import { summarizeToolActivityInput } from "@t3tools/shared/toolActivity";
/**
 * Agents-panel presentation over the source-neutral AgentPanelModel: the
 * user's filter/sort view, and the per-agent tool log derived from the
 * thread's agent-tagged tool activities. Pure; shared by every client.
 */
import {
  isToolLifecycleItemType,
  type OrchestrationThreadActivity,
  type SubagentTranscriptEntry,
} from "@t3tools/contracts";

import { formatCommandForWorkspace, formatPathsForWorkspace } from "../work-log/commandDisplay.ts";
import { toolGroupAction } from "../work-log/presentation.ts";

import type {
  AgentPanelModel,
  AgentPanelWorkflowGroup,
  RuntimeSubagent,
  RuntimeSubagentStatus,
} from "./subagentRuntime.ts";
import { isActiveSubagentStatus } from "./subagentRuntime.ts";

export type AgentStatusFilter = "working" | "idle" | "done" | "failed" | "stopped";
export type AgentPanelSort = "spawn" | "status" | "tokens" | "duration";

export interface AgentPanelView {
  /** Empty means every status. */
  readonly statuses: ReadonlyArray<AgentStatusFilter>;
  readonly query: string;
  readonly sort: AgentPanelSort;
}

export const DEFAULT_AGENT_PANEL_VIEW: AgentPanelView = {
  statuses: [],
  query: "",
  sort: "spawn",
};

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

export function isAgentPanelViewFiltered(view: AgentPanelView): boolean {
  return view.statuses.length > 0 || view.query.trim().length > 0;
}

function matchesView(agent: RuntimeSubagent, view: AgentPanelView, query: string): boolean {
  if (view.statuses.length > 0 && !view.statuses.includes(agentStatusFilterFor(agent.status))) {
    return false;
  }
  if (query.length === 0) {
    return true;
  }
  return [agent.title, agent.role, agent.model, agent.phaseTitle].some(
    (value) => value !== null && value.toLocaleLowerCase().includes(query),
  );
}

const STATUS_RANK: Record<AgentStatusFilter, number> = {
  working: 0,
  failed: 1,
  idle: 2,
  stopped: 3,
  done: 4,
};

function settledDurationMs(agent: RuntimeSubagent): number {
  if (!agent.startedAt || !agent.completedAt) return 0;
  const duration = Date.parse(agent.completedAt) - Date.parse(agent.startedAt);
  return Number.isNaN(duration) ? 0 : duration;
}

/**
 * Sorts that never reshuffle a row while it works: status order only moves a
 * row when its status changes, and token/duration sorts keep live agents
 * pinned first in spawn order, ranking settled agents by their final values.
 * Input arrays arrive in spawn order; Array.sort is stable.
 */
function sortAgents(
  agents: ReadonlyArray<RuntimeSubagent>,
  sort: AgentPanelSort,
): ReadonlyArray<RuntimeSubagent> {
  switch (sort) {
    case "spawn":
      return agents;
    case "status":
      return agents
        .slice()
        .sort(
          (a, b) =>
            STATUS_RANK[agentStatusFilterFor(a.status)] -
            STATUS_RANK[agentStatusFilterFor(b.status)],
        );
    case "tokens":
    case "duration": {
      const value = (agent: RuntimeSubagent) =>
        sort === "tokens" ? (agent.usage?.totalTokens ?? 0) : settledDurationMs(agent);
      return agents.slice().sort((a, b) => {
        const aLive = isActiveSubagentStatus(a.status);
        const bLive = isActiveSubagentStatus(b.status);
        if (aLive || bLive) return aLive === bLive ? 0 : aLive ? -1 : 1;
        return value(b) - value(a);
      });
    }
  }
}

function applyToWorkflow(
  group: AgentPanelWorkflowGroup,
  view: AgentPanelView,
  query: string,
  filtered: boolean,
): AgentPanelWorkflowGroup | null {
  const pick = (members: ReadonlyArray<RuntimeSubagent>) =>
    sortAgents(
      members.filter((member) => matchesView(member, view, query)),
      view.sort,
    );
  const hadMembers =
    group.unphasedMembers.length > 0 || group.phases.some((phase) => phase.members.length > 0);
  if (!hadMembers) {
    // A coordinator with no member rows renders as its own row.
    return !filtered || matchesView(group.workflow, view, query) ? group : null;
  }
  const phases = group.phases
    .map((phase) => ({ ...phase, members: pick(phase.members) }))
    // A filter hides phases it emptied; unfiltered, pending phases keep their slot.
    .filter((phase) => !filtered || phase.members.length > 0);
  const unphasedMembers = pick(group.unphasedMembers);
  if (filtered && phases.length === 0 && unphasedMembers.length === 0) {
    return null;
  }
  return { workflow: group.workflow, phases, unphasedMembers };
}

