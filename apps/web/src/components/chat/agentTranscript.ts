/**
 * Fork: an agent's compact transcript for the sidebar, read from the timeline
 * entries of its child thread (`deriveTimelineEntriesFromVisibleTurnItems`):
 * its messages, reasoning summaries, tool calls and notices, in thread order.
 */
import {
  subagentToolKindOfItem,
  type SubagentToolKind,
} from "@t3tools/client-runtime/state/agent-list-view";
import type { OrchestrationV2ProjectedTurnItem, ThreadId, TurnItemId } from "@t3tools/contracts";

import type { TimelineEntry, WorkLogEntry } from "../../session-logic";
import { workEntryDisplayLabel, workEntryIsVisibleInGroup } from "./MessagesTimeline.logic";

/** What the transcript's filter shows; notices and plans count as messages. */
export type AgentTranscriptKind = "message" | "reasoning" | "tool";

export type AgentTranscriptToolStatus = "running" | "completed" | "failed" | "stopped";

export type AgentTranscriptRow = (
  | {
      readonly kind: "message";
      readonly id: string;
      readonly role: "user" | "assistant" | "plan";
      readonly text: string;
      readonly streaming: boolean;
    }
  | {
      readonly kind: "reasoning";
      readonly id: string;
      readonly text: string;
      readonly projectedItem: OrchestrationV2ProjectedTurnItem | null;
    }
  | {
      readonly kind: "tool";
      readonly id: string;
      readonly label: string;
      readonly toolKind: SubagentToolKind;
      readonly status: AgentTranscriptToolStatus;
      readonly entry: WorkLogEntry;
    }
  | {
      readonly kind: "notice";
      readonly id: string;
      readonly label: string;
      readonly detail: string | null;
      readonly tone: "info" | "error";
      /** An agent this one started, to drill into. */
      readonly childThreadId: ThreadId | null;
      readonly projectedItem: OrchestrationV2ProjectedTurnItem | null;
    }
) & {
  /** When the entry happened (ISO), shown in the user's timestamp format. */
  readonly createdAt: string;
};

export interface AgentTranscriptView {
  readonly query: string;
  /** Empty means every kind. */
  readonly kinds: ReadonlyArray<AgentTranscriptKind>;
}

export const DEFAULT_AGENT_TRANSCRIPT_VIEW: AgentTranscriptView = { query: "", kinds: [] };

function toolStatus(entry: WorkLogEntry): AgentTranscriptToolStatus {
  switch (entry.toolLifecycleStatus) {
    case "inProgress":
      return "running";
    case "failed":
    case "declined":
      return "failed";
    case "stopped":
      return "stopped";
    default:
      return "completed";
  }
}

function workRow(
  entry: WorkLogEntry,
  createdAt: string,
  workspaceRoot: string | undefined,
): AgentTranscriptRow | null {
  if (!workEntryIsVisibleInGroup(entry, true)) return null;
  if (entry.itemType === "reasoning" || entry.tone === "thinking") {
    const text = entry.detail?.trim();
    return text
      ? {
          kind: "reasoning",
          id: entry.id,
          createdAt,
          text,
          projectedItem: entry.projectedItem ?? null,
        }
      : null;
  }
  // The child thread's creation is the agent itself starting.
  if (entry.itemType === "thread_created") return null;
  if (entry.tone === "tool") {
    const item = entry.structuredPayload;
    return {
      kind: "tool",
      id: entry.id,
      createdAt,
      label: workEntryDisplayLabel(entry, workspaceRoot),
      toolKind: (item ? subagentToolKindOfItem(item) : null) ?? "other",
      status: toolStatus(entry),
      entry,
    };
  }
  const detail = entry.detail?.trim() || null;
  return {
    kind: "notice",
    id: entry.id,
    createdAt,
    label: entry.label,
    detail: detail === entry.label ? null : detail,
    tone: entry.tone === "error" || entry.sourceActivityKind === "runtime.error" ? "error" : "info",
    childThreadId: null,
    projectedItem: entry.projectedItem ?? null,
  };
}

function eventRow(
  projectedItem: OrchestrationV2ProjectedTurnItem,
  createdAt: string,
): AgentTranscriptRow {
  const { item } = projectedItem;
  const title = item.title?.trim() || null;
  return {
    kind: "notice",
    id: item.id,
    createdAt,
    label:
      item.type === "subagent"
        ? `Started agent: ${title ?? (item.prompt.trim().split("\n")[0] || "Agent")}`
        : (title ?? item.type.replaceAll("_", " ")),
    detail: null,
    tone: "info",
    childThreadId: item.type === "subagent" ? item.childThreadId : null,
    projectedItem,
  };
}

