/**
 * Fork: one subagent in the sidebar, shown in place in the Agents panel (with Back) and as its
 * own agent tab beside the parent chat. The header carries identity, status and elapsed time,
 * and collapsible prompt, result, and the agents this agent started. Below it, the agent's
 * activity read from its child thread: a live compact transcript (messages, reasoning, tool calls
 * in order) or its tool calls alone, with search and filters. Usage sits in a footer.
 *
 * The child thread is subscribed only while this view is mounted. A nested agent (spawned by
 * one of this thread's agents) has its record on the thread that spawned it, read from its child
 * thread's lineage.
 */
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { deriveThreadAgentFleet, liveSubagent } from "@t3tools/client-runtime/state/agent-fleet";
import {
  applySubagentToolCallView,
  DEFAULT_SUBAGENT_TOOL_CALL_VIEW,
  deriveSubagentToolCalls,
  type SubagentToolCall,
  type SubagentToolCallSort,
  type SubagentToolCallView,
  type SubagentToolKind,
} from "@t3tools/client-runtime/state/agent-list-view";
import { formatSubagentDisplayTitle } from "@t3tools/client-runtime/state/subagent-display";
import {
  isActiveSubagentStatus,
  projectedSubagentsToRuntime,
} from "@t3tools/client-runtime/state/subagentRuntime";
import { deriveThreadRuntime } from "@t3tools/client-runtime/state/thread-execution";
import { shouldShowLoadEarlierControl } from "@t3tools/client-runtime/state/threads";
import type {
  OrchestrationV2ProjectedTurnItem,
  RunId,
  ScopedThreadRef,
  ThreadId,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowDownUpIcon,
  BotIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleStopIcon,
  ListFilterIcon,
  MessageSquarePlusIcon,
  MessageSquareShareIcon,
  PanelRightOpenIcon,
  SquareArrowOutUpRightIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";

import { useAgentDrillStore } from "~/agentDrillStore";
import { useAgentListViewStore } from "~/agentListViewStore";
import { useComposerHandleContext } from "~/composerHandleContext";
import { useDiffPanelStore } from "~/diffPanelStore";
import { useClientSettings } from "~/hooks/useSettings";
import { cn } from "~/lib/utils";
import { useRightPanelStore } from "~/rightPanelStore";
import {
  deriveCanInterruptRunningThread,
  deriveTimelineEntriesFromVisibleTurnItemsWithState,
  type TimelineEntriesProjection,
} from "~/session-logic";
import {
  useThreadHistory,
  useThreadProjection,
  useThreadShell,
  useThreadVisibleTurnItems,
} from "~/state/entities";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { buildThreadRouteParams } from "~/threadRoutes";

import { AgentElapsed, STATUS_VISUALS, StatusDot } from "../AgentStatus";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { ScrollArea } from "../ui/scroll-area";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { AgentUsageFooter, ToolCallList } from "./AgentActivityParts";
import { AgentRow, useEnvironmentShells } from "./AgentFleetRow";
import { AgentTranscriptList } from "./AgentTranscriptList";
import {
  agentTranscriptKindOf,
  applyAgentTranscriptView,
  DEFAULT_AGENT_TRANSCRIPT_VIEW,
  deriveAgentTranscriptRows,
  type AgentTranscriptKind,
  type AgentTranscriptRowCache,
  type AgentTranscriptView,
} from "./agentTranscript";
import { TOOL_KIND_LABELS } from "./agentToolKinds";
import { useAgentContextMenu } from "./agentContextMenu";
import {
  attachAgentResultToChat,
  canAttachAgentResult,
  continueAgentInChat,
  subagentContextSubject,
} from "./agentChatActions";

const TOOL_SORT_LABELS: Record<SubagentToolCallSort, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  duration: "Longest first",
};

const TOOL_STATUS_LABELS: Record<SubagentToolCall["status"], string> = {
  running: "Running",
  completed: "Completed",
  failed: "Failed",
};

const TRANSCRIPT_KIND_LABELS: Record<AgentTranscriptKind, string> = {
  message: "Messages",
  reasoning: "Thinking",
  tool: "Tool calls",
};

const NO_OPTIMISTIC_MESSAGES: [] = [];

/** An agent as the detail view opens it: its child thread and its title for the tab label. */
export interface AgentDetailTarget {
  readonly childThreadId: ThreadId;
  readonly title: string;
}

