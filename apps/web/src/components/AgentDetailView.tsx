/**
 * One agent, in full: identity, launch prompt, outcome, and its activity —
 * either the tool calls the thread recorded for it, or (on request) the
 * provider's own transcript — with search, filters and sort. Usage sits in a
 * footer. The transcript is fetched only when asked for and never streams.
 */
import {
  applySubagentToolLogView,
  applySubagentTranscriptView,
  DEFAULT_SUBAGENT_TOOL_LOG_VIEW,
  DEFAULT_SUBAGENT_TRANSCRIPT_VIEW,
  deriveSubagentToolLog,
  subagentToolCallText,
  subagentTranscriptKindFilterFor,
  subagentTranscriptToolKind,
  type SubagentToolKind,
  type SubagentToolLogEntry,
  type SubagentToolLogSort,
  type SubagentToolLogView,
  type SubagentTranscriptKindFilter,
  type SubagentTranscriptView,
} from "@t3tools/client-runtime/state/agentPanelView";
import {
  formatSubagentModelLabel,
  formatSubagentTokenCount,
  isActiveSubagentStatus,
  type RuntimeSubagent,
} from "@t3tools/client-runtime/state/subagentRuntime";
import type {
  EnvironmentId,
  OrchestrationThreadActivity,
  SubagentTranscriptEntry,
  ThreadId,
} from "@t3tools/contracts";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import {
  ArrowDownIcon,
  ArrowDownUpIcon,
  ArrowUpIcon,
  BrainIcon,
  ChevronDownIcon,
  ChevronLeft,
  ChevronRightIcon,
  DatabaseIcon,
  EyeIcon,
  GlobeIcon,
  ListFilterIcon,
  MessageCircleIcon,
  RefreshCw,
  SearchIcon,
  SquarePenIcon,
  TerminalIcon,
  UserIcon,
  WrenchIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import {
  memo,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { useClientSettings } from "~/hooks/useSettings";
import { cn } from "~/lib/utils";
import { orchestrationEnvironment } from "~/state/orchestration";
import { useEnvironmentQuery } from "~/state/query";
import { formatSecondsTimestamp } from "~/timestampFormat";

import { AgentElapsed, elapsedBetween, STATUS_VISUALS, StatusDot } from "./AgentStatus";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
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
} from "./ui/menu";
import { PreviewCard, PreviewCardPopup, PreviewCardTrigger } from "./ui/preview-card";
import { ScrollArea } from "./ui/scroll-area";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

function Section(props: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="px-0.5 text-3xs font-medium uppercase tracking-wider text-muted-foreground">
        {props.title}
      </h3>
      {props.children}
    </section>
  );
}

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

/** Text clamped to a few lines, with a toggle only when it actually overflows. */
function ClampedText(props: { text: string; lines: 3 | 4; tone?: "default" | "error" }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);
  // Re-measured on resize: the panel width and the text both change the clamp.
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || open) return;
    const measure = () => setOverflows(node.scrollHeight > node.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [open]);
  return (
    <div className="flex flex-col items-start gap-0.5 px-0.5">
      <p
        ref={ref}
        className={cn(
          "whitespace-pre-wrap break-words text-xs leading-relaxed",
          props.tone === "error" ? "text-destructive-foreground" : "text-foreground/85",
          !open && (props.lines === 3 ? "line-clamp-3" : "line-clamp-4"),
        )}
      >
        {props.text}
      </p>
      {overflows || open ? (
        <button
          type="button"
          className="text-2xs text-muted-foreground hover:text-foreground"
          onClick={() => setOpen(!open)}
        >
          {open ? "Show less" : "Show all"}
        </button>
      ) : null}
    </div>
  );
}

const TOOL_KIND_ICONS: Record<SubagentToolKind, LucideIcon> = {
  command: TerminalIcon,
  read: EyeIcon,
  edit: SquarePenIcon,
  search: SearchIcon,
  web: GlobeIcon,
  other: WrenchIcon,
};

