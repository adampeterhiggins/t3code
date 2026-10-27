import { OrchestratorMcpFailure, type ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

/** Why the calling thread may not target `target`, or null when it may. Fork-only. */
export function selfTargetRefusal(
  callerThreadId: ThreadId | undefined,
  target: ThreadId,
): string | null {
  return callerThreadId === target
    ? "This is your own thread. This tool acts on other threads."
    : null;
}

/** Fails when a thread caller targets its own thread with a tool meant for other threads. */
export const assertNotSelf = (callerThreadId: ThreadId | undefined, target: ThreadId) => {
  const refusal = selfTargetRefusal(callerThreadId, target);
  return refusal === null
    ? Effect.void
    : Effect.fail(new OrchestratorMcpFailure({ code: "invalid_request", message: refusal }));
};
