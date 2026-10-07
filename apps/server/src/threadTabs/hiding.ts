import {
  CommandId,
  ThreadId,
  type OrchestrationV2StoredEvent,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import { OrchestrationEventStore } from "../persistence/OrchestrationEventStore.ts";
import { forkParked } from "../serverActivation.ts";

/**
 * A tab group shows as one sidebar row, so the group hides as a unit. Upstream hides each
 * thread on its own; this reactor mirrors every hide and unhide across the group's live tabs.
 * Hiding the open tab otherwise leaves the row, which belongs to a different tab, in the list.
 */
export class ThreadTabHidingReactor extends Context.Service<
  ThreadTabHidingReactor,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly drain: Effect.Effect<void>;
  }
>()("t3/threadTabs/hiding/ThreadTabHidingReactor") {}

interface HideJob {
  readonly threadId: ThreadId;
  readonly hidden: boolean;
}

const MIRRORED_COMMAND_PREFIX = "server:tab-hidden:";

/**
 * The job an event asks for, if any. The payload is the thread after the command.
 * Mirrored commands are skipped: `thread.hidden.set` emits even when nothing changed, so
 * following our own events would hide the siblings again forever.
 */
function jobFor(stored: OrchestrationV2StoredEvent): HideJob | null {
  if (stored.commandId?.startsWith(MIRRORED_COMMAND_PREFIX)) return null;
  const { event } = stored;
  if (event.type !== "thread.hidden-set") return null;
  return { threadId: event.threadId, hidden: event.payload.hiddenAt != null };
}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const eventStore = yield* OrchestrationEventStore;
  const sql = yield* SqlClient.SqlClient;
  const crypto = yield* Crypto.Crypto;

  const readSiblings = Effect.fn("ThreadTabHidingReactor.readSiblings")(function* (
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

  const setHidden = Effect.fn("ThreadTabHidingReactor.setHidden")(function* (
    threadId: ThreadId,
    hidden: boolean,
  ) {
    yield* orchestrator.dispatch({
      type: "thread.hidden.set",
      commandId: CommandId.make(
        `${MIRRORED_COMMAND_PREFIX}${threadId}:${yield* crypto.randomUUIDv4}`,
      ),
      threadId,
      hidden,
    });
  });

  const run = Effect.fn("ThreadTabHidingReactor.run")(
    function* (job: HideJob) {
      const siblings = yield* readSiblings(job.threadId);
      yield* Effect.forEach(
        siblings.filter((sibling) => (sibling.hiddenAt != null) !== job.hidden),
        (sibling) => setHidden(sibling.id, job.hidden),
        { discard: true },
      );
    },
    (effect, job) =>
      effect.pipe(
        Effect.catchCauseIf(
          (cause) => !Cause.hasInterruptsOnly(cause),
          (cause) =>
            Effect.logWarning("mirroring thread tab hiding failed", {
              threadId: job.threadId,
              hidden: job.hidden,
              cause: Cause.pretty(cause),
            }),
        ),
      ),
  );

  const worker = yield* makeDrainableWorker(run);

  const start: ThreadTabHidingReactor["Service"]["start"] = Effect.fn(
    "ThreadTabHidingReactor.start",
  )(function* () {
    // Follows from the current end of the log. After a failure (such as falling too far
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
        Effect.logWarning("thread tab hiding event stream failed", { error }),
      ),
      Effect.retry(Schedule.spaced("1 second")),
    );
    yield* forkParked(follow);
  });

  return { start, drain: worker.drain } satisfies ThreadTabHidingReactor["Service"];
});

export const layer = Layer.effect(ThreadTabHidingReactor, make);
