/**
 * Agents right-panel surface: the fleet view over the native subagent fold.
 * The chat carries one expandable row per spawn batch and links here.
 *
 * Visualization rules (from live-test feedback):
 * - Spawn order is stable. Activity and completion update rows in place.
 * - Rows are one line. Working agents add their latest tool call and failed
 *   agents their error as a second line, so a row's height is fixed for each
 *   status and only changes when the status does.
 * - Workflow expansion is presentation state. A live run stays expanded when
 *   it settles; older collapsed runs can still be opened at run granularity.
 * - Static status dots, DOM-write elapsed timers, plain token counters.
 * - Hovering a row previews the agent (prompt, latest tool calls, usage);
 *   the preview stays open under the pointer, and clicking it or the row opens
 *   the agent's detail view. Right-click a row to open that agent in its own
 *   tab. Filters and sorts never move a row while it works
 *   (see applyAgentPanelView).
 */
import { useAtomValue } from "@effect/atom-react";
import {
  applyAgentPanelView,
  deriveSubagentToolLogs,
  findPanelAgent,
  isAgentPanelViewFiltered,
  type SubagentToolLogEntry,
} from "@t3tools/client-runtime/state/agentPanelView";
import type {
  AgentPanelModel,
  AgentPanelWorkflowGroup,
  RuntimeSubagent,
} from "@t3tools/client-runtime/state/subagentRuntime";
import {
  formatSubagentModelLabel,
  formatSubagentTokenCount,
  isActiveSubagentStatus,
} from "@t3tools/client-runtime/state/subagentRuntime";
import type {
  ContextMenuItem,
  EnvironmentId,
  OrchestrationThreadActivity,
  ThreadId,
} from "@t3tools/contracts";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import { Bot, Braces, Check, ChevronDown, ChevronRight, Workflow, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";

import { useAgentsPanelStore } from "~/agentsPanelStore";
import { readLocalApi } from "~/localApi";
import { useClientSettings } from "~/hooks/useSettings";
import { cn } from "~/lib/utils";
import { orchestrationEnvironment } from "~/state/orchestration";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Button } from "~/components/ui/button";
import { PreviewCard, PreviewCardPopup, PreviewCardTrigger } from "~/components/ui/preview-card";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

import { AgentUsageFooter, TOOL_KIND_ICONS, ToolLogList, UsageFooter } from "./AgentActivityParts";
import { AgentDetailView } from "./AgentDetailView";
import { AgentsPanelToolbar } from "./AgentsPanelToolbar";
import { AgentElapsed, elapsedBetween, STATUS_VISUALS, StatusDot } from "./AgentStatus";

type OpenAgent = (agentId: string, toolCallId?: string) => void;
type ToolLogs = ReadonlyMap<string, ReadonlyArray<SubagentToolLogEntry>>;

const NO_TOOL_CALLS: ReadonlyArray<SubagentToolLogEntry> = [];
const PREVIEW_TOOL_CALLS = 5;

function isSettled(agent: RuntimeSubagent): boolean {
  return (
    agent.status === "completed" ||
    agent.status === "failed" ||
    agent.status === "cancelled" ||
    agent.status === "interrupted"
  );
}

/** Live second line: the latest tool call, else whatever the provider reports. */
function LiveActivityLine(props: {
  agent: RuntimeSubagent;
  latest: SubagentToolLogEntry | undefined;
}) {
  const { agent, latest } = props;
  const waiting = agent.status === "waiting";
  if (!latest) {
    const text =
      agent.progress ?? (agent.lastToolName ? `▸ ${agent.lastToolName}` : null) ?? "Starting…";
    return <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{text}</span>;
  }
  const Icon = TOOL_KIND_ICONS[latest.kind];
  return (
    <>
      <Icon aria-hidden className="size-3 shrink-0 text-icon-muted" />
      <span className="max-w-[45%] shrink-0 truncate text-xs text-secondary-label">
        {latest.title}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-2xs text-muted-foreground">
        {latest.detail ?? latest.command ?? ""}
      </span>
      {waiting ? (
        <span className="shrink-0 font-mono text-2xs text-warning-foreground">waiting</span>
      ) : latest.status === "running" ? (
        <span className="shrink-0 font-mono text-2xs text-muted-foreground/70">…</span>
      ) : null}
    </>
  );
}

