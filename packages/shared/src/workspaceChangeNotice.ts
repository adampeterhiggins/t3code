import type { OrchestrationV2TurnItem } from "@t3tools/contracts";

/**
 * Title of the notice a run leaves when its thread moves to another worktree. Clients draw
 * it as a timeline divider, like a model change, rather than as a warning.
 */
export const WORKSPACE_CHANGED_NOTICE_TITLE = "Workspace changed";

export function isWorkspaceChangeNotice(
  item: OrchestrationV2TurnItem,
): item is Extract<OrchestrationV2TurnItem, { type: "system_notice" }> {
  return item.type === "system_notice" && item.title === WORKSPACE_CHANGED_NOTICE_TITLE;
}
