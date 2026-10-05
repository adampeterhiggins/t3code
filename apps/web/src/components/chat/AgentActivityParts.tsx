/**
 * Fork: pieces of the agent tab and the agents list rows. The tool call row
 * is shaped like the chat's tool rows (hover previews the whole call, click
 * expands it), and the usage footer shows a subagent's reported usage.
 */
import type { SubagentToolCall } from "@t3tools/client-runtime/state/agent-list-view";
import { formatSubagentTokenCount } from "@t3tools/client-runtime/state/subagentRuntime";
import { formatPathsForWorkspace } from "@t3tools/client-runtime/work-log/command-display";
import { fileChangePreviewText } from "@t3tools/client-runtime/work-log/item-detail";
import type { EnvironmentId, OrchestrationV2SubagentUsage, ThreadId } from "@t3tools/contracts";
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
import { memo, useState, type KeyboardEvent, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { useTurnItemDetail } from "~/state/queries";
import { formatSecondsTimestamp } from "~/timestampFormat";

import { elapsedBetween } from "../AgentStatus";
import { ToolCallBody } from "../ToolCallBody";
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

/** The call's full text for its expansion: the target, then the bounded preview. */
function toolCallBodyText(call: SubagentToolCall, preview = call.preview): string {
  const detail = call.detail && preview?.split("\n").includes(call.detail) ? null : call.detail;
  return [detail, preview].filter((value) => value !== null).join("\n\n") || call.title;
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

/** An expanded call. An edit whose diff the timeline left out fetches it while open. */
function ExpandedToolCall(props: { call: SubagentToolCall; meta: string; source: ToolCallSource }) {
  const { call, source } = props;
  const detail = useTurnItemDetail(
    call.detailRevision === null
      ? null
      : {
          environmentId: source.environmentId,
          threadId: source.threadId,
          itemId: call.id,
          revision: call.detailRevision,
        },
  );
  const fetchedItem = detail.data?.item;
  const fetchedPreview = fetchedItem ? fileChangePreviewText(fetchedItem) : null;
  const preview = fetchedPreview
    ? formatPathsForWorkspace(fetchedPreview, source.workspaceRoot)
    : call.preview;
  return (
    <div className="ms-6.5 mt-1 cursor-default rounded-md bg-muted/40 px-3 py-2">
      <ToolCallBody
        text={toolCallBodyText(call, preview)}
        className={cn(
          "max-h-64 cursor-text",
          call.status === "failed" ? "text-destructive-foreground" : "text-secondary-label",
        )}
      />
      {call.detailRevision !== null && detail.isPending ? (
        <p className="mt-1 text-3xs italic text-muted-foreground">Loading diff…</p>
      ) : null}
      <p className="mt-1.5 font-mono text-3xs text-muted-foreground">{props.meta}</p>
    </div>
  );
}

/** One call. Hovering previews the whole call; clicking pins it open inline. */
const ToolCallRow = memo(function ToolCallRow(props: {
  call: SubagentToolCall;
  timestampFormat: TimestampFormat;
  source: ToolCallSource;
}) {
  const { call } = props;
  const [expanded, setExpanded] = useState(false);
  const Icon = TOOL_KIND_ICONS[call.kind];
  const failed = call.status === "failed";
  const body = toolCallBodyText(call);
  const meta = toolCallMeta(call, props.timestampFormat);
  const toggle = () => setExpanded(!expanded);
  const line = (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      aria-label={failed ? `${call.title}, failed` : call.title}
      onClick={toggle}
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
      <span className="min-w-9 shrink-0 text-right font-mono text-2xs tabular-nums text-muted-foreground/70">
        {toolCallDuration(call)}
      </span>
      <ChevronRightIcon
        aria-hidden
        className={cn(
          "size-3 shrink-0 text-icon-muted opacity-70 transition-transform duration-200",
          expanded && "rotate-90",
        )}
      />
    </div>
  );
  return (
    <li className={cn("flex flex-col", expanded && "mb-1")}>
      {expanded ? (
        line
      ) : (
        <PreviewCard>
          <PreviewCardTrigger render={line} delay={300} closeDelay={150} />
          <PreviewCardPopup side="left" align="start" className="w-md max-w-[calc(100vw-2rem)]">
            <div className="flex flex-col gap-1.5 p-3">
              <p className="flex items-start gap-1.5 text-xs text-secondary-label">
                <Icon aria-hidden className="mt-px size-3.5 shrink-0 text-icon-muted" />
                <span className="min-w-0 break-all">{call.title}</span>
              </p>
              <ToolCallBody text={body} className="max-h-[50vh]" />
              <p className="font-mono text-3xs text-muted-foreground">{meta}</p>
            </div>
          </PreviewCardPopup>
        </PreviewCard>
      )}
      {expanded ? <ExpandedToolCall call={call} meta={meta} source={props.source} /> : null}
    </li>
  );
});

export function ToolCallList(props: {
  calls: ReadonlyArray<SubagentToolCall>;
  timestampFormat: TimestampFormat;
  source: ToolCallSource;
}) {
  return (
    <ol className="flex flex-col gap-px">
      {props.calls.map((call) => (
        <ToolCallRow
          key={call.id}
          call={call}
          timestampFormat={props.timestampFormat}
          source={props.source}
        />
      ))}
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
 * `Σ total` opening the full breakdown. `leading` sits at the start.
 */
export function AgentUsageFooter(props: {
  usage: OrchestrationV2SubagentUsage | null;
  leading?: ReactNode;
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
      {usage ? (
        <Tooltip>
          <TooltipTrigger render={<span tabIndex={0} className="shrink-0 outline-none" />}>
            Σ <span className="text-foreground">{formatSubagentTokenCount(usage.totalTokens)}</span>
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