/** A header line: a label and a one-line preview, expanding in place to the full content. */
function HeaderDisclosure(props: {
  label: string;
  preview: string;
  tone?: "error" | undefined;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(props.defaultOpen ?? false);
  return (
    <div className="flex min-w-0 flex-col">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex min-h-5 min-w-0 items-center gap-1.5 rounded-sm text-left text-xs hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
      >
        <ChevronRightIcon
          aria-hidden
          className={cn(
            "size-3 shrink-0 text-icon-muted transition-transform duration-200",
            open && "rotate-90",
          )}
        />
        <span className="shrink-0 text-3xs font-medium uppercase tracking-wider text-muted-foreground">
          {props.label}
        </span>
        {open ? null : (
          <span
            className={cn(
              "min-w-0 flex-1 truncate",
              props.tone === "error" ? "text-destructive-foreground" : "text-muted-foreground",
            )}
          >
            {props.preview}
          </span>
        )}
      </button>
      {open ? <div className="ms-4.5 max-h-48 overflow-y-auto py-0.5">{props.children}</div> : null}
    </div>
  );
}

function HeaderText(props: { text: string; tone?: "error" | undefined }) {
  return (
    <p
      className={cn(
        "select-text whitespace-pre-wrap break-words text-xs leading-relaxed",
        props.tone === "error" ? "text-destructive-foreground" : "text-foreground/85",
      )}
    >
      {props.text}
    </p>
  );
}

function countBy<T, K>(items: ReadonlyArray<T>, key: (item: T) => K): Map<K, number> {
  const counts = new Map<K, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return counts;
}

function CheckboxGroup<K extends string>(props: {
  label: string;
  labels: Record<K, string>;
  selected: ReadonlyArray<K>;
  counts: Map<K, number>;
  onChange: (next: ReadonlyArray<K>) => void;
}) {
  const keys = (Object.keys(props.labels) as K[]).filter((key) => props.counts.has(key));
  if (keys.length === 0) return null;
  return (
    <MenuGroup>
      <MenuGroupLabel>{props.label}</MenuGroupLabel>
      {keys.map((key) => (
        <MenuCheckboxItem
          key={key}
          checked={props.selected.includes(key)}
          onCheckedChange={(checked) =>
            props.onChange(
              checked ? [...props.selected, key] : props.selected.filter((value) => value !== key),
            )
          }
        >
          {props.labels[key]}
          <span className="ms-auto ps-4 font-mono text-2xs tabular-nums text-muted-foreground">
            {props.counts.get(key)}
          </span>
        </MenuCheckboxItem>
      ))}
    </MenuGroup>
  );
}

function FilterMenu(props: { activeCount: number; children: ReactNode }) {
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            type="button"
            size={props.activeCount > 0 ? "micro" : "icon-micro"}
            variant={props.activeCount > 0 ? "ghost" : "ghost-muted"}
            aria-label="Filter activity"
          />
        }
      >
        <ListFilterIcon />
        {props.activeCount > 0 ? props.activeCount : null}
      </MenuTrigger>
      <MenuPopup align="end">{props.children}</MenuPopup>
    </Menu>
  );
}

function ActionButton(props: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="icon-xs"
            variant="ghost-muted"
            aria-label={props.label}
            onClick={props.onClick}
          />
        }
      >
        {props.children}
      </TooltipTrigger>
      <TooltipPopup>{props.label}</TooltipPopup>
    </Tooltip>
  );
}

function EmptyActivity(props: { children: ReactNode }) {
  return <p className="px-3 py-3 text-xs text-muted-foreground">{props.children}</p>;
}

