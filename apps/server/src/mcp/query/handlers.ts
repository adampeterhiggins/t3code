import { ThreadId, UsageDay } from "@t3tools/contracts";
import { parseChangeRequestUrl } from "@t3tools/shared/changeRequestUrl";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlError from "effect/unstable/sql/SqlError";

import * as CheckpointDiffQuery from "../../checkpointing/CheckpointDiffQuery.ts";
import * as ServerEnvironment from "../../environment/ServerEnvironment.ts";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { UsageService } from "../../usage/UsageService.ts";
import {
  type CursorKey,
  makeQueryStore,
  OPEN_WINDOW,
  type Order,
  type Page,
  type PageRequest,
  type Window,
} from "./store.ts";
import { QueryToolError, QueryToolkit } from "./tools.ts";

const GUIDE = [
  "All tools are read-only and see what the user sees in T3 Code.",
  "For a day's work: list_threads with activeSince/activeUntil from today's bounds, then get_thread or list_turns on the threads that matter.",
  "list_messages with role=user shows what was asked; get_turn shows what an agent did about one prompt; get_turn_diff shows the code it changed.",
  "get_activity_timeline orders every prompt, finished turn, plan, pull request link and error in a range.",
  "list_pull_requests and list_plans cover shipped and planned work; search finds text anywhere.",
  "Pass until to cut everything off at an instant. Titles, archive state and pull request state are current, not as of until.",
].join(" ");

/**
 * A failed query is a server fault the agent cannot fix, so it dies and the
 * MCP layer reports it as an internal error; QueryToolError stays a result
 * the agent can act on.
 */
const sqlDies = <A, R>(
  effect: Effect.Effect<A, QueryToolError | SqlError.SqlError, R>,
): Effect.Effect<A, QueryToolError, R> => effect.pipe(Effect.catchTag("SqlError", Effect.die));

/** Stored times are ISO UTC with milliseconds, so bounds must be too to compare as text. */
const toStoredInstant = (value: string) =>
  Effect.fromOption(DateTime.make(value)).pipe(
    Effect.map((instant) => DateTime.formatIso(DateTime.toUtc(instant))),
    Effect.mapError(() => new QueryToolError({ reason: `${value} is not a valid time.` })),
  );

const windowOf = Effect.fn("QueryToolkit.windowOf")(function* (
  since: string | undefined,
  until: string | undefined,
) {
  const window: Window = {
    since: since === undefined ? OPEN_WINDOW.since : yield* toStoredInstant(since),
    until: until === undefined ? OPEN_WINDOW.until : yield* toStoredInstant(until),
  };
  if (window.since >= window.until) {
    return yield* new QueryToolError({ reason: "since must be earlier than until." });
  }
  return window;
});

const CursorJson = Schema.fromJsonString(
  Schema.Array(Schema.Union([Schema.String, Schema.Number])),
);
const encodeCursorJson = Schema.encodeSync(CursorJson);
const decodeCursorJson = Schema.decodeUnknownOption(CursorJson);

const encodeCursor = (key: CursorKey | null) =>
  key === null ? null : Buffer.from(encodeCursorJson(key)).toString("base64url");

const decodeCursor = (cursor: string | undefined) =>
  cursor === undefined
    ? Effect.succeed(null)
    : Effect.fromOption(
        decodeCursorJson(Buffer.from(cursor, "base64url").toString("utf8")).pipe(
          Option.filter((key) => key.length > 0),
        ),
      ).pipe(
        Effect.mapError(
          () =>
            new QueryToolError({ reason: "This cursor is not valid. Start again without one." }),
        ),
      );

const pageRequest = Effect.fn("QueryToolkit.pageRequest")(function* (input: {
  readonly order?: Order | undefined;
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
  readonly defaultLimit: number;
}) {
  return {
    order: input.order ?? "desc",
    limit: input.limit ?? input.defaultLimit,
    after: yield* decodeCursor(input.cursor),
  } satisfies PageRequest;
});

