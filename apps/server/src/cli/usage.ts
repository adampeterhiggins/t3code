import {
  UsageDay,
  WS_METHODS,
  type ServerConfig,
  type UsageBucket,
  type UsageLimitSourceSnapshots,
  type UsageSummary,
} from "@t3tools/contracts";
import {
  collectDegradedServices,
  collectLimitAccounts,
  collectLimitNotices,
  formatResetsIn,
  type LimitAccount,
  type LimitPresentations,
} from "@t3tools/shared/usageLimits";
import * as Clock from "effect/Clock";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { Command, Flag } from "effect/cli";

import {
  LiveRpcFailedError,
  LiveUsageError,
  jsonFlag,
  liveLocationFlags,
  printJson,
  rpc,
  withLiveRpc,
  type LiveRpcClient,
} from "./liveRpc.ts";

const DAY_MS = 86_400_000;
/** Long enough for the sources stream's replay, short enough not to stall without one. */
const LIMIT_SOURCES_WAIT = "3 seconds";

/**
 * Limit sources such as CLI Proxy reach clients only through the config
 * stream, which replays the current set right after its snapshot.
 */
const loadLimitsConfig = Effect.fn("cli.usage.loadLimitsConfig")(function* (client: LiveRpcClient) {
  const events = yield* rpc(
    client[WS_METHODS.subscribeServerConfig]({ usageLimitSources: true }).pipe(
      Stream.filter(
        (event) => event.type === "snapshot" || event.type === "usageLimitSourcesUpdated",
      ),
      Stream.take(2),
      Stream.timeout(LIMIT_SOURCES_WAIT),
      Stream.runCollect,
    ),
  );
  let config: ServerConfig | undefined;
  let sources: UsageLimitSourceSnapshots = [];
  for (const event of events) {
    if (event.type === "snapshot") config = event.config;
    if (event.type === "usageLimitSourcesUpdated") sources = event.payload.sources;
  }
  if (config === undefined) {
    return yield* new LiveRpcFailedError({ detail: "The server sent no configuration." });
  }
  return { config, sources };
});

export const limitsReport = (input: {
  readonly config: Pick<ServerConfig, "providers"> & {
    readonly environment: Pick<ServerConfig["environment"], "environmentId" | "label">;
  };
  readonly sources: UsageLimitSourceSnapshots;
}) => {
  const presentations: LimitPresentations = new Map([
    [
      input.config.environment.environmentId,
      {
        entry: { target: { label: input.config.environment.label } },
        serverConfig: { providers: input.config.providers, usageLimitSources: input.sources },
      },
    ],
  ]);
  return {
    accounts: collectLimitAccounts(presentations).map((account) => ({
      name: accountName(account),
      driver: account.driver,
      email: account.email ?? null,
      plan: account.plan ?? null,
      source: account.sourceLabel,
      checkedAt: account.limits.checkedAt,
      windows: account.limits.windows,
      resetCredits: account.limits.resetCredits ?? null,
    })),
    notices: collectLimitNotices(presentations),
    degradedServices: collectDegradedServices(presentations),
  };
};

const accountName = (account: LimitAccount) => account.displayName ?? String(account.driver);

export const formatLimitsReport = (report: ReturnType<typeof limitsReport>, now: number) => {
  const lines: Array<string> = [];
  for (const service of report.degradedServices) {
    lines.push(`${service.driver} status: ${service.description} (${service.pageUrl})`);
  }
  for (const account of report.accounts) {
    const detail = [account.email, account.plan, account.source].filter(
      (part): part is string => part !== null && part.length > 0,
    );
    if (lines.length > 0) lines.push("");
    lines.push(detail.length === 0 ? account.name : `${account.name} (${detail.join(", ")})`);
    const labelWidth = Math.max(0, ...account.windows.map((window) => window.label.length));
    for (const window of account.windows) {
      const used = `${Math.round(window.usedPercent)}% used`.padStart(9);
      const resets = formatResetsIn(window, now);
      lines.push(`  ${window.label.padEnd(labelWidth)}  ${used}${resets ? `  ${resets}` : ""}`);
    }
    if (account.resetCredits !== null && account.resetCredits.availableCount > 0) {
      lines.push(`  ${account.resetCredits.availableCount} reset credit(s) available`);
    }
  }
  if (report.notices.length > 0 && lines.length > 0) lines.push("");
  lines.push(...report.notices);
  return lines.length === 0 ? ["No provider reports subscription limits."] : lines;
};

