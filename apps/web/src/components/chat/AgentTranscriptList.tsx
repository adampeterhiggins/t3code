/**
 * Fork: an agent's compact transcript in the sidebar (see `agentTranscript.ts`). Rows use the
 * chat's work-log geometry; an expanded tool call or thought shows the chat's `V2ItemInspector`,
 * which fetches withheld output and edit diffs while open. The list is virtualized and follows the
 * newest activity only while it is scrolled to the end.
 */
import { LegendList, type MaintainScrollAtEndOptions } from "@legendapp/list/react";
import type {
  EnvironmentId,
  OrchestrationV2ProjectedTurnItem,
  RunId,
  ScopedThreadRef,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import {
  BrainIcon,
  ChevronRightIcon,
  InfoIcon,
  TriangleAlertIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import { createContext, memo, use, useCallback, useMemo, useState, type ReactElement } from "react";

import { cn } from "~/lib/utils";

import { elapsedBetween } from "../AgentStatus";
import ChatMarkdown from "../ChatMarkdown";
import { TOOL_KIND_ICONS } from "./agentToolKinds";
import type { AgentTranscriptRow } from "./agentTranscript";
import { shouldPreserveAssistantLineBreaks } from "./MessagesTimeline.logic";
import { V2ItemInspector } from "./V2ItemInspector";
import { WorkLogDetails, WorkLogRow } from "./WorkLog";

interface AgentTranscriptContextValue {
  readonly environmentId: EnvironmentId;
  readonly childRef: ScopedThreadRef;
  readonly workspaceRoot: string | undefined;
  readonly expanded: ReadonlySet<string>;
  readonly toggle: (id: string) => void;
  readonly onOpenAgent: (childThreadId: ThreadId) => void;
  readonly onOpenThread: (threadId: ThreadId) => void;
  readonly onOpenTurnDiff: (runId: RunId, filePath?: string) => void;
}

const AgentTranscriptContext = createContext<AgentTranscriptContextValue | null>(null);

function useTranscriptContext(): AgentTranscriptContextValue {
  const context = use(AgentTranscriptContext);
  if (context === null) throw new Error("AgentTranscript rows need AgentTranscriptList.");
  return context;
}

const rowIcon = (Icon: LucideIcon, className?: string) => (
  <Icon aria-hidden className={cn("size-3.5 text-icon-muted", className)} />
);

const chevron = (expanded: boolean) => (
  <ChevronRightIcon
    aria-hidden
    className={cn(
      "size-3 shrink-0 text-icon-muted opacity-70 transition-transform duration-200",
      expanded && "rotate-90",
    )}
  />
);

/** Keyboard activation for the div-based disclosure rows. */
function toggleKeys(toggle: () => void) {
  return (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggle();
    }
  };
}

function Inspector(props: { projectedItem: OrchestrationV2ProjectedTurnItem }) {
  const context = useTranscriptContext();
  return (
    <WorkLogDetails>
      <V2ItemInspector
        projectedItem={props.projectedItem}
        environmentId={context.environmentId}
        cwd={context.workspaceRoot}
        workspaceRoot={context.workspaceRoot}
        onOpenThread={context.onOpenThread}
        onOpenTurnDiff={context.onOpenTurnDiff}
      />
    </WorkLogDetails>
  );
}

function toolDuration(row: Extract<AgentTranscriptRow, { kind: "tool" }>): string {
  if (row.status === "running") return "…";
  const item = row.entry.projectedItem?.item;
  if (!item?.startedAt || !item.completedAt) return "";
  return elapsedBetween(DateTime.formatIso(item.startedAt), DateTime.formatIso(item.completedAt));
}

function ToolRow({ row }: { row: Extract<AgentTranscriptRow, { kind: "tool" }> }) {
  const context = useTranscriptContext();
  const expanded = context.expanded.has(row.id);
  const projectedItem = row.entry.projectedItem;
  const toggle = () => context.toggle(row.id);
  const failed = row.status === "failed";
  return (
    <WorkLogRow
      aria-label={failed ? `${row.label}, failed` : row.label}
      {...(projectedItem
        ? {
            role: "button",
            tabIndex: 0,
            "aria-expanded": expanded,
            onClick: toggle,
            onKeyDown: toggleKeys(toggle),
          }
        : {})}
      icon={rowIcon(TOOL_KIND_ICONS[row.toolKind])}
      label={
        <span
          className={cn(
            "text-xs",
            row.status === "running" && "text-foreground",
            row.status === "stopped" && "text-muted-foreground",
          )}
        >
          {row.label}
        </span>
      }
      trailing={
        <span className="flex shrink-0 items-center gap-1">
          {failed ? <XIcon aria-hidden className="size-3 text-destructive" /> : null}
          <span className="min-w-8 text-right font-mono text-2xs tabular-nums text-muted-foreground/70">
            {toolDuration(row)}
          </span>
          {projectedItem ? chevron(expanded) : null}
        </span>
      }
    >
      {expanded && projectedItem ? <Inspector projectedItem={projectedItem} /> : null}
    </WorkLogRow>
  );
}

function ReasoningRow({ row }: { row: Extract<AgentTranscriptRow, { kind: "reasoning" }> }) {
  const context = useTranscriptContext();
  const expanded = context.expanded.has(row.id);
  const toggle = () => context.toggle(row.id);
  return (
    <WorkLogRow
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      onClick={toggle}
      onKeyDown={toggleKeys(toggle)}
      icon={rowIcon(BrainIcon)}
      label={<span className="text-xs italic">{row.text.replace(/\s+/g, " ")}</span>}
      trailing={chevron(expanded)}
    >
      {expanded ? (
        row.projectedItem ? (
          <Inspector projectedItem={row.projectedItem} />
        ) : (
          <WorkLogDetails>
            <p className="whitespace-pre-wrap text-xs italic text-muted-foreground">{row.text}</p>
          </WorkLogDetails>
        )
      ) : null}
    </WorkLogRow>
  );
}

function NoticeRow({ row }: { row: Extract<AgentTranscriptRow, { kind: "notice" }> }) {
  const context = useTranscriptContext();
  const expanded = context.expanded.has(row.id);
  const { childThreadId } = row;
  const icon = rowIcon(
    row.tone === "error" ? TriangleAlertIcon : InfoIcon,
    row.tone === "error" ? "text-destructive" : undefined,
  );
  const label = (
    <span className={cn("text-xs", row.tone === "error" && "text-destructive-foreground")}>
      {row.label}
    </span>
  );
  if (childThreadId !== null) {
    const open = () => context.onOpenAgent(childThreadId);
    return (
      <WorkLogRow
        role="button"
        tabIndex={0}
        onClick={open}
        onKeyDown={toggleKeys(open)}
        icon={icon}
        label={label}
        trailing={<ChevronRightIcon aria-hidden className="size-3 shrink-0 text-icon-muted" />}
      />
    );
  }
  if (row.detail === null) return <WorkLogRow icon={icon} label={label} />;
  const toggle = () => context.toggle(row.id);
  return (
    <WorkLogRow
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      onClick={toggle}
      onKeyDown={toggleKeys(toggle)}
      icon={icon}
      label={label}
      trailing={chevron(expanded)}
    >
      {expanded ? (
        <WorkLogDetails>
          <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">
            {row.detail}
          </p>
        </WorkLogDetails>
      ) : null}
    </WorkLogRow>
  );
}

const MESSAGE_HEADINGS = { assistant: "Agent", user: "Message", plan: "Plan" } as const;

function MessageRow({ row }: { row: Extract<AgentTranscriptRow, { kind: "message" }> }) {
  const context = useTranscriptContext();
  return (
    <div className="flex min-w-0 flex-col gap-0.5 px-0.5 py-1.5">
      <span className="text-3xs font-medium uppercase tracking-wider text-muted-foreground">
        {MESSAGE_HEADINGS[row.role]}
      </span>
      {row.role === "user" ? (
        <p className="select-text whitespace-pre-wrap break-words text-xs text-foreground/85">
          {row.text}
        </p>
      ) : (
        <ChatMarkdown
          text={row.text}
          cwd={context.workspaceRoot}
          threadRef={context.childRef}
          isStreaming={row.streaming}
          lineBreaks={shouldPreserveAssistantLineBreaks(row.text)}
          className="text-xs"
        />
      )}
    </div>
  );
}

const TranscriptRow = memo(function TranscriptRow({ row }: { row: AgentTranscriptRow }) {
  switch (row.kind) {
    case "message":
      return <MessageRow row={row} />;
    case "reasoning":
      return <ReasoningRow row={row} />;
    case "tool":
      return <ToolRow row={row} />;
    case "notice":
      return <NoticeRow row={row} />;
  }
});

// Follow the newest activity while scrolled to the end; reading history stays put.
const FOLLOW_NEWEST = {
  animated: false,
  on: { dataChange: true, itemLayout: true, layout: true },
} as const satisfies MaintainScrollAtEndOptions;

const renderRow = ({ item }: { item: AgentTranscriptRow }) => (
  <div className="px-2">
    <TranscriptRow row={item} />
  </div>
);

export function AgentTranscriptList(props: {
  readonly rows: ReadonlyArray<AgentTranscriptRow>;
  readonly environmentId: EnvironmentId;
  readonly childRef: ScopedThreadRef;
  readonly workspaceRoot: string | undefined;
  readonly onOpenAgent: (childThreadId: ThreadId) => void;
  readonly onOpenThread: (threadId: ThreadId) => void;
  readonly onOpenTurnDiff: (runId: RunId, filePath?: string) => void;
  /** Opens at the newest activity rather than the start, for an agent still working. */
  readonly startAtEnd: boolean;
  /** Above the first row, such as the control that loads earlier activity. */
  readonly header?: ReactElement | null;
}) {
  // Kept here rather than in the rows, which unmount when scrolled out of view.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = useCallback(
    (id: string) =>
      setExpanded((current) => {
        const next = new Set(current);
        if (!next.delete(id)) next.add(id);
        return next;
      }),
    [],
  );
  const { environmentId, childRef, workspaceRoot, onOpenAgent, onOpenThread, onOpenTurnDiff } =
    props;
  const context = useMemo(
    () => ({
      environmentId,
      childRef,
      workspaceRoot,
      expanded,
      toggle,
      onOpenAgent,
      onOpenThread,
      onOpenTurnDiff,
    }),
    [
      childRef,
      environmentId,
      expanded,
      onOpenAgent,
      onOpenThread,
      onOpenTurnDiff,
      toggle,
      workspaceRoot,
    ],
  );
  return (
    <AgentTranscriptContext value={context}>
      <LegendList<AgentTranscriptRow>
        data={props.rows}
        keyExtractor={(row) => row.id}
        getItemType={(row) => row.kind}
        renderItem={renderRow}
        estimatedItemSize={28}
        initialScrollAtEnd={props.startAtEnd}
        maintainScrollAtEnd={FOLLOW_NEWEST}
        ListHeaderComponent={props.header ?? null}
        ListFooterComponent={<div className="h-2" />}
        className="h-full min-h-0 overflow-x-hidden overscroll-y-contain [overflow-anchor:none]"
      />
    </AgentTranscriptContext>
  );
}
