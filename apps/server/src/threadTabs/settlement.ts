import {
  CommandId,
  ThreadId,
  type OrchestrationV2StoredEvent,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import { backgroundWorkHoldsCompletion } from "@t3tools/shared/orchestrationV2PendingBackgroundWork";
import { visibleThreadPullRequests } from "@t3tools/shared/threadPullRequests";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import { threadHasQueuedTurnStart } from "../orchestration-v2/ThreadSettlementService.ts";
import { OrchestrationEventStore } from "../persistence/Services/OrchestrationEventStore.ts";
import { forkParked } from "../serverActivation.ts";

/**
 * A tab group shows as one sidebar row, so the group settles as a unit. Upstream settles each
 * thread on its own; this reactor mirrors every settle and unsettle across the group.
 *
 * - A new run or an unsettle in any tab wakes the group's settled tabs.
 * - A settle in any tab settles the rest of the group, unless another tab is still working
 *   (or, for an automatic settle, has an open pull request). Then the settle is undone, since
 *   the row it stands for is not done.
 */
export class ThreadTabSettlementReactor extends Context.Service<
  ThreadTabSettlementReactor,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly drain: Effect.Effect<void>;
  }
>()("t3/threadTabs/settlement/ThreadTabSettlementReactor") {}

type SettlementJob =
  | { readonly kind: "wake"; readonly threadId: ThreadId }
  | { readonly kind: "settle"; readonly threadId: ThreadId; readonly automatic: boolean };

// ThreadSettlementServiceV2's sweep issues every automatic settle under this command id prefix.
const AUTO_SETTLE_COMMAND_PREFIX = "server:auto-settle:";

/**
 * Mirrors the settle guards (the orchestrator's and the auto-settle sweep's), so a mirrored
 * settle is not rejected. An automatic settle also waits on a sibling's open pull request, as
 * the sweep does.
 */
function blocksSettlement(
  thread: OrchestrationV2ThreadShell,
  nowMs: number,
  automatic: boolean,
): boolean {
  if (
    automatic &&
    visibleThreadPullRequests(thread.pullRequests ?? []).some(
      (link) => link.snapshot === null || link.snapshot.state === "open",
    )
  ) {
    return true;
  }
  return (
    thread.activityRunStatus != null ||
    thread.pendingRuntimeRequest !== null ||
    backgroundWorkHoldsCompletion(thread.pendingBackgroundTasks ?? []) ||
    threadHasQueuedTurnStart(thread, nowMs)
  );
}

/** The job an event asks for, if any. */
function jobFor(stored: OrchestrationV2StoredEvent): SettlementJob | null {
  const { event } = stored;
  switch (event.type) {
    case "run.created":
    case "thread.unsettled":
      return { kind: "wake", threadId: event.threadId };
    case "thread.settled":
      return {
        kind: "settle",
        threadId: event.threadId,
        automatic: stored.commandId?.startsWith(AUTO_SETTLE_COMMAND_PREFIX) ?? false,
      };
    default:
      return null;
  }
}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const eventStore = yield* OrchestrationEventStore;
  const sql = yield* SqlClient.SqlClient;
  const crypto = yield* Crypto.Crypto;

  const readSiblings = Effect.fn("ThreadTabSettlementReactor.readSiblings")(function* (
    threadId: ThreadId,
  ) {
    const rows = yield* sql<{ readonly threadId: string }>`
      SELECT sibling.thread_id AS "threadId"
      FROM fork_thread_tabs AS tab
      JOIN fork_thread_tabs AS sibling ON sibling.group_id = tab.group_id
      WHERE tab.thread_id = ${threadId} AND sibling.thread_id != ${threadId}
    `;
    const shells = yield* Effect.forEach(rows, (row) =>
      orchestrator.getThreadShell(ThreadId.make(row.threadId)),
    );
    return shells.filter(
      (shell): shell is OrchestrationV2ThreadShell =>
        shell !== null && shell.archivedAt === null && shell.deletedAt === null,
    );
  });

  // "user" keeps a woken tab active: its own activity is still old, so a neutral reset would
  // let the auto-settle sweep settle it again right away.
  const unsettle = Effect.fn("ThreadTabSettlementReactor.unsettle")(function* (threadId: ThreadId) {
    yield* orchestrator.dispatch({
      type: "thread.unsettle",
      commandId: CommandId.make(`server:tab-unsettle:${threadId}:${yield* crypto.randomUUIDv4}`),
      threadId,
      reason: "user",
    });
  });

  const settle = Effect.fn("ThreadTabSettlementReactor.settle")(function* (threadId: ThreadId) {
    yield* orchestrator.dispatch({
      type: "thread.settle",
      commandId: CommandId.make(`server:tab-settle:${threadId}:${yield* crypto.randomUUIDv4}`),
      threadId,
    });
  });

  const run = Effect.fn("ThreadTabSettlementReactor.run")(
    function* (job: SettlementJob) {
      const siblings = yield* readSiblings(job.threadId);
      if (siblings.length === 0) return;
      if (job.kind === "wake") {
        yield* Effect.forEach(
          siblings.filter((sibling) => sibling.settledOverride === "settled"),
          (sibling) => unsettle(sibling.id),
          { discard: true },
        );
        return;
      }
      const source = yield* orchestrator.getThreadShell(job.threadId);
      if (source === null || source.settledOverride !== "settled") return;
      const nowMs = DateTime.toEpochMillis(yield* DateTime.now);
      if (siblings.some((sibling) => blocksSettlement(sibling, nowMs, job.automatic))) {
        yield* unsettle(job.threadId);
        return;
      }
      yield* Effect.forEach(
        siblings.filter((sibling) => sibling.settledOverride !== "settled"),
        (sibling) => settle(sibling.id),
        { discard: true },
      );
    },
    (effect, job) =>
      effect.pipe(
        Effect.catchCauseIf(
          (cause) => !Cause.hasInterruptsOnly(cause),
          (cause) =>
            Effect.logWarning("mirroring thread tab settlement failed", {
              threadId: job.threadId,
              kind: job.kind,
              cause: Cause.pretty(cause),
            }),
        ),
      ),
  );

  const worker = yield* makeDrainableWorker(run);

  const start: ThreadTabSettlementReactor["Service"]["start"] = Effect.fn(
    "ThreadTabSettlementReactor.start",
  )(function* () {
    // The stored stream carries each event's command id, which tells an automatic settle apart.
    // It follows from the current end of the log; after a failure (such as falling too far
    // behind its bounded buffer) it resumes from the last event it saw.
    let lastSequence = yield* eventStore.latestAgentSequence().pipe(Effect.orElseSucceed(() => 0));
    const follow = Effect.suspend(() =>
      orchestrator.streamStoredEventsFrom({ afterSequence: lastSequence }).pipe(
        Stream.runForEach((stored) => {
          lastSequence = stored.sequence;
          const job = jobFor(stored);
          return job === null ? Effect.void : worker.enqueue(job);
        }),
      ),
    ).pipe(
      Effect.tapError((error) =>
        Effect.logWarning("thread tab settlement event stream failed", { error }),
      ),
      Effect.retry(Schedule.spaced("1 second")),
    );
    yield* forkParked(follow);
  });

  return { start, drain: worker.drain } satisfies ThreadTabSettlementReactor["Service"];
});

export const layer = Layer.effect(ThreadTabSettlementReactor, make);