const withCursor = <A>(page: Page<A>) => ({
  items: page.items,
  nextCursor: encodeCursor(page.nextKey),
});

const notFound = (what: string, id: string) =>
  new QueryToolError({ reason: `No ${what} ${id} was found. It may have been deleted.` });

const requireFound = <A>(value: A | null, what: string, id: string) =>
  value === null ? Effect.fail(notFound(what, id)) : Effect.succeed(value);

const todayIn = (now: DateTime.Utc, timeZone: string) =>
  Option.map(DateTime.setZoneNamed(now, timeZone), (zoned) => {
    const start = DateTime.startOf(zoned, "day");
    return {
      since: DateTime.formatIsoOffset(start),
      until: DateTime.formatIsoOffset(DateTime.add(start, { days: 1 })),
    };
  });

const make = Effect.gen(function* () {
  const store = yield* makeQueryStore;
  const environment = yield* ServerEnvironment.ServerEnvironment;
  const checkpointDiffs = yield* CheckpointDiffQuery.CheckpointDiffQuery;
  const providers = yield* ProviderService;
  const usage = yield* UsageService;

  const requireThread = Effect.fn("QueryToolkit.requireThread")(function* (threadId: string) {
    if (!(yield* store.threadExists(threadId))) {
      return yield* notFound("thread", threadId);
    }
  });

  return QueryToolkit.of({
    get_environment: (input) =>
      Effect.gen(function* () {
        const descriptor = yield* environment.getDescriptor;
        const counts = yield* store.countEnvironment();
        const now = yield* DateTime.now;
        const serverZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const timeZone = input.timeZone ?? serverZone;
        const today = yield* Effect.fromOption(todayIn(now, timeZone)).pipe(
          Effect.mapError(
            () => new QueryToolError({ reason: `${timeZone} is not a known time zone.` }),
          ),
        );
        return {
          environmentId: descriptor.environmentId,
          label: descriptor.label,
          platform: descriptor.platform,
          serverVersion: descriptor.serverVersion,
          now: DateTime.formatIso(now),
          timeZone,
          today,
          counts,
          guide: GUIDE,
        };
      }).pipe(sqlDies),

    get_activity_timeline: (input) =>
      Effect.gen(function* () {
        const page = yield* store.timeline(
          {
            window: yield* windowOf(input.since, input.until),
            projectId: input.projectId,
            threadId: input.threadId,
            kinds: input.kinds,
          },
          yield* pageRequest({ ...input, defaultLimit: 100 }),
        );
        const { items, nextCursor } = withCursor(page);
        return { entries: items, nextCursor };
      }).pipe(sqlDies),

    list_projects: (input) =>
      Effect.gen(function* () {
        const window =
          input.activeSince === undefined && input.activeUntil === undefined
            ? undefined
            : yield* windowOf(input.activeSince, input.activeUntil);
        const page = yield* store.listProjects(
          window,
          yield* pageRequest({ ...input, defaultLimit: 50 }),
        );
        const { items, nextCursor } = withCursor(page);
        return { projects: items, nextCursor };
      }).pipe(sqlDies),

    get_project: (input) =>
      store.getProject(input.projectId).pipe(
        sqlDies,
        Effect.flatMap((project) => requireFound(project, "project", input.projectId)),
      ),

    list_threads: (input) =>
      Effect.gen(function* () {
        const window =
          input.activeSince === undefined && input.activeUntil === undefined
            ? undefined
            : yield* windowOf(input.activeSince, input.activeUntil);
        const page = yield* store.listThreads(
          {
            projectId: input.projectId,
            window,
            archived: input.archived,
            needsAttention: input.needsAttention,
            hasPullRequest: input.hasPullRequest,
            provider: input.provider,
            branch: input.branch,
            titleContains: input.titleContains,
          },
          yield* pageRequest({ ...input, defaultLimit: 25 }),
        );
        const { items, nextCursor } = withCursor(page);
        return { threads: items, nextCursor };
      }).pipe(sqlDies),

    get_thread: (input) =>
      store.getThreadDetail(input.threadId).pipe(
        sqlDies,
        Effect.flatMap((thread) => requireFound(thread, "thread", input.threadId)),
      ),

    list_turns: (input) =>
      Effect.gen(function* () {
        yield* requireThread(input.threadId);
        const page = yield* store.listTurns(
          {
            threadId: input.threadId,
            window: yield* windowOf(input.since, input.until),
            maxChars: input.maxChars ?? 400,
          },
          yield* pageRequest({ ...input, defaultLimit: 20 }),
        );
        const { items, nextCursor } = withCursor(page);
        return { turns: items, nextCursor };
      }).pipe(sqlDies),

    get_turn: (input) =>
      Effect.gen(function* () {
        yield* requireThread(input.threadId);
        const turn = yield* store.getTurn({
          threadId: input.threadId,
          turnId: input.turnId,
          maxChars: input.maxChars ?? 20_000,
        });
        return yield* requireFound(turn, "turn", input.turnId);
      }).pipe(sqlDies),

    list_messages: (input) =>
      Effect.gen(function* () {
        const page = yield* store.listMessages(
          {
            threadId: input.threadId,
            projectId: input.projectId,
            role: input.role ?? "any",
            includeReasoning: input.includeReasoning ?? false,
            window: yield* windowOf(input.since, input.until),
            maxChars: input.maxChars ?? 500,
          },
          yield* pageRequest({ ...input, defaultLimit: 25 }),
        );
        const { items, nextCursor } = withCursor(page);
        return { messages: items, nextCursor };
      }).pipe(sqlDies),

    get_message: (input) =>
      store.getMessage(input.messageId, input.maxChars ?? 50_000).pipe(
        sqlDies,
        Effect.flatMap((message) => requireFound(message, "message", input.messageId)),
      ),

    search: (input) =>
      Effect.gen(function* () {
        return yield* store.search({
          query: input.query,
          projectId: input.projectId,
          threadId: input.threadId,
          role: input.role ?? "any",
          window: yield* windowOf(input.since, input.until),
          limit: input.limit ?? 20,
        });
      }).pipe(sqlDies),

    list_activities: (input) =>
      Effect.gen(function* () {
        const page = yield* store.listActivities(
          {
            threadId: input.threadId,
            turnId: input.turnId,
            projectId: input.projectId,
            tone: input.tone,
            kinds: input.kinds,
            window: yield* windowOf(input.since, input.until),
          },
          yield* pageRequest({ ...input, defaultLimit: 50 }),
        );
        const { items, nextCursor } = withCursor(page);
        return { activities: items, nextCursor };
      }).pipe(sqlDies),

    get_activity: (input) =>
      store.getActivity(input.activityId, input.maxChars ?? 20_000).pipe(
        sqlDies,
        Effect.flatMap((activity) => requireFound(activity, "activity", input.activityId)),
      ),

    get_subagent_transcript: (input) =>
      Effect.gen(function* () {
        yield* requireThread(input.threadId).pipe(sqlDies);
        return yield* providers
          .readSubagentTranscript({ threadId: ThreadId.make(input.threadId), taskId: input.taskId })
          .pipe(Effect.mapError((error) => new QueryToolError({ reason: error.message })));
      }),

    list_plans: (input) =>
      Effect.gen(function* () {
        const page = yield* store.listPlans(
          {
            threadId: input.threadId,
            projectId: input.projectId,
            implemented: input.implemented,
            window: yield* windowOf(input.since, input.until),
          },
          yield* pageRequest({ ...input, defaultLimit: 20 }),
        );
        const { items, nextCursor } = withCursor(page);
        return { plans: items, nextCursor };
      }).pipe(sqlDies),

    get_plan: (input) =>
      store.getPlan(input.planId, input.maxChars ?? 50_000).pipe(
        sqlDies,
        Effect.flatMap((plan) => requireFound(plan, "plan", input.planId)),
      ),

    get_turn_diff: (input) =>
      Effect.gen(function* () {
        yield* requireThread(input.threadId).pipe(sqlDies);
        const range = yield* resolveTurnRange(input).pipe(sqlDies);
        const files = yield* store
          .filesBetween({ threadId: input.threadId, ...range })
          .pipe(sqlDies);
        if (input.includePatch !== true) {
          return { threadId: input.threadId, ...range, files, patch: null, truncated: false };
        }
        const maxChars = input.maxChars ?? 20_000;
        const diff = yield* checkpointDiffs
          .getTurnDiff({ threadId: ThreadId.make(input.threadId), ...range })
          .pipe(
            Effect.mapError(
              (error) =>
                new QueryToolError({ reason: `The patch is not available: ${error.message}` }),
            ),
          );
        const truncated = diff.diff.length > maxChars;
        return {
          threadId: input.threadId,
          ...range,
          files,
          patch: truncated ? `${diff.diff.slice(0, maxChars)}…` : diff.diff,
          truncated,
        };
      }),

    list_pull_requests: (input) =>
      Effect.gen(function* () {
        const page = yield* store.listPullRequests(
          {
            threadId: input.threadId,
            projectId: input.projectId,
            state: input.state,
            window: yield* windowOf(input.since, input.until),
          },
          yield* pageRequest({ ...input, defaultLimit: 25 }),
        );
        const { items, nextCursor } = withCursor(page);
        return { pullRequests: items, nextCursor };
      }).pipe(sqlDies),

    get_pull_request: (input) =>
      Effect.gen(function* () {
        const parsed = input.url === undefined ? null : parseChangeRequestUrl(input.url);
        if (input.url !== undefined && parsed === null) {
          return yield* new QueryToolError({
            reason:
              "This is not a recognised pull request URL. Pass repository and number instead.",
          });
        }
        const key =
          parsed !== null
            ? { host: parsed.host, repository: parsed.repository, number: parsed.number }
            : input.repository !== undefined && input.number !== undefined
              ? { host: null, repository: input.repository, number: input.number }
              : null;
        if (key === null) {
          return yield* new QueryToolError({ reason: "Pass url, or both repository and number." });
        }
        const links = yield* store.getPullRequest(key).pipe(sqlDies);
        if (links.length === 0) {
          return yield* new QueryToolError({
            reason: `${key.repository}#${key.number} is not linked to any thread.`,
          });
        }
        return { links };
      }),

    get_usage_summary: (input) =>
      usage
        .readSummary({
          ...input,
          sinceDay: UsageDay.make(input.sinceDay),
          untilDay: UsageDay.make(input.untilDay),
        })
        .pipe(Effect.mapError((error) => new QueryToolError({ reason: error.message }))),
  });

  function resolveTurnRange(input: {
    readonly threadId: string;
    readonly turnId?: string | undefined;
    readonly fromTurnCount?: number | undefined;
    readonly toTurnCount?: number | undefined;
  }) {
    return Effect.gen(function* () {
      if (input.turnId !== undefined) {
        const turn = yield* store.turnCountOf(input.threadId, input.turnId);
        if (turn === undefined) return yield* notFound("turn", input.turnId);
        if (turn.turnCount === null) {
          return yield* new QueryToolError({
            reason: "This turn has no checkpoint yet, so there is nothing to diff.",
          });
        }
        return { fromTurnCount: turn.turnCount - 1, toTurnCount: turn.turnCount };
      }
      if (input.toTurnCount === undefined) {
        return yield* new QueryToolError({ reason: "Pass turnId, or toTurnCount for a range." });
      }
      const fromTurnCount = input.fromTurnCount ?? input.toTurnCount - 1;
      if (fromTurnCount >= input.toTurnCount) {
        return yield* new QueryToolError({ reason: "fromTurnCount must be below toTurnCount." });
      }
      return { fromTurnCount, toTurnCount: input.toTurnCount };
    });
  }
});

export const QueryToolkitHandlersLive = QueryToolkit.toLayer(make);
