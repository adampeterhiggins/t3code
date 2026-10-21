/**
 * Fork: pieces of the agent tab and the agents list rows. The tool call row
 * is shaped like the chat's tool rows (hover previews the whole call, click
 * expands it), and the usage footer shows a subagent's reported usage.
 */
import { useNavigate } from "@tanstack/react-router";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { buildThreadRouteParams } from "~/threadRoutes";
import { useDiffPanelStore } from "~/diffPanelStore";
import { useRightPanelStore } from "~/rightPanelStore";
import { projectedWorkEntry } from "../../session-logic";
import { workEntryDisplayLabel } from "./MessagesTimeline.logic";
import { ToolCallDetails } from "./ToolCallDetail";
import type {
  SubagentToolCall,
  SubagentToolCallListEntry,
} from "@t3tools/client-runtime/state/agent-list-view";
import { formatSubagentTokenCount } from "@t3tools/client-runtime/state/subagentRuntime";
import type {
  EnvironmentId,
  OrchestrationV2ModelCallUsage,
  OrchestrationV2SubagentUsage,
  ThreadId,
} from "@t3tools/contracts";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import { formatDuration } from "@t3tools/shared/orchestrationTiming";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BrainIcon,
  ChevronRightIcon,
  DatabaseIcon,
  WrenchIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import {
  memo,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";

import { cn } from "~/lib/utils";
import { formatSecondsTimestamp } from "~/timestampFormat";

import { elapsedBetween } from "../AgentStatus";
import { PreviewCard, PreviewCardPopup, PreviewCardTrigger } from "../ui/preview-card";
import { TOOL_KIND_ICONS } from "./agentToolKinds";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const TOOL_STATUS_LABELS: Record<SubagentToolCall["status"], string> = {
  running: "running",
  completed: "completed",
  failed: "failed",
};

function rowKeyToggle(toggle: () => void) {
  return (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggle();
    }
  };
}

/** Time, status, duration, and exit code, as the chat's tool footer shows them. */
function toolCallMeta(call: SubagentToolCall, timestampFormat: TimestampFormat): string {
  return [
    call.startedAt ? formatSecondsTimestamp(call.startedAt, timestampFormat) : null,
    TOOL_STATUS_LABELS[call.status],
    toolCallDuration(call),
    call.exitCode !== null ? `exit ${call.exitCode}` : null,
  ]
    .filter((value) => value !== null && value !== "")
    .join(" · ");
}

function toolCallDuration(call: SubagentToolCall): string | null {
  if (!call.startedAt) return null;
  return call.completedAt ? elapsedBetween(call.startedAt, call.completedAt) : "…";
}

/** Where an agent's tool calls live, to fetch an edit's withheld diff when it is opened. */
export interface ToolCallSource {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly workspaceRoot: string | null;
}

/** Both the Tools list and fleet hover use the chat's preview and detail renderers. */
function AgentToolCallDetails(props: {
  call: SubagentToolCall;
  source: ToolCallSource;
  timestampFormat: TimestampFormat;
  preview?: boolean;
}) {
  const navigate = useNavigate();
  const { source, call } = props;
  const openThread = (threadId: ThreadId) =>
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(source.environmentId, threadId)),
    });
  const workEntry = projectedWorkEntry({
    item: call.item,
    sourceItemId: call.item.id,
    sourceThreadId: source.threadId,
    visibility: "local",
    position: call.item.ordinal,
  });
  const Icon = TOOL_KIND_ICONS[call.kind];
  return (
    <ToolCallDetails
      workEntry={workEntry}
      previewText={workEntryDisplayLabel(workEntry, source.workspaceRoot ?? undefined)}
      workspaceRoot={source.workspaceRoot ?? undefined}
      markdownCwd={source.workspaceRoot ?? undefined}
      activeThreadEnvironmentId={source.environmentId}
      timestampFormat={props.timestampFormat}
      onOpenThread={openThread}
      onOpenTurnDiff={(runId, filePath) => {
        const ref = scopeThreadRef(source.environmentId, source.threadId);
        useDiffPanelStore.getState().selectTurn(ref, runId, filePath);
        useRightPanelStore.getState().open(ref, "diff");
        openThread(source.threadId);
      }}
      icon={<Icon aria-hidden className="mt-px size-3.5 shrink-0 text-icon-muted" />}
      preview={props.preview}
    />
  );
}

