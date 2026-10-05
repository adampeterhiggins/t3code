/**
 * Fork: the right-click menu of a subagent, wherever the parent chat lists it (thread lineage,
 * the conversation's agent rows, the Agents panel): open it in an agent tab, continue from its
 * work in a new chat tab, attach its result to this chat, or find it in the Agents panel.
 */
import {
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import type {
  ContextMenuItem,
  OrchestrationV2ThreadProjection,
  ScopedThreadRef,
  ThreadId,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, type MouseEvent } from "react";

import { useAgentDrillStore } from "~/agentDrillStore";
import { useComposerHandleContext } from "~/composerHandleContext";
import { readLocalApi } from "~/localApi";
import { useRightPanelStore } from "~/rightPanelStore";
import { loadThreadProjection, readProject, readThreadProjection } from "~/state/entities";
import { buildThreadRouteParams } from "~/threadRoutes";

import {
  attachAgentResultToChat,
  canAttachAgentResult,
  continueAgentInChat,
  subagentContextSubject,
} from "./agentChatActions";

type AgentMenuAction = "open-in-tab" | "continue-in-chat" | "attach-result" | "show-in-agents";

function menuPosition(event: MouseEvent<HTMLElement>): { x: number; y: number } {
  if (event.clientX === 0 && event.clientY === 0) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: bounds.left, y: bounds.bottom };
  }
  return { x: event.clientX, y: event.clientY };
}

/**
 * Returns a context-menu handler for the agents listed in `parentRef`'s chat. Tabs open in
 * `parentRef`'s right panel. A nested agent names its `ownerThreadId`, the subagent thread that
 * spawned it, whose record is loaded when the menu opens. `showInAgentsPanel` adds the item that
 * opens the Agents panel, for lists other than that panel.
 */
export function useAgentContextMenu(
  parentRef: ScopedThreadRef,
  options?: { readonly showInAgentsPanel?: boolean },
) {
  const navigate = useNavigate();
  const composerRef = useComposerHandleContext();
  const showInAgentsPanel = options?.showInAgentsPanel ?? true;
  return useCallback(
    (
      event: MouseEvent<HTMLElement>,
      agent: { childThreadId: ThreadId; title: string; ownerThreadId?: ThreadId },
    ) => {
      const api = readLocalApi();
      if (!api) return;
      const ownerRef =
        agent.ownerThreadId === undefined || agent.ownerThreadId === parentRef.threadId
          ? parentRef
          : scopeThreadRef(parentRef.environmentId, agent.ownerThreadId);
      const loadedOwner = readThreadProjection(ownerRef);
      const findSubagent = (owner: OrchestrationV2ThreadProjection | null) =>
        owner?.subagents.find((candidate) => candidate.childThreadId === agent.childThreadId) ??
        null;
      // Without a record there is nothing to act on; leave the native menu alone.
      if (loadedOwner !== null && findSubagent(loadedOwner) === null) return;
      event.preventDefault();
      event.stopPropagation();
      const position = menuPosition(event);
      void (async () => {
        const subagent = findSubagent(loadedOwner ?? (await loadThreadProjection(ownerRef)));
        if (!subagent) return;
        const subject = subagentContextSubject(subagent, agent.title);
        const items: ContextMenuItem<AgentMenuAction>[] = [
          { id: "open-in-tab", label: "Open in new tab" },
          { id: "continue-in-chat", label: "Continue in chat" },
          ...(canAttachAgentResult(subject)
            ? [{ id: "attach-result" as const, label: "Attach result to chat" }]
            : []),
          ...(showInAgentsPanel
            ? [{ id: "show-in-agents" as const, label: "Show in Agents panel" }]
            : []),
        ];
        const action = await api.contextMenu.show(items, position);
        if (action === "open-in-tab") {
          useRightPanelStore.getState().openAgent(parentRef, agent);
        } else if (action === "show-in-agents") {
          // The panel opens on the agent's detail; Back returns to the fleet.
          useAgentDrillStore.getState().focus(scopedThreadKey(parentRef), agent.childThreadId);
          useRightPanelStore.getState().open(parentRef, "agents");
        } else if (action === "continue-in-chat") {
          // The new chat tab belongs to the chat the user is in, even for a nested agent.
          const parent = readThreadProjection(parentRef);
          if (!parent) return;
          const workspaceRoot =
            parent.thread.worktreePath ??
            readProject(scopeProjectRef(parentRef.environmentId, parent.thread.projectId))
              ?.workspaceRoot ??
            null;
          await continueAgentInChat({
            environmentId: parentRef.environmentId,
            parentThread: parent.thread,
            subagent,
            title: agent.title,
            workspaceRoot,
            openTab: (tabRef) =>
              navigate({
                to: "/$environmentId/$threadId",
                params: buildThreadRouteParams(tabRef),
              }),
          });
        } else if (action === "attach-result") {
          attachAgentResultToChat(composerRef, subject);
        }
      })().catch(() => undefined);
    },
    [composerRef, navigate, parentRef, showInAgentsPanel],
  );
}
