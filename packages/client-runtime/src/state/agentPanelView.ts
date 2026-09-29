/**
 * Agents-panel presentation over the source-neutral AgentPanelModel: the
 * user's filter/sort view, and the per-agent tool log derived from the
 * thread's agent-tagged tool activities. Pure; shared by every client.
 */
import type { OrchestrationThreadActivity } from "@t3tools/contracts";

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

export interface SubagentToolLogEntry {
  readonly id: string;
  readonly title: string;
  readonly detail: string | null;
  readonly itemType: string | null;
  readonly status: "running" | "completed" | "failed";
  readonly startedAt: string;
  readonly completedAt: string | null;
}

const TOOL_KINDS: ReadonlySet<string> = new Set(["tool.started", "tool.updated", "tool.completed"]);

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * The agent's own tool calls, oldest first. Providers tag a subagent's tool
 * activities with `agentId` (the agent's task id); the chat hides them and
 * this log is where they surface. One entry per tool call; later rows for the
 * same call update it in place.
 */
export function deriveSubagentToolLog(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  agentId: string,
): ReadonlyArray<SubagentToolLogEntry> {
  const entries = new Map<string, SubagentToolLogEntry>();
  for (const activity of activities) {
    if (!TOOL_KINDS.has(activity.kind)) continue;
    if (typeof activity.payload !== "object" || activity.payload === null) continue;
    const payload = activity.payload as Record<string, unknown>;
    if (payload.agentId !== agentId) continue;
    const id = asText(payload.toolCallId) ?? activity.id;
    const existing = entries.get(id);
    const nativeStatus = asText(payload.status);
    const status: SubagentToolLogEntry["status"] =
      nativeStatus === "failed" || nativeStatus === "declined"
        ? "failed"
        : activity.kind === "tool.completed" || nativeStatus === "completed"
          ? "completed"
          : "running";
    entries.set(id, {
      id,
      title: asText(payload.title) ?? existing?.title ?? activity.summary,
      detail: asText(payload.detail) ?? existing?.detail ?? null,
      itemType: asText(payload.itemType) ?? existing?.itemType ?? null,
      status: existing && existing.status !== "running" ? existing.status : status,
      startedAt: existing?.startedAt ?? activity.createdAt,
      completedAt: existing?.completedAt ?? (status === "running" ? null : activity.createdAt),
    });
  }
  return Array.from(entries.values());
}
