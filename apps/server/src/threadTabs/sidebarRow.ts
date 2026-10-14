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
 * A tab group shows as one sidebar row, so the group hides and moves between sidebar groups as
 * a unit. Upstream keeps both per thread; this reactor mirrors every hide, unhide, and group move
 * across the group's live tabs. The row belongs to one tab and the menu may be opened on another,
 * so without the mirror the row stays put, or jumps back once its tab closes.
 */
export class ThreadTabSidebarRowReactor extends Context.Service<
  ThreadTabSidebarRowReactor,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly drain: Effect.Effect<void>;
  }
>()("t3/threadTabs/sidebarRow/ThreadTabSidebarRowReactor") {}

type MirrorJob =
  | { readonly kind: "hidden"; readonly threadId: ThreadId; readonly hidden: boolean }
  | { readonly kind: "group"; readonly threadId: ThreadId; readonly groupName: string | null };

const MIRRORED_COMMAND_PREFIX = "server:tab-row:";

/**
 * The job an event asks for, if any. The payload is the thread after the command.
 * Mirrored commands are skipped: both commands emit even when nothing changed, so following
 * our own events would mirror back and forth forever.
 */
function jobFor(stored: OrchestrationV2StoredEvent): MirrorJob | null {
  if (stored.commandId?.startsWith(MIRRORED_COMMAND_PREFIX)) return null;
  const { event } = stored;
  if (event.type === "thread.hidden-set") {
    return { kind: "hidden", threadId: event.threadId, hidden: event.payload.hiddenAt != null };
  }
  if (event.type === "thread.group-set") {
    return { kind: "group", threadId: event.threadId, groupName: event.payload.groupName ?? null };
  }
  return null;
}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const eventStore = yield* OrchestrationEventStore;
  const sql = yield* SqlClient.SqlClient;
  const crypto = yield* Crypto.Crypto;

  const readSiblings = Effect.fn("ThreadTabSidebarRowReactor.readSiblings")(function* (
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

  const commandId = (threadId: ThreadId) =>
    crypto.randomUUIDv4.pipe(
      Effect.map((uuid) => CommandId.make(`${MIRRORED_COMMAND_PREFIX}${threadId}:${uuid}`)),
    );

  const run = Effect.fn("ThreadTabSidebarRowReactor.run")(
    function* (job: MirrorJob) {
      const siblings = yield* readSiblings(job.threadId);
      yield* Effect.forEach(
        siblings,
        (sibling) =>
          Effect.gen(function* () {
            if (job.kind === "hidden") {
              if ((sibling.hiddenAt != null) === job.hidden) return;
              yield* orchestrator.dispatch({
                type: "thread.hidden.set",
                commandId: yield* commandId(sibling.id),
                threadId: sibling.id,
                hidden: job.hidden,
              });
            } else {
              if ((sibling.groupName ?? null) === job.groupName) return;
              yield* orchestrator.dispatch({
                type: "thread.group.set",
                commandId: yield* commandId(sibling.id),
                threadId: sibling.id,
                groupName: job.groupName,
              });
            }
          }),
        { discard: true },
      );
    },
    (effect, job) =>
      effect.pipe(
        Effect.catchCauseIf(
          (cause) => !Cause.hasInterruptsOnly(cause),
          (cause) =>
            Effect.logWarning("mirroring thread tab sidebar row failed", {
              ...job,
              cause: Cause.pretty(cause),
            }),
        ),
      ),
  );

  const worker = yield* makeDrainableWorker(run);

  const start: ThreadTabSidebarRowReactor["Service"]["start"] = Effect.fn(
    "ThreadTabSidebarRowReactor.start",
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
        Effect.logWarning("thread tab sidebar row event stream failed", { error }),
      ),
      Effect.retry(Schedule.spaced("1 second")),
    );
    yield* forkParked(follow);
  });

  return { start, drain: worker.drain } satisfies ThreadTabSidebarRowReactor["Service"];
});

export const layer = Layer.effect(ThreadTabSidebarRowReactor, make);
