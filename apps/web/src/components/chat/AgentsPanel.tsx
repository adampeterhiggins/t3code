/**
 * Fork: the Agents right-panel surface, the whole fleet of a thread's subagents. Lineage in the
 * thread details panel lists the same agents compactly; both read the list logic in
 * `agentListView.ts`/`agentFleet.ts` and share one filter and sort (`agentListViewStore.ts`).
 *
 * - Spawn order is stable; activity and completion update rows in place.
 * - Agents spawned by an agent sit indented under it, found through child-thread lineage.
 * - Clicking an agent drills into its detail view in place (`AgentDetailPanel`), with Back to the
 *   list; an agent it started drills one level further, and a tool call clicked in a preview opens
 *   the agent on that call. An agent recorded before its child thread exists opens on its record.
 *   The drill-in is per thread and session-only (`agentDrillStore.ts`). **Open in new tab** pins an
 *   agent as its own agent tab.
 * - The footer counts agents by status and sums the usage they reported.
 * - Static status dots and DOM-write elapsed timers. Rows page in, and only working rows on
 *   screen (or an open preview) subscribe to a child thread; the detail view subscribes to its
 *   agent's child thread while it is shown.
 */
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  arrangeAgentFleet,
  deriveThreadAgentFleet,
  summarizeAgentFleet,
  type AgentFleetEntry,
} from "@t3tools/client-runtime/state/agent-fleet";
import {
  isAgentListViewFiltered,
  type AgentStatusFilter,
} from "@t3tools/client-runtime/state/agent-list-view";
import { formatSubagentDisplayTitle } from "@t3tools/client-runtime/state/subagent-display";
import type { RuntimeSubagent } from "@t3tools/client-runtime/state/subagentRuntime";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type {
  NodeId,
  OrchestrationV2Subagent,
  ScopedThreadRef,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import { BotIcon, ListCollapseIcon, ListIcon, PanelTopIcon } from "lucide-react";
import { useCallback, useMemo, useState, type MouseEvent } from "react";

import { selectAgentDrillStack, useAgentDrillStore } from "~/agentDrillStore";
import { useAgentListViewStore } from "~/agentListViewStore";
import { useRightPanelStore } from "~/rightPanelStore";
import { useThreadProjection, useThreadShell, useThreadShellsValue } from "~/state/entities";

import { StatusDot } from "../AgentStatus";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { AgentUsageFooter } from "./AgentActivityParts";
import { AgentDetailPanel } from "./AgentDetailPanel";
import { agentReferenceTargetOf, referenceAgentInChat } from "./agentReferences";
import { AgentRow, useEnvironmentShells, useProviderEntries } from "./AgentFleetRow";
import { AgentListToolbar } from "./AgentListToolbar";
import { agentMenuTargetOf, useAgentContextMenu } from "./agentContextMenu";

const PAGE_SIZE = 50;

const STATUS_COUNTS: ReadonlyArray<{
  readonly filter: AgentStatusFilter;
  readonly status: RuntimeSubagent["status"];
  readonly label: string;
}> = [
  { filter: "working", status: "running", label: "Working" },
  { filter: "idle", status: "idle", label: "Idle" },
  { filter: "done", status: "completed", label: "Completed" },
  { filter: "failed", status: "failed", label: "Failed" },
  { filter: "stopped", status: "cancelled", label: "Stopped" },
];

function StatusCount(props: { status: RuntimeSubagent["status"]; count: number; label: string }) {
  if (props.count === 0) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span tabIndex={0} className="flex shrink-0 items-center gap-1 outline-none" />}
      >
        <StatusDot status={props.status} />
        <span className="text-foreground">{props.count}</span>
      </TooltipTrigger>
      <TooltipPopup>
        {props.label} · {props.count}
      </TooltipPopup>
    </Tooltip>
  );
}