/** Applies the user's filters and sort. Footer counts stay unfiltered. */
export function applyAgentPanelView(
  model: AgentPanelModel,
  view: AgentPanelView,
): AgentPanelModel & { readonly visibleCount: number } {
  const query = view.query.trim().toLocaleLowerCase();
  const filtered = isAgentPanelViewFiltered(view);
  if (!filtered && view.sort === "spawn") {
    return { ...model, visibleCount: countAgents(model.workflows, model.directAgents) };
  }
  const workflows = model.workflows
    .map((group) => applyToWorkflow(group, view, query, filtered))
    .filter((group): group is AgentPanelWorkflowGroup => group !== null);
  const directAgents = sortAgents(
    model.directAgents.filter((agent) => matchesView(agent, view, query)),
    view.sort,
  );
  return { ...model, workflows, directAgents, visibleCount: countAgents(workflows, directAgents) };
}

function countAgents(
  workflows: ReadonlyArray<AgentPanelWorkflowGroup>,
  directAgents: ReadonlyArray<RuntimeSubagent>,
): number {
  let count = directAgents.length;
  for (const group of workflows) {
    const members =
      group.unphasedMembers.length +
      group.phases.reduce((sum, phase) => sum + phase.members.length, 0);
    count += members > 0 ? members : 1;
  }
  return count;
}

/** Every agent in the model, for resolving a focused agent by id. */
export function findPanelAgent(model: AgentPanelModel, agentId: string): RuntimeSubagent | null {
  for (const group of model.workflows) {
    if (group.workflow.id === agentId) return group.workflow;
    for (const phase of group.phases) {
      const member = phase.members.find((agent) => agent.id === agentId);
      if (member) return member;
    }
    const orphan = group.unphasedMembers.find((agent) => agent.id === agentId);
    if (orphan) return orphan;
  }
  return model.directAgents.find((agent) => agent.id === agentId) ?? null;
}

/** The tool families the log groups calls into, for icons and filtering. */
export type SubagentToolKind = "command" | "read" | "edit" | "search" | "web" | "other";

export interface SubagentToolLogEntry {
  readonly id: string;
  readonly title: string;
  readonly detail: string | null;
  /** The full command when the provider recorded one beyond the detail line. */
  readonly command: string | null;
  readonly preview?: string | null;
  readonly itemType: string | null;
  readonly kind: SubagentToolKind;
  readonly status: "running" | "completed" | "failed";
  readonly startedAt: string;
  readonly completedAt: string | null;
}

const TOOL_KINDS: ReadonlySet<string> = new Set(["tool.started", "tool.updated", "tool.completed"]);

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Classifies a call the same way the chat picks its tool icon. */
function toolKindFor(title: string, itemType: string | null, data: unknown): SubagentToolKind {
  const action = toolGroupAction({
    label: title,
    toolTitle: title,
    tone: "tool",
    toolData: data,
    ...(itemType !== null && isToolLifecycleItemType(itemType) ? { itemType } : {}),
  });
  switch (action) {
    case "command":
    case "read":
    case "edit":
      return action;
    case "code-search":
      return "search";
    case "search":
    case "browser":
      return "web";
    default:
      return "other";
  }
}

function commandFrom(data: unknown): string | null {
  const record = asRecord(data);
  return (
    asText(record?.command) ??
    asText(asRecord(record?.rawInput)?.command) ??
    asText(asRecord(record?.input)?.command) ??
    asText(asRecord(record?.item)?.command)
  );
}

/**
 * Every agent's own tool calls in one pass, each oldest first. Providers tag a
 * subagent's tool activities with `agentId` (the agent's task id); the chat
 * hides them and the Agents panel is where they surface. One entry per tool
 * call; later rows for the same call update it in place. Commands and paths
 * are shown relative to `workspaceRoot`, the directory the thread runs in.
 */
