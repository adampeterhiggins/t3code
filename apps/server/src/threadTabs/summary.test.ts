import { describe, expect, it } from "@effect/vitest";
import {
  CheckpointRef,
  EventId,
  MessageId,
  TurnId,
  type OrchestrationCheckpointSummary,
  type OrchestrationMessage,
  type OrchestrationThreadActivity,
} from "@t3tools/contracts";
import {
  siblingChatBeforeMessage,
  siblingChatThroughMessage,
  summarizeSiblingChat,
} from "./summary.ts";

let clock = 0;
// Strictly increasing timestamps order the fixture chronologically.
const at = () => `2026-01-01T00:00:00.${String(clock++).padStart(3, "0")}Z`;

const message = (
  id: string,
  role: OrchestrationMessage["role"],
  text: string,
  streaming = false,
): OrchestrationMessage => {
  const createdAt = at();
  return {
    id: MessageId.make(id),
    role,
    text,
    turnId: null,
    streaming,
    createdAt,
    updatedAt: createdAt,
  };
};

const activity = (
  kind: string,
  summary: string,
  payload: unknown,
  tone: OrchestrationThreadActivity["tone"] = "tool",
): OrchestrationThreadActivity => ({
  id: EventId.make(`activity-${clock}`),
  tone,
  kind,
  summary,
  payload,
  turnId: null,
  createdAt: at(),
});

const checkpoint = (
  files: OrchestrationCheckpointSummary["files"],
): OrchestrationCheckpointSummary => ({
  turnId: TurnId.make(`turn-${clock}`),
  checkpointTurnCount: 1,
  checkpointRef: CheckpointRef.make(`ref-${clock}`),
  status: "ready",
  files,
  assistantMessageId: null,
  completedAt: at(),
});