/** One line per agent, plus a second for live and failed agents. */
function AgentRowContent(props: {
  agent: RuntimeSubagent;
  toolLog: ReadonlyArray<SubagentToolLogEntry>;
}) {
  const { agent } = props;
  const live = isActiveSubagentStatus(agent.status);
  const failed = agent.status === "failed";
  return (
    <>
      <span className="flex h-6 items-center gap-2">
        <StatusDot status={agent.status} />
        <span className="min-w-0 flex-1 truncate text-sm">{agent.title}</span>
        {agent.status === "completed" ? (
          <Check aria-hidden className="size-3 shrink-0 text-success" />
        ) : failed ? (
          <X aria-hidden className="size-3 shrink-0 text-destructive" />
        ) : null}
        <span className="shrink-0 font-mono text-2xs tabular-nums text-muted-foreground/80">
          {agent.usage ? formatSubagentTokenCount(agent.usage.totalTokens) : ""}
        </span>
        <span className="min-w-12 shrink-0 text-right font-mono text-2xs tabular-nums text-muted-foreground/80">
          <AgentElapsed agent={agent} />
        </span>
      </span>
      {live ? (
        <span className="flex h-5 items-center gap-1.5 ps-3.5">
          <LiveActivityLine agent={agent} latest={props.toolLog.at(-1)} />
        </span>
      ) : failed && agent.error ? (
        <span className="flex h-5 items-center gap-1.5 ps-3.5">
          <X aria-hidden className="size-3 shrink-0 text-destructive" />
          <span className="min-w-0 truncate font-mono text-2xs text-destructive-foreground">
            {agent.error}
          </span>
        </span>
      ) : null}
    </>
  );
}

function PreviewSection(props: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-0.5">
      <h4 className="px-0.5 text-3xs font-medium uppercase tracking-wider text-muted-foreground">
        {props.title}
      </h4>
      {props.children}
    </section>
  );
}

/** A small agent detail view: identity, prompt, latest tool calls, usage footer. */
function AgentPreviewContent(props: {
  agent: RuntimeSubagent;
  toolLog: ReadonlyArray<SubagentToolLogEntry>;
  timestampFormat: TimestampFormat;
  onOpen: OpenAgent;
}) {
  const { agent, toolLog, onOpen } = props;
  const live = isActiveSubagentStatus(agent.status);
  const identity = [
    STATUS_VISUALS[agent.status].label,
    agent.role,
    formatSubagentModelLabel(agent.model, agent.effort),
    agent.phaseTitle ? `phase ${agent.phaseTitle}` : null,
    agent.activationCount > 1 ? `run ${agent.activationCount}` : null,
  ].filter((value): value is string => value !== null);
  const latest = useMemo(() => toolLog.slice(-PREVIEW_TOOL_CALLS).toReversed(), [toolLog]);
  const totalCalls = Math.max(toolLog.length, agent.usage?.toolUses ?? 0);
  const outcome = agent.error ?? (live ? null : agent.result);
  return (
    <div className="flex cursor-pointer flex-col" onClick={() => onOpen(agent.id)}>
      <div className="flex flex-col gap-0.5 border-b border-border/60 px-3 pb-2 pt-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <StatusDot status={agent.status} />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{agent.title}</span>
          <span className="shrink-0 font-mono text-2xs text-muted-foreground">
            <AgentElapsed agent={agent} />
          </span>
        </div>
        <p className="truncate ps-3.5 font-mono text-2xs text-muted-foreground">
          {identity.join(" · ")}
        </p>
      </div>
      <div className="flex flex-col gap-2.5 px-2.5 py-2">
        {live && agent.progress ? (
          <PreviewSection title="Now">
            <p className="px-0.5 text-xs text-muted-foreground">{agent.progress}</p>
          </PreviewSection>
        ) : null}
        {agent.prompt ? (
          <PreviewSection title="Prompt">
            <p className="line-clamp-3 whitespace-pre-wrap break-words px-0.5 text-xs leading-relaxed text-foreground/85">
              {agent.prompt}
            </p>
          </PreviewSection>
        ) : null}
        {outcome ? (
          <PreviewSection title={agent.error ? "Error" : "Result"}>
            <p
              className={cn(
                "line-clamp-3 whitespace-pre-wrap break-words px-0.5 text-xs leading-relaxed",
                agent.error ? "text-destructive-foreground" : "text-foreground/85",
              )}
            >
              {outcome}
            </p>
          </PreviewSection>
        ) : null}
        {latest.length > 0 ? (
          <PreviewSection
            title={
              <>
                Latest tool calls
                <span className="font-mono tracking-normal"> · {totalCalls}</span>
              </>
            }
          >
            <ToolLogList
              entries={latest}
              timestampFormat={props.timestampFormat}
              onActivate={(toolCallId) => onOpen(agent.id, toolCallId)}
            />
            {totalCalls > latest.length ? (
              <p className="ps-6.5 pt-1 text-2xs text-muted-foreground">
                {totalCalls - latest.length} more · click to open the agent
              </p>
            ) : null}
          </PreviewSection>
        ) : null}
      </div>
      <AgentUsageFooter agent={agent} />
    </div>
  );
}

