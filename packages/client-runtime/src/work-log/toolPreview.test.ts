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
              headBranch: "docs/plan",
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
          headBranch: "docs/plan",
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
      "We only have <https://slack.com/x|one shared account>.",
    ].join("\n");
    const preview = resolveToolPreview(
      tool("mcp__claude_ai_Slack__slack_read_thread", { channel_id: "D1" }, [
        { type: "text", text: JSON.stringify({ messages, pagination_info: "No more." }) },
      ]),
    );
    expect(preview).toEqual({
      kind: "slack-messages",
      messages: [
        {
          author: "Matt Gill",
          time: "2026-10-09 09:19:44 BST",
          channel: null,
          url: null,
          text: "Can you invite me to dbt cloud?",
        },
        {
          author: "Adam",
          time: "2026-10-09 09:24:47 BST",
          channel: null,
          url: null,
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
      threadId: null,
      summary: "Reword",
      message: "Replace the comment.",
    });
    expect(
      resolveToolPreview(
        tool("ScheduleWakeup", { reason: "CI", prompt: "Check CI" }, { scheduledFor: 0 }),
      ),
    ).toEqual({ kind: "wakeup", at: "1970-01-01T00:00:00.000Z", reason: "CI", prompt: "Check CI" });
  });

  it("splits Slack search results in both formats", () => {
    const detailed = [
      "# Search Results for: ",
      "",
      "## Messages (1 results)",
      "### Result 1 of 1",
      "Channel: DM (ID: D06FJMPFDUZ)",
      "From: Adam Higgins (ID: U06F5V4996F) ",
      "Time: 2026-09-09 17:00:37 BST",
      "Message_ts: 1788969637.553269",
      "Permalink: [link](https://focaldata.slack.com/archives/D06/p1)",
      "Text: ",
      "Here is what I did today:",
      "• Raised a <https://github.com/o/r/pull/1|PR>",
      "",
      "---",
    ].join("\n");
    expect(
      resolveToolPreview(
        tool("mcp__slack__slack_search_public_and_private", { keywords: ["x"] }, [
          { type: "text", text: JSON.stringify({ results: detailed, pagination_info: "End." }) },
        ]),
      ),
    ).toEqual({
      kind: "slack-messages",
      messages: [
        {
          author: "Adam Higgins",
          time: "2026-09-09 17:00:37 BST",
          channel: "DM",
          url: "https://focaldata.slack.com/archives/D06/p1",
          text: "Here is what I did today:\n• Raised a PR",
        },
      ],
    });
    const concise = [
      "# Search Results for: ",
      "",
      "## Messages (2 results)",
      "1. #canary-release - Adam Higgins: v3.188.5 is on canary &amp; fixed 2026-10-07 15:44:14 BST",
      "2. #general - Matt Gill: Thanks!",
    ].join("\n");
    const preview = resolveToolPreview(
      tool("mcp__slack__slack_search_public_and_private", {}, [
        { type: "text", text: JSON.stringify({ results: concise }) },
      ]),
    );
    expect(preview?.kind === "slack-messages" && preview.messages).toEqual([
      {
        author: "Adam Higgins",
        time: "2026-10-07 15:44:14 BST",
        channel: "#canary-release",
        url: null,
        text: "v3.188.5 is on canary & fixed",
      },
      { author: "Matt Gill", time: null, channel: "#general", url: null, text: "Thanks!" },
    ]);
  });

  it("shows a cancellation's reason and a launched thread's title and branch", () => {
    expect(
      resolveToolPreview(
        tool(
          "mcp__t3-code__task_cancel",
          { taskId: "t", reason: "User chose ingress JWT validation." },
          { structuredContent: { taskId: "t", status: "cancel_requested" } },
        ),
      ),
    ).toEqual({
      kind: "task",
      threadId: null,
      title: null,
      status: "cancel_requested",
      model: null,
      summary: "User chose ingress JWT validation.",
    });
    expect(
      resolveToolPreview(
        tool(
          "mcp__t3-code__t3_thread_launch",
          {
            title: "Cut v3.188.6",
            workspaceStrategy: { type: "existing_worktree", branch: "release/v3.188.6" },
            message: "Cut the release.",
          },
          {
            structuredContent: {
              threadId: "mcp:43df",
              modelSelection: { instanceId: "claudeAgent", model: "claude-opus-5-5" },
              status: null,
            },
          },
        ),
      ),
    ).toEqual({
      kind: "thread",
      threadId: "mcp:43df",
      title: "Cut v3.188.6",
      status: null,
      model: "claude-opus-5-5",
      branch: "release/v3.188.6",
      items: [{ key: "message", label: "Message", text: "Cut the release." }],
      moreItems: 0,
    });
  });

  it("lists threads, messages sent to a thread, and scheduled tasks", () => {
    expect(
      resolveToolPreview(
        tool(
          "t3-code.t3_thread_list",
          {},
          {
            threads: [{ threadId: "a", title: "Fix order", status: "running", model: "grok-4.7" }],
          },
        ),
      ),
    ).toEqual({
      kind: "threads",
      threads: [{ threadId: "a", title: "Fix order", status: "running", model: "grok-4.7" }],
    });
    expect(
      resolveToolPreview(
        tool(
          "t3-code.t3_thread_send",
          { threadId: "a", message: "Rebase it." },
          {
            delivery: "queued",
          },
        ),
      ),
    ).toEqual({
      kind: "agent-message",
      recipient: null,
      threadId: "a",
      summary: "Queued",
      message: "Rebase it.",
    });
    expect(
      resolveToolPreview(
        tool(
          "t3-code.list_scheduled_tasks",
          {},
          {
            tasks: [
              {
                scheduledTaskId: "s1",
                title: "Review the stack",
                enabled: true,
                schedule: { type: "interval", everyMs: 600000 },
              },
              {
                scheduledTaskId: "s2",
                title: "Morning brief",
                enabled: false,
                schedule: { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 2, 3, 4, 5] },
              },
            ],
          },
        ),
      ),
    ).toEqual({
      kind: "scheduled-tasks",
      tasks: [
        {
          id: "s1",
          title: "Review the stack",
          enabled: true,
          schedule: { type: "interval", everyMs: 600000 },
        },
        {
          id: "s2",
          title: "Morning brief",
          enabled: false,
          schedule: { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 2, 3, 4, 5] },
        },
      ],
    });
  });

  it("previews a browser snapshot by its page, leaving the image to the output", () => {
    expect(
      resolveToolPreview(
        tool(
          "mcp__t3-code__preview_snapshot",
          { includeImage: true, save: true },
          {
            content: [{ type: "image", source: { type: "base64", media_type: "image/png" } }],
          },
        ),
      ),
    ).toMatchObject({ kind: "browser", target: null, page: null });
  });

  it("lists threads created in a batch", () => {
    expect(
      resolveToolPreview(
        tool(
          "t3-code.create_threads",
          { threads: [{ title: "A" }] },
          {
            threads: [{ threadId: "a", title: "A", status: "starting", model: "gpt-6.1-sol" }],
          },
        ),
      ),
    ).toEqual({
      kind: "threads",
      threads: [{ threadId: "a", title: "A", status: "starting", model: "gpt-6.1-sol" }],
    });
  });

  it("names what a thread action did", () => {
    const action = (toolName: string, input: unknown, output?: unknown) =>
      resolveToolPreview(tool(`t3-code.${toolName}`, input, output));
    expect(
      action(
        "t3_thread_wait",
        { threadId: "a" },
        {
          threadId: "a",
          status: "running",
          timedOut: true,
        },
      ),
    ).toEqual({
      kind: "thread-action",
      headline: "Stopped waiting",
      status: "running",
      details: ["The wait timed out"],
      threadId: "a",
    });
    expect(
      action(
        "t3_thread_interrupt",
        { threadId: "a", reason: "Wrong branch" },
        {
          threadId: "a",
          status: "interrupt_requested",
        },
      ),
    ).toMatchObject({
      headline: "Interrupted the run",
      status: "interrupt_requested",
      details: ["Wrong branch"],
    });
    expect(
      action(
        "t3_thread_configuration",
        {},
        {
          threadId: "a",
          modelSelection: {
            instanceId: "codex",
            model: "gpt-6.1-sol",
            options: [{ id: "reasoningEffort", value: "high" }],
          },
          runtimeMode: "full-access",
          interactionMode: "default",
        },
      ),
    ).toMatchObject({
      headline: "gpt-6.1-sol",
      details: ["codex", "reasoningEffort high", "full-access · default"],
      threadId: null,
    });
    expect(
      action("t3_thread_configure", {
        modelSelection: { instanceId: "claudeAgent", model: "claude-opus-5-5" },
      }),
    ).toMatchObject({ headline: "Switched to claude-opus-5-5", details: ["claudeAgent"] });
    expect(
      action(
        "t3_thread_fork",
        { title: "Try B", sourcePoint: { type: "latest_stable" } },
        {
          sequence: 4,
          targetThreadId: "fork",
        },
      ),
    ).toMatchObject({
      headline: "Forked as “Try B”",
      details: ["From the latest stable point"],
      threadId: "fork",
    });
    expect(
      action("t3_thread_merge_back", {
        targetThreadId: "parent",
        sourcePoint: { type: "run", runId: "r" },
      }),
    ).toMatchObject({ headline: "Merged context back", threadId: "parent" });
    expect(
      action(
        "t3_thread_organize",
        { action: "move_to_group", groupName: "Release" },
        {
          sequence: 1,
        },
      ),
    ).toMatchObject({ headline: "Moved to “Release”", threadId: null });
    expect(
      action("t3_thread_organize", { action: "settle" }, { settlesWhenTurnEnds: true }),
    ).toMatchObject({ headline: "Settled", details: ["Takes effect when this turn ends"] });
    expect(
      action(
        "t3_thread_group_name",
        { name: "Release" },
        {
          groupId: "g",
          name: "Release",
          tabs: [{ threadId: "a", title: "Cut RC" }],
        },
      ),
    ).toMatchObject({ headline: "Named the group “Release”", details: ["Cut RC"] });
    expect(
      action(
        "t3_thread_update",
        { action: "rename", title: "Fix order" },
        {
          threadId: "a",
          title: "Fix order",
        },
      ),
    ).toMatchObject({ headline: "Renamed to “Fix order”", threadId: "a" });
    expect(
      action("t3_thread_update", {
        action: "link_pull_request",
        pullRequest: { repository: "o/r", number: 7 },
      }),
    ).toMatchObject({ headline: "Linked o/r#7" });
  });

  it("lists thread search matches and context transfers", () => {
    expect(
      resolveToolPreview(
        tool(
          "t3-code.t3_thread_search",
          { query: "parity" },
          {
            matches: [{ threadId: "a", source: "assistant", snippet: "parity is green" }],
          },
        ),
      ),
    ).toEqual({
      kind: "thread-search",
      query: "parity",
      matches: [{ threadId: "a", source: "assistant", snippet: "parity is green" }],
    });
    expect(
      resolveToolPreview(
        tool(
          "t3-code.t3_thread_transfers",
          {},
          {
            transfers: [{ id: "t", sourceThreadId: "a", targetThreadId: "b", status: "completed" }],
          },
        ),
      ),
    ).toEqual({
      kind: "context-transfers",
      transfers: [{ id: "t", sourceThreadId: "a", targetThreadId: "b", status: "completed" }],
    });
  });

  it("counts the attachments sent to a thread", () => {
    expect(
      resolveToolPreview(
        tool(
          "t3-code.t3_thread_send_attachments",
          { attachments: [{}, {}] },
          {
            threadId: "a",
            status: "running",
          },
        ),
      ),
    ).toEqual({
      kind: "agent-message",
      recipient: null,
      threadId: "a",
      summary: "Sent 2 attachments",
      message: "",
    });
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