/** Shows or hides each agent row's second line: its latest tool call, result, or error. */
function RowDetailsToggle() {
  const show = useAgentListViewStore((state) => state.showRowDetails);
  const setShow = useAgentListViewStore((state) => state.setShowRowDetails);
  const label = show ? "Hide agent details" : "Show agent details";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="icon-xs"
            variant="ghost-muted"
            aria-label={label}
            aria-pressed={!show}
            onClick={() => setShow(!show)}
          />
        }
      >
        {show ? <ListCollapseIcon /> : <ListIcon />}
      </TooltipTrigger>
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  );
}

interface AgentsPanelProps {
  readonly threadRef: ScopedThreadRef;
  /** The directory the agents' commands and paths are shown relative to. */
  readonly workspaceRoot: string | null;
  /** Opens the thread details panel, where Lineage lists the same agents. */
  readonly onShowLineage?: (() => void) | undefined;
}

/**
 * How many of a thread's agents are working, nested agents included, following live follow-up
 * runs: the count the Agents launcher badges. Re-renders only when the count changes.
 */
export function useWorkingAgentCount(
  threadRef: ScopedThreadRef | null,
  subagents: ReadonlyArray<OrchestrationV2Subagent> | undefined,
): number {
  const environmentId = threadRef?.environmentId ?? null;
  const threadId = threadRef?.threadId ?? null;
  const count = useCallback(
    (shells: ReadonlyArray<EnvironmentThreadShell>) => {
      if (environmentId === null || threadId === null) return 0;
      // Most threads have no agents; skip building the fleet for them.
      if (
        (subagents?.length ?? 0) === 0 &&
        !shells.some((shell) => shell.source.lineage.parentThreadId === threadId)
      ) {
        return 0;
      }
      const fleet = deriveThreadAgentFleet({
        threadId,
        subagents: subagents ?? [],
        shells: shells
          .filter((shell) => shell.environmentId === environmentId)
          .map((shell) => shell.source),
      });
      return summarizeAgentFleet(fleet).counts.working;
    },
    [environmentId, subagents, threadId],
  );
  return useThreadShellsValue(count);
}

const RECORD_KEY_PREFIX = "subagent:";

/** A drill key's child thread, or the record id of an agent without one (`AgentFleetEntry.key`). */
function drillTarget(key: string): {
  readonly childThreadId: ThreadId | null;
  readonly subagentId: NodeId | undefined;
} {
  return key.startsWith(RECORD_KEY_PREFIX)
    ? { childThreadId: null, subagentId: key.slice(RECORD_KEY_PREFIX.length) as NodeId }
    : { childThreadId: key as ThreadId, subagentId: undefined };
}

/** Drills into an agent; a tool call from its preview opens it on that call. */
function openFleetEntry(threadKey: string, entry: AgentFleetEntry, toolCallId?: TurnItemId) {
  const store = useAgentDrillStore.getState();
  if (toolCallId && entry.childThreadId !== null) {
    store.focusToolCall({ childThreadId: entry.childThreadId, itemId: toolCallId });
  }
  store.push(threadKey, entry.key);
}

export function AgentsPanel(props: AgentsPanelProps) {
  const { threadRef } = props;
  const threadKey = scopedThreadKey(threadRef);
  const stack = useAgentDrillStore(selectAgentDrillStack(threadKey));
  const focused = stack.at(-1) ?? null;
  const previous = stack.length > 1 ? drillTarget(stack.at(-2)!).childThreadId : null;
  const previousShell = useThreadShell(
    previous === null ? null : scopeThreadRef(threadRef.environmentId, previous),
  );
  if (focused === null) return <AgentFleetList {...props} />;
  const target = drillTarget(focused);
  return (
    <AgentDetailPanel
      key={focused}
      parentRef={threadRef}
      childThreadId={target.childThreadId}
      subagentId={target.subagentId}
      workspaceRoot={props.workspaceRoot}
      backLabel={
        previous === null ? "Agents" : formatSubagentDisplayTitle(previousShell?.title ?? "Agent")
      }
      onBack={() => useAgentDrillStore.getState().back(threadKey)}
      onOpenInTab={(agent) => useRightPanelStore.getState().openAgent(threadRef, agent)}
      onOpenAgent={(agent) => useAgentDrillStore.getState().push(threadKey, agent.childThreadId)}
      onOpenRecord={(key) => useAgentDrillStore.getState().push(threadKey, key)}
    />
  );
}

