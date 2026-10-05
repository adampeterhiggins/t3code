import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { ThreadHoverCardPopup } from "../ThreadHoverCard";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import { CollapsibleSectionHeader, SectionHeaderStatus } from "../ui/collapsible-section-header";
import { SubagentTooltipContent } from "./SubagentTooltipContent";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  applyAgentListView,
  isAgentListViewFiltered,
  latestSubagentToolCall,
  type AgentListSubject,
} from "@t3tools/client-runtime/state/agent-list-view";
import {
  formatSubagentTokenCount,
  isActiveSubagentStatus,
  projectedSubagentsToRuntime,
  type RuntimeSubagent,
  type RuntimeSubagentStatus,
} from "@t3tools/client-runtime/state/subagentRuntime";
import { formatSubagentDisplayTitle } from "@t3tools/client-runtime/state/subagent-display";
import {
  deriveThreadRelationshipGraph,
  immediateThreadRelationships,
  isParentThreadRelationship,
  threadRelationshipRowStatus,
  orderWebThreadLineageRows,
  resolveMergeBackTargetThreadId,
  type ThreadRelationshipEdge,
  type ThreadRelationshipWalkRow,
} from "@t3tools/client-runtime/state/thread-relationships";
import {
  canDetachThreadProviderSession,
  resolveLatestMergeBackRun,
} from "@t3tools/client-runtime/state/thread-workflows";
import type {
  EnvironmentId,
  OrchestrationV2ThreadShell,
  ScopedThreadRef,
  ThreadId,
} from "@t3tools/contracts";
import { groupBy } from "effect/Array";
import * as DateTime from "effect/DateTime";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowRightIcon,
  BotIcon,
  CornerLeftUpIcon,
  GitForkIcon,
  LoaderCircleIcon,
  MoreHorizontalIcon,
  PlusIcon,
  UnplugIcon,
} from "lucide-react";
import { useMemo, useState, type MouseEvent, type ReactNode } from "react";

import { useAgentListViewStore } from "../../agentListViewStore";
import { useArchivedThreadSnapshots } from "../../lib/archivedThreadsState";
import { buildThreadRouteParams } from "../../threadRoutes";
import {
  useProjects,
  useServerConfigs,
  useThreadProjection,
  useThreadShells,
} from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { AgentElapsed } from "./AgentElapsed";
import { TOOL_KIND_ICONS } from "./agentToolKinds";
import { AgentListToolbar } from "./AgentListToolbar";
import { useAgentContextMenu } from "./agentContextMenu";
import { ThreadRelationshipIcon, threadRelationshipStatusLabel } from "./ThreadRelationshipIcon";

import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  THREAD_DETAILS_PANEL_LINK_SPLIT_GROUP_CLASS,
  THREAD_DETAILS_PANEL_ROW_CONTENT_CLASS,
  THREAD_DETAILS_PANEL_SPLIT_SEPARATOR_CLASS,
} from "./threadDetailsPanelStyles";

// Lineage paging: a busy thread can accumulate dozens of forks and subagents,
// and the panel it lives in already scrolls. Show a workable window, keep the
// rest behind Show more, and bound what is shown so the sections below Lineage
// stay reachable.
const THREAD_LINEAGE_INITIAL_COUNT = 6;
const THREAD_LINEAGE_PAGE_COUNT = 12;

export function resolveThreadLineageWindow<Row>(
  rows: ReadonlyArray<Row>,
  visibleCount: number,
): { readonly visibleRows: ReadonlyArray<Row>; readonly hiddenCount: number } {
  const visibleRows = rows.slice(0, visibleCount);
  return { visibleRows, hiddenCount: rows.length - visibleRows.length };
}