/** Right-click on a list row. The same action as the detail view's title icon. */
async function showOpenAgentTabMenu(
  agent: RuntimeSubagent,
  onOpenInTab: (agent: RuntimeSubagent) => void,
  position: { readonly x: number; readonly y: number },
): Promise<void> {
  const api = readLocalApi();
  if (!api) return;
  const items = [
    { id: "open-in-tab", label: "Open in new tab" },
  ] as const satisfies readonly ContextMenuItem<"open-in-tab">[];
  let action: "open-in-tab" | null;
  try {
    action = await api.contextMenu.show(items, position);
  } catch {
    return;
  }
  if (action === "open-in-tab") onOpenInTab(agent);
}

function menuPosition(event: MouseEvent<HTMLButtonElement>): { x: number; y: number } {
  if (event.clientX === 0 && event.clientY === 0) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: bounds.left, y: bounds.bottom };
  }
  return { x: event.clientX, y: event.clientY };
}

/** Agent row with its hover preview; both open the agent's detail view. */
function AgentRow(props: {
  agent: RuntimeSubagent;
  toolLogs: ToolLogs;
  timestampFormat: TimestampFormat;
  onOpen: OpenAgent;
  onOpenInTab?: ((agent: RuntimeSubagent) => void) | undefined;
}) {
  const { agent, onOpen, onOpenInTab } = props;
  const toolLog = props.toolLogs.get(agent.id) ?? NO_TOOL_CALLS;
  const previewActions = useRef<{ close: () => void; unmount: () => void } | null>(null);
  const menuOpen = useRef(false);
  const statusLabel =
    agent.kind === "subagent_batch" && agent.status === "idle"
      ? "Idle"
      : STATUS_VISUALS[agent.status].label;
  return (
    <PreviewCard
      actionsRef={previewActions}
      onOpenChange={(open, details) => {
        if (open && menuOpen.current) details.cancel();
      }}
    >
      <PreviewCardTrigger
        delay={400}
        closeDelay={150}
        render={
          <button
            type="button"
            onClick={() => onOpen(agent.id)}
            onContextMenu={
              onOpenInTab
                ? (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    menuOpen.current = true;
                    previewActions.current?.close();
                    void showOpenAgentTabMenu(agent, onOpenInTab, menuPosition(event)).finally(
                      () => {
                        menuOpen.current = false;
                      },
                    );
                  }
                : undefined
            }
            aria-label={`${agent.title}, ${statusLabel}. Show details`}
            className="flex w-full flex-col rounded-md px-1.5 text-left hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
          />
        }
      >
        <AgentRowContent agent={agent} toolLog={toolLog} />
      </PreviewCardTrigger>
      <PreviewCardPopup side="left" align="start" className="w-100 max-w-[calc(100vw-2rem)]">
        <AgentPreviewContent
          agent={agent}
          toolLog={toolLog}
          timestampFormat={props.timestampFormat}
          onOpen={onOpen}
        />
      </PreviewCardPopup>
    </PreviewCard>
  );
}

