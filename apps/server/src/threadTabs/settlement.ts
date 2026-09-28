import { CommandId, type OrchestrationEvent, ThreadId } from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { forkParked } from "../serverActivation.ts";

/**
 * A tab group shows as one sidebar row, so a turn started in any tab wakes the settled tabs
 * the row may stand for. The decider only unsettles the tab the message went to.
 */
export class ThreadTabSettlementReactor extends Context.Service<
  ThreadTabSettlementReactor,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly drain: Effect.Effect<void>;
  }
>()("t3/threadTabs/settlement/ThreadTabSettlementReactor") {}

export const make = Effect.gen(function* () {
  const engine = yield* OrchestrationEngineService;
  const snapshots = yield* ProjectionSnapshotQuery;
  const sql = yield* SqlClient.SqlClient;
  const crypto = yield* Crypto.Crypto;

  const wakeSettledSiblings = Effect.fn("ThreadTabSettlementReactor.wakeSettledSiblings")(
    function* (threadId: ThreadId) {
      const siblings = yield* sql<{ readonly threadId: string }>`
        SELECT sibling.thread_id AS "threadId"
        FROM fork_thread_tabs AS tab
        JOIN fork_thread_tabs AS sibling ON sibling.group_id = tab.group_id
        WHERE tab.thread_id = ${threadId} AND sibling.thread_id != ${threadId}
      `;
      yield* Effect.forEach(
        siblings,
        (sibling) =>
          Effect.gen(function* () {
            const siblingId = ThreadId.make(sibling.threadId);
            const shell = yield* snapshots.getThreadShellById(siblingId);
            if (Option.isNone(shell) || shell.value.settledOverride !== "settled") return;
            // "user" keeps the woken tab active: its own activity is still old, so a neutral
            // reset would let the auto-settle sweep settle it again right away.
            yield* engine.dispatch({
              type: "thread.unsettle",
              commandId: CommandId.make(
                `server:tab-unsettle:${siblingId}:${yield* crypto.randomUUIDv4}`,
              ),
              threadId: siblingId,
              reason: "user",
            });
          }),
        { discard: true },
      );
    },
    (effect, threadId) =>
      effect.pipe(
        Effect.catchCauseIf(
          (cause) => !Cause.hasInterruptsOnly(cause),
          (cause) =>
            Effect.logWarning("waking settled thread tabs failed", {
              threadId,
              cause: Cause.pretty(cause),
            }),
        ),
      ),
  );

  const worker = yield* makeDrainableWorker(wakeSettledSiblings);

  const processEvent = (event: OrchestrationEvent) =>
    event.type === "thread.turn-start-requested"
      ? worker.enqueue(event.payload.threadId)
      : Effect.void;

  const start: ThreadTabSettlementReactor["Service"]["start"] = Effect.fn(
    "ThreadTabSettlementReactor.start",
  )(function* () {
    const events = yield* engine.subscribeDomainEvents;
    yield* forkParked(Stream.runForEach(events, processEvent));
  });

  return { start, drain: worker.drain } satisfies ThreadTabSettlementReactor["Service"];
});

export const layer = Layer.effect(ThreadTabSettlementReactor, make);
