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

const meta = { "io.modelcontextprotocol/serverInfo": { name: "Notion MCP" } };
const textResult = (value: unknown) => ({
  content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }],
  _meta: meta,
});

describe("Notion", () => {
  it("shows a page's updated properties and content from the call itself", () => {
    expect(
      resolveToolPreview(
        tool(
          "mcp__notion__notion-update-page",
          {
            page_id: "cda99cd1efb783309aa881b7c55920a2",
            command: "update_properties",
            properties: { "Next release": "[Next release →](https://app.notion.com/p/4f0)" },
          },
          { _meta: meta },
        ),
      ),
    ).toEqual({
      kind: "properties",
      summary: "Updated properties",
      link: {
        label: "Open page",
        url: "https://app.notion.com/p/cda99cd1efb783309aa881b7c55920a2",
      },
      notes: [],
      title: null,
      url: null,
      rows: [["Next release", "Next release →"]],
    });
    expect(
      resolveToolPreview(
        tool("mcp__notion__notion-update-page", {
          page_id: "3ce99cd1-efb7",
          command: "update_content",
          content_updates: [{ old_str: "a", new_str: "**Previous release** columns" }],
        }),
      ),
    ).toMatchObject({
      kind: "document",
      summary: "Updated 1 passage",
      markdown: "**Previous release** columns",
    });
  });

  it("renders a fetched page and tabulates a query", () => {
    expect(
      resolveToolPreview(
        tool(
          "mcp__notion__notion-fetch",
          { id: "x" },
          textResult({ title: "Layouts", url: "https://app.notion.com/p/1", text: "# Layouts" }),
        ),
      ),
    ).toMatchObject({
      kind: "document",
      title: "Layouts",
      url: "https://app.notion.com/p/1",
      markdown: "# Layouts",
    });
    expect(
      resolveToolPreview(
        tool(
          "mcp__notion__notion-query-data-sources",
          { data: {} },
          textResult({ results: [{ t: "manual", Scenario: "Feedback", url: "u" }] }),
        ),
      ),
    ).toMatchObject({ kind: "table", columns: ["t", "Scenario"], rows: [["manual", "Feedback"]] });
  });

  it("leaves an upload's bearer token out", () => {
    const preview = resolveToolPreview(
      tool(
        "mcp__notion__notion-create-file-upload",
        { filename: "clip.mp4" },
        textResult({
          filename: "clip.mp4",
          content_type: "video/mp4",
          upload_headers: { authorization: "Bearer secret" },
        }),
      ),
    );
    expect(JSON.stringify(preview)).not.toContain("secret");
    expect(preview).toMatchObject({
      rows: [
        ["File", "clip.mp4"],
        ["Type", "video/mp4"],
      ],
    });
  });

  it("shows nothing for a result that kept only server metadata", () => {
    expect(
      resolveToolPreview(tool("mcp__notion__notion-query-data-sources", {}, { _meta: meta })),
    ).toBeNull();
  });
});

describe("Datadog", () => {
  it("lists log lines with a link to the explorer", () => {
    const text = [
      "<METADATA>",
      "  <count>2</count>",
      "  <logs_explorer_url>https://app.datadoghq.eu/logs?q</logs_explorer_url>",
      "</METADATA>",
      "<YAML_DATA>",
      '- timestamp: "2026-10-08T15:27:35Z"',
      "  message: Created run",
      "  service: orchestra-api",
      "  status: info",
      "  attributes:",
      "    custom.run_id: r1",
      '- timestamp: "2026-10-08T15:27:36Z"',
      "  message: Retrying",
      "  status: warn",
      "</YAML_DATA>",
    ].join("\n");
    expect(
      resolveToolPreview(
        tool("mcp__datadog__search_datadog_logs", { query: "service:orchestra-api" }, [
          { type: "text", text },
        ]),
      ),
    ).toMatchObject({
      kind: "records",
      summary: "service:orchestra-api",
      link: { label: "Open in Datadog", url: "https://app.datadoghq.eu/logs?q" },
      notes: ["2 results"],
      items: [
        {
          title: "Created run",
          subtitle: "info",
          meta: ["2026-10-08T15:27:35Z", "orchestra-api"],
        },
        { title: "Retrying", subtitle: "warn" },
      ],
    });
  });

  it("tabulates TSV aggregates and lists JSON results", () => {
    const tsv =
      "<METADATA>\n  <total_rows>1</total_rows>\n</METADATA>\n<TSV_DATA>\np\tn\nchat-title\t167\n</TSV_DATA>";
    expect(
      resolveToolPreview(
        tool("mcp__datadog__analyze_datadog_logs", { filter: "env:prod" }, [
          { type: "text", text: tsv },
        ]),
      ),
    ).toMatchObject({ kind: "table", columns: ["p", "n"], rows: [["chat-title", "167"]] });
    expect(
      resolveToolPreview(
        tool("mcp__datadog__search_datadog_monitors", { query: "id:1" }, [
          { type: "text", text: JSON.stringify([{ id: 1, name: "LLM latency", status: "Alert" }]) },
        ]),
      ),
    ).toMatchObject({ kind: "records", items: [{ title: "LLM latency", subtitle: "Alert" }] });
  });
});