/**
 * One call. Hovering previews the whole call; clicking pins it open inline, or runs `onActivate`
 * instead where a click should navigate (the agent hover preview). A new `focusToken` expands the
 * call and scrolls it into view.
 */
const ToolCallRow = memo(function ToolCallRow(props: {
  call: SubagentToolCall;
  timestampFormat: TimestampFormat;
  source: ToolCallSource;
  focusToken: number | null;
  onActivate: ((call: SubagentToolCall) => void) | undefined;
}) {
  const { call, focusToken, onActivate } = props;
  const [expanded, setExpanded] = useState(focusToken !== null);
  // A new focus expands the call during render; the layout effect only scrolls to it.
  const [seenFocusToken, setSeenFocusToken] = useState(focusToken);
  if (focusToken !== seenFocusToken) {
    setSeenFocusToken(focusToken);
    if (focusToken !== null) setExpanded(true);
  }
  const rowRef = useRef<HTMLLIElement>(null);
  useLayoutEffect(() => {
    if (focusToken !== null) rowRef.current?.scrollIntoView({ block: "center" });
  }, [focusToken]);
  const Icon = TOOL_KIND_ICONS[call.kind];
  const failed = call.status === "failed";
  const toggle = () => (onActivate ? onActivate(call) : setExpanded(!expanded));
  const line = (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={onActivate ? undefined : expanded}
      aria-label={failed ? `${call.title}, failed` : call.title}
      onClick={(event: MouseEvent) => {
        // An outer clickable surface (the agent preview) must not also handle it.
        if (onActivate) event.stopPropagation();
        toggle();
      }}
      onKeyDown={rowKeyToggle(toggle)}
      className="flex cursor-pointer select-none items-center gap-1.5 rounded-md px-0.5 text-xs leading-relaxed hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
    >
      <span className="flex size-5 shrink-0 items-center justify-center text-icon-muted">
        <Icon aria-hidden className="size-3.5" />
      </span>
      <span
        className={cn(
          "min-w-0 truncate",
          call.detail ? "max-w-[45%] shrink-0" : "flex-1",
          call.status === "running" ? "text-foreground" : "text-secondary-label",
        )}
      >
        {call.title}
      </span>
      {call.detail ? (
        <span className="min-w-0 flex-1 truncate font-mono text-2xs text-muted-foreground">
          {call.detail}
        </span>
      ) : null}
      {failed ? <XIcon aria-hidden className="size-3 shrink-0 text-destructive" /> : null}
      {/* Fixed widths keep the columns aligned; anything wider truncates. */}
      <span className="w-[7ch] shrink-0 truncate text-right font-mono text-2xs tabular-nums text-muted-foreground/70">
        {toolCallDuration(call)}
      </span>
      <span className="min-w-[8ch] shrink-0 text-right font-mono text-2xs tabular-nums text-muted-foreground/70">
        {call.startedAt ? formatSecondsTimestamp(call.startedAt, props.timestampFormat) : null}
      </span>
      {onActivate ? null : (
        <ChevronRightIcon
          aria-hidden
          className={cn(
            "size-3 shrink-0 text-icon-muted opacity-70 transition-transform duration-200",
            expanded && "rotate-90",
          )}
        />
      )}
    </div>
  );
  return (
    <li ref={rowRef} className={cn("flex flex-col", expanded && "mb-1")}>
      {expanded ? (
        line
      ) : (
        <PreviewCard>
          <PreviewCardTrigger render={line} delay={300} closeDelay={150} />
          <PreviewCardPopup side="left" align="start" className="w-md max-w-[calc(100vw-2rem)]">
            <div
              onClick={(event) => {
                // Preview disclosures and links must not activate the enclosing agent row.
                event.stopPropagation();
              }}
            >
              <AgentToolCallDetails
                call={call}
                source={props.source}
                timestampFormat={props.timestampFormat}
                preview
              />
            </div>
          </PreviewCardPopup>
        </PreviewCard>
      )}
      {expanded ? (
        <div className="ms-6.5 mt-1 cursor-default rounded-md bg-muted/40 px-3 py-2">
          <AgentToolCallDetails
            call={call}
            source={props.source}
            timestampFormat={props.timestampFormat}
          />
          <p className="mt-1.5 font-mono text-3xs text-muted-foreground">
            {toolCallMeta(call, props.timestampFormat)}
          </p>
        </div>
      ) : null}
    </li>
  );
});

