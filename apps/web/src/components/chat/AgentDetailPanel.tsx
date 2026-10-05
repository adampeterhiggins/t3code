/**
 * Fork: a subagent's agent tab, kept beside the parent chat. Identity, launch
 * prompt, outcome, its tool calls (from the agent's child thread, with search,
 * filters and sort), and a usage footer. The conversation itself is the child
 * thread, one click away.
 */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
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
import { projectedSubagentsToRuntime } from "@t3tools/client-runtime/state/subagentRuntime";
import type { ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowDownUpIcon,
  ListFilterIcon,
  MessageSquarePlusIcon,
  MessageSquareShareIcon,
  SquareArrowOutUpRightIcon,
  XIcon,
} from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useComposerHandleContext } from "~/composerHandleContext";
import { useClientSettings } from "~/hooks/useSettings";
import { cn } from "~/lib/utils";
import { useThreadProjection, useThreadShell } from "~/state/entities";
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
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { AgentUsageFooter, ToolCallList, type ToolCallSource } from "./AgentActivityParts";
import { TOOL_KIND_LABELS } from "./agentToolKinds";
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

function Section(props: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <div className="flex min-h-6 items-center justify-between gap-1">
        <h3 className="px-0.5 text-3xs font-medium uppercase tracking-wider text-muted-foreground">
          {props.title}
        </h3>
        {props.action}
      </div>
      {props.children}
    </section>
  );
}

