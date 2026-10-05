/**
 * Fork: a thread's whole agent fleet over orchestration-v2 data, for the Agents
 * panel, plus the per-agent presentation the thread-details Lineage rows share.
 *
 * Every subagent is a child thread. The viewed thread's projection carries the
 * records of the agents it spawned (prompt, result, usage); agents those agents
 * spawned are found through thread shells' lineage alone, so listing them never
 * subscribes to another thread's projection.
 */
import type {
  ModelSelection,
  OrchestrationV2Run,
  OrchestrationV2RunAttempt,
  OrchestrationV2Subagent,
  OrchestrationV2SubagentUsage,
  OrchestrationV2ThreadShell,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import {
  agentStatusFilterFor,
  applyAgentListView,
  DEFAULT_AGENT_LIST_VIEW,
  matchesAgentListView,
  type AgentListSubject,
  type AgentListView,
  type AgentStatusFilter,
} from "./agentListView.ts";
import { formatSubagentDisplayTitle } from "./subagentDisplay.ts";
import {
  formatSubagentModelLabel,
  projectedSubagentsToRuntime,
  type RuntimeSubagent,
  type RuntimeSubagentStatus,
} from "./subagentRuntime.ts";
import { REASONING_EFFORT_OPTION_IDS } from "./threadExecution.ts";

/** A thread or lineage-edge status read as an agent status. */
export function edgeAgentStatus(status: string | null | undefined): RuntimeSubagentStatus {
  switch (status) {
    case "pending":
    case "preparing":
    case "queued":
    case "starting":
      return "pending";
    case "running":
    case "waiting":
    case "idle":
    case "completed":
    case "failed":
    case "cancelled":
    case "interrupted":
      return status;
    case "error":
      return "failed";
    case "rolled_back":
      return "cancelled";
    default:
      return "idle";
  }
}

function isoOrNull(value: DateTime.Utc | null | undefined): string | null {
  return value ? DateTime.formatIso(value) : null;
}

/**
 * A delegated task settles with its first run, but the parent can keep sending
 * the child follow-ups. While the child thread has a live run, the agent's
 * status and timer follow that run instead of the settled task.
 */
export function liveSubagent<Agent extends RuntimeSubagent>(
  agent: Agent | undefined,
  childThread: OrchestrationV2ThreadShell | null | undefined,
): Agent | undefined {
  const liveStatus = childThread?.activityRunStatus;
  if (!agent || !liveStatus) return agent;
  return {
    ...agent,
    status: liveStatus === "running" || liveStatus === "waiting" ? liveStatus : "pending",
    startedAt: isoOrNull(childThread.activityRunStartedAt),
    completedAt: null,
    // The settled task's output belongs to its first run, not this one.
    progress: null,
    result: null,
    error: null,
  };
}

/** The reasoning effort a model selection asks for, as the provider names it ("high"). */
export function modelSelectionEffort(selection: ModelSelection): string | null {
  for (const id of REASONING_EFFORT_OPTION_IDS) {
    const option = selection.options?.find((candidate) => candidate.id === id);
    if (typeof option?.value === "string") return option.value;
  }
  return null;
}

/**
 * An agent's record as rows render it. Its child thread adds the model and effort it runs with,
 * and a live follow-up run (see `liveSubagent`).
 */
export function subagentFromRecord(
  record: OrchestrationV2Subagent,
  childThread: OrchestrationV2ThreadShell | null | undefined,
): RuntimeSubagent {
  const recorded = projectedSubagentsToRuntime([record])[0]!;
  if (!childThread) return recorded;
  const withThread: RuntimeSubagent = {
    ...recorded,
    model: recorded.model ?? childThread.modelSelection.model,
    effort: modelSelectionEffort(childThread.modelSelection),
  };
  return liveSubagent(withThread, childThread) ?? withThread;
}

/** An agent known only from its child thread's shell: status and timing, no prompt or result. */
export function shellSubagent(shell: OrchestrationV2ThreadShell): RuntimeSubagent {
  const status = edgeAgentStatus(shell.activityRunStatus ?? shell.status);
  const live = shell.activityRunStatus != null;
  const startedAt = shell.activityRunStartedAt ?? shell.latestRunStartedAt ?? null;
  return projectedSubagentsToRuntime([
    {
      id: shell.id,
      title: shell.title,
      prompt: "",
      model: shell.modelSelection.model,
      // projectedSubagentsToRuntime only reads statuses the record allows.
      status,
      result: null,
      startedAt,
      completedAt: live ? null : (shell.latestRunCompletedAt ?? null),
      updatedAt: shell.updatedAt,
    },
  ]).map((agent) => ({ ...agent, effort: modelSelectionEffort(shell.modelSelection) }))[0]!;
}

/**
 * When the agent was spawned, its stable list order: its child thread's creation, which a
 * follow-up run never moves, else the record's start before the thread exists.
 */
export function subagentSpawnedAt(
  record: Pick<OrchestrationV2Subagent, "startedAt"> | null,
  childThread: Pick<OrchestrationV2ThreadShell, "createdAt"> | null | undefined,
): string | null {
  if (childThread) return DateTime.formatIso(childThread.createdAt);
  return isoOrNull(record?.startedAt);
}

export interface AgentFleetEntry {
  /** Stable row key: the child thread, or the record before its thread exists. */
  readonly key: string;
  readonly childThreadId: ThreadId | null;
  /** The thread that spawned the agent: the viewed thread, or a subagent's thread. */
  readonly ownerThreadId: ThreadId;
  /** The agent's record; null for nested agents, whose owner's projection is not loaded. */
  readonly subagent: OrchestrationV2Subagent | null;
  readonly shell: OrchestrationV2ThreadShell | null;
  /** The agent as rows render it, following a live follow-up run. */
  readonly agent: RuntimeSubagent;
  readonly title: string;
  readonly subject: AgentListSubject;
}

function subjectOf(
  agent: RuntimeSubagent,
  title: string,
  spawnedAt: string | null,
): AgentListSubject {
  return {
    title,
    model: agent.model,
    status: agent.status,
    usage: agent.usage,
    spawnedAt,
    startedAt: agent.startedAt,
    completedAt: agent.completedAt,
  };
}

/**
 * Every agent of `threadId`: the agents it spawned (its projection's subagent
 * records, plus any subagent child shell without one), then, recursively, the
 * subagent child threads those agents spawned. `shells` may include archived
 * threads; earlier shells win over later copies of the same thread.
 */
export function deriveThreadAgentFleet(input: {
  readonly threadId: ThreadId;
  readonly subagents: ReadonlyArray<OrchestrationV2Subagent>;
  readonly shells: ReadonlyArray<OrchestrationV2ThreadShell>;
}): ReadonlyArray<AgentFleetEntry> {
  const shellsById = new Map<ThreadId, OrchestrationV2ThreadShell>();
  const subagentChildren = new Map<ThreadId, OrchestrationV2ThreadShell[]>();
  for (const shell of input.shells) {
    if (shellsById.has(shell.id)) continue;
    shellsById.set(shell.id, shell);
    const parentThreadId = shell.lineage.parentThreadId;
    if (parentThreadId === null || shell.lineage.relationshipToParent !== "subagent") continue;
    const siblings = subagentChildren.get(parentThreadId);
    if (siblings) siblings.push(shell);
    else subagentChildren.set(parentThreadId, [shell]);
  }

  const entries: AgentFleetEntry[] = [];
  const seen = new Set<ThreadId>([input.threadId]);
  const fromShell = (shell: OrchestrationV2ThreadShell, ownerThreadId: ThreadId) => {
    const agent = shellSubagent(shell);
    const title = formatSubagentDisplayTitle(shell.title);
    entries.push({
      key: shell.id,
      childThreadId: shell.id,
      ownerThreadId,
      subagent: null,
      shell,
      agent,
      title,
      subject: subjectOf(agent, title, subagentSpawnedAt(null, shell)),
    });
  };

  for (const subagent of input.subagents) {
    const childThreadId = subagent.childThreadId;
    if (childThreadId !== null) {
      if (seen.has(childThreadId)) continue;
      seen.add(childThreadId);
    }
    const shell = childThreadId === null ? null : (shellsById.get(childThreadId) ?? null);
    const agent = subagentFromRecord(subagent, shell);
    const title = formatSubagentDisplayTitle(shell?.title ?? agent.title);
    entries.push({
      key: childThreadId ?? `subagent:${subagent.id}`,
      childThreadId,
      ownerThreadId: input.threadId,
      subagent,
      shell,
      agent,
      title,
      subject: subjectOf(agent, title, subagentSpawnedAt(subagent, shell)),
    });
  }
  for (const shell of subagentChildren.get(input.threadId) ?? []) {
    if (seen.has(shell.id)) continue;
    seen.add(shell.id);
    fromShell(shell, input.threadId);
  }

  // Nested agents, breadth first; `seen` guards against lineage cycles.
  for (let index = 0; index < entries.length; index += 1) {
    const owner = entries[index]!.childThreadId;
    if (owner === null) continue;
    for (const shell of subagentChildren.get(owner) ?? []) {
      if (seen.has(shell.id)) continue;
      seen.add(shell.id);
      fromShell(shell, owner);
    }
  }
  return entries;
}

export interface AgentFleetRow {
  readonly entry: AgentFleetEntry;
  /** 0 for the viewed thread's own agents, 1 for the agents they spawned, and so on. */
  readonly depth: number;
  /** Shown only because an agent it spawned matches the filter. */
  readonly context: boolean;
}

/**
 * The fleet as a tree in display order: each agent's own agents follow it,
 * every sibling group sorted by `view.sort`. Filtering keeps an agent when it
 * matches, or as context when an agent below it does.
 */
export function arrangeAgentFleet(
  entries: ReadonlyArray<AgentFleetEntry>,
  view: AgentListView,
  rootThreadId: ThreadId,
): ReadonlyArray<AgentFleetRow> {
  const childrenByOwner = new Map<ThreadId, AgentFleetEntry[]>();
  for (const entry of entries) {
    const siblings = childrenByOwner.get(entry.ownerThreadId);
    if (siblings) siblings.push(entry);
    else childrenByOwner.set(entry.ownerThreadId, [entry]);
  }
  const sortOnly: AgentListView = {
    ...DEFAULT_AGENT_LIST_VIEW,
    sort: view.sort,
  };
  const visited = new Set<ThreadId>([rootThreadId]);
  const visit = (owner: ThreadId, depth: number): AgentFleetRow[] => {
    const siblings = applyAgentListView(
      childrenByOwner.get(owner) ?? [],
      sortOnly,
      (entry) => entry.subject,
    );
    const rows: AgentFleetRow[] = [];
    for (const entry of siblings) {
      const childThreadId = entry.childThreadId;
      const below =
        childThreadId === null || visited.has(childThreadId)
          ? []
          : (visited.add(childThreadId), visit(childThreadId, depth + 1));
      const matches = matchesAgentListView(entry.subject, view);
      if (!matches && below.length === 0) continue;
      rows.push({ entry, depth, context: !matches }, ...below);
    }
    return rows;
  };
  return visit(rootThreadId, 0);
}

export interface AgentFleetSummary {
  readonly counts: Readonly<Record<AgentStatusFilter, number>>;
  /**
   * What the fleet reported, summed: each breakdown field only when an agent reported it.
   * Durations overlap, so they are not summed. Null when no agent reported usage.
   */
  readonly usage: OrchestrationV2SubagentUsage | null;
}

const SUMMED_USAGE_FIELDS = [
  "inputTokens",
  "cachedInputTokens",
  "outputTokens",
  "reasoningOutputTokens",
  "toolUses",
] as const;

export function summarizeAgentFleet(entries: ReadonlyArray<AgentFleetEntry>): AgentFleetSummary {
  const counts: Record<AgentStatusFilter, number> = {
    working: 0,
    idle: 0,
    done: 0,
    failed: 0,
    stopped: 0,
  };
  const usage: { totalTokens: number } & {
    -readonly [K in (typeof SUMMED_USAGE_FIELDS)[number]]?: number;
  } = { totalTokens: 0 };
  let hasUsage = false;
  for (const entry of entries) {
    counts[agentStatusFilterFor(entry.agent.status)] += 1;
    const reported = entry.agent.usage;
    if (!reported) continue;
    hasUsage = true;
    usage.totalTokens += reported.totalTokens;
    for (const field of SUMMED_USAGE_FIELDS) {
      const value = reported[field];
      if (value !== undefined) usage[field] = (usage[field] ?? 0) + value;
    }
  }
  return { counts, usage: hasUsage ? usage : null };
}

/** How many runs an agent's child thread has had, and the latest run's attempt. */
export interface SubagentRunStats {
  readonly runs: number;
  /** The latest run's attempt, from 1; null before the thread has a run. */
  readonly attempt: number | null;
}

/**
 * Runs and retries of an agent's own thread, from its projection. Run ordinals count every run,
 * so the newest ordinal is the run count even when older runs are paged out.
 */
export function subagentRunStats(
  projection: {
    readonly runs: ReadonlyArray<Pick<OrchestrationV2Run, "id" | "threadId" | "ordinal">>;
    readonly attempts: ReadonlyArray<Pick<OrchestrationV2RunAttempt, "runId" | "attemptOrdinal">>;
  },
  childThreadId: ThreadId,
): SubagentRunStats {
  let latest: Pick<OrchestrationV2Run, "id" | "ordinal"> | null = null;
  for (const run of projection.runs) {
    if (run.threadId === childThreadId && (latest === null || run.ordinal > latest.ordinal)) {
      latest = run;
    }
  }
  if (latest === null) return { runs: 0, attempt: null };
  let attempt = 0;
  for (const candidate of projection.attempts) {
    if (candidate.runId === latest.id) attempt = Math.max(attempt, candidate.attemptOrdinal);
  }
  return { runs: latest.ordinal, attempt: attempt > 0 ? attempt : null };
}

/** The identity line after an agent's status: compact model with effort, then `run N` past the first. */
export function subagentIdentityParts(
  agent: Pick<RuntimeSubagent, "model" | "effort">,
  runs = 0,
): ReadonlyArray<string> {
  const model = formatSubagentModelLabel(agent.model, agent.effort);
  return [model, runs > 1 ? `run ${runs}` : null].filter((part) => part !== null);
}

/** Usage breakdown rows an agent's own thread adds: runs past the first, and a retried attempt. */
export function subagentRunUsageRows(
  stats: SubagentRunStats,
): ReadonlyArray<readonly [string, string]> {
  const rows: Array<readonly [string, string]> = [];
  if (stats.runs > 1) rows.push(["Runs", String(stats.runs)]);
  if (stats.attempt !== null && stats.attempt > 1) rows.push(["Attempt", String(stats.attempt)]);
  return rows;
}