/** Shared by every agent row in the list. */
interface RowContext {
  readonly toolLogs: ToolLogs;
  readonly timestampFormat: TimestampFormat;
  readonly onOpenAgent: OpenAgent;
  readonly onOpenInTab?: ((agent: RuntimeSubagent) => void) | undefined;
}

function Rows(props: { agents: ReadonlyArray<RuntimeSubagent>; ctx: RowContext }) {
  return props.agents.map((agent) => (
    <AgentRow
      key={agent.id}
      agent={agent}
      toolLogs={props.ctx.toolLogs}
      timestampFormat={props.ctx.timestampFormat}
      onOpen={props.ctx.onOpenAgent}
      onOpenInTab={props.ctx.onOpenInTab}
    />
  ));
}

function workflowIsLive(group: AgentPanelWorkflowGroup): boolean {
  const status = group.workflow.status;
  return (
    status !== "completed" &&
    status !== "failed" &&
    status !== "cancelled" &&
    status !== "interrupted"
  );
}

function workflowMembers(group: AgentPanelWorkflowGroup): ReadonlyArray<RuntimeSubagent> {
  return [...group.phases.flatMap((phase) => phase.members), ...group.unphasedMembers];
}

function sumTokens(agents: ReadonlyArray<RuntimeSubagent>): number {
  return agents.reduce((sum, agent) => sum + (agent.usage?.totalTokens ?? 0), 0);
}

/** Wall-clock span of a settled set of agents. */
function settledSpan(agents: ReadonlyArray<RuntimeSubagent>): string | null {
  const starts = agents.flatMap((agent) => (agent.startedAt ? [agent.startedAt] : []));
  const ends = agents.flatMap((agent) => (agent.completedAt ? [agent.completedAt] : []));
  if (starts.length === 0 || ends.length !== agents.length) return null;
  return elapsedBetween(starts.toSorted()[0]!, ends.toSorted().at(-1)!);
}

/**
 * Read-only workflow script viewer, fetched through the contained
 * getWorkflowScript RPC (never a raw filesystem read from the client).
 */
function WorkflowScriptView({
  environmentId,
  threadId,
  scriptPath,
  onClose,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  scriptPath: string;
  onClose: () => void;
}) {
  const result = useAtomValue(
    orchestrationEnvironment.workflowScript({ environmentId, input: { threadId, scriptPath } }),
  );
  return (
    <div className="mx-1.5 mb-1 rounded-md border border-border/60 bg-background/60">
      <div className="flex items-center gap-2 border-b border-border/50 px-2 py-1">
        <Braces aria-hidden className="size-3 text-muted-foreground" />
        <span className="truncate font-mono text-3xs text-muted-foreground">
          {scriptPath.split("/").at(-1)}
        </span>
        <Button
          size="icon-micro"
          variant="ghost-muted"
          onClick={onClose}
          aria-label="Close script"
          className="ml-auto"
        >
          <X aria-hidden className="size-3" />
        </Button>
      </div>
      <div className="max-h-72 overflow-auto p-2">
        {result._tag === "Success" ? (
          <pre className="whitespace-pre-wrap break-words font-mono text-2xs leading-relaxed text-foreground/90">
            {result.value.contents}
            {result.value.truncated ? "\n… (truncated)" : ""}
          </pre>
        ) : result._tag === "Failure" ? (
          <p className="text-xs text-destructive-foreground">Could not load the script.</p>
        ) : (
          <p className="text-xs text-muted-foreground">Loading…</p>
        )}
      </div>
    </div>
  );
}

/**
 * Collapsible phase divider with its rollup. A phase opens when it becomes
 * active, then keeps that shape as it settles so completion never yanks rows
 * out from under the user. Manual toggles stick until a later activation.
 */