export function AgentDetailPanel(props: {
  /** The thread that spawned the agent; the tab lives in its right panel. */
  readonly parentRef: ScopedThreadRef;
  readonly childThreadId: ThreadId;
  /** The directory the agent's commands and paths are shown relative to. */
  readonly workspaceRoot: string | null;
  /** In the Agents panel: back to the fleet list, or to the agent one level up. */
  readonly onBack?: (() => void) | undefined;
  readonly backLabel?: string | undefined;
  /** In the Agents panel: pins the agent as its own tab. */
  readonly onOpenInTab?: ((agent: AgentDetailTarget) => void) | undefined;
  /** Opens an agent this agent started; an agent tab by default. */
  readonly onOpenAgent?: ((agent: AgentDetailTarget) => void) | undefined;
}) {
  const { parentRef, childThreadId } = props;
  const navigate = useNavigate();
  const composerRef = useComposerHandleContext();
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const mode = useAgentListViewStore((state) => state.activityMode);
  const setMode = useAgentListViewStore((state) => state.setActivityMode);
  const [toolView, setToolView] = useState<SubagentToolCallView>(DEFAULT_SUBAGENT_TOOL_CALL_VIEW);
  const [transcriptView, setTranscriptView] = useState<AgentTranscriptView>(
    DEFAULT_AGENT_TRANSCRIPT_VIEW,
  );

  const parent = useThreadProjection(parentRef)?.projection ?? null;
  const childRef = useMemo(
    () => scopeThreadRef(parentRef.environmentId, childThreadId),
    [childThreadId, parentRef.environmentId],
  );
  const childShell = useThreadShell(childRef);
  const child = useThreadProjection(childRef)?.projection ?? null;
  const visibleTurnItems = useThreadVisibleTurnItems(childRef);
  const history = useThreadHistory(childRef);
  const shells = useEnvironmentShells(parentRef.environmentId);
  const loadEarlierHistory = useAtomCommand(threadEnvironment.loadEarlierHistory, {
    label: "load earlier agent activity",
    reportFailure: false,
  });
  const interruptTurn = useAtomCommand(threadEnvironment.interruptTurn, "stop agent");
  const openAgentMenu = useAgentContextMenu(parentRef);

  const ownerThreadId =
    childShell?.lineage.relationshipToParent === "subagent"
      ? childShell.lineage.parentThreadId
      : null;
  const nestedOwnerRef =
    ownerThreadId !== null && ownerThreadId !== parentRef.threadId
      ? scopeThreadRef(parentRef.environmentId, ownerThreadId)
      : null;
  const nestedOwner = useThreadProjection(nestedOwnerRef)?.projection ?? null;
  const owner = nestedOwnerRef === null ? parent : nestedOwner;
  const subagent =
    owner?.subagents.find((candidate) => candidate.childThreadId === childThreadId) ?? null;
  const runtime = useMemo(() => {
    if (!subagent) return null;
    const recorded = projectedSubagentsToRuntime([subagent])[0]!;
    return liveSubagent(recorded, childShell?.source) ?? recorded;
  }, [childShell?.source, subagent]);
  // Stop is offered exactly when the agent's own thread would offer it in chat.
  const canStop = useMemo(
    () => child !== null && deriveCanInterruptRunningThread(true, deriveThreadRuntime(child)),
    [child],
  );

  const calls = useMemo(
    () =>
      child
        ? deriveSubagentToolCalls(
            child.turnItems.filter((item) => item.threadId === childThreadId),
            props.workspaceRoot,
          )
        : [],
    [child, childThreadId, props.workspaceRoot],
  );
  const visibleCalls = useMemo(() => applySubagentToolCallView(calls, toolView), [calls, toolView]);

  // The transcript reuses the chat's timeline derivation, which keeps unchanged entries while text
  // streams; the row cache then keeps their rows, so only the streaming row re-renders.
  const timelineRef = useRef<TimelineEntriesProjection | null>(null);
  const prompt = subagent?.prompt ?? null;
  // Rows depend on these options, so the cache goes with them.
  const transcriptSetup = useMemo(
    () => ({
      options: { prompt, workspaceRoot: props.workspaceRoot ?? undefined },
      cache: new WeakMap() as AgentTranscriptRowCache,
    }),
    [prompt, props.workspaceRoot],
  );
  const ownVisibleItems = useMemo(
    (): ReadonlyArray<OrchestrationV2ProjectedTurnItem> =>
      visibleTurnItems.every((row) => row.item.threadId === childThreadId)
        ? visibleTurnItems
        : visibleTurnItems.filter((row) => row.item.threadId === childThreadId),
    [childThreadId, visibleTurnItems],
  );
  const transcriptRows = useMemo(() => {
    if (mode !== "transcript") return [];
    const projection = deriveTimelineEntriesFromVisibleTurnItemsWithState(
      {
        visibleTurnItems: ownVisibleItems,
        optimisticMessages: NO_OPTIMISTIC_MESSAGES,
        ...(child === null
          ? {}
          : { attempts: child.attempts, nodes: child.nodes, plans: child.plans }),
      },
      timelineRef.current,
    );
    timelineRef.current = projection;
    return deriveAgentTranscriptRows(
      projection.entries,
      transcriptSetup.options,
      transcriptSetup.cache,
    );
  }, [child, mode, ownVisibleItems, transcriptSetup]);
  const visibleTranscript = useMemo(
    () => applyAgentTranscriptView(transcriptRows, transcriptView),
    [transcriptRows, transcriptView],
  );

  // The agents this agent started, from its own projection's records.
  const children = useMemo(
    () =>
      child === null
        ? []
        : deriveThreadAgentFleet({ threadId: childThreadId, subagents: child.subagents, shells })
            .filter((entry) => entry.ownerThreadId === childThreadId)
            .map((entry) => ({ entry, depth: 0, context: false })),
    [child, childThreadId, shells],
  );

  const { onOpenAgent } = props;
  const openAgent = useCallback(
    (agent: AgentDetailTarget) =>
      onOpenAgent ? onOpenAgent(agent) : useRightPanelStore.getState().openAgent(parentRef, agent),
    [onOpenAgent, parentRef],
  );
  const openThread = useCallback(
    (threadId: ThreadId) =>
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(scopeThreadRef(parentRef.environmentId, threadId)),
      }),
    [navigate, parentRef.environmentId],
  );
  // An edit's full diff lives with the agent's own thread.
  const openTurnDiff = useCallback(
    (runId: RunId, filePath?: string) => {
      useDiffPanelStore.getState().selectTurn(childRef, runId, filePath);
      useRightPanelStore.getState().open(childRef, "diff");
      openThread(childRef.threadId);
    },
    [childRef, openThread],
  );
  const openStartedAgent = useCallback(
    (startedThreadId: ThreadId) => {
      const entry = children.find((candidate) => candidate.entry.childThreadId === startedThreadId);
      openAgent({ childThreadId: startedThreadId, title: entry?.entry.title ?? "Agent" });
    },
    [children, openAgent],
  );

  const backButton = props.onBack ? (
    <div className="flex min-w-0">
      <Button size="xs" variant="ghost-muted" onClick={props.onBack}>
        <ChevronLeftIcon aria-hidden />
        <span className="truncate">{props.backLabel ?? "Agents"}</span>
      </Button>
    </div>
  ) : null;
  const showAllAgents = () => {
    useAgentDrillStore.getState().reset(scopedThreadKey(parentRef));
    useRightPanelStore.getState().open(parentRef, "agents");
  };

  if (!subagent || !runtime) {
    return (
      <div className="flex h-full flex-col">
        {backButton ? <div className="px-2 pt-1.5">{backButton}</div> : null}
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <p className="text-sm font-medium">Agent unavailable</p>
          <p className="max-w-64 text-xs text-muted-foreground">
            {owner === null
              ? "Loading this thread's agents…"
              : "This agent is no longer recorded on this thread."}
          </p>
          {props.onBack ? null : (
            <Button size="xs" variant="ghost-muted" onClick={showAllAgents}>
              View agents
            </Button>
          )}
        </div>
      </div>
    );
  }

  const title = formatSubagentDisplayTitle(childShell?.title ?? runtime.title);
  const subject = subagentContextSubject(subagent, title);
  const live = isActiveSubagentStatus(runtime.status);
  const continueInChat = () => {
    const parentThread = parent?.thread;
    if (!parentThread) return;
    void continueAgentInChat({
      environmentId: parentRef.environmentId,
      parentThread,
      subagent,
      title,
      workspaceRoot: props.workspaceRoot,
      openTab: (tabRef) =>
        navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(tabRef) }),
    });
  };
  const stop = () =>
    void interruptTurn({
      environmentId: childRef.environmentId,
      input: { threadId: childThreadId },
    });
  const onChildContextMenu = (
    event: MouseEvent<HTMLElement>,
    entry: (typeof children)[number]["entry"],
  ) => {
    if (entry.childThreadId === null) return;
    openAgentMenu(event, {
      childThreadId: entry.childThreadId,
      title: entry.title,
      ownerThreadId: entry.ownerThreadId,
    });
  };
  const outcome = subject.error ?? (live ? null : subject.result);

  const tools = mode === "tools";
  const query = tools ? toolView.query : transcriptView.query;
  const activeFilters = tools
    ? toolView.statuses.length + toolView.kinds.length
    : transcriptView.kinds.length;
  const customised =
    query.length > 0 ||
    activeFilters > 0 ||
    (tools && toolView.sort !== DEFAULT_SUBAGENT_TOOL_CALL_VIEW.sort);
  const setQuery = (value: string) =>
    tools
      ? setToolView({ ...toolView, query: value })
      : setTranscriptView({ ...transcriptView, query: value });
  const resetView = () =>
    tools
      ? setToolView(DEFAULT_SUBAGENT_TOOL_CALL_VIEW)
      : setTranscriptView(DEFAULT_AGENT_TRANSCRIPT_VIEW);

  const loadEarlier = shouldShowLoadEarlierControl(history) ? (
    <div className="flex items-center gap-2 px-2 py-1.5">
      <Button
        size="xs"
        variant="ghost-muted"
        disabled={history.loading}
        onClick={() =>
          void loadEarlierHistory({
            environmentId: childRef.environmentId,
            input: { threadId: childThreadId },
          })
        }
      >
        {history.loading ? "Loading earlier activity…" : "Load earlier activity"}
      </Button>
      {history.error ? (
        <span className="min-w-0 truncate text-2xs text-destructive-foreground">
          {history.error}
        </span>
      ) : null}
    </div>
  ) : null;

  let body: ReactNode;
  if (tools) {
    body = (
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col p-2">
          {visibleCalls.length > 0 ? (
            <ToolCallList
              calls={visibleCalls}
              timestampFormat={timestampFormat}
              source={{
                environmentId: parentRef.environmentId,
                threadId: childThreadId,
                workspaceRoot: props.workspaceRoot,
              }}
            />
          ) : (
            <p className="px-0.5 text-xs text-muted-foreground">
              {child === null
                ? "Loading tool calls…"
                : calls.length > 0
                  ? "No tool calls match these filters."
                  : "No tool calls yet."}
            </p>
          )}
          {loadEarlier}
        </div>
      </ScrollArea>
    );
  } else if (visibleTranscript.length === 0) {
    body = (
      <div className="min-h-0 flex-1">
        {loadEarlier}
        <EmptyActivity>
          {child === null
            ? "Loading activity…"
            : transcriptRows.length > 0
              ? "Nothing in the transcript matches."
              : live
                ? (subagent.progress ?? "Starting…")
                : "No activity recorded."}
        </EmptyActivity>
      </div>
    );
  } else {
    body = (
      <div className="min-h-0 flex-1">
        <AgentTranscriptList
          rows={visibleTranscript}
          environmentId={parentRef.environmentId}
          childRef={childRef}
          workspaceRoot={props.workspaceRoot ?? undefined}
          onOpenAgent={openStartedAgent}
          onOpenThread={openThread}
          onOpenTurnDiff={openTurnDiff}
          startAtEnd={live}
          header={loadEarlier}
        />
      </div>
    );
  }

  const childrenWorking = children.filter(({ entry }) =>
    isActiveSubagentStatus(entry.agent.status),
  ).length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-col gap-1 border-b border-border/60 px-3 py-2">
        {backButton ? <div className="-ms-1.5 -mt-0.5">{backButton}</div> : null}
        <div className="flex min-w-0 items-center gap-2">
          <StatusDot status={runtime.status} />
          <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{title}</h2>
          {props.onOpenInTab ? (
            <ActionButton
              label="Open in new tab"
              onClick={() => props.onOpenInTab?.({ childThreadId, title })}
            >
              <PanelRightOpenIcon />
            </ActionButton>
          ) : (
            <ActionButton label="Show all agents" onClick={showAllAgents}>
              <BotIcon />
            </ActionButton>
          )}
          <ActionButton label="Open agent thread" onClick={() => openThread(childThreadId)}>
            <SquareArrowOutUpRightIcon />
          </ActionButton>
          {canAttachAgentResult(subject) ? (
            <ActionButton
              label="Attach result to chat"
              onClick={() => attachAgentResultToChat(composerRef, subject)}
            >
              <MessageSquareShareIcon />
            </ActionButton>
          ) : null}
          <ActionButton label="Continue in chat" onClick={continueInChat}>
            <MessageSquarePlusIcon />
          </ActionButton>
          {canStop ? (
            <ActionButton label="Stop agent" onClick={stop}>
              <CircleStopIcon />
            </ActionButton>
          ) : null}
        </div>
        <p className="truncate ps-3.5 font-mono text-2xs text-muted-foreground">
          {[STATUS_VISUALS[runtime.status].label, subagent.model].filter(Boolean).join(" · ")}
          {runtime.startedAt ? (
            <>
              {" · "}
              <AgentElapsed agent={runtime} />
            </>
          ) : null}
        </p>
        <div className="flex flex-col">
          {live && runtime.progress ? (
            <p className="truncate ps-4.5 text-xs text-muted-foreground">{runtime.progress}</p>
          ) : null}
          {subject.prompt ? (
            <HeaderDisclosure label="Prompt" preview={subject.prompt}>
              <HeaderText text={subject.prompt} />
            </HeaderDisclosure>
          ) : null}
          {outcome ? (
            <HeaderDisclosure
              label={subject.error ? "Error" : "Result"}
              preview={outcome}
              tone={subject.error ? "error" : undefined}
              defaultOpen
            >
              <HeaderText text={outcome} tone={subject.error ? "error" : undefined} />
            </HeaderDisclosure>
          ) : null}
          {children.length > 0 ? (
            <HeaderDisclosure
              label={`Agents · ${children.length}`}
              preview={
                childrenWorking > 0
                  ? `${childrenWorking} working`
                  : children.map(({ entry }) => entry.title).join(", ")
              }
            >
              <div className="flex flex-col">
                {children.map((row) => (
                  <AgentRow
                    key={row.entry.key}
                    parentRef={parentRef}
                    row={row}
                    workspaceRoot={props.workspaceRoot}
                    onOpen={(entry) =>
                      entry.childThreadId === null
                        ? undefined
                        : openAgent({ childThreadId: entry.childThreadId, title: entry.title })
                    }
                    onContextMenu={onChildContextMenu}
                  />
                ))}
              </div>
            </HeaderDisclosure>
          ) : null}
        </div>
      </header>
      <div className="flex items-center gap-1 border-b border-border/60 px-2 py-1.5">
        <ToggleGroup
          aria-label="Agent activity"
          value={[mode]}
          onValueChange={(next) => {
            const value = next[0];
            if (value === "transcript" || value === "tools") setMode(value);
          }}
        >
          <Toggle value="transcript">Transcript</Toggle>
          <Toggle value="tools">
            Tools
            {calls.length > 0 ? (
              <span className="font-mono tabular-nums text-muted-foreground">{calls.length}</span>
            ) : null}
          </Toggle>
        </ToggleGroup>
        <div className="min-w-0 flex-1">
          <Input
            size="compact"
            type="search"
            value={query}
            placeholder={tools ? "Search tool calls" : "Search transcript"}
            aria-label={tools ? "Search tool calls" : "Search transcript"}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <FilterMenu activeCount={activeFilters}>
          {tools ? (
            <>
              <CheckboxGroup
                label="Status"
                labels={TOOL_STATUS_LABELS}
                selected={toolView.statuses}
                counts={countBy(calls, (call) => call.status)}
                onChange={(statuses) => setToolView({ ...toolView, statuses })}
              />
              <MenuSeparator />
              <CheckboxGroup<SubagentToolKind>
                label="Kind"
                labels={TOOL_KIND_LABELS}
                selected={toolView.kinds}
                counts={countBy(calls, (call) => call.kind)}
                onChange={(kinds) => setToolView({ ...toolView, kinds })}
              />
            </>
          ) : (
            <CheckboxGroup
              label="Show"
              labels={TRANSCRIPT_KIND_LABELS}
              selected={transcriptView.kinds}
              counts={countBy(transcriptRows, agentTranscriptKindOf)}
              onChange={(kinds) => setTranscriptView({ ...transcriptView, kinds })}
            />
          )}
        </FilterMenu>
        {tools ? (
          <Menu>
            <MenuTrigger
              render={
                <Button
                  type="button"
                  size="icon-micro"
                  variant={
                    toolView.sort === DEFAULT_SUBAGENT_TOOL_CALL_VIEW.sort ? "ghost-muted" : "ghost"
                  }
                  aria-label={`Sort tool calls: ${TOOL_SORT_LABELS[toolView.sort]}`}
                />
              }
            >
              <ArrowDownUpIcon />
            </MenuTrigger>
            <MenuPopup align="end">
              <MenuRadioGroup
                value={toolView.sort}
                onValueChange={(sort: SubagentToolCallSort) => setToolView({ ...toolView, sort })}
              >
                {(Object.keys(TOOL_SORT_LABELS) as SubagentToolCallSort[]).map((sort) => (
                  <MenuRadioItem key={sort} value={sort}>
                    {TOOL_SORT_LABELS[sort]}
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuPopup>
          </Menu>
        ) : null}
        {customised ? (
          <Button
            type="button"
            size="icon-micro"
            variant="ghost-muted"
            aria-label="Reset activity filters"
            onClick={resetView}
          >
            <XIcon />
          </Button>
        ) : null}
      </div>
      {body}
      <AgentUsageFooter usage={subagent.usage ?? null} />
    </div>
  );
}
