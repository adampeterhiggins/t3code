/**
 * Fork: the right-click menu of a subagent, wherever the parent chat lists it (thread lineage,
 * the conversation's agent rows): open it in an agent tab, continue from its work in a new chat
 * tab, or attach its result to this chat.
 */
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { ContextMenuItem, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, type MouseEvent } from "react";

import { useComposerHandleContext } from "~/composerHandleContext";
import { readLocalApi } from "~/localApi";
import { useRightPanelStore } from "~/rightPanelStore";
import { readProject, readThreadProjection } from "~/state/entities";
import { buildThreadRouteParams } from "~/threadRoutes";

import {
  attachAgentResultToChat,
  canAttachAgentResult,
  continueAgentInChat,
  subagentContextSubject,
} from "./agentChatActions";

type AgentMenuAction = "open-in-tab" | "continue-in-chat" | "attach-result";

function menuPosition(event: MouseEvent<HTMLElement>): { x: number; y: number } {
  if (event.clientX === 0 && event.clientY === 0) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: bounds.left, y: bounds.bottom };
  }
  return { x: event.clientX, y: event.clientY };
}

/**
 * Returns a context-menu handler for the subagents of `parentRef`, or null for a row whose child
 * thread is unknown. The agent is read from the parent's open projection when the menu opens.
 */
export function useAgentContextMenu(parentRef: ScopedThreadRef) {
  const navigate = useNavigate();
  const composerRef = useComposerHandleContext();
  return useCallback(
    (event: MouseEvent<HTMLElement>, agent: { childThreadId: ThreadId; title: string }) => {
      const parent = readThreadProjection(parentRef);
      const subagent = parent?.subagents.find(
        (candidate) => candidate.childThreadId === agent.childThreadId,
      );
      const api = readLocalApi();
      if (!parent || !subagent || !api) return;
      event.preventDefault();
      event.stopPropagation();
      const subject = subagentContextSubject(subagent, agent.title);
      const canAttach = canAttachAgentResult(subject);
      const items: ContextMenuItem<AgentMenuAction>[] = [
        { id: "open-in-tab", label: "Open in new tab" },
        { id: "continue-in-chat", label: "Continue in chat" },
        ...(canAttach ? [{ id: "attach-result" as const, label: "Attach result to chat" }] : []),
      ];
      void api.contextMenu
        .show(items, menuPosition(event))
        .then((action) => {
          if (action === "open-in-tab") {
            useRightPanelStore.getState().openAgent(parentRef, agent);
          } else if (action === "continue-in-chat") {
            const workspaceRoot =
              parent.thread.worktreePath ??
              readProject(scopeProjectRef(parentRef.environmentId, parent.thread.projectId))
                ?.workspaceRoot ??
              null;
            void continueAgentInChat({
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
        })
        .catch(() => undefined);
    },
    [composerRef, navigate, parentRef],
  );
}