function entryRow(
  entry: TimelineEntry,
  workspaceRoot: string | undefined,
): AgentTranscriptRow | null {
  switch (entry.kind) {
    case "message": {
      const { message } = entry;
      if (message.role === "system") return null;
      if (message.text.trim().length === 0 && !message.streaming) return null;
      return {
        kind: "message",
        id: entry.id,
        createdAt: entry.createdAt,
        role: message.role,
        text: message.text,
        streaming: message.streaming,
      };
    }
    case "proposed-plan":
      return {
        kind: "message",
        id: entry.id,
        createdAt: entry.createdAt,
        role: "plan",
        text: entry.proposedPlan.planMarkdown,
        streaming: false,
      };
    case "work":
      return workRow(entry.entry, entry.createdAt, workspaceRoot);
    case "event":
      return eventRow(entry.projectedItem, entry.createdAt);
    case "mcp-app":
      return null;
    case "html-render":
      return {
        kind: "notice",
        id: entry.id,
        createdAt: entry.createdAt,
        label: `Rendered: ${entry.htmlRender.title}`,
        detail: null,
        tone: "info",
        childThreadId: null,
        projectedItem: null,
      };
  }
}

/** Rows already derived, by timeline entry, so unchanged entries keep their row while text streams. */
export type AgentTranscriptRowCache = WeakMap<TimelineEntry, AgentTranscriptRow | null>;

/**
 * The transcript rows of an agent's child thread. The first user message that
 * repeats the agent's launch prompt is left out; the detail view shows the
 * prompt above the transcript. A cache must be dropped when the options change.
 */
export function deriveAgentTranscriptRows(
  entries: ReadonlyArray<TimelineEntry>,
  options: { readonly prompt: string | null; readonly workspaceRoot: string | undefined },
  cache?: AgentTranscriptRowCache,
): ReadonlyArray<AgentTranscriptRow> {
  const prompt = options.prompt?.trim() || null;
  let promptSkipped = false;
  const rows: AgentTranscriptRow[] = [];
  for (const entry of entries) {
    if (
      !promptSkipped &&
      prompt !== null &&
      entry.kind === "message" &&
      entry.message.role === "user" &&
      entry.message.text.trim() === prompt
    ) {
      promptSkipped = true;
      continue;
    }
    let row = cache?.get(entry);
    if (row === undefined) {
      row = entryRow(entry, options.workspaceRoot);
      cache?.set(entry, row);
    }
    if (row !== null) rows.push(row);
  }
  return rows;
}

export function agentTranscriptKindOf(row: AgentTranscriptRow): AgentTranscriptKind {
  switch (row.kind) {
    case "reasoning":
      return "reasoning";
    case "tool":
      return "tool";
    default:
      return "message";
  }
}

function rowText(row: AgentTranscriptRow): string {
  switch (row.kind) {
    case "message":
    case "reasoning":
      return row.text;
    case "tool":
      return [row.label, row.entry.command, row.entry.detail].filter(Boolean).join("\n");
    case "notice":
      return [row.label, row.detail].filter(Boolean).join("\n");
  }
}

/** Keeps thread order; the filter and search only narrow it. */
export function applyAgentTranscriptView(
  rows: ReadonlyArray<AgentTranscriptRow>,
  view: AgentTranscriptView,
): ReadonlyArray<AgentTranscriptRow> {
  const query = view.query.trim().toLocaleLowerCase();
  if (query.length === 0 && view.kinds.length === 0) return rows;
  return rows.filter(
    (row) =>
      (view.kinds.length === 0 || view.kinds.includes(agentTranscriptKindOf(row))) &&
      (query.length === 0 || rowText(row).toLocaleLowerCase().includes(query)),
  );
}

/** The position of a tool call's row, to open the transcript on it; -1 when it is not listed. */
export function agentTranscriptToolRowIndex(
  rows: ReadonlyArray<AgentTranscriptRow>,
  itemId: TurnItemId,
): number {
  return rows.findIndex(
    (row) =>
      row.kind === "tool" &&
      (row.entry.structuredPayload?.id ?? row.entry.projectedItem?.item.id) === itemId,
  );
}
