import { CommandId, type ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import * as ServerSelfUpdate from "../cloud/selfUpdate.ts";
import * as ThreadManagementService from "./ThreadManagementService.ts";

/** Shown on the stopped turn so the thread explains why it is waiting for Resume. */
export const PAUSE_FOR_UPDATE_REASON = "Paused for an application update.";

/** Long enough for a provider to acknowledge Stop, short enough to stay inside an update's shutdown budget. */
const PAUSE_TIMEOUT_MS = 15_000;

/**
 * Stops every thread that is mid-turn and waits until that turn is interrupted.
 * After the update restarts, those threads offer Resume instead of looking cancelled.
 */
export const pauseRunningThreadsForUpdate = Effect.fn(
  "UpdateThreadPause.pauseRunningThreadsForUpdate",
)(function* () {
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const threadIds = yield* threads.getShellSnapshot().pipe(
    Effect.map((snapshot) =>
      snapshot.threads.flatMap((thread) => (thread.activeRunId === null ? [] : [thread.id])),
    ),
    Effect.catchCause((cause) =>
      Effect.logWarning("Could not list running threads before the update.", { cause }).pipe(
        Effect.as<ReadonlyArray<ThreadId>>([]),
      ),
    ),
  );

  const paused = yield* Effect.forEach(
    threadIds,
    (threadId) =>
      Effect.gen(function* () {
        const records = yield* threads.getThreadRecords(threadId, ["runs"]);
        const active = ThreadManagementService.latestActiveRun(records);
        if (active === undefined) return null;
        yield* threads.dispatch({
          type: "thread.stop",
          commandId: CommandId.make(`command:update-pause:${active.id}`),
          threadId,
          reason: PAUSE_FOR_UPDATE_REASON,
        });
        const shell = yield* threads.getThreadShell(threadId);
        if (shell === null) {
          yield* Effect.logWarning("Paused a thread that no longer has a shell.", { threadId });
          return threadId;
        }
        const waited = yield* threads.waitForThread({
          projectId: shell.projectId,
          threadId,
          runId: active.id,
          timeoutMs: PAUSE_TIMEOUT_MS,
        });
        if (waited.timedOut) {
          yield* Effect.logWarning("A running thread did not pause before the update.", {
            threadId,
            runId: active.id,
          });
        }
        return threadId;
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Could not pause a running thread before the update.", {
            threadId,
            cause,
          }).pipe(Effect.as(null)),
        ),
      ),
    { concurrency: "unbounded" },
  );

  const pausedThreadIds = paused.filter((threadId): threadId is ThreadId => threadId !== null);
  if (pausedThreadIds.length > 0) {
    yield* Effect.logInfo("Paused running threads for an application update.", {
      count: pausedThreadIds.length,
    });
  }
  return pausedThreadIds;
});

/**
 * Self-update that pauses running threads at the handoff, before this process is replaced.
 * Download and preflight still run while threads are working.
 */
export const layerServerSelfUpdate = Layer.effect(
  ServerSelfUpdate.ServerSelfUpdate,
  Effect.gen(function* () {
    const inner = yield* ServerSelfUpdate.ServerSelfUpdate;
    const config = yield* ServerConfig.ServerConfig;
    const threads = yield* ThreadManagementService.ThreadManagementService;
    return yield* ServerSelfUpdate.withRunningThreadContinuation({
      mode: config.mode,
      selfUpdate: inner,
      // Captured here so the update RPC can pause threads without asking its
      // caller to provide orchestration services.
      pause: pauseRunningThreadsForUpdate().pipe(
        Effect.provideService(ThreadManagementService.ThreadManagementService, threads),
        Effect.asVoid,
      ),
      prepare: Effect.succeed([]),
      clear: () => Effect.void,
    });
  }),
).pipe(Layer.provide(ServerSelfUpdate.layer));