export function ThreadLineageRowList(props: {
  readonly hiddenCount: number;
  readonly onShowMore: () => void;
  readonly children: ReactNode;
}) {
  return (
    <>
      {/*
        Bounded rather than free-growing so Lineage cannot push the rest of the
        thread details panel out of view. Plain overflow, not a ScrollArea
        component: this sits inside an already scrolling panel, where a
        max-height-only virtual viewport measures badly. Every row is a focusable
        button, so keyboard users reach and scroll the region through the rows
        themselves and the container needs no extra tab stop of its own.
      */}
      <ul
        aria-label="Related threads"
        className="m-0 max-h-[13.5rem] list-none overflow-y-auto overscroll-contain p-0"
      >
        {props.children}
      </ul>
      {props.hiddenCount > 0 ? (
        <button
          type="button"
          onClick={props.onShowMore}
          className={`flex h-8 w-full cursor-pointer items-center rounded-lg ${THREAD_DETAILS_PANEL_ROW_CONTENT_CLASS} text-sm font-medium text-muted-foreground/70 hover:bg-black/[0.055] hover:text-foreground/80 dark:hover:bg-white/[0.075]`}
        >
          <PlusIcon aria-hidden className="size-4 shrink-0" />
          Show {Math.min(props.hiddenCount, THREAD_LINEAGE_PAGE_COUNT)} more
        </button>
      ) : null}
    </>
  );
}

function ThreadLineageGroup(props: {
  readonly label: string | null;
  readonly rows: ReadonlyArray<ThreadRelationshipWalkRow>;
  readonly expanded: boolean;
  /** Fork: a filtered agents list shows its matches instead of a collapsed header. */
  readonly forceExpanded?: boolean;
  readonly children: (rows: ReadonlyArray<ThreadRelationshipWalkRow>) => ReactNode;
}) {
  const [userExpanded, setExpanded] = useState(props.expanded);
  const expanded = userExpanded || props.forceExpanded === true;
  const [visibleCount, setVisibleCount] = useState(THREAD_LINEAGE_INITIAL_COUNT);
  const { visibleRows, hiddenCount } = resolveThreadLineageWindow(props.rows, visibleCount);
  const failedCount = props.rows.filter(
    ({ edge }) => edge.status === "failed" || edge.status === "error",
  ).length;
  if (props.rows.length === 0) return null;
  return (
    <div>
      {props.label ? (
        <CollapsibleSectionHeader
          expanded={expanded}
          onClick={() => setExpanded(!expanded)}
          accessory={
            failedCount > 0 ? <SectionHeaderStatus>{failedCount} failed</SectionHeaderStatus> : null
          }
        >
          {props.label}
          {!expanded && ` (${props.rows.length})`}
        </CollapsibleSectionHeader>
      ) : null}
      {expanded ? (
        <ThreadLineageRowList
          hiddenCount={hiddenCount}
          onShowMore={() => setVisibleCount((count) => count + THREAD_LINEAGE_PAGE_COUNT)}
        >
          {props.children(visibleRows)}
        </ThreadLineageRowList>
      ) : null}
    </div>
  );
}

function relationshipLabel(edge: ThreadRelationshipEdge, currentThreadId: ThreadId) {
  if (edge.kind === "transfer") return "Context transfer";
  if (edge.kind === "subagent") {
    return edge.sourceThreadId === currentThreadId ? "Subagent" : "Parent agent";
  }
  return edge.sourceThreadId === currentThreadId ? "Fork" : "Parent thread";
}

function relationshipThreadTitle(input: {
  readonly title: string;
  readonly isSubagent: boolean;
}): string {
  if (!input.isSubagent) return input.title;
  return formatSubagentDisplayTitle(input.title);
}

/**
 * A delegated task settles with its first run, but the parent can keep sending
 * the child follow-ups. While the child thread has a live run, the row's timer
 * and hover card follow that run instead of the settled task.
 */
function liveSubagent<Agent extends RuntimeSubagent>(
  agent: Agent | undefined,
  childThread: OrchestrationV2ThreadShell | null | undefined,
): Agent | undefined {
  const liveStatus = childThread?.activityRunStatus;
  if (!agent || !liveStatus) return agent;
  const startedAt = childThread.activityRunStartedAt;
  return {
    ...agent,
    status: liveStatus === "running" || liveStatus === "waiting" ? liveStatus : "pending",
    startedAt: startedAt ? DateTime.formatIso(startedAt) : null,
    completedAt: null,
    // The settled task's output belongs to its first run, not this one.
    progress: null,
    result: null,
    error: null,
  };
}

