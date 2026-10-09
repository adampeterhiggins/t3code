import { ThreadId, TurnItemId, type OrchestrationV2TurnItem } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { resolveToolPreview } from "./toolPreview.ts";

function tool(toolName: string, input: unknown, output?: unknown): OrchestrationV2TurnItem {
  const at = DateTime.makeUnsafe("2026-10-09T15:00:00.000Z");
  return {
    id: TurnItemId.make("tool"),
    threadId: ThreadId.make("thread"),
    runId: null,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: 0,
    status: "completed",
    title: null,
    startedAt: at,
    completedAt: at,
    updatedAt: at,
    type: "dynamic_tool",
    toolName,
    input,
    ...(output === undefined ? {} : { output }),
  };
}

const threadRead = {
  thread: {
    threadId: "child-thread",
    title: "K01 G10 stored-number reachability",
    status: "cancelled",
    model: "claude-haiku-5-5",
    branch: "task/K01-g10",
  },
  items: [
    { itemId: "a", type: "user_message", text: "Check reachability", title: null },
    { itemId: "b", type: "reasoning", text: "Reading seams.py", title: null },
    { itemId: "c", type: "dynamic_tool", text: null, title: "Read seams.py" },
    { itemId: "d", type: "assistant_message", text: "Reachable.", title: null },
    { itemId: "e", type: "assistant_message", text: "Done.", title: null },
  ],
};