/** The calendar day of `ms` in an IANA zone, as `YYYY-MM-DD`. */
export const dayInZone = (ms: number, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(ms);

/** `7d` (the last seven days including today), `today`, or a `YYYY-MM-DD` start day. */
export const sinceDay = (since: string, today: string) => {
  const value = since.trim().toLowerCase();
  if (value === "today") return Effect.succeed(today);
  const days = /^(\d+)d$/.exec(value);
  if (days !== null) {
    const count = Number(days[1]);
    if (count < 1) return Effect.fail(new LiveUsageError({ detail: "--since needs 1d or more." }));
    const start = Date.parse(`${today}T00:00:00Z`) - (count - 1) * DAY_MS;
    return Effect.succeed(new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(start));
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`))) {
    return value > today
      ? Effect.fail(new LiveUsageError({ detail: "--since is in the future." }))
      : Effect.succeed(value);
  }
  return Effect.fail(
    new LiveUsageError({ detail: `'${since}' is not a day. Use 7d, today, or YYYY-MM-DD.` }),
  );
};

export interface UsageRow {
  readonly provider: UsageBucket["provider"];
  readonly model: string;
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly cacheCreationTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
  readonly unpricedRecords: number;
}

/** Totals per provider and model, most expensive first. */
export const usageRows = (buckets: ReadonlyArray<UsageBucket>): ReadonlyArray<UsageRow> => {
  const rows = new Map<string, UsageRow>();
  for (const bucket of buckets) {
    const key = `${bucket.provider}\u0000${bucket.model}`;
    const previous = rows.get(key);
    rows.set(key, {
      provider: bucket.provider,
      model: bucket.model,
      inputTokens: (previous?.inputTokens ?? 0) + bucket.totals.uncachedInputTokens,
      cachedInputTokens: (previous?.cachedInputTokens ?? 0) + bucket.totals.cachedInputTokens,
      cacheCreationTokens: (previous?.cacheCreationTokens ?? 0) + bucket.totals.cacheCreationTokens,
      outputTokens: (previous?.outputTokens ?? 0) + bucket.totals.outputTokens,
      costUsd: (previous?.costUsd ?? 0) + bucket.costUsd,
      unpricedRecords: (previous?.unpricedRecords ?? 0) + bucket.unpricedRecords,
    });
  }
  return [...rows.values()].toSorted(
    (left, right) =>
      right.costUsd - left.costUsd ||
      right.inputTokens + right.outputTokens - (left.inputTokens + left.outputTokens),
  );
};

export const compactNumber = (value: number) => {
  const units = [
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "k"],
  ] as const;
  for (const [size, suffix] of units) {
    if (value >= size) return `${(value / size).toFixed(value >= size * 100 ? 0 : 1)}${suffix}`;
  }
  return String(value);
};

const usd = (value: number) => `$${value.toFixed(2)}`;

const table = (header: ReadonlyArray<string>, rows: ReadonlyArray<ReadonlyArray<string>>) => {
  const widths = header.map((cell, index) =>
    Math.max(cell.length, ...rows.map((row) => row[index]?.length ?? 0)),
  );
  // Text columns (the first two) align left, numbers right.
  const line = (row: ReadonlyArray<string>) =>
    row
      .map((cell, index) =>
        index < 2 ? cell.padEnd(widths[index] ?? 0) : cell.padStart(widths[index] ?? 0),
      )
      .join("  ")
      .trimEnd();
  return [line(header), ...rows.map(line)];
};

const loadSummary = Effect.fn("cli.usage.loadSummary")(function* (
  client: LiveRpcClient,
  since: string,
) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = dayInZone(yield* Clock.currentTimeMillis, timeZone);
  const start = yield* sinceDay(since, today);
  return yield* rpc(
    client[WS_METHODS.serverGetUsageSummary]({
      sinceDay: UsageDay.make(start),
      untilDay: UsageDay.make(today),
      timeZone,
    }),
  );
});

const summaryJson = (summary: UsageSummary, rows: ReadonlyArray<UsageRow>) => ({
  sinceDay: summary.sinceDay,
  untilDay: summary.untilDay,
  timeZone: summary.timeZone,
  rows,
  totalCostUsd: rows.reduce((sum, row) => sum + row.costUsd, 0),
  pricing: summary.pricing,
  sources: summary.sources.filter((source) => source.status !== "ok"),
});

const summaryFooter = (summary: UsageSummary, rows: ReadonlyArray<UsageRow>) => {
  const lines: Array<string> = [];
  const unpriced = rows.reduce((sum, row) => sum + row.unpricedRecords, 0);
  if (unpriced > 0) lines.push(`${unpriced} record(s) had no known price and count as $0.`);
  if (summary.pricing.status === "unavailable") lines.push("Model prices are unavailable.");
  for (const source of summary.sources) {
    if (source.status === "ok" || source.status === "missing") continue;
    lines.push(
      `${source.fingerprint.provider} history ${source.status}${source.message === null ? "" : `: ${source.message}`}`,
    );
  }
  return lines;
};

const sinceFlag = Flag.String("since").pipe(
  Flag.withDescription("First day: 7d (last seven days), today, or YYYY-MM-DD."),
  Flag.withDefault("7d"),
);

const usageTokensCommand = Command.make("tokens", {
  ...liveLocationFlags,
  since: sinceFlag,
  json: jsonFlag,
}).pipe(
  Command.withDescription(
    "Token use per provider and model, from this machine's provider history.",
  ),
  Command.withHandler((flags) =>
    withLiveRpc(
      flags,
      "t3 usage cli",
      Effect.fn("cli.usage.tokens")(function* (client) {
        const summary = yield* loadSummary(client, flags.since);
        const rows = usageRows(summary.buckets);
        if (flags.json) return yield* printJson(summaryJson(summary, rows));
        yield* Console.log(`${summary.sinceDay} to ${summary.untilDay} (${summary.timeZone})`);
        if (rows.length === 0) return yield* Console.log("No usage recorded.");
        const lines = table(
          ["provider", "model", "input", "cache read", "cache write", "output"],
          rows.map((row) => [
            row.provider,
            row.model,
            compactNumber(row.inputTokens),
            compactNumber(row.cachedInputTokens),
            compactNumber(row.cacheCreationTokens),
            compactNumber(row.outputTokens),
          ]),
        );
        for (const line of [...lines, ...summaryFooter(summary, rows)]) yield* Console.log(line);
      }),
    ),
  ),
);

const usageCostCommand = Command.make("cost", {
  ...liveLocationFlags,
  since: sinceFlag,
  json: jsonFlag,
}).pipe(
  Command.withDescription(
    "Estimated API-price cost per provider and model, from this machine's provider history.",
  ),
  Command.withHandler((flags) =>
    withLiveRpc(
      flags,
      "t3 usage cli",
      Effect.fn("cli.usage.cost")(function* (client) {
        const summary = yield* loadSummary(client, flags.since);
        const rows = usageRows(summary.buckets);
        if (flags.json) return yield* printJson(summaryJson(summary, rows));
        yield* Console.log(`${summary.sinceDay} to ${summary.untilDay} (${summary.timeZone})`);
        if (rows.length === 0) return yield* Console.log("No usage recorded.");
        const total = rows.reduce((sum, row) => sum + row.costUsd, 0);
        const lines = table(
          ["provider", "model", "cost"],
          [
            ...rows.map((row) => [row.provider, row.model, usd(row.costUsd)]),
            ["total", "", usd(total)],
          ],
        );
        for (const line of [...lines, ...summaryFooter(summary, rows)]) yield* Console.log(line);
      }),
    ),
  ),
);

export const usageCommand = Command.make("usage", { ...liveLocationFlags, json: jsonFlag }).pipe(
  Command.withDescription(
    "Show subscription limits, with reset times and provider service status.",
  ),
  Command.withHandler((flags) =>
    withLiveRpc(
      flags,
      "t3 usage cli",
      Effect.fn("cli.usage.limits")(function* (client) {
        const report = limitsReport(yield* loadLimitsConfig(client));
        if (flags.json) return yield* printJson(report);
        const now = yield* Clock.currentTimeMillis;
        for (const line of formatLimitsReport(report, now)) yield* Console.log(line);
      }),
    ),
  ),
  Command.withSubcommands([usageTokensCommand, usageCostCommand]),
);
