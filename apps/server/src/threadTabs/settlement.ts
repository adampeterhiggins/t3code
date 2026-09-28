import {
  CommandId,
  type OrchestrationEvent,
  type OrchestrationThreadShell,
  ThreadId,
} from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import { visibleThreadPullRequests } from "@t3tools/shared/threadPullRequests";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { threadHasQueuedTurnStart } from "../orchestration/ThreadSettlementPolicy.ts";
import { forkParked } from "../serverActivation.ts";

/**
 * A tab group shows as one sidebar row, so the group settles as a unit. Upstream settles each
 * thread on its own; this reactor mirrors every settle and unsettle across the group.
 *
 * - A turn start or unsettle in any tab wakes the group's settled tabs.
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

// ThreadSettlementReactor's sweep issues every automatic settle under this command id prefix.
const AUTO_SETTLE_COMMAND_PREFIX = "server:auto-settle:";

/**
 * Mirrors the decider's settle guards, so a mirrored settle is never rejected. An automatic
 * settle also waits on a sibling's open pull request, as the settlement policy does.
 */
function blocksSettlement(
  thread: OrchestrationThreadShell,
  now: string,
  automatic: boolean,
): boolean {
  if (
    automatic &&
    visibleThreadPullRequests(thread.pullRequests).some(
      (link) => link.snapshot === null || link.snapshot.state === "open",
    )
  ) {
    return true;
  }
  return (
    thread.session?.status === "starting" ||
    thread.session?.status === "running" ||
    thread.hasPendingApprovals ||
    thread.hasPendingUserInput ||
    thread.backgroundLiveness != null ||
    threadHasQueuedTurnStart(thread, now)
  );
}

export const make = Effect.gen(function* () {
  const engine = yield* OrchestrationEngineService;
  const snapshots = yield* ProjectionSnapshotQuery;
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
      snapshots.getThreadShellById(ThreadId.make(row.threadId)),
    );
    return shells.flatMap((shell) =>
      Option.isSome(shell) && shell.value.archivedAt === null ? [shell.value] : [],
    );
  });

  // "user" keeps a woken tab active: its own activity is still old, so a neutral reset would
  // let the auto-settle sweep settle it again right away.
  const unsettle = Effect.fn("ThreadTabSettlementReactor.unsettle")(function* (threadId: ThreadId) {
    yield* engine.dispatch({
      type: "thread.unsettle",
      commandId: CommandId.make(`server:tab-unsettle:${threadId}:${yield* crypto.randomUUIDv4}`),
      threadId,
      reason: "user",
    });
  });

  const settle = Effect.fn("ThreadTabSettlementReactor.settle")(function* (threadId: ThreadId) {
    yield* engine.dispatch({
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
      const source = yield* snapshots.getThreadShellById(job.threadId);
      if (Option.isNone(source) || source.value.settledOverride !== "settled") return;
      const now = DateTime.formatIso(yield* DateTime.now);
      if (siblings.some((sibling) => blocksSettlement(sibling, now, job.automatic))) {
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

  const processEvent = (event: OrchestrationEvent) => {
    switch (event.type) {
      case "thread.turn-start-requested":
      case "thread.unsettled":
        return worker.enqueue({ kind: "wake", threadId: event.payload.threadId });
      case "thread.settled":
        return worker.enqueue({
          kind: "settle",
          threadId: event.payload.threadId,
          automatic: event.commandId?.startsWith(AUTO_SETTLE_COMMAND_PREFIX) ?? false,
        });
    }
    return Effect.void;
  };

  const start: ThreadTabSettlementReactor["Service"]["start"] = Effect.fn(
    "ThreadTabSettlementReactor.start",
  )(function* () {
    const events = yield* engine.subscribeDomainEvents;
    yield* forkParked(Stream.runForEach(events, processEvent));
  });

  return { start, drain: worker.drain } satisfies ThreadTabSettlementReactor["Service"];
});

export const layer = Layer.effect(ThreadTabSettlementReactor, make);
