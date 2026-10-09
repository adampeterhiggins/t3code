/**
 * Fork: referencing a subagent in chat by its `@handle` (client-runtime `subagentHandles.ts`).
 * The composer's `@` menu and the agent rows' long-press menu insert the same chip.
 */
import { useAtomValue } from "@effect/atom-react";
import { deriveThreadAgentFleet } from "@t3tools/client-runtime/state/agent-fleet";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { subagentContextRecord } from "@t3tools/client-runtime/state/subagent-handles";
import type { EnvironmentId, OrchestrationV2Subagent, ThreadId } from "@t3tools/contracts";
import { formatComposerContextReference } from "@t3tools/shared/composerContextReferences";
import { useCallback, useMemo } from "react";
import { Alert } from "react-native";

import { scopedThreadKey } from "../../lib/scopedEntities";
import { environmentThreadShells } from "../../state/threads";
import { insertComposerDraftContext } from "../../state/use-composer-drafts";

/** An agent as its rows name it: the handle, and the title and status a chip records. */
export interface AgentReference {
  readonly handle: string;
  readonly title: string;
  readonly status: string;
}

/** `AgentFleetEntry.key` of an agent record. */
export function agentReferenceKey(
  subagent: Pick<OrchestrationV2Subagent, "id" | "childThreadId">,
): string {
  return subagent.childThreadId ?? `subagent:${subagent.id}`;
}

/**
 * The agents `ownerThreadId` started, by `agentReferenceKey`. Handles are deduped per owner, so
 * only the owner's own child shells are read. Re-renders only when a reference changes.
 */
export function useAgentReferences(
  environmentId: EnvironmentId,
  ownerThreadId: ThreadId | null,
  subagents: ReadonlyArray<OrchestrationV2Subagent>,
): ReadonlyMap<string, AgentReference> {
  // A string, so the shells subscription compares by value.
  const select = useCallback(
    (shells: ReadonlyArray<EnvironmentThreadShell>) =>
      ownerThreadId === null
        ? "[]"
        : JSON.stringify(
            deriveThreadAgentFleet({
              threadId: ownerThreadId,
              subagents,
              shells: shells.flatMap((shell) =>
                shell.environmentId === environmentId &&
                shell.source.lineage.parentThreadId === ownerThreadId
                  ? [shell.source]
                  : [],
              ),
            }).map((entry): [string, AgentReference] => [
              entry.key,
              { handle: entry.handle, title: entry.title, status: entry.agent.status },
            ]),
          ),
    [environmentId, ownerThreadId, subagents],
  );
  const serialized = useAtomValue(environmentThreadShells.threadShellsAtom, select);
  return useMemo(
    () => new Map(JSON.parse(serialized) as Array<[string, AgentReference]>),
    [serialized],
  );
}

/** Puts an agent's chip into its owner thread's composer draft, at the caret or the end. */
export function attachAgentToChat(
  environmentId: EnvironmentId,
  subagent: OrchestrationV2Subagent,
  reference: AgentReference,
): boolean {
  const record = subagentContextRecord({ environmentId, subagent, ...reference });
  const inserted = insertComposerDraftContext(scopedThreadKey(environmentId, subagent.threadId), {
    text: formatComposerContextReference(record),
    context: { version: 1, records: [record] },
  });
  if (!inserted) {
    Alert.alert("Too many context items", "Remove some context from the draft and try again.");
  }
  return inserted;
}