describe("Google and Granola", () => {
  it("lists calendar events with their time and meeting link", () => {
    expect(
      resolveToolPreview(
        tool(
          "mcp__claude_ai_Google_Calendar__list_events",
          {},
          {
            events: [
              {
                id: "e1",
                summary: "Adam / Matt",
                start: { dateTime: "2026-10-06T10:30:00+01:00" },
                end: { dateTime: "2026-10-06T11:30:00+01:00" },
                attendees: [{}, {}],
                conferenceUrl: "https://meet.google.com/x",
              },
            ],
          },
        ),
      ),
    ).toMatchObject({
      kind: "records",
      items: [
        {
          title: "Adam / Matt",
          meta: ["2026-10-06 10:30–11:30", "2 attendees"],
          url: "https://meet.google.com/x",
        },
      ],
    });
  });

  it("renders a Drive file and lists Granola meetings", () => {
    expect(
      resolveToolPreview(
        tool(
          "mcp__claude_ai_Google_Drive__read_file_content",
          { fileId: "f1" },
          { content: JSON.stringify({ fileContent: "# Notes" }) },
        ),
      ),
    ).toMatchObject({
      kind: "document",
      markdown: "# Notes",
      url: "https://drive.google.com/open?id=f1",
    });
    const meetings =
      '<meetings_data count="1">\n<meeting id="m1" title="Cache chat" date="Oct 1, 2026 3:00 PM" url="https://notes.granola.ai/d/m1">\n<known_participants>\nAdam &lt;adam@x.com&gt;\n</known_participants>\n</meeting>\n</meetings_data>';
    expect(
      resolveToolPreview(
        tool("mcp__claude_ai_Granola__list_meetings", {}, [{ type: "text", text: meetings }]),
      ),
    ).toMatchObject({
      kind: "records",
      items: [
        {
          title: "Cache chat",
          meta: ["Oct 1, 2026 3:00 PM"],
          url: "https://notes.granola.ai/d/m1",
          body: "Adam <adam@x.com>",
        },
      ],
    });
  });
});

describe("Slack", () => {
  it("shows a sent message and a draft by channel", () => {
    expect(
      resolveToolPreview(
        tool(
          "mcp__claude_ai_Slack__slack_send_message",
          { channel_id: "C1", thread_ts: "1.2", message: "**Addendum**" },
          [{ type: "text", text: JSON.stringify({ message_link: "https://slack.com/m" }) }],
        ),
      ),
    ).toMatchObject({
      kind: "document",
      summary: "C1",
      link: { label: "Open in Slack", url: "https://slack.com/m" },
      notes: ["In a thread"],
      markdown: "**Addendum**",
    });
    expect(
      resolveToolPreview(
        tool(
          "mcp__claude_ai_Slack__slack_send_message_draft",
          { channel_id: "C2", message: "Hey team" },
          [
            {
              type: "text",
              text: JSON.stringify({
                channel_link: "https://slack.com/c",
                draft_id: "Dr1",
                channel_info: { name: "fd-research-team" },
              }),
            },
          ],
        ),
      ),
    ).toMatchObject({ summary: "#fd-research-team", notes: ["Saved as a draft, not sent"] });
  });

  it("lists a channel's messages, users and channels", () => {
    const channel =
      "Channel: DM (D1)\n\n=== Message from Matt Gill (U1) at 2026-10-09 09:46:09 BST === \nMessage TS: 1.1\nlike run time generate it\n\n=== Message from Adam (U2) at 2026-10-09 09:45:54 BST === \nMessage TS: 1.2\nlooking into it";
    expect(
      resolveToolPreview(
        tool("mcp__claude_ai_Slack__slack_read_channel", {}, [
          { type: "text", text: JSON.stringify({ messages: channel }) },
        ]),
      ),
    ).toMatchObject({
      kind: "records",
      summary: "DM",
      items: [
        {
          title: "Matt Gill",
          meta: ["2026-10-09 09:46:09 BST"],
          body: "like run time generate it",
        },
        { title: "Adam", body: "looking into it" },
      ],
    });
    const users =
      "# Search Results for: Tony\n\n## Users (1 results)\n### Result 1 of 1\nName: Tony\nUser ID: U9\nTitle: \nEmail: \nTimezone: Europe/London\nPermalink: [link](https://slack.com/team/U9)\n";
    expect(
      resolveToolPreview(
        tool("mcp__claude_ai_Slack__slack_search_users", {}, [
          { type: "text", text: JSON.stringify({ results: users }) },
        ]),
      ),
    ).toMatchObject({
      items: [{ title: "Tony", meta: ["Europe/London"], url: "https://slack.com/team/U9" }],
    });
    const channels =
      "# Search Results for: \n\n## Channels (1 results)\n1. #developers-x-researchers (C09) - public_channel - Creator: Iordanis\n";
    expect(
      resolveToolPreview(
        tool("mcp__claude_ai_Slack__slack_search_channels", {}, [
          { type: "text", text: JSON.stringify({ results: channels }) },
        ]),
      ),
    ).toMatchObject({
      items: [{ title: "#developers-x-researchers", subtitle: "public channel" }],
    });
  });
});