/** A subagent row without a parent record still reads its status from the lineage edge. */
function edgeAgentStatus(status: string | null): RuntimeSubagentStatus {
  switch (status) {
    case "pending":
    case "preparing":
    case "starting":
      return "pending";
    case "running":
    case "waiting":
    case "idle":
    case "completed":
    case "failed":
    case "cancelled":
    case "interrupted":
      return status;
    case "error":
      return "failed";
    default:
      return "idle";
  }
}

/**
 * Fork: a working agent's second line, its latest tool call read from its child thread, or the
 * provider's progress until the first call arrives. Mounted only for working rows on screen.
 */
function SubagentActivityLine(props: {
  readonly childRef: ScopedThreadRef;
  readonly progress: string | null;
  readonly workspaceRoot: string | null;
}) {
  const child = useThreadProjection(props.childRef)?.projection ?? null;
  const latest = useMemo(
    () =>
      child === null
        ? null
        : latestSubagentToolCall(
            child.turnItems.filter((item) => item.threadId === props.childRef.threadId),
            props.workspaceRoot,
          ),
    [child, props.childRef.threadId, props.workspaceRoot],
  );
  if (latest === null) {
    return (
      <span className="block truncate text-left text-2xs font-normal text-muted-foreground">
        {props.progress ?? "Starting…"}
      </span>
    );
  }
  const Icon = TOOL_KIND_ICONS[latest.kind];
  return (
    <span className="flex min-w-0 items-center gap-1 text-left text-2xs font-normal text-muted-foreground">
      <Icon aria-hidden className="size-3 shrink-0" />
      <span className={latest.detail ? "max-w-[45%] shrink-0 truncate" : "min-w-0 truncate"}>
        {latest.title}
      </span>
      {latest.detail ? <span className="min-w-0 truncate font-mono">{latest.detail}</span> : null}
    </span>
  );
}