const TOOL_KIND_LABELS: Record<SubagentToolKind, string> = {
  command: "Commands",
  read: "Reads",
  edit: "Edits",
  search: "Searches",
  web: "Web",
  other: "Other",
};

const TOOL_STATUS_LABELS: Record<SubagentToolLogEntry["status"], string> = {
  running: "Running",
  completed: "Completed",
  failed: "Failed",
};

const TOOL_SORT_LABELS: Record<SubagentToolLogSort, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  duration: "Longest first",
};

const TRANSCRIPT_KIND_LABELS: Record<SubagentTranscriptKindFilter, string> = {
  message: "Messages",
  reasoning: "Thinking",
  tool: "Tool calls",
};

const TRANSCRIPT_SORT_LABELS: Record<SubagentTranscriptView["sort"], string> = {
  oldest: "Oldest first",
  newest: "Newest first",
};

function rowKeyToggle(toggle: () => void) {
  return (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggle();
    }
  };
}

/**
 * One call, shaped like the chat's tool row. Hovering previews the whole
 * call; clicking pins it open inline.
 */
const CallRow = memo(function CallRow(props: {
  icon: LucideIcon;
  title: string;
  detail: string | null;
  status: SubagentToolLogEntry["status"];
  time: string | null;
  duration: string | null;
  body: string;
  meta: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const Icon = props.icon;
  const failed = props.status === "failed";
  const toggle = () => setExpanded(!expanded);
  const line = (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      aria-label={failed ? `${props.title}, failed` : props.title}
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
          props.detail ? "shrink-0 max-w-[60%]" : "flex-1",
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
          <PreviewCardTrigger render={line} delay={350} closeDelay={80} />
          <PreviewCardPopup side="left" align="start" className="w-md max-w-[calc(100vw-2rem)]">
            <div className="flex flex-col gap-1.5 p-3">
              <p className="flex items-center gap-1.5 text-xs text-secondary-label">
                <Icon aria-hidden className="size-3.5 text-icon-muted" />
                {props.title}
              </p>
              <pre className="max-h-[50vh] overflow-hidden whitespace-pre-wrap break-words font-mono text-2xs leading-relaxed">
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

/** Prompt, agent and thinking text in the transcript: clamped, click to open. */
const MessageRow = memo(function MessageRow(props: {
  entry: SubagentTranscriptEntry;
  time: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const { entry } = props;
  const Icon =
    entry.kind === "reasoning" ? BrainIcon : entry.kind === "user" ? UserIcon : MessageCircleIcon;
  const toggle = () => setExpanded(!expanded);
  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={toggle}
        onKeyDown={rowKeyToggle(toggle)}
        className="flex cursor-pointer items-start gap-1.5 rounded-md px-0.5 py-0.5 hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
      >
        <span className="flex size-5 shrink-0 items-center justify-center text-icon-muted">
          <Icon aria-hidden className="size-3.5" />
        </span>
        <p
          className={cn(
            "min-w-0 flex-1 whitespace-pre-wrap break-words text-xs leading-relaxed",
            entry.kind === "reasoning" ? "italic text-muted-foreground" : "text-foreground/85",
            expanded ? "select-text" : "line-clamp-3",
          )}
        >
          {entry.text}
        </p>
        {props.time ? (
          <span className="shrink-0 ps-1 pt-px font-mono text-2xs tabular-nums text-muted-foreground">
            {props.time}
          </span>
        ) : null}
        <ChevronRightIcon
          aria-hidden
          className={cn(
            "mt-1 size-3 shrink-0 text-icon-muted opacity-70 transition-transform duration-200",
            expanded && "rotate-90",
          )}
        />
      </div>
    </li>
  );
});

function durationLabel(entry: SubagentToolLogEntry): string {
  return entry.completedAt ? elapsedBetween(entry.startedAt, entry.completedAt) : "…";
}

function ToolLogList(props: {
  entries: ReadonlyArray<SubagentToolLogEntry>;
  timestampFormat: TimestampFormat;
}) {
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
            body={subagentToolCallText(entry)}
            meta={[time, TOOL_STATUS_LABELS[entry.status].toLowerCase(), duration].join(" · ")}
          />
        );
      })}
    </ol>
  );
}

