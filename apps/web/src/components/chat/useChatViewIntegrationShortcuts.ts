import type { ThreadTabGroup } from "@t3tools/contracts";
import type { ChatShortcutCommands } from "./useChatShortcuts";
import { useRunThreadScheduledTask } from "../../hooks/useRunThreadScheduledTask";
import { useStableCallback } from "../../hooks/useStableCallback";
import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { subscribeSplitViewAction, useSplitViewActions } from "./splitPane";
import { useSplitViewStore } from "../../splitViewStore";
import { useEffect } from "react";
import { readEnvironmentScope } from "../../state/session";

export function useChatViewIntegrationShortcuts(input: {
  environmentId: EnvironmentId;
  routeThreadRef: ScopedThreadRef;
  routeThreadKey: string;
  activeThreadRef: ScopedThreadRef | null;
  threadTabGroup: ThreadTabGroup | null;
  isServerThread: boolean;
  unfocusedSplitPane: boolean;
  focusComposerStable: () => void;
}) {
  const {
    environmentId,
    routeThreadRef,
    routeThreadKey,
    activeThreadRef,
    threadTabGroup,
    isServerThread,
    unfocusedSplitPane,
    focusComposerStable,
  } = input;
  const splitViewActions = useSplitViewActions();
  const runThreadScheduledTask = useRunThreadScheduledTask();
  // Moving to this pane from the keyboard hands it the keyboard too. A click leaves focus where
  // it landed, so selecting text in the other pane still works.
  const composerFocusRequested = useSplitViewStore(
    (state) => state.composerFocusKey === routeThreadKey,
  );
  useEffect(() => {
    if (!composerFocusRequested || unfocusedSplitPane) return;
    useSplitViewStore.getState().clearComposerFocus();
    focusComposerStable();
  }, [composerFocusRequested, focusComposerStable, unfocusedSplitPane]);
  // Split view acts on the routed server thread, the focused pane.
  const handleSplitViewAction = useStableCallback((action: "toggle" | "focus-other") => {
    if (!isServerThread) return;
    if (action === "focus-other") {
      splitViewActions.focusOther(routeThreadRef);
      return;
    }
    splitViewActions.toggle(
      routeThreadRef,
      threadTabGroup ? threadTabGroup.tabs.map((tab) => tab.threadId) : null,
    );
  });
  useEffect(() => {
    if (unfocusedSplitPane) return;
    return subscribeSplitViewAction(handleSplitViewAction);
  }, [handleSplitViewAction, unfocusedSplitPane]);
  return {
    "splitView.toggle": ({ event }) => {
      if (!event.repeat) handleSplitViewAction("toggle");
    },
    "splitView.focusOther": ({ event }) => {
      if (!event.repeat) handleSplitViewAction("focus-other");
    },
    "thread.runScheduledTask": ({ event }) => {
      if (!readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)) return false;
      if (!isServerThread || !activeThreadRef) return false;
      if (!event.repeat) void runThreadScheduledTask(activeThreadRef);
    },
  } satisfies ChatShortcutCommands;
}
