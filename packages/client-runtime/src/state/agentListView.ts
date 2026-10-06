/**
 * Fork: presentation over orchestration-v2 subagents, shared by every client.
 *
 * - The user's view of a thread's agents list: status filter, search, sort.
 *   Spawn order is the default, and no sort moves a row while it works.
 * - A subagent's tool calls, read from its child thread's turn items, for the
 *   compact rows' latest call and the agent tab's searchable log.
 * - The text that carries an agent's work into chat (attach, continue).
 */
import type { OrchestrationV2TurnItem, TurnItemId } from "@t3tools/contracts";
import { isWindowsAbsolutePath } from "@t3tools/shared/path";
import * as DateTime from "effect/DateTime";
import { copySorted } from "@t3tools/shared/Array";
import {
  classifyToolActivity,
  collectToolFilePaths,
  formatSearchToolLabel,
  summarizeToolActivityInput,
} from "@t3tools/shared/toolActivity";

import { formatCommandForWorkspace, formatPathsForWorkspace } from "../work-log/commandDisplay.ts";
import { commandDisplayText } from "../work-log/commandLabel.ts";
import {
  fileChangeDiffWithheld,
  fileChangePreviewText,
  turnItemDetailRevision,
  turnItemNeedsDetailFetch,
} from "../work-log/itemDetail.ts";
import { isActiveSubagentStatus, type RuntimeSubagentStatus } from "./subagentRuntime.ts";

export type AgentStatusFilter = "working" | "idle" | "done" | "failed" | "stopped";
export type AgentListSort = "spawn" | "status" | "tokens" | "duration";

export interface AgentListView {
  /** Empty means every status. */
  readonly statuses: ReadonlyArray<AgentStatusFilter>;
  readonly query: string;
  readonly sort: AgentListSort;
}

export const DEFAULT_AGENT_LIST_VIEW: AgentListView = {
  statuses: [],
  query: "",
  sort: "spawn",
};

/** What the list filters and sorts an agent by. */
export interface AgentListSubject {
  readonly title: string;
  readonly model: string | null;
  readonly status: RuntimeSubagentStatus;
  readonly usage: { readonly totalTokens: number } | null;
  /** ISO time the agent was spawned; the default order. */
  readonly spawnedAt: string | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
}

export function agentStatusFilterFor(status: RuntimeSubagentStatus): AgentStatusFilter {
  switch (status) {
    case "pending":
    case "running":
    case "waiting":
      return "working";
    case "idle":
      return "idle";
    case "completed":
      return "done";
    case "failed":
      return "failed";
    case "cancelled":
    case "interrupted":
      return "stopped";
  }
}

export function isAgentListViewFiltered(view: AgentListView): boolean {
  return view.statuses.length > 0 || view.query.trim().length > 0;
}

const STATUS_RANK: Record<AgentStatusFilter, number> = {
  working: 0,
  failed: 1,
  idle: 2,
  stopped: 3,
  done: 4,
};

function epochOrNull(iso: string | null): number | null {
  if (iso === null) return null;
  const millis = Date.parse(iso);
  return Number.isNaN(millis) ? null : millis;
}

function settledDurationMs(agent: AgentListSubject): number {
  const started = epochOrNull(agent.startedAt);
  const completed = epochOrNull(agent.completedAt);
  return started === null || completed === null ? 0 : completed - started;
}

/** True when the agent passes the view's status filter and search (title and model). */
export function matchesAgentListView(subject: AgentListSubject, view: AgentListView): boolean {
  if (view.statuses.length > 0 && !view.statuses.includes(agentStatusFilterFor(subject.status))) {
    return false;
  }
  const query = view.query.trim().toLocaleLowerCase();
  return (
    query.length === 0 ||
    [subject.title, subject.model].some(
      (value) => value !== null && value.toLocaleLowerCase().includes(query),
    )
  );
}

/**
 * Filters and sorts a thread's agents. Spawn order (oldest first) is the base,
 * and the other sorts never reshuffle a working row: status order only moves a
 * row when its status changes, and token/duration sorts keep live agents first
 * in spawn order, ranking settled agents by their final values.
 */