/** A call to open expanded and in view; a new `token` focuses it again. */
export interface ToolCallFocus {
  readonly id: SubagentToolCall["id"];
  readonly token: number;
}

function stepTokenSummary(usage: OrchestrationV2ModelCallUsage | undefined): string | null {
  if (usage === undefined) return null;
  const parts: Array<string> = [];
  if (usage.inputTokens !== undefined) {
    parts.push(`↓ ${formatSubagentTokenCount(usage.inputTokens)}`);
  }
  if (usage.outputTokens !== undefined) {
    parts.push(`↑ ${formatSubagentTokenCount(usage.outputTokens)}`);
  }
  return parts.length === 0 ? null : parts.join(" · ");
}

function StepUsageTooltip(props: { usage: OrchestrationV2ModelCallUsage; summary: string }) {
  const { usage } = props;
  const exact = (value: number) => value.toLocaleString();
  const cachedShare =
    usage.cachedInputTokens !== undefined && usage.inputTokens
      ? Math.round((usage.cachedInputTokens / usage.inputTokens) * 100)
      : null;
  const rows: Array<readonly [string, string]> = [];
  if (usage.inputTokens !== undefined) rows.push(["Input", exact(usage.inputTokens)]);
  if (usage.cachedInputTokens !== undefined) {
    rows.push([
      "Cached",
      cachedShare === null
        ? exact(usage.cachedInputTokens)
        : `${exact(usage.cachedInputTokens)} (${cachedShare}% of input)`,
    ]);
  }
  if (usage.outputTokens !== undefined) rows.push(["Output", exact(usage.outputTokens)]);
  if (usage.reasoningOutputTokens !== undefined) {
    rows.push(["Reasoning", exact(usage.reasoningOutputTokens)]);
  }
  return (
    <Tooltip>
      <TooltipTrigger render={<span tabIndex={0} className="shrink-0 outline-none" />}>
        {props.summary}
      </TooltipTrigger>
      <TooltipPopup side="top" align="end">
        <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 font-mono text-2xs tabular-nums">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="text-right">{value}</dd>
            </div>
          ))}
        </dl>
      </TooltipPopup>
    </Tooltip>
  );
}

/** A hairline above one model call's tool rows. No token text when that call reported none. */
function ToolCallStepDivider(props: { step: number; usage?: OrchestrationV2ModelCallUsage }) {
  const summary = stepTokenSummary(props.usage);
  return (
    <li className="flex items-center gap-2 py-1 font-mono text-2xs tabular-nums text-muted-foreground">
      <span className="shrink-0">Step {props.step}</span>
      <span aria-hidden className="h-px min-w-2 flex-1 bg-border/60" />
      {summary !== null && props.usage !== undefined ? (
        <StepUsageTooltip usage={props.usage} summary={summary} />
      ) : null}
    </li>
  );
}

export function ToolCallList(props: {
  calls: ReadonlyArray<SubagentToolCall>;
  /** Model-call dividers interleaved with `calls`. Omit to render the rows alone. */
  entries?: ReadonlyArray<SubagentToolCallListEntry> | undefined;
  timestampFormat: TimestampFormat;
  source: ToolCallSource;
  focus?: ToolCallFocus | null | undefined;
  /** Clicking a call navigates instead of expanding it. */
  onActivate?: ((call: SubagentToolCall) => void) | undefined;
}) {
  const row = (call: SubagentToolCall) => (
    <ToolCallRow
      key={call.id}
      call={call}
      timestampFormat={props.timestampFormat}
      source={props.source}
      focusToken={props.focus?.id === call.id ? props.focus.token : null}
      onActivate={props.onActivate}
    />
  );
  return (
    <ol className="flex flex-col gap-px">
      {props.entries === undefined
        ? props.calls.map(row)
        : props.entries.map((entry) =>
            entry.kind === "step" ? (
              <ToolCallStepDivider
                key={`step:${entry.firstCallId}`}
                step={entry.step}
                {...(entry.usage === undefined ? {} : { usage: entry.usage })}
              />
            ) : (
              row(entry.call)
            ),
          )}
    </ol>
  );
}

