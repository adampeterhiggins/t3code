/**
 * Fork: referencing a subagent in chat by its `@handle` (`subagentHandles.ts`). The composer's
 * `@` menu, the agent context menu, and the Reference buttons on agent surfaces all insert the
 * same chip, whose payload tells the provider how to reach the agent.
 */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  deriveThreadAgentFleet,
  type AgentFleetEntry,
} from "@t3tools/client-runtime/state/agent-fleet";
import { formatSubagentDisplayTitle } from "@t3tools/client-runtime/state/subagent-display";
import {
  subagentContextRecord,
  subagentContextRecordFromShell,
  subagentHandlesFromShells,
  subagentHandleSlug,
} from "@t3tools/client-runtime/state/subagent-handles";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type {
  EnvironmentId,
  NodeId,
  OrchestrationV2Subagent,
  ScopedThreadRef,
  SubagentContextRecord,
  ThreadId,
} from "@t3tools/contracts";
import { useCallback, useMemo } from "react";

import { useComposerDraftStore } from "~/composerDraftStore";
import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { useIssueContextStore } from "~/issueContextStore";
import {
  loadThreadProjection,
  readThreadProjection,
  readThreadShells,
  useThreadShellsValue,
} from "~/state/entities";

import { toastManager } from "../ui/toast";

/** An agent by the thread that started it, and its child thread or, before that exists, its record. */
export interface AgentReferenceTarget {
  readonly environmentId: EnvironmentId;
  readonly ownerThreadId: ThreadId;
  readonly childThreadId: ThreadId | null;
  readonly subagentId: NodeId | null;
}

export function agentReferenceTargetOf(
  environmentId: EnvironmentId,
  entry: AgentFleetEntry,
): AgentReferenceTarget {
  return {
    environmentId,
    ownerThreadId: entry.ownerThreadId,
    childThreadId: entry.childThreadId,
    subagentId: entry.subagent?.id ?? null,
  };
}

/** `AgentFleetEntry.key` of a target. */
function targetKey(target: Pick<AgentReferenceTarget, "childThreadId" | "subagentId">) {
  return target.childThreadId ?? `subagent:${target.subagentId}`;
}

function ownerAgents(
  environmentId: EnvironmentId,
  ownerThreadId: ThreadId,
  subagents: ReadonlyArray<OrchestrationV2Subagent>,
  shells: ReadonlyArray<EnvironmentThreadShell>,
) {
  return deriveThreadAgentFleet({
    threadId: ownerThreadId,
    subagents,
    shells: shells.filter((shell) => shell.environmentId === environmentId).map((s) => s.source),
  }).filter((entry) => entry.ownerThreadId === ownerThreadId);
}

function environmentHandles(
  environmentId: EnvironmentId,
  ownerThreadId: ThreadId,
  shells: ReadonlyArray<EnvironmentThreadShell>,
) {
  return subagentHandlesFromShells(
    ownerThreadId,
    shells.filter((shell) => shell.environmentId === environmentId).map((shell) => shell.source),
  );
}

/**
 * An agent's handle, from its owner's child thread shells. Re-renders only when it changes. Null
 * while the agent's thread is unknown; agents shown before their thread exists carry the handle on
 * their fleet entry instead.
 */
export function useAgentHandle(
  environmentId: EnvironmentId | null,
  ownerThreadId: ThreadId | null,
  childThreadId: ThreadId | null,
): string | null {
  const select = useCallback(
    (shells: ReadonlyArray<EnvironmentThreadShell>) => {
      if (environmentId === null || ownerThreadId === null || childThreadId === null) return null;
      return environmentHandles(environmentId, ownerThreadId, shells).get(childThreadId) ?? null;
    },
    [childThreadId, environmentId, ownerThreadId],
  );
  return useThreadShellsValue(select);
}

/**
 * Handles of every agent `ownerThreadId` started that has a child thread, by child thread id, for
 * lists that cannot call `useAgentHandle` per row. Re-renders only when a handle changes.
 */
export function useAgentHandles(
  environmentId: EnvironmentId | null,
  ownerThreadId: ThreadId | null,
): ReadonlyMap<ThreadId, string> {
  // A string, so the shells subscription compares by value.
  const select = useCallback(
    (shells: ReadonlyArray<EnvironmentThreadShell>) => {
      if (environmentId === null || ownerThreadId === null) return "";
      return JSON.stringify([...environmentHandles(environmentId, ownerThreadId, shells)]);
    },
    [environmentId, ownerThreadId],
  );
  const serialized = useThreadShellsValue(select);
  return useMemo(
    () => new Map(serialized === "" ? [] : (JSON.parse(serialized) as Array<[ThreadId, string]>)),
    [serialized],
  );
}

/** The chip payload for an agent, loading its owner's record when no view has it open. */
export async function resolveAgentContextRecord(
  target: AgentReferenceTarget,
): Promise<SubagentContextRecord | null> {
  const ownerRef = scopeThreadRef(target.environmentId, target.ownerThreadId);
  const owner = readThreadProjection(ownerRef) ?? (await loadThreadProjection(ownerRef));
  if (!owner) return null;
  const subagent = owner.subagents.find((candidate) =>
    target.childThreadId !== null
      ? candidate.childThreadId === target.childThreadId
      : candidate.id === target.subagentId,
  );
  const entry = ownerAgents(
    target.environmentId,
    target.ownerThreadId,
    owner.subagents,
    readThreadShells(),
  ).find((candidate) => candidate.key === targetKey(target));
  if (!subagent) {
    // The record may be paged out with an older run; the child thread still names the agent.
    if (!entry?.shell) return null;
    return subagentContextRecordFromShell({
      environmentId: target.environmentId,
      ownerThreadId: target.ownerThreadId,
      shell: entry.shell,
      handle: entry.handle,
      title: entry.title,
      status: entry.agent.status,
    });
  }
  const title = entry?.title ?? formatSubagentDisplayTitle(subagent.title ?? subagent.prompt);
  return subagentContextRecord({
    environmentId: target.environmentId,
    subagent,
    handle: entry?.handle ?? subagentHandleSlug(title),
    title,
    status: entry?.agent.status ?? subagent.status,
  });
}

/** Puts an agent's chip at the caret of `composerRef`'s composer, or at the end of its draft. */
export async function referenceAgentInChat(
  composerRef: ScopedThreadRef,
  target: AgentReferenceTarget,
): Promise<boolean> {
  const record = await resolveAgentContextRecord(target);
  if (record === null) {
    toastManager.add({
      type: "error",
      title: "Could not reference the agent",
      description: "Its record isn't available yet. Try again in a moment.",
    });
    return false;
  }
  useIssueContextStore.getState().upsert(composerRef.threadId, record);
  useComposerDraftStore.getState().insertContextReference(composerRef, {
    kind: "subagent",
    contextId: record.contextId,
    label: record.label,
  });
  return true;
}

export function copyAgentHandle(handle: string): void {
  void writeTextToClipboard(`@${handle}`).then(
    () => toastManager.add({ type: "success", title: `Copied @${handle}` }),
    () => toastManager.add({ type: "error", title: "Could not copy the handle" }),
  );
}
