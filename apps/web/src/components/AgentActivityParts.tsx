/**
 * Pieces shared by the Agents list, its agent hover previews, and the agent
 * detail view: the tool call row (shaped like the chat's tool rows, with its
 * own hover preview) and the icon usage footer.
 */
import {
  subagentToolCallText,
  type SubagentToolKind,
  type SubagentToolLogEntry,
} from "@t3tools/client-runtime/state/agentPanelView";
import {
  formatSubagentTokenCount,
  type RuntimeSubagent,
} from "@t3tools/client-runtime/state/subagentRuntime";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BrainIcon,
  ChevronRightIcon,
  DatabaseIcon,
  EyeIcon,
  GlobeIcon,
  SearchIcon,
  SquarePenIcon,
  TerminalIcon,
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

import { elapsedBetween } from "./AgentStatus";
import { PreviewCard, PreviewCardPopup, PreviewCardTrigger } from "./ui/preview-card";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

/** Mirrors the chat's expanded tool call body. */
function ExpandedBody(props: { text: string; meta?: string; tone?: "default" | "error" }) {
  return (
    <div className="cursor-default rounded-md bg-muted/40 px-3 py-2">
      <pre
        className={cn(
          "max-h-64 cursor-text overflow-auto whitespace-pre-wrap break-words font-mono text-2xs leading-relaxed select-text",
          props.tone === "error" ? "text-destructive-foreground" : "text-secondary-label",
        )}
      >
        {props.text}
      </pre>
      {props.meta ? (
        <p className="mt-1.5 font-mono text-3xs text-muted-foreground">{props.meta}</p>
      ) : null}
    </div>
  );
}

export const TOOL_KIND_ICONS: Record<SubagentToolKind, LucideIcon> = {
  command: TerminalIcon,
  read: EyeIcon,
  edit: SquarePenIcon,
  search: SearchIcon,
  web: GlobeIcon,
  other: WrenchIcon,
};

export const TOOL_STATUS_LABELS: Record<SubagentToolLogEntry["status"], string> = {
  running: "Running",
  completed: "Completed",
  failed: "Failed",
};

export function rowKeyToggle(toggle: () => void) {
  return (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggle();
    }
  };
}

/**
 * One call, shaped like the chat's tool row. Hovering previews the whole
 * call. Clicking pins it open inline, or runs `onActivate` instead when the
 * row lives somewhere that should navigate (the agent hover preview).
 */
export const CallRow = memo(function CallRow(props: {
  icon: LucideIcon;
  title: string;
  detail: string | null;
  status: SubagentToolLogEntry["status"];
  time: string | null;
  duration: string | null;
  body: string;
  meta: string;
  defaultExpanded?: boolean;
  onActivate?: () => void;
}) {
  const [expanded, setExpanded] = useState(props.defaultExpanded ?? false);
  const rowRef = useRef<HTMLLIElement>(null);
  const Icon = props.icon;
  const failed = props.status === "failed";
  const activate = props.onActivate;
  const toggle = () => (activate ? activate() : setExpanded(!expanded));

  // A row opened from elsewhere (the agent preview) scrolls itself into view once.
  const scrollOnMount = useRef(props.defaultExpanded ?? false);
  useLayoutEffect(() => {
    if (!scrollOnMount.current) return;
    scrollOnMount.current = false;
    rowRef.current?.scrollIntoView({ block: "center" });
  }, []);

  const line = (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={activate ? undefined : expanded}
      aria-label={failed ? `${props.title}, failed` : props.title}
      onClick={(event: MouseEvent) => {
        // Keep an outer clickable surface (the agent preview) from also handling it.
        if (activate) event.stopPropagation();
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
          props.detail ? "max-w-[60%] shrink-0" : "flex-1",
          props.status === "running" ? "text-foreground" : "text-secondary-label",
        )}
      >
        {props.title}
      </span>
      {props.detail ? (
        <span className="min-w-0 flex-1 truncate font-mono text-2xs text-muted-foreground">
          {props.detail}
        </span>
      ) : null}
      {failed ? <XIcon aria-hidden className="size-3 shrink-0 text-destructive" /> : null}
      <span className="flex shrink-0 gap-2 ps-1 font-mono text-2xs tabular-nums">
        {props.time ? <span className="text-muted-foreground">{props.time}</span> : null}
        {props.duration !== null ? (
          <span className="min-w-9 text-right text-muted-foreground/70">{props.duration}</span>
        ) : null}
      </span>
      {activate ? null : (
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
              className="flex flex-col gap-1.5 p-3"
              onClick={(event) => {
                if (!activate) return;
                event.stopPropagation();
                activate();
              }}
            >
              <p className="flex items-center gap-1.5 text-xs text-secondary-label">
                <Icon aria-hidden className="size-3.5 text-icon-muted" />
                {props.title}
              </p>
              <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap break-words font-mono text-2xs leading-relaxed select-text">
                {props.body}
              </pre>
              <p className="font-mono text-3xs text-muted-foreground">{props.meta}</p>
            </div>
          </PreviewCardPopup>
        </PreviewCard>
      )}
      {expanded ? (
        <div className="ms-6.5 mt-1">
          <ExpandedBody text={props.body} meta={props.meta} tone={failed ? "error" : "default"} />
        </div>
      ) : null}
    </li>
  );
});