function PhaseSection({
  phase,
  defaultOpen = false,
  ctx,
}: {
  phase: AgentPanelWorkflowGroup["phases"][number];
  defaultOpen?: boolean;
  ctx: RowContext;
}) {
  const [open, setOpen] = useState(defaultOpen || phase.state === "running");
  const previousState = useRef(phase.state);

  useEffect(() => {
    if (previousState.current !== "running" && phase.state === "running") {
      setOpen(true);
    }
    previousState.current = phase.state;
  }, [phase.state]);

  const pending = phase.state === "pending" && phase.members.length === 0;
  const span = phase.state === "done" ? settledSpan(phase.members) : null;
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        disabled={pending}
        className="mt-1.5 flex h-6 w-full items-center gap-1.5 rounded-sm px-1.5 text-left text-3xs font-medium uppercase tracking-wider hover:bg-accent/40 disabled:hover:bg-transparent"
      >
        {pending ? (
          <span className="size-3 shrink-0" />
        ) : open ? (
          <ChevronDown aria-hidden className="size-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight aria-hidden className="size-3 shrink-0 text-muted-foreground" />
        )}
        {phase.state === "done" ? (
          <Check aria-hidden className="size-3 shrink-0 text-success-foreground" />
        ) : null}
        <span
          className={cn(
            "min-w-0 truncate",
            phase.state === "done"
              ? "text-success-foreground"
              : phase.state === "running"
                ? "text-info-foreground"
                : "text-muted-foreground/70",
          )}
        >
          {phase.title}
        </span>
        <span className="ms-auto flex shrink-0 items-center gap-2 font-mono font-normal normal-case tracking-normal tabular-nums text-muted-foreground/80">
          {pending ? (
            <span>pending</span>
          ) : (
            <>
              {!open ? (
                <span className="flex items-center gap-0.5">
                  {phase.members.map((member) => (
                    <StatusDot key={member.id} status={member.status} />
                  ))}
                </span>
              ) : null}
              <span>
                {phase.settledCount}/{phase.members.length}
              </span>
              <span>{formatSubagentTokenCount(sumTokens(phase.members))}</span>
              {span ? <span>{span}</span> : null}
            </>
          )}
        </span>
      </button>
      {open ? <Rows agents={phase.members} ctx={ctx} /> : null}
    </div>
  );
}

/** Expanded workflow: a flat header over its phase dividers and rows. */
function ExpandedWorkflowSection({
  group,
  environmentId,
  threadId,
  onCollapse,
  ctx,
}: {
  group: AgentPanelWorkflowGroup;
  environmentId: EnvironmentId | null;
  threadId: ThreadId | null;
  onCollapse: () => void;
  ctx: RowContext;
}) {
  const [scriptOpen, setScriptOpen] = useState(false);
  const members = workflowMembers(group);
  const settled = members.filter(isSettled).length;
  const scriptPath = group.workflow.runHandles?.scriptPath;
  const canShowScript = scriptPath !== undefined && environmentId !== null && threadId !== null;
  return (
    <section className="flex flex-col">
      <div className="flex h-7 items-center gap-2 px-1.5">
        <Workflow aria-hidden className="size-3.5 shrink-0 text-icon-muted" />
        <span className="min-w-0 truncate text-sm">
          {group.workflow.workflowName ?? group.workflow.title}
        </span>
        {canShowScript ? (
          <button
            type="button"
            onClick={() => setScriptOpen((value) => !value)}
            className={cn(
              "shrink-0 rounded-sm px-1 font-mono text-2xs text-muted-foreground hover:bg-accent hover:text-foreground",
              scriptOpen && "text-foreground",
            )}
            aria-expanded={scriptOpen}
          >
            {"{}"} script
          </button>
        ) : null}
        <span className="ms-auto flex shrink-0 items-center gap-2 font-mono text-2xs tabular-nums text-muted-foreground/80">
          <span>
            {settled}/{members.length} settled
          </span>
          <AgentElapsed agent={group.workflow} />
        </span>
        <Button
          size="icon-micro"
          variant="ghost-muted"
          onClick={onCollapse}
          aria-label="Collapse workflow"
        >
          <ChevronDown aria-hidden className="size-3" />
        </Button>
      </div>
      {scriptOpen && canShowScript ? (
        <WorkflowScriptView
          environmentId={environmentId}
          threadId={threadId}
          scriptPath={scriptPath}
          onClose={() => setScriptOpen(false)}
        />
      ) : null}
      {group.phases.map((phase) => (
        <PhaseSection
          key={phase.index}
          phase={phase}
          defaultOpen={!workflowIsLive(group)}
          ctx={ctx}
        />
      ))}
      <Rows agents={group.unphasedMembers} ctx={ctx} />
      {group.phases.length === 0 && group.unphasedMembers.length === 0 ? (
        <Rows agents={[group.workflow]} ctx={ctx} />
      ) : null}
    </section>
  );
}

