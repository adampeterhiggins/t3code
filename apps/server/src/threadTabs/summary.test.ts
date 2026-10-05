import { describe, expect, it } from "@effect/vitest";
import {
  CheckpointId,
  CheckpointScopeId,
  MessageId,
  PlanId,
  RunId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2CheckpointFileSummary,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import {
  siblingChatBeforeMessage,
  siblingChatThroughMessage,
  summarizeSiblingChat,
} from "./summary.ts";

const NOW = DateTime.makeUnsafe("2026-10-05T12:00:00.000Z");
let ordinal = 0;

const base = (runId: string | null = "run-1") => {
  ordinal += 1;
  return {
    id: TurnItemId.make(`item-${ordinal}`),
    threadId: ThreadId.make("thread"),
    runId: runId === null ? null : RunId.make(runId),
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal,
    status: "completed" as const,
    title: null,
    startedAt: NOW,
    completedAt: NOW,
    updatedAt: NOW,
  };
};

const user = (id: string, text: string, runId = "run-1"): OrchestrationV2TurnItem => ({
  ...base(runId),
  type: "user_message",
  createdBy: "user",
  creationSource: "web",
  messageId: MessageId.make(id),
  inputIntent: "turn_start",
  text,
  attachments: [],
});

const assistant = (
  id: string,
  text: string,
  options: { readonly streaming?: boolean; readonly runId?: string } = {},
): OrchestrationV2TurnItem => ({
  ...base(options.runId ?? "run-1"),
  type: "assistant_message",
  messageId: MessageId.make(id),
  text,
  streaming: options.streaming ?? false,
});

const reasoning = (text: string): OrchestrationV2TurnItem => ({
  ...base(),
  type: "reasoning",
  text,
  streaming: false,
});

const command = (
  input: string,
  options: { readonly exitCode?: number; readonly runId?: string } = {},
): OrchestrationV2TurnItem => ({
  ...base(options.runId ?? "run-1"),
  type: "command_execution",
  input,
  ...(options.exitCode === undefined ? {} : { exitCode: options.exitCode }),
});

const edit = (fileName: string, runId = "run-1"): OrchestrationV2TurnItem => ({
  ...base(runId),
  type: "file_change",
  fileName,
});

const failure = (message: string): OrchestrationV2TurnItem => ({
  ...base(),
  type: "error",
  status: "failed",
  failure: { class: "provider_error", message, code: null, retryable: null },
});

const checkpoint = (
  files: ReadonlyArray<OrchestrationV2CheckpointFileSummary>,
  runId = "run-1",
): OrchestrationV2TurnItem => ({
  ...base(runId),
  type: "checkpoint",
  checkpointId: CheckpointId.make(`checkpoint-${ordinal}`),
  scopeId: CheckpointScopeId.make("scope"),
  files,
});

const plan = (markdown: string, runId = "run-1"): OrchestrationV2TurnItem => ({
  ...base(runId),
  type: "proposed_plan",
  planId: PlanId.make(`plan-${ordinal}`),
  markdown,
  streaming: false,
});

const file = (path: string, additions: number, deletions = 0) => ({
  path,
  kind: "modified",
  additions,
  deletions,
});

describe("sibling chat handoff", () => {
  it("interleaves dialogue with tool calls, reasoning, errors, files and the latest plan", () => {
    const summary = summarizeSiblingChat({
      title: "Search",
      worktreePath: "/repo",
      latestRunStatus: "completed",
      items: [
        user("u1", "Fix the flaky search test"),
        command("/bin/zsh -lc 'cd /repo && vp test run apps/web/src/search.test.ts'"),
        command("git status", { exitCode: 1 }),
        edit("/repo/apps/web/src/search.ts"),
        failure("transport failure"),
        reasoning("The debounce races the fake timers"),
        plan("1. Flush timers"),
        assistant("a1", "Fixed by flushing timers"),
        checkpoint([file("apps/web/src/search.ts", 3, 1)]),
        checkpoint([file("apps/web/src/search.ts", 2)]),
      ],
    });

    expect(summary).toContain("Latest turn: completed");
    expect(summary).toContain("- apps/web/src/search.ts (+5 −1)");
    expect(summary).toContain("Latest plan:\n1. Flush timers");
    expect(summary).toContain(
      "Tools: Command: 'vp test run apps/web/src/search.test.ts' · Command: git status (failed) · Edit: apps/web/src/search.ts",
    );
    expect(summary).toContain("Error: transport failure");
    expect(summary).toContain("Reasoning (excerpt): The debounce races the fake timers");
    expect(summary.indexOf("User: Fix")).toBeLessThan(summary.indexOf("Tools:"));
    expect(summary.indexOf("Tools:")).toBeLessThan(summary.indexOf("Assistant: Fixed"));
  });

  it("keeps the opening request and newest turns when the budget runs out", () => {
    const items = [user("first", "Build the search view")];
    for (let index = 0; index < 20; index++) {
      items.push(user(`u${index}`, `Follow-up ${index}`));
      items.push(assistant(`a${index}`, `Detail ${index} ${"x".repeat(1_500)}`));
    }
    items.push(assistant("live", "unfinished", { streaming: true }));
    const summary = summarizeSiblingChat({ title: "Search work", items });

    expect(summary.length).toBeLessThanOrEqual(16_000);
    expect(summary).toContain("User: Build the search view");
    expect(summary).toContain("Follow-up 19");
    expect(summary).not.toContain("Follow-up 0\n");
    expect(summary).toMatch(/\[\d+ turns omitted\]/);
    expect(summary).not.toContain("unfinished");
  });

  it("clips long messages at both ends so conclusions survive", () => {
    const summary = summarizeSiblingChat({
      title: "Long",
      items: [user("u", "Go"), assistant("a", `Start ${"y".repeat(10_000)} Conclusion`)],
    });
    expect(summary).toContain("Assistant: Start");
    expect(summary).toContain("Conclusion");
    expect(summary.length).toBeLessThan(3_000);
  });

  it("forks from a user message with only the history before it", () => {
    const chat = {
      title: "Search",
      latestRunStatus: "completed",
      items: [
        user("u1", "Build the search view"),
        command("cat search.ts"),
        assistant("a1", "Built it"),
        checkpoint([file("search.ts", 1)]),
        user("u2", "Now add filters", "run-2"),
        command("cat filters.ts", { runId: "run-2" }),
        assistant("a2", "Added filters", { runId: "run-2" }),
        checkpoint([file("filters.ts", 4)], "run-2"),
      ],
    };

    const forked = siblingChatBeforeMessage(chat, MessageId.make("u2"));
    expect(forked).not.toBeNull();
    const summary = summarizeSiblingChat(forked!);
    expect(summary).toContain("User: Build the search view");
    expect(summary).toContain("Assistant: Built it");
    expect(summary).toContain("Command: cat search.ts");
    expect(summary).toContain("search.ts (+1 −0)");
    expect(summary).not.toContain("Now add filters");
    expect(summary).not.toContain("Added filters");
    expect(summary).not.toContain("filters.ts");
    expect(summary).not.toContain("Latest turn");

    expect(siblingChatBeforeMessage(chat, MessageId.make("a1"))).toBeNull();
    expect(siblingChatBeforeMessage(chat, MessageId.make("missing"))).toBeNull();
  });

  it("forks through a completed assistant response with its checkpoint but no later work", () => {
    const chat = {
      title: "Search",
      latestRunStatus: "running",
      items: [
        user("u1", "Build search"),
        command("cat search.ts"),
        plan("Build the search view"),
        assistant("a1", "Built search"),
        checkpoint([file("search.ts", 1)]),
        user("u2", "Add filters", "run-2"),
        plan("Add filters", "run-2"),
        command("cat filters.ts", { runId: "run-2" }),
        assistant("a2", "Added filters", { runId: "run-2" }),
        checkpoint([file("filters.ts", 4)], "run-2"),
      ],
    };
    const forked = siblingChatThroughMessage(chat, MessageId.make("a1"));
    const summary = summarizeSiblingChat(forked!);
    expect(summary).toContain("User: Build search");
    expect(summary).toContain("Assistant: Built search");
    expect(summary).toContain("Command: cat search.ts");
    expect(summary).toContain("search.ts (+1 −0)");
    expect(summary).toContain("Latest plan:\nBuild the search view");
    expect(summary).not.toContain("filters");
    expect(summary).not.toContain("Latest turn");
  });

  it("rejects assistant fork cutoffs that are missing, streaming, or another role", () => {
    const chat = {
      title: "Search",
      items: [user("u1", "Build search"), assistant("a1", "Working", { streaming: true })],
    };
    for (const id of ["missing", "u1", "a1"]) {
      expect(siblingChatThroughMessage(chat, MessageId.make(id))).toBeNull();
    }
  });
});
