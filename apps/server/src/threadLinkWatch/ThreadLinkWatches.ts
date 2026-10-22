import {
  type ThreadId,
  type ThreadLinkKind,
  type ThreadLinkWatch,
  ThreadLinkWatchError,
  type ThreadLinkWatches as ThreadLinkWatchesList,
  type ThreadLinkWatchSetInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as SqlClient from "effect/sql/SqlClient";

import * as DiscordApi from "../discord/DiscordApi.ts";
import * as DiscordThreadLinks from "../discord/DiscordThreadLinks.ts";
import * as GitHubIssueThreadLinks from "../githubIssues/GitHubIssueThreadLinks.ts";
import * as GitHubIssues from "../githubIssues/GitHubIssues.ts";
import * as GranolaApi from "../granola/GranolaApi.ts";
import * as GranolaThreadLinks from "../granola/GranolaThreadLinks.ts";
import * as LinearApi from "../linear/LinearApi.ts";
import * as LinearThreadLinks from "../linear/LinearThreadLinks.ts";
import * as NotionApi from "../notion/NotionApi.ts";
import * as NotionThreadLinks from "../notion/NotionThreadLinks.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as SlackApi from "../slack/SlackApi.ts";
import * as SlackThreadLinks from "../slack/SlackThreadLinks.ts";
import {
  baselineOf,
  discordSnapshot,
  gitHubSnapshot,
  granolaSnapshot,
  type LinkBaseline,
  LinkBaselineJson,
  type LinkSnapshot,
  linearSnapshot,
  notionSnapshot,
  slackSnapshot,
  THREAD_LINK_KIND_LABELS,
} from "./linkWatchSnapshot.ts";

export interface StoredLinkWatch extends ThreadLinkWatch {
  readonly baseline: LinkBaseline;
}

/** A read of a thread's link: its contents, or why there was nothing to read. */
export type LinkRead =
  | { readonly _tag: "read"; readonly url: string; readonly snapshot: LinkSnapshot }
  | { readonly _tag: "not-linked" }
  /** The integration is turned off in settings; nothing is read until it is back on. */
  | { readonly _tag: "off" };

interface WatchRow {
  readonly threadId: string;
  readonly kind: string;
  readonly url: string;
  readonly startedAt: string;
  readonly wakes: number;
  readonly baseline: string;
}

const decodeBaseline = Schema.decodeUnknownOption(LinkBaselineJson);
const encodeBaseline = Schema.encodeSync(LinkBaselineJson);
const isThreadLinkKind = (kind: string): kind is ThreadLinkKind =>
  Object.hasOwn(THREAD_LINK_KIND_LABELS, kind);

const storageError = (cause: unknown) =>
  new ThreadLinkWatchError({
    reason: "storage",
    detail: "Could not save the link watch.",
    cause,
  });

const unreadable = (error: { readonly message: string }) =>
  new ThreadLinkWatchError({ reason: "unreadable", detail: error.message });

const publicWatch = ({ baseline: _baseline, ...watch }: StoredLinkWatch): ThreadLinkWatch => watch;

const INTEGRATION_SETTING = {
  slack: "enableSlackIntegration",
  discord: "enableDiscordIntegration",
  notion: "enableNotionIntegration",
  granola: "enableGranolaIntegration",
} as const;

export class ThreadLinkWatches extends Context.Service<
  ThreadLinkWatches,
  {
    /** Every watch in the environment, re-emitted whenever one starts, advances, or ends. */
    readonly watches: Stream.Stream<ThreadLinkWatchesList>;
    readonly list: Effect.Effect<ReadonlyArray<StoredLinkWatch>>;
    readonly forThread: (threadId: ThreadId) => Effect.Effect<ReadonlyArray<ThreadLinkWatch>>;
    /**
     * Starts watching the thread's link of `kind` from what it shows now. Watching the same link
     * again keeps the watch it has.
     */
    readonly watch: (
      threadId: ThreadId,
      kind: ThreadLinkKind,
    ) => Effect.Effect<ThreadLinkWatch, ThreadLinkWatchError>;
    /** False when the thread was not watching that kind of link. */
    readonly unwatch: (
      threadId: ThreadId,
      kind: ThreadLinkKind,
    ) => Effect.Effect<boolean, ThreadLinkWatchError>;
    readonly set: (
      input: ThreadLinkWatchSetInput,
    ) => Effect.Effect<ThreadLinkWatch | null, ThreadLinkWatchError>;
    readonly readLink: (
      threadId: ThreadId,
      kind: ThreadLinkKind,
    ) => Effect.Effect<LinkRead, ThreadLinkWatchError>;
    /** Saves what the thread was told, only while the same watch of the same link is on. */
    readonly advance: (
      watch: StoredLinkWatch,
      next: { readonly baseline: LinkBaseline; readonly wakes: number },
    ) => Effect.Effect<void>;
    /** Ends this watch; a newer one of the thread's link of that kind stays. */
    readonly end: (watch: StoredLinkWatch) => Effect.Effect<void>;
  }
>()("t3/threadLinkWatch/ThreadLinkWatches") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const settings = yield* ServerSettings.ServerSettingsService;
  const linearLinks = yield* LinearThreadLinks.LinearThreadLinks;
  const gitHubLinks = yield* GitHubIssueThreadLinks.GitHubIssueThreadLinks;
  const slackLinks = yield* SlackThreadLinks.SlackThreadLinks;
  const discordLinks = yield* DiscordThreadLinks.DiscordThreadLinks;
  const notionLinks = yield* NotionThreadLinks.NotionThreadLinks;
  const granolaLinks = yield* GranolaThreadLinks.GranolaThreadLinks;
  const linear = yield* LinearApi.LinearApi;
  const gitHub = yield* GitHubIssues.GitHubIssues;
  const slack = yield* SlackApi.SlackApi;
  const discord = yield* DiscordApi.DiscordApi;
  const notion = yield* NotionApi.NotionApi;
  const granola = yield* GranolaApi.GranolaApi;

  const read = sql<WatchRow>`
    SELECT thread_id AS "threadId", kind, url, started_at AS "startedAt", wakes, baseline
    FROM fork_thread_link_watches
    ORDER BY started_at
  `.pipe(
    Effect.map((rows) =>
      rows.flatMap((row): Array<StoredLinkWatch> => {
        const baseline = decodeBaseline(row.baseline);
        // A row this build cannot read is skipped rather than failing every other watch.
        if (!isThreadLinkKind(row.kind) || baseline._tag === "None") return [];
        return [
          {
            threadId: row.threadId as ThreadId,
            kind: row.kind,
            url: row.url,
            startedAt: row.startedAt,
            wakes: row.wakes,
            baseline: baseline.value,
          },
        ];
      }),
    ),
  );

  const stored = yield* SubscriptionRef.make(yield* read.pipe(Effect.orDie));
  const refresh = read.pipe(
    Effect.flatMap((watches) => SubscriptionRef.set(stored, watches)),
    Effect.catch((cause) => Effect.logWarning("Could not re-read thread link watches", cause)),
  );
  const list = SubscriptionRef.get(stored);

  const integrationOn = (kind: ThreadLinkKind) =>
    kind === "linear" || kind === "github"
      ? Effect.succeed(true)
      : settings.getSettings.pipe(
          Effect.map((current) => current[INTEGRATION_SETTING[kind]]),
          Effect.orElseSucceed(() => true),
        );

  const readLink = Effect.fn("ThreadLinkWatches.readLink")(function* (
    threadId: ThreadId,
    kind: ThreadLinkKind,
  ) {
    if (!(yield* integrationOn(kind))) return { _tag: "off" } as const;
    const notLinked = { _tag: "not-linked" } as const;
    const found = (url: string, snapshot: LinkSnapshot) =>
      ({ _tag: "read", url, snapshot }) as const;
    switch (kind) {
      case "linear": {
        const link = yield* linearLinks.forThread(threadId);
        if (link === undefined) return notLinked;
        const issue = yield* linear
          .getIssue({ id: link.issueId })
          .pipe(Effect.mapError(unreadable));
        return found(link.url, linearSnapshot(issue));
      }
      case "github": {
        const link = yield* gitHubLinks.forThread(threadId);
        if (link === undefined) return notLinked;
        const issue = yield* gitHub.getIssue({ url: link.url }).pipe(Effect.mapError(unreadable));
        return found(link.url, gitHubSnapshot(issue));
      }
      case "slack": {
        const link = yield* slackLinks.forThread(threadId);
        if (link === undefined) return notLinked;
        const thread = yield* slack
          .getThread({
            channelId: link.channelId,
            ts: link.threadTs,
            threadTs: link.threadTs,
            url: link.url,
            scope: "thread",
          })
          .pipe(Effect.mapError(unreadable));
        return found(link.url, slackSnapshot(thread));
      }
      case "discord": {
        const link = yield* discordLinks.forThread(threadId);
        if (link === undefined) return notLinked;
        const thread = yield* discord
          .getThread({
            guildId: link.guildId,
            channelId: link.channelId,
            messageId: link.messageId,
            url: link.url,
            scope: "thread",
          })
          .pipe(Effect.mapError(unreadable));
        return found(link.url, discordSnapshot(thread));
      }
      case "notion": {
        const link = yield* notionLinks.forThread(threadId);
        if (link === undefined) return notLinked;
        const page = yield* notion.getPage({ id: link.pageId }).pipe(Effect.mapError(unreadable));
        return found(link.url, notionSnapshot(page));
      }
      case "granola": {
        const link = yield* granolaLinks.forThread(threadId);
        if (link === undefined) return notLinked;
        const note = yield* granola.getNote({ id: link.noteId }).pipe(Effect.mapError(unreadable));
        return found(link.url, granolaSnapshot(note));
      }
    }
  });

  const requireWatchableThread = Effect.fn("ThreadLinkWatches.requireWatchableThread")(function* (
    threadId: ThreadId,
  ) {
    const unavailable = (detail: string) =>
      new ThreadLinkWatchError({ reason: "thread-unavailable", detail });
    const shell = yield* orchestrator
      .getThreadShell(threadId)
      .pipe(Effect.mapError(() => unavailable(`Could not read thread ${threadId}.`)));
    if (shell === null || shell.deletedAt !== null) {
      return yield* unavailable(`Thread ${threadId} was not found.`);
    }
    if (shell.archivedAt !== null) {
      return yield* unavailable(`Thread ${threadId} is archived and cannot watch links.`);
    }
    // A subagent reports to its parent, which owns the work the link belongs to.
    if (shell.lineage.relationshipToParent === "subagent") {
      return yield* unavailable(
        `Thread ${threadId} is a subagent; its parent thread watches links.`,
      );
    }
  });

  const findWatch = (threadId: ThreadId, kind: ThreadLinkKind) =>
    list.pipe(
      Effect.map((watches) =>
        watches.find((watch) => watch.threadId === threadId && watch.kind === kind),
      ),
    );

  const watch = Effect.fn("ThreadLinkWatches.watch")(function* (
    threadId: ThreadId,
    kind: ThreadLinkKind,
  ) {
    yield* requireWatchableThread(threadId);
    const label = THREAD_LINK_KIND_LABELS[kind];
    const current = yield* readLink(threadId, kind);
    if (current._tag === "off") {
      return yield* new ThreadLinkWatchError({
        reason: "unreadable",
        detail: `The ${label.split(" ")[0]} integration is turned off in Settings → Integrations.`,
      });
    }
    if (current._tag === "not-linked") {
      return yield* new ThreadLinkWatchError({
        reason: "not-linked",
        detail: `Thread ${threadId} has no linked ${label}. Link one first.`,
      });
    }
    const existing = yield* findWatch(threadId, kind);
    if (existing !== undefined && existing.url === current.url) return publicWatch(existing);
    const startedAt = DateTime.formatIso(yield* DateTime.now);
    yield* sql`
      INSERT INTO fork_thread_link_watches (thread_id, kind, url, started_at, wakes, baseline)
      VALUES (${threadId}, ${kind}, ${current.url}, ${startedAt}, 0,
        ${encodeBaseline(baselineOf(current.snapshot))})
      ON CONFLICT (thread_id, kind) DO UPDATE SET url = excluded.url,
        started_at = excluded.started_at, wakes = 0, baseline = excluded.baseline
    `.pipe(Effect.mapError(storageError));
    yield* refresh;
    return { threadId, kind, url: current.url, startedAt, wakes: 0 } satisfies ThreadLinkWatch;
  });

  const unwatch = Effect.fn("ThreadLinkWatches.unwatch")(function* (
    threadId: ThreadId,
    kind: ThreadLinkKind,
  ) {
    const existing = yield* findWatch(threadId, kind);
    yield* sql`
      DELETE FROM fork_thread_link_watches WHERE thread_id = ${threadId} AND kind = ${kind}
    `.pipe(Effect.mapError(storageError));
    yield* refresh;
    return existing !== undefined;
  });

  const advance = Effect.fn("ThreadLinkWatches.advance")(function* (
    current: StoredLinkWatch,
    next: { readonly baseline: LinkBaseline; readonly wakes: number },
  ) {
    yield* sql`
      UPDATE fork_thread_link_watches SET baseline = ${encodeBaseline(next.baseline)},
        wakes = ${next.wakes}
      WHERE thread_id = ${current.threadId} AND kind = ${current.kind}
        AND started_at = ${current.startedAt} AND url = ${current.url}
    `.pipe(Effect.catch((cause) => Effect.logWarning("Could not save a thread link watch", cause)));
    yield* refresh;
  });

  const end = Effect.fn("ThreadLinkWatches.end")(function* (current: StoredLinkWatch) {
    yield* sql`
      DELETE FROM fork_thread_link_watches
      WHERE thread_id = ${current.threadId} AND kind = ${current.kind}
        AND started_at = ${current.startedAt} AND url = ${current.url}
    `.pipe(Effect.catch((cause) => Effect.logWarning("Could not end a thread link watch", cause)));
    yield* refresh;
  });

  return ThreadLinkWatches.of({
    watches: SubscriptionRef.changes(stored).pipe(
      Stream.map((watches) => watches.map(publicWatch)),
    ),
    list,
    forThread: Effect.fn("ThreadLinkWatches.forThread")(function* (threadId: ThreadId) {
      const watches = yield* list;
      return watches.filter((entry) => entry.threadId === threadId).map(publicWatch);
    }),
    watch,
    unwatch,
    set: Effect.fn("ThreadLinkWatches.set")(function* (input: ThreadLinkWatchSetInput) {
      if (input.watching) return yield* watch(input.threadId, input.kind);
      yield* unwatch(input.threadId, input.kind);
      return null;
    }),
    readLink,
    advance,
    end,
  });
});

export const layer = Layer.effect(ThreadLinkWatches, make);
