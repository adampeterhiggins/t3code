import { describe, expect, it } from "vite-plus/test";
import { ThreadId, TurnItemId, type OrchestrationV2TurnItem } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import {
  applyAgentListView,
  applySubagentToolCallView,
  DEFAULT_AGENT_LIST_VIEW,
  DEFAULT_SUBAGENT_TOOL_CALL_VIEW,
  deriveSubagentToolCalls,
  latestSubagentToolCall,
  subagentContinuationContext,
  subagentResultChatContext,
  type AgentListSubject,
  type SubagentToolCall,
} from "./agentListView.ts";

const at = (iso: string) => DateTime.makeUnsafe(iso);

function agent(
  overrides: Partial<AgentListSubject> & { readonly title: string },
): AgentListSubject {
  return {
    model: null,
    status: "completed",
    usage: null,
    spawnedAt: null,
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

const identity = (subject: AgentListSubject) => subject;
const titles = (agents: ReadonlyArray<AgentListSubject>) => agents.map((entry) => entry.title);

describe("applyAgentListView", () => {
  const scout = agent({
    title: "Scout",
    status: "running",
    model: "claude-haiku",
    spawnedAt: "2026-10-05T10:00:02.000Z",
  });
  const builder = agent({
    title: "Builder",
    status: "completed",
    usage: { totalTokens: 900 },
    spawnedAt: "2026-10-05T10:00:01.000Z",
    startedAt: "2026-10-05T10:00:01.000Z",
    completedAt: "2026-10-05T10:01:00.000Z",
  });
  const reviewer = agent({
    title: "Reviewer",
    status: "failed",
    usage: { totalTokens: 4_000 },
    spawnedAt: "2026-10-05T10:00:03.000Z",
    startedAt: "2026-10-05T10:00:03.000Z",
    completedAt: "2026-10-05T10:00:10.000Z",
  });
  const agents = [scout, reviewer, builder];

  it("orders agents by spawn time by default, whatever order they arrive in", () => {
    expect(titles(applyAgentListView(agents, DEFAULT_AGENT_LIST_VIEW, identity))).toEqual([
      "Builder",
      "Scout",
      "Reviewer",
    ]);
  });

  it("keeps agents without a spawn time after the rest, in arrival order", () => {
    const late = agent({ title: "Late" });
    expect(
      titles(applyAgentListView([late, scout, builder], DEFAULT_AGENT_LIST_VIEW, identity)),
    ).toEqual(["Builder", "Scout", "Late"]);
  });

  it("filters by status group and searches title and model", () => {
    expect(
      titles(
        applyAgentListView(agents, { ...DEFAULT_AGENT_LIST_VIEW, statuses: ["working"] }, identity),
      ),
    ).toEqual(["Scout"]);
    expect(
      titles(applyAgentListView(agents, { ...DEFAULT_AGENT_LIST_VIEW, query: "HAIKU" }, identity)),
    ).toEqual(["Scout"]);
    expect(
      titles(
        applyAgentListView(
          agents,
          { ...DEFAULT_AGENT_LIST_VIEW, statuses: ["done", "failed"], query: "er" },
          identity,
        ),
      ),
    ).toEqual(["Builder", "Reviewer"]);
  });

  it("sorts by status rank without reordering agents that share a status", () => {
    const second = agent({
      title: "Second scout",
      status: "pending",
      spawnedAt: "2026-10-05T10:00:04.000Z",
    });
    expect(
      titles(
        applyAgentListView(
          [...agents, second],
          { ...DEFAULT_AGENT_LIST_VIEW, sort: "status" },
          identity,
        ),
      ),
    ).toEqual(["Scout", "Second scout", "Reviewer", "Builder"]);
  });

  it("keeps working agents first in spawn order for token and duration sorts", () => {
    expect(
      titles(applyAgentListView(agents, { ...DEFAULT_AGENT_LIST_VIEW, sort: "tokens" }, identity)),
    ).toEqual(["Scout", "Reviewer", "Builder"]);
    expect(
      titles(
        applyAgentListView(agents, { ...DEFAULT_AGENT_LIST_VIEW, sort: "duration" }, identity),
      ),
    ).toEqual(["Scout", "Builder", "Reviewer"]);
  });
});

const threadId = ThreadId.make("thread-child");

function item(
  fields: Record<string, unknown> & {
    readonly id: string;
    readonly type: OrchestrationV2TurnItem["type"];
    readonly ordinal: number;
  },
): OrchestrationV2TurnItem {
  return {
    threadId,
    runId: null,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    status: "completed",
    title: null,
    startedAt: at("2026-10-05T10:00:00.000Z"),
    completedAt: at("2026-10-05T10:00:01.000Z"),
    updatedAt: at("2026-10-05T10:00:01.000Z"),
    ...fields,
    id: TurnItemId.make(fields.id),
  } as OrchestrationV2TurnItem;
}

describe("deriveSubagentToolCalls", () => {
  const root = "/repo/app";
  const items = [
    item({
      id: "msg",
      type: "assistant_message",
      ordinal: 0,
      messageId: "m",
      text: "Looking",
      streaming: false,
    }),
    item({
      id: "edit",
      type: "file_change",
      ordinal: 3,
      fileName: "/repo/app/src/a.ts",
      oldStr: "const a = 1;\n",
      newStr: "const a = 2;\n",
    }),
    item({
      id: "read",
      type: "dynamic_tool",
      ordinal: 2,
      toolName: "Read",
      input: { file_path: "/repo/app/src/a.ts", offset: 10, limit: 40 },
    }),
    item({
      id: "cmd",
      type: "command_execution",
      ordinal: 1,
      input: "cd /repo/app && bun test /repo/app/src",
      exitCode: 1,
      status: "failed",
    }),
    item({
      id: "grep",
      type: "dynamic_tool",
      ordinal: 4,
      toolName: "Grep",
      status: "running",
      completedAt: null,
      input: { pattern: "TODO", path: "/repo/app/src" },
    }),
  ];

  it("lists tool items oldest first with workspace-relative targets", () => {
    const calls = deriveSubagentToolCalls(items, root);
    expect(calls.map((call) => [call.id, call.kind, call.status, call.detail])).toEqual([
      ["cmd", "command", "failed", "bun test src"],
      ["read", "read", "completed", "src/a.ts"],
      ["edit", "edit", "completed", "src/a.ts"],
      ["grep", "search", "running", "Searched TODO in src"],
    ]);
    expect(calls[0]?.exitCode).toBe(1);
  });

  it("previews read ranges and bounded edit diffs with line counts", () => {
    const calls = deriveSubagentToolCalls(items, root);
    const read = calls.find((call) => call.id === "read");
    expect(read?.preview).toContain("Start line: 10");
    expect(read?.preview).toContain("Limit: 40");
    const edit = calls.find((call) => call.id === "edit");
    expect(edit?.preview).toContain("+1, −1 lines");
    expect(edit?.preview).toContain("-const a = 1;");
    expect(edit?.preview).toContain("+const a = 2;");
    expect(edit?.preview).not.toContain("/repo/app/");
  });

  it("offers a withheld edit diff for fetching and still shows its line counts", () => {
    const [call] = deriveSubagentToolCalls(
      [
        item({
          id: "slim-edit",
          type: "file_change",
          ordinal: 0,
          fileName: "/repo/app/src/b.ts",
          additions: 3,
          deletions: 1,
        }),
      ],
      root,
    );
    expect(call?.preview).toBe("+3, −1 lines");
    expect(call?.detailRevision).toBe("2026-10-05T10:00:01.000Z");
    expect(
      deriveSubagentToolCalls(items, root).find((entry) => entry.id === "edit")?.detailRevision,
    ).toBeNull();
  });

  it("shows calls relative to a Claude agent worktree or a sibling checkout the agent uses", () => {
    const worktree = "/repo/app/.claude/worktrees/agent-a1b2";
    const sibling = "/repo/app-task";
    const calls = deriveSubagentToolCalls(
      [
        item({
          id: "wt",
          type: "command_execution",
          ordinal: 0,
          input: `cd ${worktree} && bun test ${worktree}/src`,
        }),
        item({
          id: "s1",
          type: "dynamic_tool",
          ordinal: 1,
          toolName: "Read",
          input: { file_path: `${sibling}/src/a.ts` },
        }),
        item({
          id: "s2",
          type: "dynamic_tool",
          ordinal: 2,
          toolName: "Read",
          input: { file_path: `${sibling}/src/b.ts` },
        }),
        item({
          id: "own",
          type: "dynamic_tool",
          ordinal: 3,
          toolName: "Read",
          input: { file_path: "/repo/app/src/c.ts" },
        }),
      ],
      root,
    );
    expect(calls.map((call) => call.detail)).toEqual([
      "bun test src",
      "src/a.ts",
      "src/b.ts",
      "src/c.ts",
    ]);
    // One stray read of a neighbouring checkout stays absolute.
    expect(
      deriveSubagentToolCalls(
        [
          item({
            id: "once",
            type: "dynamic_tool",
            ordinal: 0,
            toolName: "Read",
            input: { file_path: `${sibling}/src/a.ts` },
          }),
        ],
        root,
      )[0]?.detail,
    ).toBe(`${sibling}/src/a.ts`);
  });

  it("picks the newest tool call for a working agent's row", () => {
    expect(latestSubagentToolCall(items, root)?.id).toBe("grep");
    expect(latestSubagentToolCall(items.slice(0, 1), root)).toBeNull();
  });

  it("filters, searches, and sorts the log", () => {
    const calls = deriveSubagentToolCalls(items, root);
    expect(
      applySubagentToolCallView(calls, DEFAULT_SUBAGENT_TOOL_CALL_VIEW).map((call) => call.id),
    ).toEqual(["grep", "edit", "read", "cmd"]);
    expect(
      applySubagentToolCallView(calls, {
        ...DEFAULT_SUBAGENT_TOOL_CALL_VIEW,
        kinds: ["read", "edit"],
        sort: "oldest",
      }).map((call) => call.id),
    ).toEqual(["read", "edit"]);
    expect(
      applySubagentToolCallView(calls, {
        ...DEFAULT_SUBAGENT_TOOL_CALL_VIEW,
        statuses: ["failed"],
      }).map((call) => call.id),
    ).toEqual(["cmd"]);
    expect(
      applySubagentToolCallView(calls, {
        ...DEFAULT_SUBAGENT_TOOL_CALL_VIEW,
        query: "limit: 40",
      }).map((call) => call.id),
    ).toEqual(["read"]);
  });
});

describe("chat context", () => {
  const finished = {
    title: "Scout",
    status: "completed" as const,
    prompt: "Find the flaky test",
    result: "It is in src/a.test.ts",
    error: null,
  };

  it("attaches a settled agent's task and result, and nothing while it works", () => {
    expect(subagentResultChatContext(finished)).toBe(
      'Findings from the "Scout" subagent.\n\nTask:\nFind the flaky test\n\nResult:\nIt is in src/a.test.ts',
    );
    expect(subagentResultChatContext({ ...finished, status: "running" })).toBeNull();
    expect(subagentResultChatContext({ ...finished, result: "  " })).toBeNull();
    expect(
      subagentResultChatContext({ ...finished, status: "failed", error: "Out of budget" }),
    ).toContain('The "Scout" subagent failed.');
  });

  it("carries the task, outcome and latest tool calls into a continuation", () => {
    const call = (id: string, status: SubagentToolCall["status"]): SubagentToolCall => ({
      id: TurnItemId.make(id),
      title: "Command",
      detail: `run ${id}`,
      kind: "command",
      status,
      startedAt: null,
      completedAt: null,
      exitCode: null,
      preview: null,
      detailRevision: null,
    });
    const calls = Array.from({ length: 42 }, (_, index) =>
      call(`c${index}`, index === 41 ? "failed" : "completed"),
    );
    const context = subagentContinuationContext(finished, calls);
    expect(context).toContain('The "Scout" subagent finished. Continue from its work.');
    expect(context).toContain("Task:\nFind the flaky test");
    expect(context).toContain("Result:\nIt is in src/a.test.ts");
    expect(context).toContain("Tool calls (latest 40 of 42):");
    expect(context).not.toContain("run c1\n");
    expect(context).toContain("- Command: run c41 (failed)");
  });

  it("continues a working agent from its progress instead of a result", () => {
    const context = subagentContinuationContext(
      { ...finished, status: "running", progress: "Reading tests" },
      [],
    );
    expect(context).toContain("still working");
    expect(context).toContain("Latest progress:\nReading tests");
    expect(context).not.toContain("Result:");
    expect(
      subagentContinuationContext(
        { ...finished, prompt: null, result: null, status: "running" },
        [],
      ),
    ).toBeNull();
  });
});