export function applyAgentListView<Item>(
  items: ReadonlyArray<Item>,
  view: AgentListView,
  subjectOf: (item: Item) => AgentListSubject,
): ReadonlyArray<Item> {
  const entries = items.map((item, index) => ({ item, index, subject: subjectOf(item) }));
  const visible = entries.filter(({ subject }) => matchesAgentListView(subject, view));
  const spawned = copySorted(visible, (left, right) => {
    const leftAt = epochOrNull(left.subject.spawnedAt);
    const rightAt = epochOrNull(right.subject.spawnedAt);
    if (leftAt !== rightAt) {
      if (leftAt === null) return 1;
      if (rightAt === null) return -1;
      return leftAt - rightAt;
    }
    return left.index - right.index;
  });
  const sorted = (() => {
    switch (view.sort) {
      case "spawn":
        return spawned;
      case "status":
        return copySorted(
          spawned,
          (left, right) =>
            STATUS_RANK[agentStatusFilterFor(left.subject.status)] -
            STATUS_RANK[agentStatusFilterFor(right.subject.status)],
        );
      case "tokens":
      case "duration": {
        const value = (subject: AgentListSubject) =>
          view.sort === "tokens" ? (subject.usage?.totalTokens ?? 0) : settledDurationMs(subject);
        return copySorted(spawned, (left, right) => {
          const leftLive = isActiveSubagentStatus(left.subject.status);
          const rightLive = isActiveSubagentStatus(right.subject.status);
          if (leftLive || rightLive) return leftLive === rightLive ? 0 : leftLive ? -1 : 1;
          return value(right.subject) - value(left.subject);
        });
      }
    }
  })();
  return sorted.map(({ item }) => item);
}

/** The tool families calls are grouped into, for icons and filtering. */
export type SubagentToolKind = "command" | "read" | "edit" | "search" | "web" | "other";

export interface SubagentToolCall {
  /** Original file targets before workspace display formatting, for inspection and copying. */
  readonly rawTitle?: string;
  readonly rawDetail?: string;
  /** The child thread's turn item. */
  readonly id: TurnItemId;
  readonly title: string;
  /** The call's target: a command, a path, a search pattern. */
  readonly detail: string | null;
  readonly kind: SubagentToolKind;
  readonly status: "running" | "completed" | "failed";
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly exitCode: number | null;
  /** Bounded details: edit diffs and line counts, read ranges, search arguments. */
  readonly preview: string | null;
  /**
   * The `getTurnItem` revision to fetch an edit's withheld diff or a read's withheld file with;
   * null when there is none.
   */
  readonly detailRevision: string | null;
}