/**
 * Collapsed workflow: one summary line. The parent owns expansion so a live
 * workflow keeps its shape when it settles.
 */
function CollapsedWorkflowSection({
  group,
  onExpand,
}: {
  group: AgentPanelWorkflowGroup;
  onExpand: () => void;
}) {
  const members = workflowMembers(group);
  const failed = members.filter((member) => member.status === "failed").length;
  // Coordinator usage may already aggregate members (panel-footer rule):
  // count it only when there are no member rows to sum.
  const totalTokens =
    members.length === 0 ? (group.workflow.usage?.totalTokens ?? 0) : sumTokens(members);
  const elapsed =
    group.workflow.startedAt && group.workflow.completedAt
      ? elapsedBetween(group.workflow.startedAt, group.workflow.completedAt)
      : null;
  return (
    <section>
      <button
        type="button"
        onClick={onExpand}
        className="flex h-7 w-full items-center gap-2 rounded-md px-1.5 text-left hover:bg-accent/40"
        aria-expanded={false}
      >
        <Workflow aria-hidden className="size-3.5 shrink-0 text-icon-muted" />
        <span className="min-w-0 truncate text-sm">
          {group.workflow.workflowName ?? group.workflow.title}
        </span>
        <span className="ms-auto flex shrink-0 items-center gap-1.5 font-mono text-2xs tabular-nums text-muted-foreground/80">
          {failed > 0 ? <span className="text-destructive-foreground">{failed} failed</span> : null}
          <span>{members.length} agents</span>
          <span>· {formatSubagentTokenCount(totalTokens)}</span>
          {elapsed ? <span>· {elapsed}</span> : null}
          <ChevronRight aria-hidden className="size-3" />
        </span>
      </button>
    </section>
  );
}

/** A workflow's open state is presentation state, not a status derivative. */
function WorkflowSection({
  group,
  environmentId,
  threadId,
  forceOpen,
  ctx,
}: {
  group: AgentPanelWorkflowGroup;
  environmentId: EnvironmentId | null;
  threadId: ThreadId | null;
  /** A filtered view shows its matches instead of collapsed summaries. */
  forceOpen: boolean;
  ctx: RowContext;
}) {
  const [open, setOpen] = useState(() => workflowIsLive(group));
  return open || forceOpen ? (
    <ExpandedWorkflowSection
      group={group}
      environmentId={environmentId}
      threadId={threadId}
      onCollapse={() => setOpen(false)}
      ctx={ctx}
    />
  ) : (
    <CollapsedWorkflowSection group={group} onExpand={() => setOpen(true)} />
  );
}

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

