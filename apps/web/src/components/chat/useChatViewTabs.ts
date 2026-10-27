import { type EnvironmentId, type ThreadId } from "@t3tools/contracts";
import { useRightPanelFollowsTabSwitch, useThreadTabGroup } from "./ThreadTabs";
import { useSplitPaneFocus } from "./splitPane";
import { useThreadTabRecencyStore } from "../../threadTabRecencyStore";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useEffect } from "react";

export function useChatViewTabs(
  environmentId: EnvironmentId,
  serverThreadId: ThreadId | null,
  splitPaneFocus: ReturnType<typeof useSplitPaneFocus>,
  unfocusedSplitPane: boolean,
) {
  const threadTabGroup = useThreadTabGroup(environmentId, serverThreadId);
  const openThreadTabId = threadTabGroup ? serverThreadId : null;
  // Upstream servers have no tab group, so tab-only actions fall back or stay hidden.
  const hasThreadTabs = threadTabGroup !== null;
  // Split panes each keep their own right panel, so neither carries it across a tab switch.
  useRightPanelFollowsTabSwitch(
    environmentId,
    splitPaneFocus === null ? openThreadTabId : null,
    threadTabGroup,
  );
  useEffect(() => {
    if (openThreadTabId === null || unfocusedSplitPane) return;
    useThreadTabRecencyStore.getState().markOpened(scopeThreadRef(environmentId, openThreadTabId));
  }, [environmentId, openThreadTabId, unfocusedSplitPane]);
  return { threadTabGroup, hasThreadTabs };
}