/** Text clamped to a few lines, with a toggle only when it actually overflows. */
function ClampedText(props: { text: string; tone?: "default" | "error" }) {
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
          "select-text whitespace-pre-wrap break-words text-xs leading-relaxed",
          props.tone === "error" ? "text-destructive-foreground" : "text-foreground/85",
          !open && "line-clamp-4",
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

function ToolCallsSection(props: {
  calls: ReadonlyArray<SubagentToolCall>;
  loading: boolean;
  source: ToolCallSource;
}) {
  const { calls } = props;
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const [view, setView] = useState<SubagentToolCallView>(DEFAULT_SUBAGENT_TOOL_CALL_VIEW);
  const statusCounts = useMemo(() => countBy(calls, (call) => call.status), [calls]);
  const kindCounts = useMemo(() => countBy(calls, (call) => call.kind), [calls]);
  const visible = useMemo(() => applySubagentToolCallView(calls, view), [calls, view]);
  const activeFilters = view.statuses.length + view.kinds.length;
  const customised =
    view.query.length > 0 ||
    activeFilters > 0 ||
    view.sort !== DEFAULT_SUBAGENT_TOOL_CALL_VIEW.sort;
  return (
    <Section
      title={`Tool calls · ${calls.length}`}
      action={
        calls.length > 0 ? (
          <span className="flex items-center gap-0.5">
            <Menu>
              <MenuTrigger
                render={
                  <Button
                    type="button"
                    size={activeFilters > 0 ? "micro" : "icon-micro"}
                    variant={activeFilters > 0 ? "ghost" : "ghost-muted"}
                    aria-label="Filter tool calls"
                  />
                }
              >
                <ListFilterIcon />
                {activeFilters > 0 ? activeFilters : null}
              </MenuTrigger>
              <MenuPopup align="end">
                <CheckboxGroup
                  label="Status"
                  labels={TOOL_STATUS_LABELS}
                  selected={view.statuses}
                  counts={statusCounts}
                  onChange={(statuses) => setView({ ...view, statuses })}
                />
                <MenuSeparator />
                <CheckboxGroup<SubagentToolKind>
                  label="Kind"
                  labels={TOOL_KIND_LABELS}
                  selected={view.kinds}
                  counts={kindCounts}
                  onChange={(kinds) => setView({ ...view, kinds })}
                />
              </MenuPopup>
            </Menu>
            <Menu>
              <MenuTrigger
                render={
                  <Button
                    type="button"
                    size="icon-micro"
                    variant={
                      view.sort === DEFAULT_SUBAGENT_TOOL_CALL_VIEW.sort ? "ghost-muted" : "ghost"
                    }
                    aria-label={`Sort tool calls: ${TOOL_SORT_LABELS[view.sort]}`}
                  />
                }
              >
                <ArrowDownUpIcon />
              </MenuTrigger>
              <MenuPopup align="end">
                <MenuRadioGroup
                  value={view.sort}
                  onValueChange={(sort: SubagentToolCallSort) => setView({ ...view, sort })}
                >
                  {(Object.keys(TOOL_SORT_LABELS) as SubagentToolCallSort[]).map((sort) => (
                    <MenuRadioItem key={sort} value={sort}>
                      {TOOL_SORT_LABELS[sort]}
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
              </MenuPopup>
            </Menu>
            {customised ? (
              <Button
                type="button"
                size="icon-micro"
                variant="ghost-muted"
                aria-label="Reset tool call filters"
                onClick={() => setView(DEFAULT_SUBAGENT_TOOL_CALL_VIEW)}
              >
                <XIcon />
              </Button>
            ) : null}
          </span>
        ) : null
      }
    >
      {calls.length > 0 ? (
        <Input
          size="compact"
          type="search"
          value={view.query}
          placeholder="Search tool calls"
          aria-label="Search tool calls"
          onChange={(event) => setView({ ...view, query: event.target.value })}
        />
      ) : null}
      {visible.length > 0 ? (
        <ToolCallList calls={visible} timestampFormat={timestampFormat} source={props.source} />
      ) : (
        <p className="px-0.5 text-xs text-muted-foreground">
          {props.loading
            ? "Loading tool calls…"
            : calls.length > 0
              ? "No tool calls match these filters."
              : "No tool calls yet."}
        </p>
      )}
    </Section>
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

export function AgentDetailPanel(props: {
  /** The thread that spawned the agent; the tab lives in its right panel. */
  readonly parentRef: ScopedThreadRef;
  readonly childThreadId: ThreadId;
  /** The directory the agent's commands and paths are shown relative to. */
  readonly workspaceRoot: string | null;
}) {
  const navigate = useNavigate();
  const composerRef = useComposerHandleContext();
  const parent = useThreadProjection(props.parentRef)?.projection ?? null;
  const childRef = scopeThreadRef(props.parentRef.environmentId, props.childThreadId);
  const childShell = useThreadShell(childRef);
  const child = useThreadProjection(childRef)?.projection ?? null;
  const subagent =
    parent?.subagents.find((candidate) => candidate.childThreadId === props.childThreadId) ?? null;
  const runtime = useMemo(
    () => (subagent ? projectedSubagentsToRuntime([subagent])[0]! : null),
    [subagent],
  );
  const calls = useMemo(
    () =>
      child
        ? deriveSubagentToolCalls(
            child.turnItems.filter((item) => item.threadId === props.childThreadId),
            props.workspaceRoot,
          )
        : [],
    [child, props.childThreadId, props.workspaceRoot],
  );

  if (!subagent || !runtime) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-sm font-medium">Agent unavailable</p>
        <p className="max-w-64 text-xs text-muted-foreground">
          {parent === null
            ? "Loading this thread's agents…"
            : "This agent is no longer recorded on this thread."}
        </p>
      </div>
    );
  }

  const title = formatSubagentDisplayTitle(childShell?.title ?? runtime.title);
  const subject = subagentContextSubject(subagent, title);
  const openThread = () =>
    void navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(childRef) });
  const continueInChat = () => {
    const parentThread = parent?.thread;
    if (!parentThread) return;
    void continueAgentInChat({
      environmentId: props.parentRef.environmentId,
      parentThread,
      subagent,
      title,
      workspaceRoot: props.workspaceRoot,
      openTab: (tabRef) =>
        navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(tabRef) }),
    });
  };
  const outcome = subject.error ?? subject.result;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-col gap-0.5 border-b border-border/60 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <StatusDot status={runtime.status} />
          <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{title}</h2>
          <ActionButton label="Open agent thread" onClick={openThread}>
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
      </header>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 p-3">
          {subagent.progress && runtime.status === "running" ? (
            <Section title="Now">
              <p className="px-0.5 text-xs text-muted-foreground">{subagent.progress}</p>
            </Section>
          ) : null}
          {subject.prompt ? (
            <Section title="Prompt">
              <ClampedText text={subject.prompt} />
            </Section>
          ) : null}
          {outcome ? (
            <Section title={subject.error ? "Error" : "Result"}>
              <ClampedText text={outcome} tone={subject.error ? "error" : "default"} />
            </Section>
          ) : null}
          <ToolCallsSection
            calls={calls}
            loading={child === null}
            source={{
              environmentId: props.parentRef.environmentId,
              threadId: props.childThreadId,
              workspaceRoot: props.workspaceRoot,
            }}
          />
        </div>
      </ScrollArea>
      <AgentUsageFooter usage={subagent.usage ?? null} />
    </div>
  );
}