function UsageStat(props: { icon: LucideIcon; label: string; value: string }) {
  const Icon = props.icon;
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span tabIndex={0} className="flex shrink-0 items-center gap-1 outline-none" />}
      >
        <Icon aria-hidden className="size-3 text-icon-muted" />
        <span className="text-foreground">{props.value}</span>
      </TooltipTrigger>
      <TooltipPopup>{props.label}</TooltipPopup>
    </Tooltip>
  );
}

/**
 * A subagent's usage as icon + number with each label in its tooltip, and
 * `Σ total` opening the full breakdown. `leading` sits at the start; `extra`
 * appends rows to the breakdown (runs, attempt).
 */
export function AgentUsageFooter(props: {
  usage: OrchestrationV2SubagentUsage | null;
  leading?: ReactNode;
  extra?: ReadonlyArray<readonly [string, string]>;
}) {
  const { usage } = props;
  const breakdown: Array<readonly [string, string]> = [];
  if (usage) {
    breakdown.push(["Total", formatSubagentTokenCount(usage.totalTokens)]);
    if (usage.inputTokens !== undefined)
      breakdown.push(["Input", formatSubagentTokenCount(usage.inputTokens)]);
    if (usage.cachedInputTokens !== undefined)
      breakdown.push(["Cached", formatSubagentTokenCount(usage.cachedInputTokens)]);
    if (usage.outputTokens !== undefined)
      breakdown.push(["Output", formatSubagentTokenCount(usage.outputTokens)]);
    if (usage.reasoningOutputTokens !== undefined)
      breakdown.push(["Reasoning", formatSubagentTokenCount(usage.reasoningOutputTokens)]);
    if (usage.toolUses !== undefined) breakdown.push(["Tool calls", String(usage.toolUses)]);
    if (usage.durationMs !== undefined)
      breakdown.push(["Duration", formatDuration(usage.durationMs)]);
  }
  breakdown.push(...(props.extra ?? []));
  const cachedShare =
    usage?.cachedInputTokens !== undefined && usage.inputTokens
      ? Math.round((usage.cachedInputTokens / usage.inputTokens) * 100)
      : null;
  const exact = (value: number) => value.toLocaleString();
  return (
    <footer className="flex items-center justify-between gap-3 border-t border-border/60 px-3 py-1.5 font-mono text-2xs tabular-nums text-muted-foreground">
      <span className="flex min-w-0 items-center gap-3 overflow-hidden">
        {props.leading}
        {usage?.inputTokens !== undefined ? (
          <UsageStat
            icon={ArrowDownIcon}
            label={`Input tokens · ${exact(usage.inputTokens)}`}
            value={formatSubagentTokenCount(usage.inputTokens)}
          />
        ) : null}
        {cachedShare !== null && usage?.cachedInputTokens !== undefined ? (
          <UsageStat
            icon={DatabaseIcon}
            label={`Cached input · ${exact(usage.cachedInputTokens)} (${cachedShare}% of input)`}
            value={`${cachedShare}%`}
          />
        ) : null}
        {usage?.outputTokens !== undefined ? (
          <UsageStat
            icon={ArrowUpIcon}
            label={`Output tokens · ${exact(usage.outputTokens)}`}
            value={formatSubagentTokenCount(usage.outputTokens)}
          />
        ) : null}
        {usage?.reasoningOutputTokens !== undefined ? (
          <UsageStat
            icon={BrainIcon}
            label={`Reasoning tokens · ${exact(usage.reasoningOutputTokens)}`}
            value={formatSubagentTokenCount(usage.reasoningOutputTokens)}
          />
        ) : null}
        {usage?.toolUses !== undefined ? (
          <UsageStat
            icon={WrenchIcon}
            label={`Tool calls · ${usage.toolUses}`}
            value={String(usage.toolUses)}
          />
        ) : null}
      </span>
      {usage || breakdown.length > 0 ? (
        <Tooltip>
          <TooltipTrigger render={<span tabIndex={0} className="shrink-0 outline-none" />}>
            Σ{" "}
            <span className="text-foreground">
              {usage ? formatSubagentTokenCount(usage.totalTokens) : "—"}
            </span>
          </TooltipTrigger>
          <TooltipPopup side="top" align="end">
            <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 font-mono text-2xs tabular-nums">
              {breakdown.map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="text-right">{value}</dd>
                </div>
              ))}
            </dl>
          </TooltipPopup>
        </Tooltip>
      ) : (
        <span className="shrink-0">Usage not reported</span>
      )}
    </footer>
  );
}