describe("Linear and T3 history", () => {
  it("shows an issue as its title and description", () => {
    expect(
      resolveToolPreview(
        tool(
          "mcp__claude_ai_Linear__save_issue",
          {},
          {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  id: "PSET-1253",
                  title: "Reports miss briefs",
                  description: "## Summary",
                  url: "https://linear.app/i",
                  status: "Backlog",
                }),
              },
            ],
            _meta: meta,
          },
        ),
      ),
    ).toMatchObject({
      kind: "document",
      title: "PSET-1253 Reports miss briefs",
      url: "https://linear.app/i",
      notes: ["Backlog"],
      markdown: "## Summary",
    });
  });

  it("opens history threads and lists their pull requests", () => {
    expect(
      resolveToolPreview(
        tool(
          "mcp__t3-code-history__get_thread",
          {},
          {
            thread: { threadId: "t1", title: "Repost", sessionStatus: "completed", model: "m" },
          },
        ),
      ),
    ).toMatchObject({ kind: "thread", threadId: "t1", title: "Repost", status: "completed" });
    expect(
      resolveToolPreview(
        tool(
          "mcp__t3-code-history__list_threads",
          {},
          {
            threads: [{ threadId: "t2", title: "Fork UI", sessionStatus: "running" }],
          },
        ),
      ),
    ).toMatchObject({
      kind: "records",
      items: [{ title: "Fork UI", subtitle: "running", threadId: "t2" }],
    });
    expect(
      resolveToolPreview(
        tool(
          "mcp__t3-code-history__list_pull_requests",
          {},
          {
            pullRequests: [
              { url: "https://github.com/o/r/pull/1", number: 1, title: "Fix", state: "open" },
            ],
          },
        ),
      ),
    ).toMatchObject({ kind: "pull-requests", pullRequests: [{ title: "Fix", state: "open" }] });
  });
});

describe("other servers", () => {
  it("infers records and properties from plain JSON results", () => {
    expect(
      resolveToolPreview(
        tool(
          "mcp__claude_ai_Forge__retrieve_order_statistics",
          {},
          {
            structuredContent: {
              survey_order: {
                status: "Pending",
                panel_supplier_orders: [{ order_description: "Base order", status: "Pending" }],
              },
            },
          },
        ),
      ),
    ).toMatchObject({
      kind: "records",
      notes: ["Status: Pending"],
      items: [{ title: "Base order", subtitle: "Pending" }],
    });
    expect(
      resolveToolPreview(
        tool(
          "mcp__claude_ai_Forge-dev__create_respondent",
          {},
          {
            structuredContent: { result: "Success: respondent 'flat-003' created" },
          },
        ),
      ),
    ).toMatchObject({ kind: "document", markdown: "Success: respondent 'flat-003' created" });
    expect(
      resolveToolPreview(
        tool(
          "mcp__claude_ai_Forge-dev__run_data_quality_checks",
          {},
          {
            structuredContent: {
              survey_id: "s",
              respondent_data_quality_check_results: [
                { survey_id: "s", supplier_respondent_id: "flat-001", check_result: "passed" },
                { survey_id: "s", supplier_respondent_id: "flat-002", check_result: "failed" },
              ],
            },
          },
        ),
      ),
    ).toMatchObject({
      items: [
        { title: "flat-001", subtitle: "passed" },
        { title: "flat-002", subtitle: "failed" },
      ],
    });
    expect(
      resolveToolPreview(
        tool(
          "codex_apps.github.create_pull_request",
          {},
          {
            title: "Match sums",
            url: "https://github.com/o/r/pull/3",
            number: 3,
          },
        ),
      ),
    ).toMatchObject({
      kind: "properties",
      title: "Match sums",
      url: "https://github.com/o/r/pull/3",
    });
  });

  it("names Claude's task, worktree and agent listing tools", () => {
    expect(
      resolveToolPreview(
        tool(
          "TaskStop",
          { task_id: "b1" },
          { command: "make devin-review", task_type: "local_bash" },
        ),
      ),
    ).toMatchObject({
      kind: "thread-action",
      headline: "Stopped a background task",
      details: ["make devin-review", "local bash"],
    });
    expect(
      resolveToolPreview(
        tool("EnterWorktree", { path: "/w" }, { worktreeBranch: "release/x", worktreePath: "/w" }),
      ),
    ).toMatchObject({ headline: "Entered a worktree", details: ["release/x", "/w"] });
    expect(
      resolveToolPreview(tool("ListAgents", {}, { listing: "Subagents (1):\n  a1 · running" })),
    ).toMatchObject({ kind: "document", preformatted: true });
  });
});
