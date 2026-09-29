import { describe, expect, it } from "vite-plus/test";
import type { OrchestrationThreadActivity } from "@t3tools/contracts";

import {
  applyAgentPanelView,
  DEFAULT_AGENT_PANEL_VIEW,
  deriveSubagentToolLog,
  type AgentPanelView,
} from "./agentPanelView.ts";
import { deriveAgentPanelModel, foldSubagentActivities } from "./subagentRuntime.ts";

let sequence = 0;
function activity(kind: string, payload: Record<string, unknown>): OrchestrationThreadActivity {
  sequence += 1;
  return {
    id: `activity-${sequence}`,
    tone: "info",
    kind,
    summary: kind,
    payload: kind.startsWith("task.") ? { agentKind: "agent", ...payload } : payload,
    turnId: null,
    createdAt: `2026-08-01T10:${String(Math.floor(sequence / 60)).padStart(2, "0")}:${String(sequence % 60).padStart(2, "0")}.000Z`,
  } as unknown as OrchestrationThreadActivity;
}

function start(taskId: string, extra: Record<string, unknown> = {}) {
  return activity("task.started", { taskId, taskType: "local_agent", title: taskId, ...extra });
}

function complete(taskId: string, tokens: number, status = "completed") {
  return activity("task.completed", {
    taskId,
    status,
    summary: `${taskId} done`,
    typedUsage: { totalTokens: tokens },
  });
}

function model(rows: ReadonlyArray<OrchestrationThreadActivity>) {
  return deriveAgentPanelModel({ agents: foldSubagentActivities(rows) });
}

function ids(view: AgentPanelView, rows: ReadonlyArray<OrchestrationThreadActivity>) {
  return applyAgentPanelView(model(rows), view).directAgents.map((agent) => agent.id);
}

describe("applyAgentPanelView", () => {
  const rows = [
    start("alpha", { role: "Explore" }),
    start("beta", { role: "Plan" }),
    start("gamma", { model: "claude-haiku-4-5" }),
    start("delta"),
    complete("alpha", 500),
    complete("beta", 9000, "failed"),
    complete("delta", 2000),
  ];

  it("keeps spawn order by default", () => {
    expect(ids(DEFAULT_AGENT_PANEL_VIEW, rows)).toEqual(["alpha", "beta", "gamma", "delta"]);
  });

  it("filters by status and matches role or model text", () => {
    expect(ids({ ...DEFAULT_AGENT_PANEL_VIEW, statuses: ["done"] }, rows)).toEqual([
      "alpha",
      "delta",
    ]);
    expect(ids({ ...DEFAULT_AGENT_PANEL_VIEW, query: "explore" }, rows)).toEqual(["alpha"]);
    expect(ids({ ...DEFAULT_AGENT_PANEL_VIEW, query: "HAIKU" }, rows)).toEqual(["gamma"]);
  });

  it("pins working agents first so live rows never move on token updates", () => {
    expect(ids({ ...DEFAULT_AGENT_PANEL_VIEW, sort: "tokens" }, rows)).toEqual([
      "gamma",
      "beta",
      "delta",
      "alpha",
    ]);
    expect(ids({ ...DEFAULT_AGENT_PANEL_VIEW, sort: "status" }, rows)).toEqual([
      "gamma",
      "beta",
      "alpha",
      "delta",
    ]);
  });

  it("hides workflow phases a filter emptied and drops workflows with no matches", () => {
    const workflowRows = [
      activity("task.started", {
        taskId: "wf",
        taskType: "local_workflow",
        title: "Review",
        phases: [
          { index: 0, title: "Scan" },
          { index: 1, title: "Verify" },
        ],
      }),
      activity("task.progress", {
        taskId: "wf:wf:0",
        parentAgentId: "wf",
        phaseIndex: 0,
        title: "scanner",
        status: "completed",
      }),
      activity("task.progress", {
        taskId: "wf:wf:1",
        parentAgentId: "wf",
        phaseIndex: 1,
        title: "verifier",
        status: "running",
      }),
    ];
    const working = applyAgentPanelView(model(workflowRows), {
      ...DEFAULT_AGENT_PANEL_VIEW,
      statuses: ["working"],
    });
    expect(working.workflows[0]?.phases.map((phase) => phase.title)).toEqual(["Verify"]);
    expect(working.visibleCount).toBe(1);

    const failed = applyAgentPanelView(model(workflowRows), {
      ...DEFAULT_AGENT_PANEL_VIEW,
      statuses: ["failed"],
    });
    expect(failed.workflows).toEqual([]);
    expect(failed.visibleCount).toBe(0);
  });
});

describe("deriveSubagentToolLog", () => {
  it("collects one entry per tool call owned by the agent", () => {
    const rows = [
      activity("tool.started", { agentId: "alpha", toolCallId: "t1", title: "Read file" }),
      activity("tool.started", { agentId: "beta", toolCallId: "t2", title: "Other agent" }),
      activity("tool.started", { toolCallId: "t3", title: "Main thread" }),
      activity("tool.updated", { agentId: "alpha", toolCallId: "t1", detail: "src/a.ts" }),
      activity("tool.completed", { agentId: "alpha", toolCallId: "t1", status: "completed" }),
      activity("tool.started", { agentId: "alpha", toolCallId: "t4", title: "Run tests" }),
      activity("tool.completed", { agentId: "alpha", toolCallId: "t4", status: "failed" }),
    ];
    const log = deriveSubagentToolLog(rows, "alpha");
    expect(log.map(({ id, title, detail, status }) => ({ id, title, detail, status }))).toEqual([
      { id: "t1", title: "Read file", detail: "src/a.ts", status: "completed" },
      { id: "t4", title: "Run tests", detail: null, status: "failed" },
    ]);
    expect(log[0]?.completedAt).not.toBeNull();
  });
});

describe("foldSubagentActivities prompt", () => {
  it("keeps the launch prompt from the start row", () => {
    const [agent] = foldSubagentActivities([
      start("alpha", { prompt: "Find every caller of foo" }),
      complete("alpha", 10),
    ]);
    expect(agent?.prompt).toBe("Find every caller of foo");
  });
});
