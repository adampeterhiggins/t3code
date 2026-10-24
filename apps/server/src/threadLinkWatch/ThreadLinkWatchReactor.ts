import { CommandId, MessageId, type ThreadLinkKind } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import type * as Scope from "effect/Scope";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import { forkParked } from "../serverActivation.ts";
import {
  baselineOf,
  diffLinkSnapshot,
  linkWatchMessage,
  linkWatchUnreadableMessage,
  THREAD_LINK_WATCH_WAKE_LIMIT,
} from "./linkWatchSnapshot.ts";
import * as ThreadLinkWatches from "./ThreadLinkWatches.ts";

const SWEEP_INTERVAL = "1 minute";
const READ_FAILURE_LIMIT = 8;

/**
 * How often each kind is read. Chat threads move fastest. Notion and Granola reads walk the
 * whole document, so they are the slowest.
 */
const READ_EVERY_MS: Record<ThreadLinkKind, number> = {
  slack: 60_000,
  discord: 60_000,
  linear: 2 * 60_000,
  github: 2 * 60_000,
  notion: 5 * 60_000,
  google: 5 * 60_000,
  granola: 5 * 60_000,
};

const watchKey = (watch: ThreadLinkWatches.StoredLinkWatch) =>
  `${watch.threadId} ${watch.kind} ${watch.startedAt}`;

/**
 * Wakes a thread's agent when a link it watches (`watch_thread_link`) changes: new or edited
 * messages in a Slack or Discord thread, a Linear or GitHub issue's status, assignee, title, or
 * content, or an edited Notion page or Granola note. Like the pull request watch, the server
 * reads each link on a schedule and the thread is woken only when something changed.
 *
 * Changes are held while the thread is running and arrive as one wake after it finishes, so a
 * busy thread is not queued a wake per read. Archiving, deleting, or unlinking ends a watch, as
 * does a closed issue or the wake limit.
 */
export class ThreadLinkWatchReactor extends Context.Service<
  ThreadLinkWatchReactor,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly sweep: Effect.Effect<void>;
  }
>()("t3/threadLinkWatch/ThreadLinkWatchReactor") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const engine = yield* Orchestrator.OrchestratorV2;
  const watches = yield* ThreadLinkWatches.ThreadLinkWatches;
  const lastReadAt = new Map<string, number>();
  const failures = new Map<string, number>();

  const forget = (watch: ThreadLinkWatches.StoredLinkWatch) => {
    lastReadAt.delete(watchKey(watch));
    failures.delete(watchKey(watch));
  };

  const ended = Effect.fn("ThreadLinkWatchReactor.ended")(function* (
    watch: ThreadLinkWatches.StoredLinkWatch,
    reason: string,
  ) {
    forget(watch);
    yield* watches.end(watch);
    yield* Effect.logInfo("thread link watch ended", {
      threadId: watch.threadId,
      kind: watch.kind,
      reason,
      wakes: watch.wakes,
    });
  });

  // The ids follow from the watch and its wake count, so a wake that is dispatched again after
  // its save failed is the same command, which the orchestrator runs once.
  const wake = (
    watch: ThreadLinkWatches.StoredLinkWatch,
    wakes: number,
    message: ReturnType<typeof linkWatchMessage>,
  ) => {
    const id = `link-watch:${watch.threadId}:${watch.kind}:${watch.startedAt}:${wakes}`;
    return engine.dispatch({
      type: "thread.link-watch.wake",
      commandId: CommandId.make(`server:${id}`),
      threadId: watch.threadId,
      messageId: MessageId.make(`message:${id}`),
      text: message.text,
      notification: message.notification,
    });
  };

  const check = Effect.fn("ThreadLinkWatchReactor.check")(function* (
    watch: ThreadLinkWatches.StoredLinkWatch,
    now: number,
  ) {
    const key = watchKey(watch);
    if (now - (lastReadAt.get(key) ?? Number.NEGATIVE_INFINITY) < READ_EVERY_MS[watch.kind]) {
      return;
    }
    const shell = yield* engine.getThreadShell(watch.threadId);
    if (shell === null || shell.deletedAt !== null) return yield* ended(watch, "deleted");
    if (shell.archivedAt !== null) return yield* ended(watch, "archived");
    if (shell.lineage.relationshipToParent === "subagent") return yield* ended(watch, "subagent");
    // What changed while the thread runs reaches it as one wake once it finishes.
    if (shell.activeRunId !== null) return;

    const read = yield* Effect.result(watches.readLink(watch.threadId, watch.kind));
    if (read._tag === "Failure") {
      const count = (failures.get(key) ?? 0) + 1;
      failures.set(key, count);
      if (count < READ_FAILURE_LIMIT) return;
      yield* wake(
        watch,
        watch.wakes + 1,
        linkWatchUnreadableMessage({
          kind: watch.kind,
          url: watch.url,
          failures: count,
          detail: read.failure.detail,
        }),
      ).pipe(Effect.ignore);
      return yield* ended(watch, "unreadable");
    }
    lastReadAt.set(key, now);
    failures.delete(key);
    const result = read.success;
    if (result._tag === "off") return;
    if (result._tag === "not-linked") return yield* ended(watch, "unlinked");
    if (result.url !== watch.url) return yield* ended(watch, "replaced");

    const change = diffLinkSnapshot(watch.baseline, result.snapshot);
    if (change === null) return;
    const wakes = watch.wakes + 1;
    const outcome = result.snapshot.closed
      ? "closed"
      : wakes >= THREAD_LINK_WATCH_WAKE_LIMIT
        ? "limit"
        : "watching";
    const woke = yield* Effect.exit(
      wake(
        watch,
        wakes,
        linkWatchMessage({
          kind: watch.kind,
          url: watch.url,
          snapshot: result.snapshot,
          change,
          outcome,
        }),
      ),
    );
    // The orchestrator turns a wake away once the thread archives or becomes unwakeable.
    if (woke._tag === "Failure") return yield* ended(watch, "wake rejected");
    if (outcome !== "watching") return yield* ended(watch, outcome);
    yield* watches.advance(watch, { baseline: baselineOf(result.snapshot), wakes });
  });

  const sweep = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const current = yield* watches.list;
    const live = new Set(current.map(watchKey));
    for (const key of lastReadAt.keys()) if (!live.has(key)) lastReadAt.delete(key);
    for (const key of failures.keys()) if (!live.has(key)) failures.delete(key);
    yield* Effect.forEach(
      current,
      (watch) =>
        check(watch, now).pipe(
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.interrupt
              : Effect.logWarning("thread link watch check failed", {
                  threadId: watch.threadId,
                  kind: watch.kind,
                  cause,
                }),
          ),
        ),
      { concurrency: 4, discard: true },
    );
  }).pipe(Effect.withSpan("ThreadLinkWatchReactor.sweep"));

  const start = () =>
    forkParked(sweep.pipe(Effect.repeat(Schedule.spaced(SWEEP_INTERVAL)), Effect.asVoid));

  return ThreadLinkWatchReactor.of({ start, sweep });
});

const layer = Layer.effect(ThreadLinkWatchReactor, make);

/** Builds the reactor and sweeps for the server's lifetime. */
export const layerStarted = Layer.effectDiscard(
  Effect.gen(function* () {
    const reactor = yield* ThreadLinkWatchReactor;
    yield* reactor.start();
  }),
).pipe(Layer.provide(layer));
