import { deriveThreadAgentFleet } from "@t3tools/client-runtime/state/agent-fleet";
import { matchesSubagentQuery } from "@t3tools/client-runtime/state/subagent-handles";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useMemo } from "react";

import { useThreadProjection, useThreadShells } from "~/state/entities";

import type { ComposerCommandItem } from "./ComposerCommandMenu";

const EMPTY_ITEMS: ReadonlyArray<ComposerCommandItem> = [];

/**
 * Fork: the `@` menu's Agents tab: every agent of the thread being composed in, nested agents
 * included, matched by handle or title. Subscribes to nothing while `@` is closed.
 * `prefersAgents` is set when the typed query starts an agent's handle, so `@explore` opens on
 * the Agents tab.
 */
export function useComposerAgentItems(
  threadRef: ScopedThreadRef | null,
  enabled: boolean,
  query: string,
  /** The directory agents' tool calls are shown relative to. */
  workspaceRoot: string | null,
) {
  const environmentId = enabled ? (threadRef?.environmentId ?? null) : null;
  const threadId = enabled ? (threadRef?.threadId ?? null) : null;
  const activeRef = useMemo(
    () => (environmentId === null || threadId === null ? null : { environmentId, threadId }),
    [environmentId, threadId],
  );
  const projection = useThreadProjection(activeRef)?.projection ?? null;
  const shells = useThreadShells(activeRef !== null);
  const fleet = useMemo(() => {
    if (activeRef === null) return [];
    return deriveThreadAgentFleet({
      threadId: activeRef.threadId,
      subagents: projection?.subagents ?? [],
      shells: shells
        .filter((shell) => shell.environmentId === activeRef.environmentId)
        .map((shell) => shell.source),
    });
  }, [activeRef, projection?.subagents, shells]);
  return useMemo(() => {
    if (activeRef === null || fleet.length === 0) {
      return { available: false, prefersAgents: false, items: EMPTY_ITEMS };
    }
    const needle = query.trim().toLowerCase();
    const items = fleet
      .filter((entry) => matchesSubagentQuery(entry, needle))
      .map((entry): ComposerCommandItem => ({
        id: `subagent:${entry.key}`,
        type: "subagent",
        parentRef: activeRef,
        entry,
        workspaceRoot,
        label: `@${entry.handle}`,
        description: entry.title,
      }));
    return {
      available: true,
      prefersAgents: needle.length > 0 && fleet.some((entry) => entry.handle.startsWith(needle)),
      items,
    };
  }, [activeRef, fleet, query, workspaceRoot]);
}