export function ThreadRelationshipsPanel(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const ref = scopeThreadRef(props.environmentId, props.threadId);
  const projection = useThreadProjection(ref)?.projection ?? null;
  const providers = useServerConfigs().get(props.environmentId)?.providers;
  const subagentsByThreadId = useMemo(
    () =>
      new Map(
        (projection?.subagents ?? [])
          .filter((subagent) => subagent.childThreadId !== null)
          .map((subagent) => [
            subagent.childThreadId,
            {
              ...projectedSubagentsToRuntime([subagent])[0]!,
              driver: subagent.driver,
              providerInstanceId: subagent.providerInstanceId,
            },
          ]),
      ),
    [projection?.subagents],
  );
  const threadShells = useThreadShells();
  const projects = useProjects().filter((project) => project.environmentId === props.environmentId);
  const archived = useArchivedThreadSnapshots([props.environmentId]);
  const archivedShells = archived.snapshots.find(
    (entry) => entry.environmentId === props.environmentId,
  )?.snapshot.threads;
  const graph = useMemo(() => {
    const shells: ReadonlyArray<OrchestrationV2ThreadShell> = [
      ...threadShells
        .filter((thread) => thread.environmentId === props.environmentId)
        .map((thread) => thread.source),
      ...(archivedShells ?? []),
    ];
    return deriveThreadRelationshipGraph({ threads: shells, projection });
  }, [archivedShells, projection, props.environmentId, threadShells]);
  const currentThread = projection?.thread ?? graph.nodes.get(props.threadId)?.thread;
  const currentProject = projects.find((project) => project.id === currentThread?.projectId);
  const navigate = useNavigate();
  const openAgentMenu = useAgentContextMenu(ref);
  const agentListView = useAgentListViewStore((state) => state.view);
  const setAgentListView = useAgentListViewStore((state) => state.setView);
  const workspaceRoot = currentThread?.worktreePath ?? currentProject?.workspaceRoot ?? null;
  const mergeBack = useAtomCommand(threadEnvironment.mergeBack);
  const stopSession = useAtomCommand(threadEnvironment.stopSession);
  const [busyAction, setBusyAction] = useState<"merge" | "detach" | null>(null);
  const latestMergeBackRun = projection === null ? null : resolveLatestMergeBackRun(projection);
  const mergeTargetThreadId = resolveMergeBackTargetThreadId(projection);
  const relationshipRows = useMemo(
    () =>
      orderWebThreadLineageRows({
        graph,
        rows: immediateThreadRelationships(graph, props.threadId),
        currentThreadId: props.threadId,
        mergeTargetThreadId,
      }),
    [graph, mergeTargetThreadId, props.threadId],
  );
  const canMerge = mergeTargetThreadId !== null && latestMergeBackRun !== null;
  const canDetach = projection ? canDetachThreadProviderSession(projection) : false;

  const {
    related = [],
    active = [],
    previous = [],
  } = groupBy(relationshipRows, ({ edge }) => {
    if (edge.kind !== "subagent" || isParentThreadRelationship(edge, props.threadId))
      return "related";
    return ["completed", "failed", "error", "cancelled", "interrupted", "idle"].includes(
      edge.status ?? "",
    )
      ? "previous"
      : "active";
  });
  // Fork: the agents list's search, status filter and sort, in spawn order by default.
  const agentSubject = ({ threadId, edge }: ThreadRelationshipWalkRow): AgentListSubject => {
    const node = graph.nodes.get(threadId);
    const recorded = subagentsByThreadId.get(threadId);
    const agent = liveSubagent(recorded, node?.thread);
    return {
      title: relationshipThreadTitle({
        title: node?.thread?.title ?? agent?.title ?? threadId,
        isSubagent: true,
      }),
      model: agent?.model ?? null,
      status: agent?.status ?? edgeAgentStatus(edge.status),
      usage: agent?.usage ?? null,
      spawnedAt:
        recorded?.firstSeenAt ?? (node?.thread ? DateTime.formatIso(node.thread.createdAt) : null),
      startedAt: agent?.startedAt ?? null,
      completedAt: agent?.completedAt ?? null,
    };
  };
  const agentRowCount = active.length + previous.length;
  const agentListFiltered = isAgentListViewFiltered(agentListView);
  const visibleActive = applyAgentListView(active, agentListView, agentSubject);
  const visiblePrevious = applyAgentListView(previous, agentListView, agentSubject);
  const showAgentToolbar = agentRowCount > 1 || agentListFiltered;
  const groups = [
    { id: "related", label: null, rows: related, expanded: true },
    { id: "active", label: null, rows: visibleActive, expanded: true },
    {
      id: "previous",
      label: "Previous agents",
      rows: visiblePrevious,
      expanded: false,
      forceExpanded: agentListFiltered,
    },
  ];
  // Subagents without a child thread yet have no row, so count them separately.
  const runningCount =
    (projection?.subagents.filter(
      (agent) => agent.childThreadId === null && agent.status === "running",
    ).length ?? 0) + active.filter(({ edge }) => edge.status === "running").length;

  if (relationshipRows.length === 0 && runningCount === 0) {
    return null;
  }

  const openThread = (threadId: ThreadId) => {
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(props.environmentId, threadId)),
    });
  };

  const merge = async () => {
    if (!latestMergeBackRun || mergeTargetThreadId === null || busyAction !== null) return;
    setBusyAction("merge");
    const result = await mergeBack({
      environmentId: props.environmentId,
      input: {
        sourceThreadId: props.threadId,
        targetThreadId: mergeTargetThreadId,
        runId: latestMergeBackRun.id,
      },
    });
    setBusyAction(null);
    if (result._tag === "Success") openThread(mergeTargetThreadId);
  };

  const detach = async () => {
    if (!canDetach || busyAction !== null) return;
    setBusyAction("detach");
    await stopSession({
      environmentId: props.environmentId,
      input: { threadId: props.threadId },
    });
    setBusyAction(null);
  };

  const parentTitle =
    mergeTargetThreadId === null
      ? null
      : (graph.nodes.get(mergeTargetThreadId)?.thread?.title ?? null);

  return (
    <ThreadDetailsSection
      headingId="thread-details-lineage-heading"
      title={runningCount > 0 ? `Lineage · ${runningCount} running` : "Lineage"}
      data-thread-relationships-panel
      actions={
        canDetach ? (
          <Menu>
            <MenuTrigger
              render={
                <ThreadDetailsControl
                  size="icon-xs"
                  variant="ghost"
                  part="icon"
                  aria-label="More thread actions"
                  disabled={busyAction !== null}
                />
              }
            >
              <MoreHorizontalIcon className="size-3.5" />
            </MenuTrigger>
            <MenuPopup align="end" className="min-w-60 max-w-(--available-width)">
              <MenuItem onClick={() => void detach()}>
                <UnplugIcon className="size-3.5" />
                Disconnect agent session
              </MenuItem>
            </MenuPopup>
          </Menu>
        ) : null
      }
    >
      {showAgentToolbar ? (
        <AgentListToolbar view={agentListView} onChange={setAgentListView} />
      ) : null}
      {showAgentToolbar &&
      agentListFiltered &&
      visibleActive.length === 0 &&
      visiblePrevious.length === 0 ? (
        <div className="flex items-center justify-between gap-2 px-2.5 py-1.5">
          <span className="text-xs text-muted-foreground">No agents match these filters.</span>
          <Button
            size="xs"
            variant="outline"
            onClick={() => setAgentListView({ ...agentListView, statuses: [], query: "" })}
          >
            Clear filters
          </Button>
        </div>
      ) : null}
      {groups.map((group) => (
        <ThreadLineageGroup key={`${scopedThreadKey(ref)}:${group.id}`} {...group}>
          {(visibleRows) =>
            visibleRows.map(({ threadId, edge }) => {
              const node = graph.nodes.get(threadId);
              const isSubagent = edge.kind === "subagent";
              const isMergeTarget = threadId === mergeTargetThreadId;
              const isParent = isParentThreadRelationship(edge, props.threadId);
              const status = threadRelationshipRowStatus(graph, { threadId, edge });
              const RelationshipIcon = isParent
                ? CornerLeftUpIcon
                : isSubagent
                  ? BotIcon
                  : GitForkIcon;
              const relationship = relationshipLabel(edge, props.threadId);
              const agent = liveSubagent(
                isSubagent && !isParent ? subagentsByThreadId.get(threadId) : undefined,
                node?.thread,
              );
              const threadTitle = relationshipThreadTitle({
                title: node?.thread?.title ?? agent?.title ?? threadId,
                isSubagent,
              });
              const provider = providers?.find(
                (entry) =>
                  entry.instanceId ===
                  (agent?.providerInstanceId ?? node?.thread?.providerInstanceId),
              );
              const providerDriver = agent?.driver ?? provider?.driver;
              const project = projects.find((project) => project.id === node?.thread?.projectId);
              const relationshipHint = node?.missing
                ? "This related thread is unavailable"
                : `Open ${relationship.toLowerCase()} in this chat`;
              const RelationshipPopup = agent ? ThreadHoverCardPopup : TooltipPopup;
              const relationshipTooltip = agent ? (
                <SubagentTooltipContent
                  title={threadTitle}
                  model={agent.model}
                  provider={provider}
                  providers={providers}
                  driver={providerDriver}
                  elapsed={<AgentElapsed agent={agent} />}
                  status={agent.status}
                  result={agent.result}
                  progress={agent.progress}
                  usage={agent.usage}
                  parentThread={currentThread ?? undefined}
                  childThread={node?.thread ?? undefined}
                  parentProject={currentProject}
                  childProject={project}
                />
              ) : (
                relationshipHint
              );
              // Fork: working agents add their latest tool call, failed agents their error.
              const agentLive = agent !== undefined && isActiveSubagentStatus(agent.status);
              // One truncated line; the full error stays in the hover card and the agent tab.
              const agentError =
                agent?.status === "failed" && agent.error
                  ? agent.error.length > 160
                    ? `${agent.error.slice(0, 159)}…`
                    : agent.error
                  : null;
              const secondLine = agentLive ? (
                <SubagentActivityLine
                  childRef={scopeThreadRef(props.environmentId, threadId)}
                  progress={agent.progress}
                  workspaceRoot={workspaceRoot}
                />
              ) : agentError ? (
                <span className="block truncate text-left font-mono text-2xs font-normal text-destructive-foreground">
                  {agentError}
                </span>
              ) : null;
              const onAgentContextMenu =
                agent && !node?.missing
                  ? (event: MouseEvent<HTMLElement>) =>
                      openAgentMenu(event, { childThreadId: threadId, title: threadTitle })
                  : undefined;
              const relationshipContent = (
                <>
                  <ThreadRelationshipIcon
                    driver={isSubagent && !isParent ? providerDriver : undefined}
                    provider={provider}
                    fallbackIcon={RelationshipIcon}
                    status={status}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-left text-sm font-medium leading-4 text-foreground/85">
                      {threadTitle}
                    </span>
                    {secondLine}
                  </span>
                  {agent?.usage ? (
                    <span className="shrink-0 text-2xs font-normal tabular-nums text-muted-foreground">
                      {formatSubagentTokenCount(agent.usage.totalTokens)}
                    </span>
                  ) : null}
                  {agent ? (
                    agent.startedAt ? (
                      <span className="shrink-0 text-2xs font-normal tabular-nums text-muted-foreground">
                        <AgentElapsed agent={agent} />
                      </span>
                    ) : null
                  ) : (
                    <ArrowRightIcon className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  )}
                  {!isMergeTarget ? (
                    <span className="shrink-0 text-2xs text-muted-foreground">
                      {threadRelationshipStatusLabel(status)}
                    </span>
                  ) : null}
                </>
              );
              return (
                <li
                  key={threadId}
                  className={`group flex ${secondLine ? "min-h-8" : "h-8"} items-center rounded-lg`}
                >
                  {isMergeTarget ? (
                    <div className={THREAD_DETAILS_PANEL_LINK_SPLIT_GROUP_CLASS}>
                      <Tooltip>
                        <TooltipTrigger
                          delay={200}
                          render={
                            <ThreadDetailsControl
                              size="sm"
                              variant="ghost"
                              part="link-primary"
                              aria-label={`${threadTitle} ${threadRelationshipStatusLabel(status)}`}
                              disabled={node?.missing === true}
                              onClick={() => openThread(threadId)}
                            />
                          }
                        >
                          {relationshipContent}
                        </TooltipTrigger>
                        <RelationshipPopup side="left">{relationshipTooltip}</RelationshipPopup>
                      </Tooltip>
                      <span
                        aria-hidden="true"
                        className={THREAD_DETAILS_PANEL_SPLIT_SEPARATOR_CLASS}
                      />
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <ThreadDetailsControl
                              size="sm"
                              variant="ghost"
                              part="secondary"
                              aria-label={
                                parentTitle
                                  ? `Merge back to ${parentTitle}`
                                  : "Merge back to source conversation"
                              }
                              disabled={!canMerge || busyAction !== null}
                              onClick={() => void merge()}
                            >
                              {busyAction === "merge" ? (
                                <LoaderCircleIcon className="size-3 animate-spin" />
                              ) : (
                                <PullRequestGlyph.merged className="size-3" />
                              )}
                            </ThreadDetailsControl>
                          }
                        />
                        <TooltipPopup side="left">
                          {latestMergeBackRun === null
                            ? "Complete a run in this fork before merging it back"
                            : parentTitle
                              ? `Merge this conversation back into ${parentTitle}`
                              : "Merge this conversation back into its source"}
                        </TooltipPopup>
                      </Tooltip>
                      <span className="shrink-0 border border-transparent ps-1 pe-2.5 text-2xs font-medium text-muted-foreground">
                        {threadRelationshipStatusLabel(status)}
                      </span>
                    </div>
                  ) : (
                    <Tooltip>
                      <TooltipTrigger
                        delay={200}
                        render={
                          <ThreadDetailsControl
                            size="sm"
                            variant="ghost"
                            disabled={node?.missing === true}
                            onClick={() => openThread(threadId)}
                            onContextMenu={onAgentContextMenu}
                            multiline={secondLine !== null}
                            part="row"
                          />
                        }
                      >
                        {relationshipContent}
                      </TooltipTrigger>
                      <RelationshipPopup side="left">{relationshipTooltip}</RelationshipPopup>
                    </Tooltip>
                  )}
                </li>
              );
            })
          }
        </ThreadLineageGroup>
      ))}
    </ThreadDetailsSection>
  );
}
