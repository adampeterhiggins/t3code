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
  subagentTranscriptKindFilterFor,
  subagentTranscriptToolKind,
  type SubagentToolKind,
  type SubagentToolLogSort,
  type SubagentToolLogView,
  type SubagentTranscriptKindFilter,
  type SubagentTranscriptView,
} from "@t3tools/client-runtime/state/agentPanelView";
import {
  formatSubagentModelLabel,
  isActiveSubagentStatus,
  type RuntimeSubagent,
  type SubagentWorkspace,
} from "@t3tools/client-runtime/state/subagentRuntime";
import type {
  EnvironmentId,
  OrchestrationThreadActivity,
  SubagentTranscriptEntry,
  ThreadId,
} from "@t3tools/contracts";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import {
  ArrowDownUpIcon,
  BrainIcon,
  ChevronDownIcon,
  ChevronLeft,
  ChevronRightIcon,
  ListFilterIcon,
  MessageCircleIcon,
  SquareArrowOutUpRightIcon,
  RefreshCw,
  SearchIcon,
  UserIcon,
  XIcon,
} from "lucide-react";
import { memo, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useClientSettings } from "~/hooks/useSettings";
import { cn } from "~/lib/utils";
import { orchestrationEnvironment } from "~/state/orchestration";
import { useEnvironmentQuery } from "~/state/query";
import { formatSecondsTimestamp } from "~/timestampFormat";

import {
  AgentUsageFooter,
  CallRow,
  rowKeyToggle,
  TOOL_KIND_ICONS,
  TOOL_STATUS_LABELS,
  ToolLogList,
} from "./AgentActivityParts";
import { AgentElapsed, STATUS_VISUALS, StatusDot } from "./AgentStatus";
import { AgentWorkspaceLine } from "./AgentWorkspace";
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
import { ScrollArea } from "./ui/scroll-area";

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

const TOOL_KIND_LABELS: Record<SubagentToolKind, string> = {
  command: "Commands",
  read: "Reads",
  edit: "Edits",
  search: "Searches",
  web: "Web",
  other: "Other",
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
  initialToolCallId: string | null;
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
        <ToolLogList
          entries={visibleTools}
          timestampFormat={props.timestampFormat}
          expandedId={props.initialToolCallId}
        />
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

export function AgentDetailView(props: {
  agent: RuntimeSubagent;
  workspace: SubagentWorkspace | null;
  activities: ReadonlyArray<OrchestrationThreadActivity>;
  environmentId: EnvironmentId | null;
  threadId: ThreadId | null;
  /** Opens with this tool call expanded and in view (from the agent preview). */
  initialToolCallId?: string | null;
  onBack: () => void;
  onOpenInTab?: (() => void) | undefined;
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
          {props.onOpenInTab ? (
            <Button size="xs" variant="ghost-muted" onClick={props.onOpenInTab}>
              <SquareArrowOutUpRightIcon aria-hidden />
              Open in new tab
            </Button>
          ) : null}
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
        <AgentWorkspaceLine agent={agent} workspace={props.workspace} />
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
            initialToolCallId={props.initialToolCallId ?? null}
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
      <AgentUsageFooter agent={agent} />
    </div>
  );
}