export function AgentsPanel({
  model,
  activities,
  threadKey,
  environmentId = null,
  threadId = null,
  dedicatedAgentId,
  onOpenAgentTab,
  onViewAgents,
}: {
  dedicatedAgentId?: string | undefined;
  onOpenAgentTab?: ((agent: RuntimeSubagent) => void) | undefined;
  onViewAgents?: (() => void) | undefined;
  model: AgentPanelModel;
  activities: ReadonlyArray<OrchestrationThreadActivity>;
  /** Scoped thread key; the chat focuses an agent through the panel store. */
  threadKey: string | null;
  environmentId?: EnvironmentId | null;
  threadId?: ThreadId | null;
}) {
  const view = useAgentsPanelStore((state) => state.view);
  const setView = useAgentsPanelStore((state) => state.setView);
  const focusAgent = useAgentsPanelStore((state) => state.focusAgent);
  const focusedToolCallId = useAgentsPanelStore((state) => state.focusedToolCallId);
  const focusedAgentId = useAgentsPanelStore((state) =>
    threadKey ? (state.focusedAgentIdByThreadKey[threadKey] ?? null) : null,
  );
  const { timestampFormat } = useClientSettings();
  const visible = useMemo(() => applyAgentPanelView(model, view), [model, view]);
  const toolLogs = useMemo(() => deriveSubagentToolLogs(activities), [activities]);
  const detailAgentId = dedicatedAgentId ?? focusedAgentId;
  const focusedAgent = detailAgentId ? findPanelAgent(model, detailAgentId) : null;
  const ctx: RowContext = {
    toolLogs,
    timestampFormat,
    onOpenAgent: (agentId, toolCallId) => {
      if (threadKey) focusAgent(threadKey, agentId, toolCallId ?? null);
    },
    onOpenInTab: onOpenAgentTab,
  };

  if (dedicatedAgentId && !focusedAgent) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-sm font-medium">Agent unavailable</p>
        <p className="text-xs text-muted-foreground">
          This agent's activity is not available in this thread.
        </p>
        <Button size="xs" variant="ghost-muted" onClick={onViewAgents}>
          View agents
        </Button>
      </div>
    );
  }

  if (!model.hasAgents) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <Bot aria-hidden className="size-6 text-muted-foreground/60" />
        <p className="text-sm font-medium">No agents yet</p>
        <p className="max-w-56 text-xs text-muted-foreground">
          When this thread spawns subagents or runs a workflow, they show up here with live status,
          activity, and token usage.
        </p>
      </div>
    );
  }

  if (focusedAgent) {
    return (
      <AgentDetailView
        key={focusedAgent.id}
        agent={focusedAgent}
        activities={activities}
        environmentId={environmentId}
        threadId={threadId}
        initialToolCallId={dedicatedAgentId ? null : focusedToolCallId}
        onOpenInTab={
          !dedicatedAgentId && onOpenAgentTab ? () => onOpenAgentTab(focusedAgent) : undefined
        }
        onBack={() => {
          if (dedicatedAgentId) onViewAgents?.();
          else if (threadKey) focusAgent(threadKey, null);
        }}
      />
    );
  }

  const filtered = isAgentPanelViewFiltered(view);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <AgentsPanelToolbar view={view} onChange={setView} />
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-2 p-2">
          {visible.visibleCount === 0 ? (
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
          {visible.workflows.map((group) => (
            <WorkflowSection
              key={group.workflow.id}
              group={group}
              environmentId={environmentId}
              threadId={threadId}
              forceOpen={filtered}
              ctx={ctx}
            />
          ))}
          {visible.directAgents.length > 0 ? (
            <section className="flex flex-col">
              <h3 className="flex h-6 items-center gap-1.5 px-1.5 text-3xs font-medium uppercase tracking-wider text-muted-foreground">
                Direct spawns
                <span className="font-mono tracking-normal">{visible.directAgents.length}</span>
              </h3>
              <Rows agents={visible.directAgents} ctx={ctx} />
            </section>
          ) : null}
        </div>
      </ScrollArea>
      <UsageFooter
        usage={{ totalTokens: model.totalTokens, ...model.usageTotals }}
        leading={
          <>
            <StatusCount status="running" count={model.liveCount} label="Working" />
            <StatusCount status="idle" count={model.idleCount} label="Idle" />
            <StatusCount status="completed" count={model.completedCount} label="Completed" />
            <StatusCount status="failed" count={model.failedCount} label="Failed" />
            <StatusCount status="cancelled" count={model.stoppedCount} label="Stopped" />
            {filtered ? <span className="shrink-0">· {visible.visibleCount} shown</span> : null}
          </>
        }
      />
    </div>
  );
}
