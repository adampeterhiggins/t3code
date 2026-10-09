/**
 * Fork: the right-click menu of a subagent, wherever the parent chat lists it (thread lineage,
 * the conversation's agent rows, the Agents panel): reference it in this chat by its `@handle`,
 * copy the handle, open it in an agent tab, continue from its work in a new chat tab, attach its
 * result to this chat, or find it in the Agents panel.
 */
import {
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import type {
  ContextMenuItem,
  NodeId,
  OrchestrationV2ThreadProjection,
  ScopedThreadRef,
  ThreadId,
} from "@t3tools/contracts";
import type { AgentFleetEntry } from "@t3tools/client-runtime/state/agent-fleet";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, type MouseEvent } from "react";

import { useAgentDrillStore } from "~/agentDrillStore";
import { readLocalApi } from "~/localApi";
import { useRightPanelStore } from "~/rightPanelStore";
import { loadThreadProjection, readProject, readThreadProjection } from "~/state/entities";
import { buildThreadRouteParams } from "~/threadRoutes";

import {
  copyAgentHandle,
  referenceAgentInChat,
  resolveAgentContextRecord,
} from "./agentReferences";
import {
  canAttachAgentResult,
  continueAgentInChat,
  subagentContextSubject,
} from "./agentChatActions";

type AgentMenuAction =
  | "reference"
  | "copy-handle"
  | "open-in-tab"
  | "continue-in-chat"
  | "attach-result"
  | "show-in-agents";

function menuPosition(event: MouseEvent<HTMLElement>): { x: number; y: number } {
  if (event.clientX === 0 && event.clientY === 0) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: bounds.left, y: bounds.bottom };
  }
  return { x: event.clientX, y: event.clientY };
}

/** An agent the menu acts on: by its child thread, or by its record before the thread exists. */
export type AgentMenuTarget =
  | { childThreadId: ThreadId; title: string; ownerThreadId?: ThreadId }
  | { childThreadId: null; subagentId: NodeId; title: string };

/** The Agents panel's key for an agent (`AgentFleetEntry.key`). */
export function agentMenuTargetKey(agent: AgentMenuTarget): string {
  return agent.childThreadId ?? `subagent:${agent.subagentId}`;
}

/** Opens the Agents panel on one agent's detail; Back returns to the fleet. */
export function showAgentInPanel(parentRef: ScopedThreadRef, key: string): void {
  useAgentDrillStore.getState().focus(scopedThreadKey(parentRef), key);
  useRightPanelStore.getState().open(parentRef, "agents");
}

/** Opens the Agents panel on its fleet list. */
export function showAgentsPanel(parentRef: ScopedThreadRef): void {
  useAgentDrillStore.getState().reset(scopedThreadKey(parentRef));
  useRightPanelStore.getState().open(parentRef, "agents");
}

/**
 * Returns a context-menu handler for the agents listed in `parentRef`'s chat. Tabs open in
 * `parentRef`'s right panel. A nested agent names its `ownerThreadId`, the subagent thread that
 * spawned it, whose record is loaded when the menu opens. An agent without a child thread has no
 * tab. `showInAgentsPanel` adds the item that opens the Agents panel, for lists other than that
 * panel.
 */
export function useAgentContextMenu(
  parentRef: ScopedThreadRef,
  options?: { readonly showInAgentsPanel?: boolean },
) {
  const navigate = useNavigate();
  const showInAgentsPanel = options?.showInAgentsPanel ?? true;
  return useCallback(
    (event: MouseEvent<HTMLElement>, agent: AgentMenuTarget) => {
      const api = readLocalApi();
      if (!api) return;
      const ownerThreadId = agent.childThreadId === null ? undefined : agent.ownerThreadId;
      const ownerRef =
        ownerThreadId === undefined || ownerThreadId === parentRef.threadId
          ? parentRef
          : scopeThreadRef(parentRef.environmentId, ownerThreadId);
      const loadedOwner = readThreadProjection(ownerRef);
      const findSubagent = (owner: OrchestrationV2ThreadProjection | null) =>
        owner?.subagents.find((candidate) =>
          agent.childThreadId === null
            ? candidate.id === agent.subagentId
            : candidate.childThreadId === agent.childThreadId,
        ) ?? null;
      // Without a record there is nothing to act on; leave the native menu alone.
      if (loadedOwner !== null && findSubagent(loadedOwner) === null) return;
      event.preventDefault();
      event.stopPropagation();
      const position = menuPosition(event);
      void (async () => {
        const subagent = findSubagent(loadedOwner ?? (await loadThreadProjection(ownerRef)));
        if (!subagent) return;
        const subject = subagentContextSubject(subagent, agent.title);
        const childThreadId = agent.childThreadId;
        const referenceTarget = {
          environmentId: parentRef.environmentId,
          ownerThreadId: ownerRef.threadId,
          childThreadId,
          subagentId: subagent.id,
        };
        const record = await resolveAgentContextRecord(referenceTarget);
        const items: ContextMenuItem<AgentMenuAction>[] = [
          { id: "reference", label: "Reference in chat" },
          ...(record === null
            ? []
            : [{ id: "copy-handle" as const, label: `Copy @${record.handle}` }]),
          ...(childThreadId === null
            ? []
            : [{ id: "open-in-tab" as const, label: "Open in new tab" }]),
          { id: "continue-in-chat", label: "Continue in chat" },
          ...(canAttachAgentResult(subject)
            ? [{ id: "attach-result" as const, label: "Attach result to chat" }]
            : []),
          ...(showInAgentsPanel
            ? [{ id: "show-in-agents" as const, label: "Show in Agents panel" }]
            : []),
        ];
        const action = await api.contextMenu.show(items, position);
        if (action === "reference") {
          await referenceAgentInChat(parentRef, referenceTarget);
        } else if (action === "copy-handle") {
          if (record !== null) copyAgentHandle(record.handle);
        } else if (action === "open-in-tab") {
          if (childThreadId !== null) {
            useRightPanelStore
              .getState()
              .openAgent(parentRef, { childThreadId, title: agent.title });
          }
        } else if (action === "show-in-agents") {
          showAgentInPanel(parentRef, agentMenuTargetKey(agent));
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
          // The agent's chip carries its task and result.
          await referenceAgentInChat(parentRef, referenceTarget);
        }
      })().catch(() => undefined);
    },
    [navigate, parentRef, showInAgentsPanel],
  );
}

/** The menu target for a fleet row; null for a nested agent row that has neither. */
export function agentMenuTargetOf(entry: AgentFleetEntry): AgentMenuTarget | null {
  if (entry.childThreadId !== null) {
    return {
      childThreadId: entry.childThreadId,
      title: entry.title,
      ownerThreadId: entry.ownerThreadId,
    };
  }
  return entry.subagent === null
    ? null
    : { childThreadId: null, subagentId: entry.subagent.id, title: entry.title };
}