function TranscriptList(props: {
  rows: ReturnType<typeof applySubagentTranscriptView>;
  timestampFormat: TimestampFormat;
}) {
  return (
    <ol className="flex flex-col gap-px">
      {props.rows.map(({ index, entry }) => {
        const time = entry.at ? formatSecondsTimestamp(entry.at, props.timestampFormat) : null;
        if (entry.kind !== "tool") {
          return <MessageRow key={index} entry={entry} time={time} />;
        }
        const status = entry.status ?? "completed";
        return (
          <CallRow
            key={index}
            icon={TOOL_KIND_ICONS[subagentTranscriptToolKind(entry.toolName)]}
            title={entry.text}
            detail={entry.input ?? null}
            status={status}
            time={time}
            duration={null}
            body={[entry.input, entry.output].filter(Boolean).join("\n\n") || entry.text}
            meta={[entry.toolName, time, TOOL_STATUS_LABELS[status].toLowerCase()]
              .filter(Boolean)
              .join(" · ")}
          />
        );
      })}
    </ol>
  );
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

function countBy<T, K>(items: ReadonlyArray<T>, key: (item: T) => K): Map<K, number> {
  const counts = new Map<K, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return counts;
}

function SortMenu<S extends string>(props: {
  labels: Record<S, string>;
  value: S;
  isDefault: boolean;
  onChange: (sort: S) => void;
}) {
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            type="button"
            size="icon-micro"
            variant={props.isDefault ? "ghost-muted" : "ghost"}
            aria-label={`Sort: ${props.labels[props.value]}`}
          />
        }
      >
        <ArrowDownUpIcon />
      </MenuTrigger>
      <MenuPopup align="end">
        <MenuRadioGroup value={props.value} onValueChange={(sort: S) => props.onChange(sort)}>
          {(Object.keys(props.labels) as S[]).map((sort) => (
            <MenuRadioItem key={sort} value={sort}>
              {props.labels[sort]}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
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
            aria-label="Filter"
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

type ActivityMode = "tools" | "transcript";

function ActivitySection(props: {
  agent: RuntimeSubagent;
  activities: ReadonlyArray<OrchestrationThreadActivity>;
  environmentId: EnvironmentId | null;
  threadId: ThreadId | null;
  timestampFormat: TimestampFormat;
}) {
  const { agent } = props;
  const [mode, setMode] = useState<ActivityMode>("tools");
  const [toolView, setToolView] = useState<SubagentToolLogView>(DEFAULT_SUBAGENT_TOOL_LOG_VIEW);
  const [transcriptView, setTranscriptView] = useState<SubagentTranscriptView>(
    DEFAULT_SUBAGENT_TRANSCRIPT_VIEW,
  );
  const [searchOpen, setSearchOpen] = useState(false);
  // Sticky once asked for, so switching back and forth does not refetch.
  const [transcriptRequested, setTranscriptRequested] = useState(false);
  const canLoadTranscript = props.environmentId !== null && props.threadId !== null;

  const toolLog = useMemo(
    () => deriveSubagentToolLog(props.activities, agent.id),
    [props.activities, agent.id],
  );
  const toolStatusCounts = useMemo(() => countBy(toolLog, (entry) => entry.status), [toolLog]);
  const toolKindCounts = useMemo(() => countBy(toolLog, (entry) => entry.kind), [toolLog]);
  const visibleTools = useMemo(
    () => applySubagentToolLogView(toolLog, toolView),
    [toolLog, toolView],
  );
  const transcriptQuery = useEnvironmentQuery(
    transcriptRequested && props.environmentId && props.threadId
      ? orchestrationEnvironment.subagentTranscript({
          environmentId: props.environmentId,
          input: { threadId: props.threadId, taskId: agent.id },
        })
      : null,
  );
  const transcriptEntries = transcriptQuery.data?.entries;
  const visibleTranscript = useMemo(
    () => applySubagentTranscriptView(transcriptEntries ?? [], transcriptView),
    [transcriptEntries, transcriptView],
  );

  const tools = mode === "tools";
  const query = tools ? toolView.query : transcriptView.query;
  const setQuery = (value: string) =>
    tools
      ? setToolView({ ...toolView, query: value })
      : setTranscriptView({ ...transcriptView, query: value });
  const activeFilters = tools
    ? toolView.statuses.length + toolView.kinds.length
    : transcriptView.kinds.length;
  const customised =
    query.length > 0 ||
    activeFilters > 0 ||
    (tools
      ? toolView.sort !== DEFAULT_SUBAGENT_TOOL_LOG_VIEW.sort
      : transcriptView.sort !== DEFAULT_SUBAGENT_TRANSCRIPT_VIEW.sort);
  const total = tools ? toolLog.length : (transcriptEntries?.length ?? 0);
  const shown = tools ? visibleTools.length : visibleTranscript.length;
  const narrowed = query.trim().length > 0 || activeFilters > 0;

  const closeSearch = () => {
    setQuery("");
    setSearchOpen(false);
  };
  const reset = () => {
    if (tools) setToolView(DEFAULT_SUBAGENT_TOOL_LOG_VIEW);
    else setTranscriptView(DEFAULT_SUBAGENT_TRANSCRIPT_VIEW);
    setSearchOpen(false);
  };
  const switchMode = (next: ActivityMode) => {
    if (next === "transcript") setTranscriptRequested(true);
    setMode(next);
  };

  let body: ReactNode;
  if (tools) {
    body =
      toolLog.length === 0 ? (
        agent.recentActivity.length > 0 ? (
          <ol className="flex flex-col px-1">
            {agent.recentActivity.map((entry) => (
              <li key={`${entry.at}:${entry.summary}`} className="truncate text-xs">
                {entry.summary}
              </li>
            ))}
          </ol>
        ) : (
          <p className="px-0.5 text-xs text-muted-foreground">
            This provider did not report the agent's tool calls.
          </p>
        )
      ) : visibleTools.length === 0 ? (
        <p className="px-0.5 text-xs text-muted-foreground">No tool calls match.</p>
      ) : (
        <ToolLogList entries={visibleTools} timestampFormat={props.timestampFormat} />
      );
  } else if (transcriptQuery.data) {
    body =
      transcriptQuery.data.entries.length === 0 ? (
        <p className="px-0.5 text-xs text-muted-foreground">The transcript is empty.</p>
      ) : (
        <>
          {transcriptQuery.data.truncated ? (
            <p className="px-0.5 pb-1 text-2xs text-muted-foreground">
              Showing the latest entries.
            </p>
          ) : null}
          {visibleTranscript.length === 0 ? (
            <p className="px-0.5 text-xs text-muted-foreground">
              Nothing in the transcript matches.
            </p>
          ) : (
            <TranscriptList rows={visibleTranscript} timestampFormat={props.timestampFormat} />
          )}
        </>
      );
  } else {
    body = (
      <p className="px-0.5 text-xs text-muted-foreground">
        {transcriptQuery.error ?? "Loading transcript…"}
      </p>
    );
  }

  return (
    <section className="flex flex-col">
      <div className="sticky top-0 z-10 -mx-0.5 flex flex-col bg-background px-0.5 pb-1">
        <div className="flex items-center gap-0.5">
          {canLoadTranscript ? (
            <Menu>
              <MenuTrigger
                render={
                  <button
                    type="button"
                    aria-label="Switch between tool calls and transcript"
                    className="-ms-0.5 me-auto flex h-5 items-center gap-1 rounded-sm px-0.5 text-3xs font-medium uppercase tracking-wider text-muted-foreground hover:bg-accent hover:text-foreground"
                  />
                }
              >
                {tools ? "Tool calls" : "Transcript"}
                {total > 0 ? <span className="font-mono tracking-normal">· {total}</span> : null}
                <ChevronDownIcon aria-hidden className="size-3" />
              </MenuTrigger>
              <MenuPopup align="start">
                <MenuRadioGroup
                  value={mode}
                  onValueChange={(next: ActivityMode) => switchMode(next)}
                >
                  <MenuRadioItem value="tools">Tool calls</MenuRadioItem>
                  <MenuRadioItem value="transcript">Transcript</MenuRadioItem>
                </MenuRadioGroup>
              </MenuPopup>
            </Menu>
          ) : (
            <h3 className="me-auto px-0.5 text-3xs font-medium uppercase tracking-wider text-muted-foreground">
              Tool calls
              {total > 0 ? <span className="font-mono tracking-normal"> · {total}</span> : null}
            </h3>
          )}
          {!tools ? (
            <Button
              size="icon-micro"
              variant="ghost-muted"
              aria-label="Refresh transcript"
              disabled={transcriptQuery.isPending}
              onClick={transcriptQuery.refresh}
            >
              <RefreshCw aria-hidden />
            </Button>
          ) : null}
          <Button
            size="icon-micro"
            variant={searchOpen ? "ghost" : "ghost-muted"}
            aria-label={tools ? "Search tool calls" : "Search transcript"}
            aria-pressed={searchOpen}
            onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
          >
            <SearchIcon aria-hidden />
          </Button>
          <FilterMenu activeCount={activeFilters}>
            {tools ? (
              <>
                <CheckboxGroup
                  label="Status"
                  labels={TOOL_STATUS_LABELS}
                  selected={toolView.statuses}
                  counts={toolStatusCounts}
                  onChange={(statuses) => setToolView({ ...toolView, statuses })}
                />
                <MenuSeparator />
                <CheckboxGroup
                  label="Tool"
                  labels={TOOL_KIND_LABELS}
                  selected={toolView.kinds}
                  counts={toolKindCounts}
                  onChange={(kinds) => setToolView({ ...toolView, kinds })}
                />
              </>
            ) : (
              <CheckboxGroup
                label="Show"
                labels={TRANSCRIPT_KIND_LABELS}
                selected={transcriptView.kinds}
                counts={countBy(transcriptEntries ?? [], subagentTranscriptKindFilterFor)}
                onChange={(kinds) => setTranscriptView({ ...transcriptView, kinds })}
              />
            )}
          </FilterMenu>
          {tools ? (
            <SortMenu
              labels={TOOL_SORT_LABELS}
              value={toolView.sort}
              isDefault={toolView.sort === DEFAULT_SUBAGENT_TOOL_LOG_VIEW.sort}
              onChange={(sort) => setToolView({ ...toolView, sort })}
            />
          ) : (
            <SortMenu
              labels={TRANSCRIPT_SORT_LABELS}
              value={transcriptView.sort}
              isDefault={transcriptView.sort === DEFAULT_SUBAGENT_TRANSCRIPT_VIEW.sort}
              onChange={(sort) => setTranscriptView({ ...transcriptView, sort })}
            />
          )}
          {customised ? (
            <Button size="icon-micro" variant="ghost-muted" aria-label="Reset view" onClick={reset}>
              <XIcon aria-hidden />
            </Button>
          ) : null}
        </div>
        {searchOpen ? (
          <Input
            size="compact"
            type="search"
            autoFocus
            value={query}
            placeholder={tools ? "Search tool calls" : "Search transcript"}
            aria-label={tools ? "Search tool calls" : "Search transcript"}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") closeSearch();
            }}
            className="mt-1"
          />
        ) : null}
      </div>
      {body}
      {narrowed && shown > 0 ? (
        <p className="px-0.5 pt-1.5 text-2xs text-muted-foreground">
          Showing {shown} of {total}
        </p>
      ) : null}
    </section>
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

/** Token usage as icon + number; each label lives in its tooltip. */
function UsageFooter({ agent }: { agent: RuntimeSubagent }) {
  const usage = agent.usage;
  const breakdown: Array<[string, string]> = [];
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
  if (agent.activationCount > 1) breakdown.push(["Runs", String(agent.activationCount)]);
  if (agent.attempt !== null && agent.attempt > 1)
    breakdown.push(["Attempt", String(agent.attempt)]);
  if (!usage && breakdown.length === 0) return null;

  const cachedShare =
    usage?.cachedInputTokens !== undefined && usage.inputTokens
      ? Math.round((usage.cachedInputTokens / usage.inputTokens) * 100)
      : null;
  const exact = (value: number) => value.toLocaleString();
  return (
    <footer className="flex items-center justify-between gap-3 border-t border-border/60 px-3 py-1.5 font-mono text-2xs tabular-nums text-muted-foreground">
      <span className="flex min-w-0 items-center gap-3 overflow-hidden">
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
      </span>
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
    </footer>
  );
}

export function AgentDetailView(props: {
  agent: RuntimeSubagent;
  activities: ReadonlyArray<OrchestrationThreadActivity>;
  environmentId: EnvironmentId | null;
  threadId: ThreadId | null;
  onBack: () => void;
}) {
  const { agent } = props;
  const { timestampFormat } = useClientSettings();
  const live = isActiveSubagentStatus(agent.status);
  const identity = [
    STATUS_VISUALS[agent.status].label,
    agent.role,
    formatSubagentModelLabel(agent.model, agent.effort),
    agent.phaseTitle ? `phase ${agent.phaseTitle}` : null,
  ].filter((value): value is string => value !== null);
  const outcome = agent.error ?? (live ? null : agent.result);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-col gap-1 border-b border-border/60 px-2 py-1.5">
        <div className="flex items-center gap-1">
          <Button size="xs" variant="ghost-muted" onClick={props.onBack}>
            <ChevronLeft aria-hidden />
            Agents
          </Button>
          <span className="ml-auto pr-1 font-mono text-2xs text-muted-foreground/80">
            <AgentElapsed agent={agent} />
          </span>
        </div>
        <div className="flex min-w-0 items-center gap-2 px-1">
          <StatusDot status={agent.status} />
          <h2 className="min-w-0 truncate text-sm font-medium">{agent.title}</h2>
        </div>
        <p className="truncate px-1 font-mono text-2xs text-muted-foreground">
          {identity.join(" · ")}
        </p>
      </header>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-3.5 p-2">
          {live && agent.progress ? (
            <Section title="Now">
              <p className="px-0.5 text-xs text-muted-foreground">{agent.progress}</p>
            </Section>
          ) : null}
          {agent.prompt ? (
            <Section title="Prompt">
              <ClampedText text={agent.prompt} lines={4} />
            </Section>
          ) : null}
          {outcome ? (
            <Section title={agent.error ? "Error" : "Result"}>
              <ClampedText text={outcome} lines={4} tone={agent.error ? "error" : "default"} />
            </Section>
          ) : null}
          <ActivitySection
            agent={agent}
            activities={props.activities}
            environmentId={props.environmentId}
            threadId={props.threadId}
            timestampFormat={timestampFormat}
          />
          {agent.outputFile || agent.runHandles?.sessionUrl ? (
            <Section title="Artifacts">
              {agent.outputFile ? (
                <p className="break-all px-0.5 font-mono text-2xs text-muted-foreground">
                  {agent.outputFile}
                </p>
              ) : null}
              {agent.runHandles?.sessionUrl ? (
                <a
                  href={agent.runHandles.sessionUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="px-0.5 text-xs text-info-foreground hover:underline"
                >
                  Open remote session
                </a>
              ) : null}
            </Section>
          ) : null}
        </div>
      </ScrollArea>
      <UsageFooter agent={agent} />
    </div>
  );
}