function AgentFleetList(props: AgentsPanelProps) {
  const { threadRef } = props;
  const threadKey = scopedThreadKey(threadRef);
  const projection = useThreadProjection(threadRef)?.projection ?? null;
  const shells = useEnvironmentShells(threadRef.environmentId);
  const providers = useProviderEntries(threadRef.environmentId);
  const view = useAgentListViewStore((state) => state.view);
  const setView = useAgentListViewStore((state) => state.setView);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const openAgentMenu = useAgentContextMenu(threadRef, { showInAgentsPanel: false });
  const fleet = useMemo(
    () =>
      deriveThreadAgentFleet({
        threadId: threadRef.threadId,
        subagents: projection?.subagents ?? [],
        shells,
      }),
    [projection?.subagents, shells, threadRef.threadId],
  );
  const rows = useMemo(
    () => arrangeAgentFleet(fleet, view, threadRef.threadId),
    [fleet, threadRef.threadId, view],
  );
  const summary = useMemo(() => summarizeAgentFleet(fleet), [fleet]);
  const filtered = isAgentListViewFiltered(view);
  const visibleRows = rows.slice(0, visibleCount);
  const hiddenCount = rows.length - visibleRows.length;
  const openAgent = (entry: AgentFleetEntry, toolCallId?: TurnItemId) =>
    openFleetEntry(threadKey, entry, toolCallId);
  const onContextMenu = (event: MouseEvent<HTMLElement>, entry: AgentFleetEntry) => {
    const target = agentMenuTargetOf(entry);
    if (target !== null) openAgentMenu(event, target);
  };
  const lineageButton = props.onShowLineage ? (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="icon-xs"
            variant="ghost-muted"
            aria-label="Show in Lineage"
            onClick={props.onShowLineage}
          />
        }
      >
        <PanelTopIcon />
      </TooltipTrigger>
      <TooltipPopup>Show in Lineage</TooltipPopup>
    </Tooltip>
  ) : null;

  if (fleet.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <BotIcon aria-hidden className="size-6 text-muted-foreground/60" />
        <p className="text-sm font-medium">
          {projection === null ? "Loading agents…" : "No agents yet"}
        </p>
        {projection !== null ? (
          <p className="max-w-56 text-xs text-muted-foreground">
            When this thread spawns subagents, they show up here with live status, activity, and
            token usage.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1 px-2 pt-2">
        <div className="min-w-0 flex-1">
          <AgentListToolbar view={view} onChange={setView} />
        </div>
        <div className="flex items-center pb-1">
          <RowDetailsToggle />
          {lineageButton}
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col p-2 pt-0">
          {rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
              <p className="text-xs text-muted-foreground">No agents match these filters.</p>
              <Button
                size="xs"
                variant="outline"
                onClick={() => setView({ ...view, statuses: [], query: "" })}
              >
                Clear filters
              </Button>
            </div>
          ) : null}
          {visibleRows.map((row) => (
            <AgentRow
              key={row.entry.key}
              parentRef={threadRef}
              row={row}
              providers={providers}
              workspaceRoot={props.workspaceRoot}
              onOpen={openAgent}
              onContextMenu={onContextMenu}
              onReference={(entry) =>
                void referenceAgentInChat(
                  threadRef,
                  agentReferenceTargetOf(threadRef.environmentId, entry),
                )
              }
            />
          ))}
          {hiddenCount > 0 ? (
            <div className="mt-1">
              <Button
                size="xs"
                variant="ghost-muted"
                onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
              >
                Show {Math.min(hiddenCount, PAGE_SIZE)} more
              </Button>
            </div>
          ) : null}
        </div>
      </ScrollArea>
      <AgentUsageFooter
        usage={summary.usage}
        leading={
          <>
            {STATUS_COUNTS.map(({ filter, status, label }) => (
              <StatusCount
                key={filter}
                status={status}
                count={summary.counts[filter]}
                label={label}
              />
            ))}
            {filtered ? <span className="shrink-0">· {rows.length} shown</span> : null}
          </>
        }
      />
    </div>
  );
}
