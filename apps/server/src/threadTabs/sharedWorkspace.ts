import type { ThreadId } from "@t3tools/contracts";

/** A shared worktree may change branch metadata together only when every active user is a tab sibling. */
export function areTabSiblings(
  sharingThreadIds: ReadonlyArray<ThreadId>,
  groupMemberIds: ReadonlySet<string>,
): boolean {
  return sharingThreadIds.length > 1 && sharingThreadIds.every((id) => groupMemberIds.has(id));
}
