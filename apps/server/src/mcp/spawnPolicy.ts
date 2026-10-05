import {
  OrchestratorMcpFailure,
  type OrchestrationV2ThreadShell,
  type ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";

/**
 * Limits on the threads an agent inside a thread may start over MCP. They keep
 * a runaway agent from filling the sidebar or recursing without end. An agent
 * holding an agent access token acts as the user and is not limited here.
 * Fork-only; see docs/fork-differences.md.
 */

/** Threads an agent started sit one level below the thread that started them. */
export const MAX_SPAWN_DEPTH = 2;
/** Started threads a thread may have going at once; see isLive. */
export const MAX_LIVE_CHILDREN = 5;

type SpawnShell = Pick<
  OrchestrationV2ThreadShell,
  | "id"
  | "startedBy"
  | "lineage"
  | "creationSource"
  | "archivedAt"
  | "settledOverride"
  | "deletedAt"
  | "activeRunId"
>;

/**
 * The thread whose agent started `thread`: a top-level thread records it in
 * `startedBy`, a delegate_task child in its subagent lineage. Threads the user
 * started and provider-native subagents have none.
 */
export function spawnParentOf(
  thread: Pick<SpawnShell, "startedBy" | "lineage" | "creationSource">,
): ThreadId | null {
  if (thread.startedBy?.kind === "thread") return thread.startedBy.threadId;
  return thread.lineage.relationshipToParent === "subagent" && thread.creationSource === "mcp"
    ? thread.lineage.parentThreadId
    : null;
}

/**
 * A started thread stays live until it is settled or archived. A delegated
 * task's child thread is never settled by hand, so it counts only while it
 * has a run going.
 */
const isLive = (thread: SpawnShell) =>
  thread.archivedAt === null &&
  thread.deletedAt === null &&
  thread.settledOverride !== "settled" &&
  (thread.lineage.relationshipToParent !== "subagent" || thread.activeRunId !== null);

/** Why `parentDepth` and `liveChildren` keep a thread from starting `count` more, or null. */
export function spawnRefusal(input: {
  readonly parentDepth: number;
  readonly liveChildren: number;
  readonly count: number;
}): string | null {
  if (input.parentDepth + 1 > MAX_SPAWN_DEPTH) {
    return `Threads started by agents can only start threads ${MAX_SPAWN_DEPTH} levels deep. Ask the user, or do the work in this thread.`;
  }
  if (input.liveChildren + input.count > MAX_LIVE_CHILDREN) {
    return input.liveChildren >= MAX_LIVE_CHILDREN
      ? `This thread already has ${input.liveChildren} threads it started that are still active. Wait for one to finish, or archive one, before starting another.`
      : `This thread has ${input.liveChildren} threads it started that are still active, and may have at most ${MAX_LIVE_CHILDREN}. Start ${MAX_LIVE_CHILDREN - input.liveChildren} or fewer.`;
  }
  return null;
}

/** Why the calling thread may not target `target`, or null when it may. */
export function selfTargetRefusal(
  callerThreadId: ThreadId | undefined,
  target: ThreadId,
): string | null {
  return callerThreadId === target
    ? "This is your own thread. This tool acts on other threads."
    : null;
}

const refused = (message: string) =>
  new OrchestratorMcpFailure({ code: "capability_denied", message });

/**
 * Fails when the thread `parentId` may not start `count` more threads. Depth
 * walks the started-by chain up from the parent; live children are counted
 * across every project, since a launch may target another project.
 */
export const assertMaySpawn = Effect.fn("mcp.assertMaySpawn")(function* (
  threads: ThreadManagementService.ThreadManagementService["Service"],
  parentId: ThreadId,
  count: number,
) {
  const unavailable = () =>
    new OrchestratorMcpFailure({
      code: "orchestration_error",
      message: "Could not check how many threads this thread has started.",
    });
  let parentDepth = 0;
  let cursor: ThreadId | null = parentId;
  // Bounded so a malformed chain cannot loop.
  while (cursor !== null && parentDepth <= MAX_SPAWN_DEPTH) {
    const shell: OrchestrationV2ThreadShell | null = yield* threads
      .getThreadShell(cursor)
      .pipe(Effect.mapError(unavailable));
    const next: ThreadId | null = shell === null ? null : spawnParentOf(shell);
    if (next === null) break;
    parentDepth += 1;
    cursor = next;
  }
  const snapshot = yield* threads
    .getShellSnapshot({ location: "active" })
    .pipe(Effect.mapError(unavailable));
  const liveChildren = snapshot.threads.filter(
    (thread) => isLive(thread) && spawnParentOf(thread) === parentId,
  ).length;
  const refusal = spawnRefusal({ parentDepth, liveChildren, count });
  if (refusal !== null) return yield* refused(refusal);
});

/** Fails when a thread caller targets its own thread with a tool meant for other threads. */
export const assertNotSelf = (callerThreadId: ThreadId | undefined, target: ThreadId) => {
  const refusal = selfTargetRefusal(callerThreadId, target);
  return refusal === null
    ? Effect.void
    : Effect.fail(new OrchestratorMcpFailure({ code: "invalid_request", message: refusal }));
};