describe("resolveToolPreview", () => {
  it("reads a thread from each provider's result shape", () => {
    const json = JSON.stringify(threadRead);
    const codex = tool("t3-code.t3_thread_read", { threadId: "child-thread" }, threadRead);
    const claude = tool(
      "mcp__t3-code__t3_thread_read",
      { threadId: "child-thread" },
      {
        content: json,
      },
    );
    const cursor = tool(
      "mcp__t3-code__t3_thread_read",
      { providerIdentifier: "t3-code", toolName: "t3_thread_read", args: { threadId: "x" } },
      { content: [{ text: { text: json } }], isError: false },
    );
    const expected = {
      kind: "thread",
      threadId: "child-thread",
      title: "K01 G10 stored-number reachability",
      status: "cancelled",
      model: "claude-haiku-5-5",
      branch: "task/K01-g10",
      items: [
        { key: "b", label: "Thinking", text: "Reading seams.py" },
        { key: "c", label: "Tool", text: "Read seams.py" },
        { key: "d", label: "Agent", text: "Reachable." },
        { key: "e", label: "Agent", text: "Done." },
      ],
      moreItems: 1,
    };
    expect(resolveToolPreview(codex)).toEqual(expected);
    expect(resolveToolPreview(claude)).toEqual(expected);
    expect(resolveToolPreview(cursor)).toEqual(expected);
  });

  it("shows a delegated task's state and the brief's title", () => {
    const preview = resolveToolPreview(
      tool(
        "t3-code.delegate_task",
        { title: "G10 reachability", task: "Long brief" },
        {
          childThreadId: "child",
          status: "running",
          workState: "working",
          model: "claude-haiku-5-5",
          summary: null,
          latestTerminalSummary: null,
        },
      ),
    );
    expect(preview).toEqual({
      kind: "task",
      threadId: "child",
      title: "G10 reachability",
      status: "working",
      model: "claude-haiku-5-5",
      summary: null,
    });
  });

  it("lists pull requests and says what a link or watch call did", () => {
    const listed = resolveToolPreview(
      tool(
        "t3-code.list_thread_pull_requests",
        {},
        {
          pullRequests: [
            {
              url: "https://github.com/o/r/pull/306",
              repository: "o/r",
              number: 306,
              title: "Plan the layer",
              state: "open",
              isDraft: true,
            },
          ],
        },
      ),
    );
    expect(listed).toEqual({
      kind: "pull-requests",
      pullRequests: [
        {
          url: "https://github.com/o/r/pull/306",
          repository: "o/r",
          number: 306,
          title: "Plan the layer",
          state: "open",
          isDraft: true,
          note: null,
        },
      ],
    });
    const watched = resolveToolPreview(
      tool(
        "mcp__t3-code__unwatch_pull_request",
        { url: "https://github.com/o/r/pull/7" },
        {
          content: "{}",
          structuredContent: {
            url: "https://github.com/o/r/pull/7",
            repository: "o/r",
            number: 7,
            watching: false,
            wasWatching: true,
          },
        },
      ),
    );
    expect(watched?.kind === "pull-requests" && watched.pullRequests[0]?.note).toBe(
      "Stopped watching",
    );
  });

  it("names a browser action's target and the page it ran on", () => {
    const pressed = resolveToolPreview(
      tool(
        "t3-code.preview_press",
        { key: "ArrowLeft", modifiers: ["Alt"] },
        { toolIcon: { _tag: "website", pageUrl: "http://localhost:7356/pair" } },
      ),
    );
    expect(pressed).toEqual({
      kind: "browser",
      target: "Alt+ArrowLeft",
      text: null,
      expression: null,
      value: null,
      page: { url: "http://localhost:7356/pair", title: null },
    });
    const evaluated = resolveToolPreview(
      tool(
        "mcp__t3-code__preview_evaluate",
        { expression: "document.title" },
        { content: JSON.stringify({ toolIcon: { pageUrl: "http://x" }, value: false }) },
      ),
    );
    expect(evaluated).toMatchObject({ expression: "document.title", value: "false" });
    const navigated = resolveToolPreview(
      tool(
        "t3-code.preview_navigate",
        { url: "http://127.0.0.1:1427/" },
        { url: "http://127.0.0.1:1427/", title: "Usage Monitor" },
      ),
    );
    expect(navigated).toMatchObject({
      target: "http://127.0.0.1:1427/",
      page: { url: "http://127.0.0.1:1427/", title: "Usage Monitor" },
    });
  });

  it("marks the options a user picked, and a free-text answer", () => {
    const preview = resolveToolPreview(
      tool(
        "AskUserQuestion",
        {
          questions: [
            {
              question: "Which ticket?",
              options: [{ label: "No ticket" }, { label: "I'll give one" }],
            },
            { question: "Description okay?", options: [{ label: "Looks good" }] },
          ],
        },
        { answers: { "Which ticket?": "No ticket", "Description okay?": "Shorten it" } },
      ),
    );
    expect(preview).toEqual({
      kind: "questions",
      questions: [
        {
          question: "Which ticket?",
          options: [
            { label: "No ticket", selected: true },
            { label: "I'll give one", selected: false },
          ],
          otherAnswer: null,
        },
        {
          question: "Description okay?",
          options: [{ label: "Looks good", selected: false }],
          otherAnswer: "Shorten it",
        },
      ],
    });
  });

  it("splits a Slack thread into its messages", () => {
    const messages = [
      "=== THREAD PARENT MESSAGE ===",
      "From: Matt Gill (U0BQY01G45Q)",
      "Time: 2026-10-09 09:19:44 BST",
      "Message TS: 1791533984.327329",
      "Can you invite me to dbt cloud?",
      "",
      "=== THREAD REPLIES (1 total) ===",
      "",
      "--- Reply 1 of 1 ---",
      "From: Adam (U06F5V4996F)",
      "Time: 2026-10-09 09:24:47 BST",
      "Message TS: 1791534287.463029",
      "We only have one shared account.",
    ].join("\n");
    const preview = resolveToolPreview(
      tool("mcp__claude_ai_Slack__slack_read_thread", { channel_id: "D1" }, [
        { type: "text", text: JSON.stringify({ messages, pagination_info: "No more." }) },
      ]),
    );
    expect(preview).toEqual({
      kind: "slack-thread",
      messages: [
        {
          author: "Matt Gill",
          time: "2026-10-09 09:19:44 BST",
          text: "Can you invite me to dbt cloud?",
        },
        {
          author: "Adam",
          time: "2026-10-09 09:24:47 BST",
          text: "We only have one shared account.",
        },
      ],
    });
  });

  it("previews Claude's own tools from their arguments", () => {
    expect(
      resolveToolPreview(
        tool(
          "ToolSearch",
          { query: "select:Monitor" },
          {
            matches: ["Monitor", "mcp__t3-code__preview_open"],
          },
        ),
      ),
    ).toEqual({ kind: "loaded-tools", names: ["Monitor", "preview_open"] });
    expect(
      resolveToolPreview(
        tool("SendMessage", { to: "a7257", summary: "Reword", message: "Replace the comment." }),
      ),
    ).toEqual({
      kind: "agent-message",
      recipient: "a7257",
      summary: "Reword",
      message: "Replace the comment.",
    });
    expect(
      resolveToolPreview(
        tool("ScheduleWakeup", { reason: "CI", prompt: "Check CI" }, { scheduledFor: 0 }),
      ),
    ).toEqual({ kind: "wakeup", at: "1970-01-01T00:00:00.000Z", reason: "CI", prompt: "Check CI" });
  });

  it("leaves failed calls and unknown tools on the generic body", () => {
    expect(resolveToolPreview(tool("mcp__notion__notion-fetch", { id: "x" }, {}))).toBeNull();
    expect(
      resolveToolPreview({
        ...tool("t3-code.task_status", { taskId: "t" }, "Error: no such task"),
        status: "failed",
      }),
    ).toBeNull();
  });
});
