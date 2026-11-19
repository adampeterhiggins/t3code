import {
  deriveOtherThreadAgents,
  deriveThreadAgentFleet,
} from "@t3tools/client-runtime/state/agent-fleet";
import { matchesSubagentQuery } from "@t3tools/client-runtime/state/subagent-handles";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useGT } from "gt-react";

import { useThreadProjection, useThreadShells } from "~/state/entities";

import type { ComposerCommandItem } from "./ComposerCommandMenu";

const EMPTY_ITEMS: ReadonlyArray<ComposerCommandItem> = [];
const OTHER_THREAD_AGENT_LIMIT = 20;

/**
 * Fork: the `@` menu's Agents tab: this thread's agents (nested included), then, once a query is
 * typed, other threads' newest matching agents. `prefersAgents` opens the tab when the query
 * starts a handle. Subscribes to nothing while `@` is closed.
 */
export function useComposerAgentItems(
  threadRef: ScopedThreadRef | null,
  enabled: boolean,
  query: string,
  /** The directory agents' tool calls are shown relative to. */
  workspaceRoot: string | null,
) {
  const gt = useGT();
  const environmentId = enabled ? (threadRef?.environmentId ?? null) : null;
  const threadId = enabled ? (threadRef?.threadId ?? null) : null;
  const activeRef =
    environmentId === null || threadId === null ? null : { environmentId, threadId };
  const projection = useThreadProjection(activeRef)?.projection ?? null;
  const shells = useThreadShells(activeRef !== null);
  const environmentShells =
    activeRef === null
      ? []
      : shells
          .filter((shell) => shell.environmentId === activeRef.environmentId)
          .map((shell) => shell.source);
  const fleet =
    activeRef === null
      ? []
      : deriveThreadAgentFleet({
          threadId: activeRef.threadId,
          subagents: projection?.subagents ?? [],
          shells: environmentShells,
        });
  const needle = query.trim().toLowerCase();
  const ownKeys = new Set(fleet.map((entry) => entry.key));
  const others =
    activeRef === null || needle === ""
      ? []
      : deriveOtherThreadAgents({ threadId: activeRef.threadId, shells: environmentShells })
          .filter((entry) => !ownKeys.has(entry.key) && matchesSubagentQuery(entry, needle))
          .toSorted((left, right) =>
            (right.subject.spawnedAt ?? "").localeCompare(left.subject.spawnedAt ?? ""),
          )
          .slice(0, OTHER_THREAD_AGENT_LIMIT);
  if (activeRef === null || (fleet.length === 0 && others.length === 0)) {
    return { available: false, prefersAgents: false, items: EMPTY_ITEMS };
  }
  const titles = new Map(environmentShells.map((shell) => [shell.id, shell.title]));
  const items = [
    ...fleet
      .filter((entry) => matchesSubagentQuery(entry, needle))
      .map((entry) => ({ entry, ownerTitle: null })),
    ...others.map((entry) => ({
      entry,
      ownerTitle: titles.get(entry.ownerThreadId) ?? gt("another thread"),
    })),
  ].map(({ entry, ownerTitle }): ComposerCommandItem => ({
    id: `subagent:${entry.key}`,
    type: "subagent",
    parentRef: activeRef,
    entry,
    ownerTitle,
    workspaceRoot,
    label: `@${entry.handle}`,
    description: entry.title,
  }));
  return {
    available: true,
    prefersAgents:
      needle.length > 0 && [...fleet, ...others].some((entry) => entry.handle.startsWith(needle)),
    items,
  };
}