export function durationLabel(entry: SubagentToolLogEntry): string {
  return entry.completedAt ? elapsedBetween(entry.startedAt, entry.completedAt) : "…";
}

export function ToolLogList(props: {
  entries: ReadonlyArray<SubagentToolLogEntry>;
  timestampFormat: TimestampFormat;
  /** Starts this call expanded and scrolls it into view. */
  expandedId?: string | null;
  /** Clicking a call navigates instead of expanding it. */
  onActivate?: (entryId: string) => void;
}) {
  const { onActivate } = props;
  return (
    <ol className="flex flex-col gap-px">
      {props.entries.map((entry) => {
        const time = formatSecondsTimestamp(entry.startedAt, props.timestampFormat);
        const duration = durationLabel(entry);
        return (
          <CallRow
            key={entry.id}
            icon={TOOL_KIND_ICONS[entry.kind]}
            title={entry.title}
            detail={entry.detail ?? entry.command}
            status={entry.status}
            time={time}
            duration={duration}
            body={subagentToolCallText(entry, false)}
            meta={[time, TOOL_STATUS_LABELS[entry.status].toLowerCase(), duration].join(" · ")}
            defaultExpanded={entry.id === props.expandedId}
            {...(onActivate ? { onActivate: () => onActivate(entry.id) } : {})}
          />
        );
      })}
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

export interface UsageFigures {
  readonly totalTokens: number;
  readonly inputTokens?: number | undefined;
  readonly cachedInputTokens?: number | undefined;
  readonly outputTokens?: number | undefined;
  readonly reasoningOutputTokens?: number | undefined;
  readonly toolUses?: number | undefined;
}

/**
 * Token usage as icon + number with each label in its tooltip, and `Σ total`
 * opening the full breakdown. `leading` sits at the start (the list's status
 * counts); `extra` appends rows to the breakdown (runs, attempts).
 */
export function UsageFooter(props: {
  usage: UsageFigures | null;
  leading?: ReactNode;
  extra?: ReadonlyArray<readonly [string, string]>;
  /** Skip the per-kind stats when the leading content needs the room. */
  compact?: boolean;
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
  }
  breakdown.push(...(props.extra ?? []));
  if (!usage && breakdown.length === 0 && !props.leading) return null;

  const cachedShare =
    usage?.cachedInputTokens !== undefined && usage.inputTokens
      ? Math.round((usage.cachedInputTokens / usage.inputTokens) * 100)
      : null;
  const exact = (value: number) => value.toLocaleString();
  const stats = (
    <>
      {!props.compact && usage?.inputTokens !== undefined ? (
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
      {!props.compact && usage?.outputTokens !== undefined ? (
        <UsageStat
          icon={ArrowUpIcon}
          label={`Output tokens · ${exact(usage.outputTokens)}`}
          value={formatSubagentTokenCount(usage.outputTokens)}
        />
      ) : null}
      {!props.compact && usage?.reasoningOutputTokens !== undefined ? (
        <UsageStat
          icon={BrainIcon}
          label={`Reasoning tokens · ${exact(usage.reasoningOutputTokens)}`}
          value={formatSubagentTokenCount(usage.reasoningOutputTokens)}
        />
      ) : null}
    </>
  );
  return (
    <footer className="flex items-center justify-between gap-3 border-t border-border/60 px-3 py-1.5 font-mono text-2xs tabular-nums text-muted-foreground">
      <span className="flex min-w-0 items-center gap-3 overflow-hidden">
        {props.leading ?? stats}
      </span>
      <span className="flex shrink-0 items-center gap-3">
        {props.leading ? stats : null}
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
      </span>
    </footer>
  );
}

/** One agent's usage footer: its own usage plus runs and attempts. */
export function AgentUsageFooter({ agent }: { agent: RuntimeSubagent }) {
  const extra: Array<readonly [string, string]> = [];
  if (agent.activationCount > 1) extra.push(["Runs", String(agent.activationCount)]);
  if (agent.attempt !== null && agent.attempt > 1) extra.push(["Attempt", String(agent.attempt)]);
  return <UsageFooter usage={agent.usage} extra={extra} />;
}