export function deriveSubagentToolLogs(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  workspaceRoot?: string | null,
): ReadonlyMap<string, ReadonlyArray<SubagentToolLogEntry>> {
  const byAgent = new Map<string, Map<string, SubagentToolLogEntry>>();
  for (const activity of activities) {
    if (!TOOL_KINDS.has(activity.kind)) continue;
    const payload = asRecord(activity.payload);
    const agentId = asText(payload?.agentId);
    if (payload === null || agentId === null) continue;
    let entries = byAgent.get(agentId);
    if (!entries) {
      entries = new Map();
      byAgent.set(agentId, entries);
    }
    const id = asText(payload.toolCallId) ?? activity.id;
    const existing = entries.get(id);
    const nativeStatus = asText(payload.status);
    const status: SubagentToolLogEntry["status"] =
      nativeStatus === "failed" || nativeStatus === "declined"
        ? "failed"
        : activity.kind === "tool.completed" || nativeStatus === "completed"
          ? "completed"
          : "running";
    const payloadTitle = asText(payload.title);
    const itemType = asText(payload.itemType) ?? existing?.itemType ?? null;
    // Adapters title tools by category ("File change", "Tool call") with a
    // "Write: <path>" detail; name the row after the tool instead.
    const toolName = asText(asRecord(payload.data)?.toolName);
    const rawDetail = asText(payload.detail);
    const namedDetail =
      toolName !== null && rawDetail?.startsWith(`${toolName}: `)
        ? rawDetail.slice(toolName.length + 2)
        : null;
    const title =
      namedDetail !== null || (toolName !== null && existing?.title === toolName)
        ? (toolName ?? activity.summary)
        : (payloadTitle ?? existing?.title ?? activity.summary);
    const detail = namedDetail ?? rawDetail;
    entries.set(id, {
      id,
      title,
      detail: detail ?? existing?.detail ?? null,
      command: commandFrom(payload.data) ?? existing?.command ?? null,
      preview: summarizeToolActivityInput(payload.data) ?? existing?.preview ?? null,
      itemType,
      kind: toolKindFor(payloadTitle ?? activity.summary, itemType, payload.data),
      status: existing && existing.status !== "running" ? existing.status : status,
      startedAt: existing?.startedAt ?? activity.createdAt,
      completedAt: existing?.completedAt ?? (status === "running" ? null : activity.createdAt),
    });
  }
  return new Map(
    Array.from(byAgent, ([agentId, entries]) => [
      agentId,
      Array.from(entries.values(), (entry) => withWorkspacePaths(entry, workspaceRoot)),
    ]),
  );
}

/** One agent's tool calls, oldest first. See deriveSubagentToolLogs. */
export function deriveSubagentToolLog(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  agentId: string,
  workspaceRoot?: string | null,
): ReadonlyArray<SubagentToolLogEntry> {
  return deriveSubagentToolLogs(activities, workspaceRoot).get(agentId) ?? [];
}

/**
 * Formats a call's input (a command, or a file tool's target) the way the
 * chat shows it: relative to the directory the thread runs in.
 */
export function formatSubagentToolInput(
  kind: SubagentToolKind,
  text: string,
  workspaceRoot: string | null | undefined,
): string {
  return kind === "command"
    ? formatCommandForWorkspace(text, workspaceRoot)
    : formatPathsForWorkspace(text, workspaceRoot);
}

function withWorkspacePaths(
  entry: SubagentToolLogEntry,
  workspaceRoot: string | null | undefined,
): SubagentToolLogEntry {
  if (!workspaceRoot) return entry;
  const format = (text: string | null) =>
    text && formatSubagentToolInput(entry.kind, text, workspaceRoot);
  // The preview lists paths and diffs rather than the command, and must keep
  // matching the detail it deduplicates against.
  const preview = entry.preview ? formatPathsForWorkspace(entry.preview, workspaceRoot) : null;
  // ACP providers such as Cursor put the target in the title ("Read /repo/a.ts").
  const title = formatPathsForWorkspace(entry.title, workspaceRoot);
  return { ...entry, title, detail: format(entry.detail), command: format(entry.command), preview };
}

/** Everything a call recorded, deduplicated, for previews, expansion and search. */
export function subagentToolCallText(entry: SubagentToolLogEntry, includeTitle = true): string {
  const preview = entry.preview ?? null;
  const detail = entry.detail && preview?.split("\n").includes(entry.detail) ? null : entry.detail;
  return (
    [
      ...new Set(
        [includeTitle ? entry.title : null, detail, entry.command, preview].filter(
          (v) => v != null,
        ),
      ),
    ].join("\n\n") || entry.title
  );
}