describe("sibling chat handoff", () => {
  it("interleaves dialogue with tool calls, reasoning, errors, files and the latest plan", () => {
    const messages = [message("u1", "user", "Fix the flaky search test")];
    const activities = [
      activity("tool.started", "Command run started", { detail: "Bash: {}" }),
      // Claude: generic summary, truncated detail, full input under data.
      activity("tool.completed", "Command run", {
        status: "completed",
        detail: "Bash: cd /repo && vp test run apps/web/src/sea...",
        data: {
          toolName: "Bash",
          input: { command: "cd /repo && vp test run apps/web/src/search.test.ts" },
        },
      }),
      // Codex: shell wrapper in the detail.
      activity("tool.completed", "Ran command", {
        status: "failed",
        detail: "/bin/zsh -lc 'git status'",
      }),
      // ACP: the summary already says it all.
      activity("tool.completed", "Read apps/web/src/search.ts (1 - 40)", { status: "completed" }),
      activity("tool.completed", "File change", {
        status: "completed",
        detail: 'Edit: {"file_path":"/repo/apps/web/src/search.ts","old_string":"a...',
        data: { toolName: "Edit", input: { file_path: "/repo/apps/web/src/search.ts" } },
      }),
      activity(
        "provider.turn.start.failed",
        "Provider turn start failed",
        {
          detail: "transport failure",
        },
        "error",
      ),
    ];
    messages.push(message("r1", "reasoning", "The debounce races the fake timers"));
    messages.push(message("a1", "assistant", "Fixed by flushing timers"));
    const summary = summarizeSiblingChat({
      title: "Search",
      worktreePath: "/repo",
      latestTurnState: "completed",
      messages: messages.toSorted((a, b) => a.createdAt.localeCompare(b.createdAt)),
      activities,
      checkpoints: [
        checkpoint([
          { path: "apps/web/src/search.ts", kind: "modified", additions: 3, deletions: 1 },
        ]),
        checkpoint([
          { path: "apps/web/src/search.ts", kind: "modified", additions: 2, deletions: 0 },
        ]),
      ],
      proposedPlans: [
        {
          id: "plan",
          turnId: null,
          planMarkdown: "1. Flush timers",
          implementedAt: null,
          implementationThreadId: null,
          createdAt: at(),
          updatedAt: at(),
        },
      ],
    });

    expect(summary).toContain("Latest turn: completed");
    expect(summary).toContain("- apps/web/src/search.ts (+5 −1)");
    expect(summary).toContain("Latest plan:\n1. Flush timers");
    expect(summary).toContain(
      "Tools: Bash: vp test run apps/web/src/search.test.ts · Ran command: 'git status' (failed) · Read apps/web/src/search.ts (1 - 40) · Edit: apps/web/src/search.ts",
    );
    expect(summary).not.toContain("Command run started");
    expect(summary).toContain("Error: Provider turn start failed: transport failure");
    expect(summary).toContain("Reasoning (excerpt): The debounce races the fake timers");
    expect(summary.indexOf("User: Fix")).toBeLessThan(summary.indexOf("Tools:"));
    expect(summary.indexOf("Tools:")).toBeLessThan(summary.indexOf("Assistant: Fixed"));
  });

  it("keeps the opening request and newest turns when the budget runs out", () => {
    const messages = [message("first", "user", "Build the search view")];
    for (let index = 0; index < 20; index++) {
      messages.push(message(`u${index}`, "user", `Follow-up ${index}`));
      messages.push(message(`a${index}`, "assistant", `Detail ${index} ${"x".repeat(1_500)}`));
    }
    messages.push(message("live", "assistant", "unfinished", true));
    const summary = summarizeSiblingChat({ title: "Search work", messages });

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
      messages: [
        message("u", "user", "Go"),
        message("a", "assistant", `Start ${"y".repeat(10_000)} Conclusion`),
      ],
    });
    expect(summary).toContain("Assistant: Start");
    expect(summary).toContain("Conclusion");
    expect(summary.length).toBeLessThan(3_000);
  });

  it("forks from a user message with only the history before it", () => {
    const messages = [
      message("u1", "user", "Build the search view"),
      message("a1", "assistant", "Built it"),
    ];
    const earlyTool = activity("tool.completed", "Read search.ts", { status: "completed" });
    const earlyFiles = checkpoint([
      { path: "search.ts", kind: "modified", additions: 1, deletions: 0 },
    ]);
    messages.push(message("u2", "user", "Now add filters"));
    messages.push(message("a2", "assistant", "Added filters"));
    const lateTool = activity("tool.completed", "Read filters.ts", { status: "completed" });
    const lateFiles = checkpoint([
      { path: "filters.ts", kind: "modified", additions: 4, deletions: 0 },
    ]);
    const chat = {
      title: "Search",
      latestTurnState: "completed",
      messages,
      activities: [earlyTool, lateTool],
      checkpoints: [earlyFiles, lateFiles],
    };

    const forked = siblingChatBeforeMessage(chat, "u2");
    expect(forked).not.toBeNull();
    const summary = summarizeSiblingChat(forked!);
    expect(summary).toContain("User: Build the search view");
    expect(summary).toContain("Assistant: Built it");
    expect(summary).toContain("Read search.ts");
    expect(summary).toContain("search.ts (+1 −0)");
    expect(summary).not.toContain("Now add filters");
    expect(summary).not.toContain("Added filters");
    expect(summary).not.toContain("filters.ts");
    expect(summary).not.toContain("Latest turn");

    expect(siblingChatBeforeMessage(chat, "a1")).toBeNull();
    expect(siblingChatBeforeMessage(chat, "missing")).toBeNull();
  });
  it("forks through a completed assistant response without later dialogue or work", () => {
    const opening = message("u1", "user", "Build search");
    const answer = message("a1", "assistant", "Built search");
    // Tool work can land while the assistant response is streaming.
    const earlyTool = activity("tool.completed", "Read search.ts", {});
    const earlyFiles = checkpoint([
      { path: "search.ts", kind: "modified", additions: 1, deletions: 0 },
    ]);
    const plan = {
      id: "early-plan",
      turnId: null,
      planMarkdown: "Build the search view",
      implementedAt: null,
      implementationThreadId: null,
      createdAt: at(),
      updatedAt: at(),
    };
    const completedAnswer = { ...answer, updatedAt: at() };
    const later = message("u2", "user", "Add filters");
    const lateTool = activity("tool.completed", "Read filters.ts", {});
    const lateFiles = checkpoint([
      { path: "filters.ts", kind: "modified", additions: 4, deletions: 0 },
    ]);
    const chat = {
      title: "Search",
      latestTurnState: "running",
      messages: [opening, completedAnswer, later, message("a2", "assistant", "Added filters")],
      activities: [earlyTool, lateTool],
      checkpoints: [earlyFiles, lateFiles],
      proposedPlans: [
        plan,
        { ...plan, id: "late-plan", planMarkdown: "Add filters", updatedAt: at() },
      ],
    };
    const forked = siblingChatThroughMessage(chat, "a1");
    expect(forked?.messages.map((entry) => entry.id)).toEqual(["u1", "a1"]);
    const summary = summarizeSiblingChat(forked!);
    expect(summary).toContain("User: Build search");
    expect(summary).toContain("Assistant: Built search");
    expect(summary).toContain("Read search.ts");
    expect(summary).toContain("search.ts (+1 −0)");
    expect(summary).toContain("Latest plan:\nBuild the search view");
    expect(summary).not.toContain("filters");
    expect(summary).not.toContain("Latest turn");
  });

  it("rejects assistant fork cutoffs that are missing, streaming, or another role", () => {
    const chat = {
      title: "Search",
      messages: [
        message("u1", "user", "Build search"),
        message("a1", "assistant", "Working", true),
        message("r1", "reasoning", "Thinking"),
      ],
    };
    for (const id of ["missing", "u1", "a1", "r1"]) {
      expect(siblingChatThroughMessage(chat, id)).toBeNull();
    }
  });
});
