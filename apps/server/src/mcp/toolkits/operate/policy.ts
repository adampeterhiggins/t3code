import type { OrchestrationThreadShell, RuntimeMode, ThreadId } from "@t3tools/contracts";

/**
 * Limits on what an agent inside a thread may do to other threads. They keep
 * an agent from granting work more permission than it has itself, and keep a
 * runaway agent from filling the sidebar. Agents holding an agent access
 * token act as the user and are not limited here.
 */

/** Threads an agent started count one level below the thread that started them. */
export const MAX_SPAWN_DEPTH = 2;
/** Children a thread may have at once that are neither settled nor archived. */
export const MAX_LIVE_CHILDREN = 5;

/** Least to most permissive. */
const RUNTIME_MODE_ORDER: ReadonlyArray<RuntimeMode> = [
  "approval-required",
  "auto-accept-edits",
  "auto",
  "full-access",
];

const rank = (mode: RuntimeMode) => RUNTIME_MODE_ORDER.indexOf(mode);

/**
 * The runtime mode to start with: the requested one, or the ceiling when none
 * is asked for. A request above the ceiling is refused rather than lowered, so
 * the agent learns why it did not get what it asked for.
 */
export function resolveRuntimeMode(
  requested: RuntimeMode | undefined,
  ceiling: RuntimeMode,
): { readonly mode: RuntimeMode } | { readonly refused: string } {
  if (requested === undefined) return { mode: ceiling };
  if (rank(requested) <= rank(ceiling)) return { mode: requested };
  return {
    refused: `This thread runs in ${ceiling} mode, so a thread it starts cannot use ${requested}.`,
  };
}

type SpawnShell = Pick<OrchestrationThreadShell, "id" | "createdBy" | "archivedAt" | "settledAt">;

/** How many agent-started threads lie between `thread` and a thread the user started. */
export function spawnDepth(thread: SpawnShell, threads: ReadonlyArray<SpawnShell>): number {
  const byId = new Map(threads.map((entry) => [entry.id, entry]));
  let depth = 0;
  let cursor: SpawnShell | undefined = thread;
  // Bounded so a malformed chain cannot loop.
  while (cursor?.createdBy?.kind === "thread" && depth <= MAX_SPAWN_DEPTH) {
    depth += 1;
    cursor = byId.get(cursor.createdBy.threadId);
  }
  return depth;
}

/** Why `parent` may not start another thread now, or null when it may. */
export function spawnRefusal(
  parent: SpawnShell,
  threads: ReadonlyArray<SpawnShell>,
): string | null {
  if (spawnDepth(parent, threads) + 1 > MAX_SPAWN_DEPTH) {
    return `Threads started by agents can only start threads ${MAX_SPAWN_DEPTH} levels deep. Ask the user, or do the work in this thread.`;
  }
  const live = threads.filter(
    (thread) =>
      thread.createdBy?.kind === "thread" &&
      thread.createdBy.threadId === parent.id &&
      thread.archivedAt === null &&
      thread.settledAt === null,
  ).length;
  if (live >= MAX_LIVE_CHILDREN) {
    return `This thread already has ${live} threads it started that are still active. Wait for one to finish, or archive one, before starting another.`;
  }
  return null;
}

/** Why the calling thread may not act on `target` itself, or null when it may. */
export function selfTargetRefusal(
  callerThreadId: ThreadId | null,
  target: ThreadId,
): string | null {
  return callerThreadId === target
    ? "This is your own thread. These tools act on other threads."
    : null;
}