export type SubagentToolLogSort = "newest" | "oldest" | "duration";

export interface SubagentToolLogView {
  readonly query: string;
  /** Empty means every status. */
  readonly statuses: ReadonlyArray<SubagentToolLogEntry["status"]>;
  /** Empty means every kind. */
  readonly kinds: ReadonlyArray<SubagentToolKind>;
  readonly sort: SubagentToolLogSort;
}

export const DEFAULT_SUBAGENT_TOOL_LOG_VIEW: SubagentToolLogView = {
  query: "",
  statuses: [],
  kinds: [],
  sort: "newest",
};

function durationMs(entry: SubagentToolLogEntry): number {
  // Running calls have no end yet; they sort as the longest.
  return entry.completedAt === null
    ? Number.POSITIVE_INFINITY
    : Date.parse(entry.completedAt) - Date.parse(entry.startedAt);
}

/** Filters, searches and sorts the log. Input is oldest first, as derived. */
export function applySubagentToolLogView(
  entries: ReadonlyArray<SubagentToolLogEntry>,
  view: SubagentToolLogView,
): ReadonlyArray<SubagentToolLogEntry> {
  const query = view.query.trim().toLocaleLowerCase();
  const visible = entries.filter(
    (entry) =>
      (view.statuses.length === 0 || view.statuses.includes(entry.status)) &&
      (view.kinds.length === 0 || view.kinds.includes(entry.kind)) &&
      (query.length === 0 || subagentToolCallText(entry).toLocaleLowerCase().includes(query)),
  );
  // `filter` returned a fresh array; sorting it in place keeps Hermes (no toSorted) happy.
  switch (view.sort) {
    case "oldest":
      return visible;
    case "newest":
      // oxlint-disable-next-line unicorn/no-array-reverse
      return visible.reverse();
    case "duration":
      return visible.sort((a, b) => durationMs(b) - durationMs(a));
  }
}

export type SubagentTranscriptKindFilter = "message" | "reasoning" | "tool";

export interface SubagentTranscriptView {
  readonly query: string;
  /** Empty means every kind. */
  readonly kinds: ReadonlyArray<SubagentTranscriptKindFilter>;
  readonly sort: "oldest" | "newest";
}

/** A transcript reads as a conversation, so it starts oldest first. */
export const DEFAULT_SUBAGENT_TRANSCRIPT_VIEW: SubagentTranscriptView = {
  query: "",
  kinds: [],
  sort: "oldest",
};

/**
 * Transcripts carry the provider's native tool name ("Bash", "Read",
 * "exec_command", ...), so the family is a best-effort match on it.
 */
export function subagentTranscriptToolKind(toolName: string | undefined): SubagentToolKind {
  const name = toolName?.toLocaleLowerCase() ?? "";
  if (/web|fetch|url|browser/.test(name)) return "web";
  if (/bash|shell|exec|command|terminal/.test(name)) return "command";
  if (/grep|glob|search|find/.test(name)) return "search";
  if (/edit|write|patch|apply/.test(name)) return "edit";
  if (/read|view|open/.test(name)) return "read";
  return "other";
}

export function subagentTranscriptKindFilterFor(
  entry: SubagentTranscriptEntry,
): SubagentTranscriptKindFilter {
  return entry.kind === "user" || entry.kind === "assistant" ? "message" : entry.kind;
}

/**
 * Filters, searches and sorts transcript entries, keeping each entry's
 * position in the provider's transcript as a stable key.
 */
export function applySubagentTranscriptView(
  entries: ReadonlyArray<SubagentTranscriptEntry>,
  view: SubagentTranscriptView,
): ReadonlyArray<{ readonly index: number; readonly entry: SubagentTranscriptEntry }> {
  const query = view.query.trim().toLocaleLowerCase();
  const visible = entries
    .map((entry, index) => ({ index, entry }))
    .filter(
      ({ entry }) =>
        (view.kinds.length === 0 || view.kinds.includes(subagentTranscriptKindFilterFor(entry))) &&
        (query.length === 0 ||
          [entry.text, entry.toolName, entry.input, entry.output].some((value) =>
            value?.toLocaleLowerCase().includes(query),
          )),
    );
  // Hermes lacks toReversed; `filter` returned a fresh array, so this cannot mutate the input.
  // oxlint-disable-next-line unicorn/no-array-reverse
  return view.sort === "newest" ? visible.reverse() : visible;
}
