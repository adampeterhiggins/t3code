import { describe, expect, it } from "vite-plus/test";
import type { OrchestrationThreadActivity } from "@t3tools/contracts";

import {
  applyAgentPanelView,
  DEFAULT_AGENT_PANEL_VIEW,
  applySubagentToolLogView,
  applySubagentTranscriptView,
  DEFAULT_SUBAGENT_TOOL_LOG_VIEW,
  DEFAULT_SUBAGENT_TRANSCRIPT_VIEW,
  deriveSubagentToolLog,
  deriveSubagentToolLogs,
  subagentToolCallText,
  subagentTranscriptToolKind,
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
  it("preserves edit previews across lifecycle updates and searches their contents", () => {
    const log = deriveSubagentToolLog(
      [
        activity("tool.started", {
          agentId: "alpha",
          toolCallId: "edit",
          title: "Edit",
          data: {
            preview: "src/a.ts\n\nBefore\nbefore\n\nAfter\nfixed",
          },
        }),
        activity("tool.completed", { agentId: "alpha", toolCallId: "edit" }),
      ],
      "alpha",
    );
    expect(subagentToolCallText(log[0]!)).toContain("After\nfixed");
    expect(
      applySubagentToolLogView(log, { query: "fixed", statuses: [], kinds: [], sort: "oldest" }),
    ).toHaveLength(1);
  });

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

describe("deriveSubagentToolLog kinds and commands", () => {
  it("classifies calls like the chat and keeps the full command", () => {
    const log = deriveSubagentToolLog(
      [
        activity("tool.completed", {
          agentId: "alpha",
          toolCallId: "c1",
          itemType: "command_execution",
          title: "Ran command",
          detail: "vp test run",
          data: { rawInput: { command: "vp test run src/a.test.ts --reporter verbose" } },
        }),
        activity("tool.completed", {
          agentId: "alpha",
          toolCallId: "c2",
          itemType: "dynamic_tool_call",
          title: "Read file",
        }),
        activity("tool.completed", {
          agentId: "alpha",
          toolCallId: "c3",
          itemType: "file_change",
          title: "Edit src/a.ts",
        }),
        activity("tool.completed", {
          agentId: "alpha",
          toolCallId: "c4",
          itemType: "web_search",
          title: "Web search",
        }),
      ],
      "alpha",
    );
    expect(log.map((entry) => entry.kind)).toEqual(["command", "read", "edit", "web"]);
    expect(subagentToolCallText(log[0]!)).toBe(
      "Ran command\n\nvp test run\n\nvp test run src/a.test.ts --reporter verbose",
    );
  });
});

describe("applySubagentToolLogView", () => {
  const log = deriveSubagentToolLog(
    [
      activity("tool.started", {
        agentId: "a",
        toolCallId: "t1",
        title: "Read file",
        detail: "a.ts",
      }),
      activity("tool.completed", { agentId: "a", toolCallId: "t1" }),
      activity("tool.started", {
        agentId: "a",
        toolCallId: "t2",
        itemType: "command_execution",
        title: "Ran command",
        detail: "vp test run",
      }),
      activity("tool.updated", { agentId: "a", toolCallId: "t2" }),
      activity("tool.updated", { agentId: "a", toolCallId: "t2" }),
      activity("tool.completed", { agentId: "a", toolCallId: "t2", status: "failed" }),
      activity("tool.started", {
        agentId: "a",
        toolCallId: "t3",
        title: "Read file",
        detail: "b.ts",
      }),
    ],
    "a",
  );
  const ids = (view: Partial<typeof DEFAULT_SUBAGENT_TOOL_LOG_VIEW>) =>
    applySubagentToolLogView(log, { ...DEFAULT_SUBAGENT_TOOL_LOG_VIEW, ...view }).map((e) => e.id);

  it("defaults to newest first", () => {
    expect(ids({})).toEqual(["t3", "t2", "t1"]);
    expect(ids({ sort: "oldest" })).toEqual(["t1", "t2", "t3"]);
  });

  it("sorts running calls first, then by duration", () => {
    expect(ids({ sort: "duration" })).toEqual(["t3", "t2", "t1"]);
  });

  it("filters by status and kind, and searches the full call", () => {
    expect(ids({ statuses: ["failed"] })).toEqual(["t2"]);
    expect(ids({ kinds: ["command"] })).toEqual(["t2"]);
    expect(ids({ query: "B.TS" })).toEqual(["t3"]);
  });
});

describe("applySubagentTranscriptView", () => {
  const entries = [
    { kind: "user", text: "Find the bug" },
    { kind: "reasoning", text: "Check the parser" },
    { kind: "tool", text: "Ran", toolName: "Bash", input: "rg parse", output: "src/parse.ts:12" },
    { kind: "assistant", text: "Found it in the parser" },
  ] as const;

  it("keeps transcript order by default and preserves positions", () => {
    const visible = applySubagentTranscriptView(entries, DEFAULT_SUBAGENT_TRANSCRIPT_VIEW);
    expect(visible.map((row) => row.index)).toEqual([0, 1, 2, 3]);
    const newest = applySubagentTranscriptView(entries, {
      ...DEFAULT_SUBAGENT_TRANSCRIPT_VIEW,
      sort: "newest",
    });
    expect(newest.map((row) => row.index)).toEqual([3, 2, 1, 0]);
  });

  it("groups user and agent text as messages and searches tool output", () => {
    const messages = applySubagentTranscriptView(entries, {
      ...DEFAULT_SUBAGENT_TRANSCRIPT_VIEW,
      kinds: ["message"],
    });
    expect(messages.map((row) => row.index)).toEqual([0, 3]);
    const byOutput = applySubagentTranscriptView(entries, {
      ...DEFAULT_SUBAGENT_TRANSCRIPT_VIEW,
      query: "parse.ts",
    });
    expect(byOutput.map((row) => row.index)).toEqual([2]);
  });
});

describe("deriveSubagentToolLogs", () => {
  it("groups every agent's calls in one pass and ignores untagged ones", () => {
    const logs = deriveSubagentToolLogs([
      activity("tool.started", { agentId: "a", toolCallId: "t1", title: "Read file" }),
      activity("tool.started", { agentId: "b", toolCallId: "t2", title: "Ran command" }),
      activity("tool.started", { toolCallId: "t3", title: "Main thread" }),
      activity("tool.started", { agentId: "a", toolCallId: "t4", title: "Edit" }),
    ]);
    expect([...logs.keys()]).toEqual(["a", "b"]);
    expect(logs.get("a")?.map((entry) => entry.id)).toEqual(["t1", "t4"]);
  });
});

describe("deriveAgentPanelModel footer totals", () => {
  it("splits settled agents by outcome and sums reported usage", () => {
    const panel = model([
      start("a"),
      activity("task.completed", {
        taskId: "a",
        status: "completed",
        typedUsage: { totalTokens: 100, inputTokens: 80, cachedInputTokens: 40, outputTokens: 20 },
      }),
      start("b"),
      activity("task.completed", {
        taskId: "b",
        status: "failed",
        typedUsage: { totalTokens: 50, inputTokens: 30 },
      }),
      start("c"),
      complete("c", 10, "stopped"),
      start("d"),
    ]);
    expect([
      panel.completedCount,
      panel.failedCount,
      panel.stoppedCount,
      panel.runningCount,
    ]).toEqual([1, 1, 1, 1]);
    expect(panel.totalTokens).toBe(160);
    expect(panel.usageTotals).toEqual({
      inputTokens: 110,
      cachedInputTokens: 40,
      outputTokens: 20,
    });
  });
});

describe("subagentTranscriptToolKind", () => {
  it("maps native tool names onto the log's families", () => {
    expect(
      [
        "Bash",
        "exec_command",
        "Read",
        "Edit",
        "Grep",
        "WebSearch",
        "WebFetch",
        "Task",
        undefined,
      ].map(subagentTranscriptToolKind),
    ).toEqual(["command", "command", "read", "edit", "search", "web", "web", "other", "other"]);
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
