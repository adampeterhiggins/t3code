import type { OrchestrationV2TurnItem } from "@t3tools/contracts";

/** Stored workspace-change notices render as timeline dividers rather than warnings. */
export const WORKSPACE_CHANGED_NOTICE_TITLE = "Workspace changed";

export function isWorkspaceChangeNotice(
  item: OrchestrationV2TurnItem,
): item is Extract<OrchestrationV2TurnItem, { type: "system_notice" }> {
  return item.type === "system_notice" && item.title === WORKSPACE_CHANGED_NOTICE_TITLE;
}