function toolCallStatus(status: OrchestrationV2TurnItem["status"]): SubagentToolCall["status"] {
  switch (status) {
    case "completed":
      return "completed";
    case "failed":
    case "cancelled":
    case "interrupted":
      return "failed";
    default:
      return "running";
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function dynamicToolKind(
  item: Extract<OrchestrationV2TurnItem, { readonly type: "dynamic_tool" }>,
): SubagentToolKind {
  const toolName = item.toolName ?? "";
  if (/web|fetch|browser|url/i.test(toolName)) return "web";
  const action = classifyToolActivity({
    itemType: "dynamic_tool_call",
    data: { toolName: toolName || undefined, input: item.input },
  });
  switch (action) {
    case "command":
    case "read":
    case "search":
      return action;
    case "file_change":
      return "edit";
    default:
      return "other";
  }
}

type RawToolCall = Omit<
  SubagentToolCall,
  "id" | "status" | "startedAt" | "completedAt" | "detailRevision"
>;

/** A tool item's call as recorded, with paths and commands still absolute. */
function rawToolCallFromItem(item: OrchestrationV2TurnItem): RawToolCall | null {
  const title = item.title?.trim() || null;
  switch (item.type) {
    case "command_execution":
      return {
        title: title ?? "Command",
        detail: commandDisplayText(item.input).trim() || null,
        kind: "command",
        exitCode: item.exitCode ?? null,
        preview: null,
      };
    case "file_change": {
      const many = item.changes !== undefined && item.changes.length > 1;
      return {
        title: title ?? (many ? `Changed ${item.changes!.length} files` : "Edit"),
        detail: item.fileName,
        kind: "edit",
        exitCode: null,
        preview:
          fileChangePreviewText(item) ??
          (item.additions !== undefined || item.deletions !== undefined
            ? `+${item.additions ?? 0}, −${item.deletions ?? 0} lines`
            : null),
      };
    }
    case "file_search":
      return {
        title: title ?? "Search",
        detail: textOrNull(item.pattern),
        kind: "search",
        exitCode: null,
        preview:
          item.results && item.results.length > 0
            ? item.results
                .slice(0, 8)
                .map((result) => `${result.fileName}${result.line ? `:${result.line}` : ""}`)
                .join("\n")
            : null,
      };
    case "web_search":
      return {
        title: title ?? "Web search",
        detail: item.patterns?.length ? item.patterns.join(", ") : null,
        kind: "web",
        exitCode: null,
        preview: null,
      };
    case "dynamic_tool": {
      const kind = dynamicToolKind(item);
      const input = asRecord(item.input);
      const [path] = collectToolFilePaths({ input: item.input });
      const detail =
        kind === "command"
          ? (textOrNull(input?.command) ?? textOrNull(input?.cmd))
          : kind === "search"
            ? (formatSearchToolLabel({ input: item.input }) ?? null)
            : kind === "web"
              ? (textOrNull(input?.url) ?? textOrNull(input?.query))
              : (path ?? null);
      return {
        title: title ?? item.toolName ?? "Tool",
        detail: kind === "command" && detail ? commandDisplayText(detail) : detail,
        kind,
        exitCode: null,
        // The output adds what the call reported back, such as an error or exit code.
        preview:
          summarizeToolActivityInput({
            toolName: item.toolName,
            input: item.input,
            ...(item.output === undefined ? {} : { result: item.output }),
          }) ?? null,
      };
    }
    default:
      return null;
  }
}

/** The tool family of a turn item, as agent rows mark it; null for non-tool items. */
export function subagentToolKindOfItem(item: OrchestrationV2TurnItem): SubagentToolKind | null {
  return rawToolCallFromItem(item)?.kind ?? null;
}

function rawToolCallText(call: RawToolCall): string {
  return [call.title, call.detail, call.preview].filter(Boolean).join("\n");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parentDirectory(path: string): string | null {
  const trimmed = path.replace(/[\\/]+$/, "");
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return index > 0 ? trimmed.slice(0, index) : null;
}

function pathSeparator(path: string): "/" | "\\" {
  return path.includes("\\") && !path.includes("/") ? "\\" : "/";
}

function mentionsDirectory(text: string, directory: string): boolean {
  const caseInsensitive = isWindowsAbsolutePath(directory);
  const source = caseInsensitive ? text.toLowerCase() : text;
  const needle = caseInsensitive ? directory.toLowerCase() : directory;
  let from = 0;
  while (from < source.length) {
    const index = source.indexOf(needle, from);
    if (index < 0) return false;
    const before = index === 0 ? "" : source[index - 1]!;
    const after = source[index + needle.length] ?? "";
    const boundedBefore = index === 0 || /[\s'"=(]/.test(before);
    const boundedAfter = after === "" || /[\\/]/.test(after) || /[\s'"`;&|):]/.test(after);
    if (boundedBefore && boundedAfter) return true;
    from = index + 1;
  }
  return false;
}

/**
 * A checkout next to `workspaceRoot` that an agent's calls actually use.
 * Cursor task subagents keep their shell there and still hand file tools
 * absolute paths. One call is not enough: a single read of a neighboring file
 * stays absolute. Two checkouts used equally often stay absolute too.
 */
export function subagentSiblingCheckout(
  callTexts: ReadonlyArray<string>,
  workspaceRoot: string | null | undefined,
): string | null {
  const root = workspaceRoot?.trim().replace(/[\\/]+$/, "") ?? "";
  const parent = parentDirectory(root);
  if (!parent || !/[\\/][^\\/]/.test(root)) return null;
  const ownName = root.slice(parent.length + 1);
  const caseInsensitive = isWindowsAbsolutePath(root);
  const normalize = (value: string) => (caseInsensitive ? value.toLowerCase() : value);
  const pattern = new RegExp(
    `(?:^|[\\s'"=(])${escapeRegExp(parent)}[\\\\/]+([^\\s'"\`;&|)\\\\/]+)`,
    caseInsensitive ? "gi" : "g",
  );
  const counts = new Map<string, { readonly path: string; count: number }>();
  for (const text of callTexts) {
    const seen = new Set<string>();
    for (const match of text.matchAll(pattern)) {
      const name = match[1];
      if (!name || name === "." || name === ".." || normalize(name) === normalize(ownName)) {
        continue;
      }
      const after = text.slice((match.index ?? 0) + match[0].length);
      if (!after.startsWith("/") && !after.startsWith("\\")) continue;
      const key = normalize(name);
      if (seen.has(key)) continue;
      seen.add(key);
      const existing = counts.get(key);
      counts.set(
        key,
        existing
          ? { path: existing.path, count: existing.count + 1 }
          : { path: `${parent}${pathSeparator(root)}${name}`, count: 1 },
      );
    }
  }
  let best: { readonly path: string; count: number } | null = null;
  let runnerUp = 0;
  for (const candidate of counts.values()) {
    if (!best || candidate.count > best.count) {
      runnerUp = best?.count ?? 0;
      best = candidate;
    } else if (candidate.count > runnerUp) {
      runnerUp = candidate.count;
    }
  }
  return best && best.count >= 2 && best.count > runnerUp ? best.path : null;
}

// Claude Code gives a worktree-isolated agent its own checkout at
// `<repo>/.claude/worktrees/agent-<id>`, outside a thread running in a T3 worktree,
// and never reports the path; the agent's absolute paths are the only record of it.
const CLAUDE_AGENT_WORKTREE =
  /[^\s'"=(]*[\\/]\.claude[\\/]worktrees[\\/]agent-[^\s'"`;&|):\\/]+(?=$|[\s'"`;&|):\\/])/;

/** The directory one call runs in: its agent worktree, a used sibling checkout, or the thread's. */
function toolCallRoot(
  text: string,
  workspaceRoot: string | null | undefined,
  siblingCheckout: string | null,
): string | null | undefined {
  const worktree = CLAUDE_AGENT_WORKTREE.exec(text)?.[0];
  if (worktree) return worktree;
  if (siblingCheckout && mentionsDirectory(text, siblingCheckout)) return siblingCheckout;
  return workspaceRoot;
}

function formatToolCall(
  call: RawToolCall,
  workspaceRoot: string | null | undefined,
  siblingCheckout: string | null,
): RawToolCall {
  const root = toolCallRoot(rawToolCallText(call), workspaceRoot, siblingCheckout);
  const paths = (text: string | null) => (text ? formatPathsForWorkspace(text, root) : null);
  return {
    ...call,
    // ACP providers such as Cursor put the target in the title ("Read /repo/a.ts").
    title: formatPathsForWorkspace(call.title, root),
    detail:
      call.kind === "command" && call.detail
        ? formatCommandForWorkspace(call.detail, root) || null
        : paths(call.detail),
    preview: paths(call.preview),
  };
}

function toolCallFromItem(
  item: OrchestrationV2TurnItem,
  raw: RawToolCall,
  workspaceRoot: string | null | undefined,
  siblingCheckout: string | null,
): SubagentToolCall {
  return {
    ...formatToolCall(raw, workspaceRoot, siblingCheckout),
    ...(raw.kind === "command"
      ? {}
      : { rawTitle: raw.title, ...(raw.detail ? { rawDetail: raw.detail } : {}) }),
    id: item.id,
    status: toolCallStatus(item.status),
    detailRevision:
      fileChangeDiffWithheld(item) || (raw.kind === "read" && turnItemNeedsDetailFetch(item))
        ? turnItemDetailRevision(item)
        : null,
    startedAt: item.startedAt === null ? null : DateTime.formatIso(item.startedAt),
    completedAt: item.completedAt === null ? null : DateTime.formatIso(item.completedAt),
  };
}

function rawToolCalls(items: ReadonlyArray<OrchestrationV2TurnItem>) {
  const calls: Array<{ readonly item: OrchestrationV2TurnItem; readonly raw: RawToolCall }> = [];
  for (const item of items) {
    const raw = rawToolCallFromItem(item);
    if (raw !== null) calls.push({ item, raw });
  }
  return copySorted(calls, (left, right) => left.item.ordinal - right.item.ordinal);
}

/**
 * A subagent's tool calls, oldest first, from its child thread's turn items.
 * Paths and commands are shown relative to the directory the agent runs in:
 * `workspaceRoot`, or a sibling checkout or Claude agent worktree its calls use.
 */
export function deriveSubagentToolCalls(
  items: ReadonlyArray<OrchestrationV2TurnItem>,
  workspaceRoot?: string | null,
): ReadonlyArray<SubagentToolCall> {
  const calls = rawToolCalls(items);
  const sibling = subagentSiblingCheckout(
    calls.map(({ raw }) => rawToolCallText(raw)),
    workspaceRoot,
  );
  return calls.map(({ item, raw }) => toolCallFromItem(item, raw, workspaceRoot, sibling));
}

/**
 * The directory an agent works in, for showing its whole transcript relative to it: the Claude
 * agent worktree its calls use most, else a sibling checkout they use (see
 * `subagentSiblingCheckout`), else `workspaceRoot`.
 */
export function subagentWorkspaceRoot(
  items: ReadonlyArray<OrchestrationV2TurnItem>,
  workspaceRoot?: string | null,
): string | null {
  const texts = rawToolCalls(items).map(({ raw }) => rawToolCallText(raw));
  const worktrees = new Map<string, number>();
  for (const text of texts) {
    const worktree = CLAUDE_AGENT_WORKTREE.exec(text)?.[0];
    if (worktree) worktrees.set(worktree, (worktrees.get(worktree) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const [worktree, count] of worktrees) {
    if (best === null || count > worktrees.get(best)!) best = worktree;
  }
  return best ?? subagentSiblingCheckout(texts, workspaceRoot) ?? workspaceRoot ?? null;
}

/**
 * What an agent's empty Tools view says. An agent whose thread recorded activity but no tool
 * calls made none; one whose provider recorded nothing at all, or counted tool uses it never
 * reported, falls back to its progress while it works.
 */
export function subagentEmptyToolCallsText(input: {
  readonly live: boolean;
  /** Turn items the agent's own thread recorded, of any kind. */
  readonly recordedItems: number;
  readonly reportedToolUses: number | undefined;
  readonly progress: string | null;
}): string {
  const unreported = input.recordedItems === 0 || (input.reportedToolUses ?? 0) > 0;
  if (!unreported) return input.live ? "No tool calls yet." : "No tool calls.";
  if (input.live && input.progress?.trim()) return input.progress.trim();
  return input.live && input.recordedItems === 0 && input.reportedToolUses === undefined
    ? "Starting…"
    : "This provider did not report the agent's tool calls.";
}

/** The call a working agent's row shows: the newest one. Only it is formatted. */
export function latestSubagentToolCall(
  items: ReadonlyArray<OrchestrationV2TurnItem>,
  workspaceRoot?: string | null,
): SubagentToolCall | null {
  const calls = rawToolCalls(items);
  const latest = calls.at(-1);
  if (latest === undefined) return null;
  const sibling = subagentSiblingCheckout(
    calls.map(({ raw }) => rawToolCallText(raw)),
    workspaceRoot,
  );
  return toolCallFromItem(latest.item, latest.raw, workspaceRoot, sibling);
}

/** Everything a call recorded, deduplicated, for search and expansion. */
export function subagentToolCallText(call: SubagentToolCall): string {
  return [
    ...new Set([call.title, call.detail, call.preview].filter((value) => value != null)),
  ].join("\n\n");
}

export type SubagentToolCallSort = "newest" | "oldest" | "duration";

export interface SubagentToolCallView {
  readonly query: string;
  /** Empty means every status. */
  readonly statuses: ReadonlyArray<SubagentToolCall["status"]>;
  /** Empty means every kind. */
  readonly kinds: ReadonlyArray<SubagentToolKind>;
  readonly sort: SubagentToolCallSort;
}

export const DEFAULT_SUBAGENT_TOOL_CALL_VIEW: SubagentToolCallView = {
  query: "",
  statuses: [],
  kinds: [],
  sort: "newest",
};

function durationMs(call: SubagentToolCall): number {
  const started = epochOrNull(call.startedAt);
  const completed = epochOrNull(call.completedAt);
  // Running calls have no end yet; they sort as the longest.
  if (completed === null) return Number.POSITIVE_INFINITY;
  return started === null ? 0 : completed - started;
}

/** Filters, searches and sorts the log. Input is oldest first, as derived. */
export function applySubagentToolCallView(
  calls: ReadonlyArray<SubagentToolCall>,
  view: SubagentToolCallView,
): ReadonlyArray<SubagentToolCall> {
  const query = view.query.trim().toLocaleLowerCase();
  const visible = calls.filter(
    (call) =>
      (view.statuses.length === 0 || view.statuses.includes(call.status)) &&
      (view.kinds.length === 0 || view.kinds.includes(call.kind)) &&
      (query.length === 0 || subagentToolCallText(call).toLocaleLowerCase().includes(query)),
  );
  switch (view.sort) {
    case "oldest":
      return visible;
    case "newest":
      // `filter` returned a fresh array; reversing it cannot touch the input (Hermes lacks toReversed).
      // oxlint-disable-next-line unicorn/no-array-reverse
      return visible.reverse();
    case "duration":
      return copySorted(visible, (left, right) => durationMs(right) - durationMs(left));
  }
}

/** What the chat-context helpers read from an agent. */
export interface SubagentContextSubject {
  readonly title: string;
  readonly status: RuntimeSubagentStatus;
  readonly prompt: string | null;
  readonly result: string | null;
  readonly error: string | null;
  readonly progress?: string | null;
}

/** Characters of launch prompt kept when a result is attached to chat. */
const RESULT_CONTEXT_PROMPT_CHAR_LIMIT = 600;

function clip(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

/**
 * A finished agent's findings as text for the composer, so a follow-up turn knows what was asked
 * and what came back. Null while the agent works or when it reported nothing.
 */
export function subagentResultChatContext(agent: SubagentContextSubject): string | null {
  if (isActiveSubagentStatus(agent.status)) return null;
  const outcome = agent.error ?? agent.result;
  if (!outcome?.trim()) return null;
  const prompt = agent.prompt?.trim();
  const sections = [
    agent.error
      ? `The "${agent.title}" subagent failed.`
      : `Findings from the "${agent.title}" subagent.`,
    prompt ? `Task:\n${clip(prompt, RESULT_CONTEXT_PROMPT_CHAR_LIMIT)}` : null,
    `${agent.error ? "Error" : "Result"}:\n${outcome.trim()}`,
  ];
  return sections.filter((section) => section !== null).join("\n\n");
}

const CONTINUATION_PROMPT_CHAR_LIMIT = 6_000;
const CONTINUATION_OUTCOME_CHAR_LIMIT = 16_000;
const CONTINUATION_TOOL_CALL_LIMIT = 40;
const CONTINUATION_TOOL_LINE_CHAR_LIMIT = 200;

function continuationStatusLine(name: string, status: RuntimeSubagentStatus): string {
  switch (status) {
    case "completed":
      return `The "${name}" subagent finished.`;
    case "failed":
      return `The "${name}" subagent failed.`;
    case "cancelled":
    case "interrupted":
      return `The "${name}" subagent was stopped before it finished.`;
    case "idle":
      return `The "${name}" subagent is idle.`;
    default:
      return `The "${name}" subagent was still working when this was captured.`;
  }
}

/**
 * Everything needed to pick up where an agent left off in a fresh chat: its assignment, its
 * outcome, and its latest tool calls. Unlike `subagentResultChatContext`, this also works mid-run.
 * Null when the agent left nothing to go on.
 */
export function subagentContinuationContext(
  agent: SubagentContextSubject,
  toolCalls: ReadonlyArray<SubagentToolCall>,
): string | null {
  const prompt = agent.prompt?.trim();
  const live = isActiveSubagentStatus(agent.status);
  const outcome = (agent.error ?? (live ? null : agent.result))?.trim();
  if (!prompt && !outcome && toolCalls.length === 0) return null;
  const calls = toolCalls.slice(-CONTINUATION_TOOL_CALL_LIMIT).map((call) => {
    const line = call.detail ? `${call.title}: ${call.detail}` : call.title;
    const status = call.status === "completed" ? "" : ` (${call.status})`;
    return `- ${clip(line.replace(/\s+/g, " "), CONTINUATION_TOOL_LINE_CHAR_LIMIT)}${status}`;
  });
  const sections = [
    `${continuationStatusLine(agent.title, agent.status)} Continue from its work.`,
    prompt ? `Task:\n${clip(prompt, CONTINUATION_PROMPT_CHAR_LIMIT)}` : null,
    live && agent.progress?.trim() ? `Latest progress:\n${agent.progress.trim()}` : null,
    outcome
      ? `${agent.error ? "Error" : "Result"}:\n${clip(outcome, CONTINUATION_OUTCOME_CHAR_LIMIT)}`
      : null,
    calls.length > 0
      ? `Tool calls (${
          toolCalls.length > calls.length
            ? `latest ${calls.length} of ${toolCalls.length}`
            : `${calls.length}`
        }):\n${calls.join("\n")}`
      : null,
  ];
  return sections.filter((section) => section !== null).join("\n\n");
}
