/**
 * ProviderServiceStatus — the public status-page rollup for each provider
 * that publishes one.
 *
 * Statuspage's `minor` indicator is the "Partially Degraded Service" state.
 * A page that cannot be read keeps the previous rollup, so a blip does not
 * clear a real degradation. Providers without a status feed are omitted.
 *
 * @module provider/providerServiceStatus
 */
import {
  ProviderDriverKind,
  type ServerProvider,
  type ServerProviderServiceStatus,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

import * as BackgroundPolicy from "../background/BackgroundPolicy.ts";

const StatuspageBody = Schema.Struct({
  status: Schema.Struct({
    indicator: Schema.Literals(["none", "minor", "major", "critical"]),
    description: Schema.String,
  }),
});
const decodeStatuspage = Schema.decodeUnknownOption(StatuspageBody);

export interface ProviderServiceReport {
  readonly driver: ProviderDriverKind;
  readonly status: ServerProviderServiceStatus;
}

/**
 * Statuspage v2 feeds verified to return `{ status: { indicator, description } }`.
 * Grok's host is included because it publishes the same feed; it currently
 * rejects non-browser clients, and a rejected read is left unpublished.
 */
const STATUS_PAGES = [
  {
    driver: ProviderDriverKind.make("claudeAgent"),
    statusUrl: "https://status.claude.com/api/v2/status.json",
    pageUrl: "https://status.claude.com",
  },
  {
    driver: ProviderDriverKind.make("codex"),
    statusUrl: "https://status.openai.com/api/v2/status.json",
    pageUrl: "https://status.openai.com",
  },
  {
    driver: ProviderDriverKind.make("cursor"),
    statusUrl: "https://status.cursor.com/api/v2/status.json",
    pageUrl: "https://status.cursor.com",
  },
  {
    driver: ProviderDriverKind.make("devin"),
    statusUrl: "https://www.devinstatus.com/api/v2/status.json",
    pageUrl: "https://www.devinstatus.com",
  },
  {
    driver: ProviderDriverKind.make("grok"),
    statusUrl: "https://status.x.ai/api/v2/status.json",
    pageUrl: "https://status.x.ai",
  },
] as const;

export function serviceStatusFromBody(
  pageUrl: string,
  checkedAt: string,
  body: unknown,
): ServerProviderServiceStatus | undefined {
  const decoded = decodeStatuspage(body);
  if (Option.isNone(decoded)) return undefined;
  const description = decoded.value.status.description.trim();
  if (!description) return undefined;
  return {
    indicator: decoded.value.status.indicator,
    description,
    pageUrl,
    checkedAt,
  };
}

function sameReport(left: ProviderServiceReport, right: ProviderServiceReport): boolean {
  return (
    left.driver === right.driver &&
    left.status.indicator === right.status.indicator &&
    left.status.description === right.status.description &&
    left.status.pageUrl === right.status.pageUrl
  );
}

/** Attach the latest rollup, and drop one a provider no longer has. */
export function withProviderServiceStatus(
  providers: readonly ServerProvider[],
  reports: readonly ProviderServiceReport[],
): readonly ServerProvider[] {
  const byDriver = new Map(reports.map((report) => [report.driver, report.status] as const));
  let changed = false;
  const next = providers.map((provider) => {
    const incoming = byDriver.get(provider.driver);
    const current = provider.serviceStatus;
    if (!incoming) {
      if (!current) return provider;
      changed = true;
      const { serviceStatus: _dropped, ...rest } = provider;
      return rest;
    }
    if (
      current &&
      current.indicator === incoming.indicator &&
      current.description === incoming.description &&
      current.pageUrl === incoming.pageUrl
    ) {
      return provider;
    }
    changed = true;
    return { ...provider, serviceStatus: incoming };
  });
  return changed ? next : providers;
}

export class ProviderServiceStatus extends Context.Service<
  ProviderServiceStatus,
  {
    readonly current: Effect.Effect<ReadonlyArray<ProviderServiceReport>>;
    readonly streamChanges: Stream.Stream<ReadonlyArray<ProviderServiceReport>>;
  }
>()("t3/provider/providerServiceStatus") {}

const readPage = (page: (typeof STATUS_PAGES)[number], checkedAt: string) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const response = yield* client.execute(
      HttpClientRequest.get(page.statusUrl).pipe(
        HttpClientRequest.setHeader("accept", "application/json"),
      ),
    );
    const body = yield* HttpClientResponse.schemaBodyJson(Schema.Unknown)(
      yield* HttpClientResponse.filterStatusOk(response),
    );
    const status = serviceStatusFromBody(page.pageUrl, checkedAt, body);
    if (!status) return yield* Effect.fail("unrecognized status page");
    return { driver: page.driver, status } satisfies ProviderServiceReport;
  }).pipe(Effect.timeout("10 seconds"), Effect.option);

/** One pass over the status pages. A failed page keeps its previous rollup. */
export const readProviderServiceReports = Effect.fn("readProviderServiceReports")(function* (
  previous: ReadonlyArray<ProviderServiceReport>,
) {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const reads = yield* Effect.forEach(STATUS_PAGES, (page) => readPage(page, checkedAt), {
    concurrency: 4,
  });
  return STATUS_PAGES.flatMap((page, index) => {
    const read = reads[index];
    if (read && Option.isSome(read)) return [read.value];
    const kept = previous.find((report) => report.driver === page.driver);
    return kept ? [kept] : [];
  });
});

const make = Effect.gen(function* () {
  const backgroundPolicy = yield* BackgroundPolicy.BackgroundPolicy;
  const stateRef = yield* Ref.make<ReadonlyArray<ProviderServiceReport>>([]);
  const changes = yield* Effect.acquireRelease(
    PubSub.unbounded<ReadonlyArray<ProviderServiceReport>>(),
    PubSub.shutdown,
  );

  const refresh = Effect.gen(function* () {
    const previous = yield* Ref.get(stateRef);
    const next = yield* readProviderServiceReports(previous);
    if (
      next.length === previous.length &&
      next.every((report, index) => previous[index] && sameReport(report, previous[index]))
    ) {
      return;
    }
    yield* Ref.set(stateRef, next);
    yield* PubSub.publish(changes, next);
  }).pipe(Effect.ignoreCause({ log: true }));

  yield* Effect.forever(
    Effect.sleep("5 minutes").pipe(
      Effect.andThen(backgroundPolicy.shouldRunScopeWork({ type: "provider-status" })),
      Effect.flatMap((shouldRun) => (shouldRun ? refresh : Effect.void)),
      Effect.ignoreCause({ log: true }),
    ),
  ).pipe(Effect.forkScoped);
  yield* refresh.pipe(Effect.forkScoped);

  return {
    current: Ref.get(stateRef),
    get streamChanges() {
      return Stream.unwrap(
        Effect.gen(function* () {
          const subscription = yield* PubSub.subscribe(changes);
          const snapshot = yield* Ref.get(stateRef);
          return Stream.concat(Stream.make(snapshot), Stream.fromSubscription(subscription)).pipe(
            Stream.changes,
          );
        }),
      );
    },
  } satisfies ProviderServiceStatus["Service"];
});

export const layer = Layer.effect(ProviderServiceStatus, make);
