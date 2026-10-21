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

describe("Slack directory and concise reads", () => {
  const slack = (name: string, input: unknown, body: Record<string, string>) =>
    resolveToolPreview(
      tool(`mcp__slack__${name}`, input, [{ type: "text", text: JSON.stringify(body) }]),
    );

  it("splits a concise channel read into messages, keeping blank lines inside one", () => {
    const messages =
      "Channel: DM (D1)\n\nMatt Gill: <https://github.com/o/r/pull/7|github.com/o/r/pull/7> [2026-10-21 16:32:08 BST]\n\nAdam: First paragraph\n\n• second [2026-10-20 14:28:15 BST]";
    expect(slack("slack_read_channel", { response_format: "concise" }, { messages })).toMatchObject(
      {
        kind: "records",
        summary: "DM",
        items: [
          { title: "Matt Gill", meta: ["2026-10-21 16:32:08 BST"], body: "github.com/o/r/pull/7" },
          { title: "Adam", meta: ["2026-10-20 14:28:15 BST"], body: "First paragraph\n\n• second" },
        ],
      },
    );
  });

  it("shows a profile's filled fields, without its No flags", () => {
    const result =
      "User ID: U1\nUsername: sam\nDisplay Name: Sam\nReal Name: Sam Rivera\nPronouns: \nEmail: sam@example.com\nTimezone: Europe/London\nAdmin: No\nBot: No\n";
    expect(slack("slack_read_user_profile", {}, { result })).toEqual(
      expect.objectContaining({
        kind: "properties",
        title: "Sam Rivera",
        rows: [
          ["User ID", "U1"],
          ["Username", "sam"],
          ["Display Name", "Sam"],
          ["Real Name", "Sam Rivera"],
          ["Email", "sam@example.com"],
          ["Timezone", "Europe/London"],
        ],
      }),
    );
  });

  it("lists the user's channels and a channel's members", () => {
    const channels =
      '## My Channels (showing 2, more results available)\n\n### #general\n- **ID:** C1\n- **Type:** Public Channel\n- **Topic:** Announcements\n- **Archived:** No\n\n### #old\n- **ID:** C2\n- **Type:** Private Channel\n- **Archived:** Yes\n\n---\nPagination: More results available. Use cursor: "x"\n';
    expect(slack("slack_list_user_channels", {}, { result: channels })).toMatchObject({
      notes: ["More channels on the next page"],
      items: [
        { title: "#general", subtitle: "Public Channel", meta: [], body: "Announcements" },
        { title: "#old", subtitle: "Private Channel", meta: ["archived"], body: null },
      ],
    });
    const detailed =
      "# Channel Members (1)\n\n## Member 1\nUser ID: U1\nUsername: @sam\nDisplay Name: Sam\nReal Name: Sam Rivera\nEmail: sam@example.com\n\n";
    expect(slack("slack_list_channel_members", {}, { members: detailed })).toMatchObject({
      items: [{ title: "Sam Rivera", subtitle: "@sam", meta: ["sam@example.com"] }],
    });
    expect(
      slack("slack_list_channel_members", {}, { members: "# Channel Members (1)\n\n@jo (Jo)\n" }),
    ).toMatchObject({ items: [{ title: "Jo", subtitle: "@jo" }] });
  });

  it("shows detailed channel search results", () => {
    const results =
      "# Search Results for: \n\n## Channels (1 results)\n### Result 1 of 1\nName: #notif-requests\nCreator: Oli (<@U9)\nCreated: 2021-11-26 09:26:26 GMT\nPurpose: demo requests\nPermalink: [link](https://slack.com/archives/C1)\nIs Archived: false\n";
    expect(slack("slack_search_channels", {}, { results })).toMatchObject({
      items: [
        {
          title: "#notif-requests",
          meta: ["Oli", "2021-11-26 09:26:26 GMT"],
          url: "https://slack.com/archives/C1",
          body: "demo requests",
        },
      ],
    });
  });

  it("shows reactions and custom emojis", () => {
    expect(
      slack(
        "slack_get_reactions",
        {},
        { result: "Reactions on message:\n\n:white_check_mark: × 2 — Sam (U1), Jo (U2)" },
      ),
    ).toMatchObject({ kind: "properties", rows: [[":white_check_mark: × 2", "Sam, Jo"]] });
    expect(
      slack(
        "slack_search_emojis",
        { query: "ship" },
        {
          results:
            'Found 2 custom emojis matching "ship":\n:ship-it-parrot:, :shipit: (alias for :squirrel:)',
        },
      ),
    ).toMatchObject({
      summary: 'Found 2 custom emojis matching "ship"',
      items: [
        { title: ":ship-it-parrot:", subtitle: null },
        { title: ":shipit:", subtitle: "alias for :squirrel:" },
      ],
    });
  });

  it("shows a scheduled message and a new canvas", () => {
    expect(
      slack(
        "slack_schedule_message",
        { channel_id: "C1", message: "Standup", post_at: 1792596728 },
        { result: "Scheduled" },
      ),
    ).toMatchObject({ markdown: "Standup", notes: ["Scheduled for 2026-10-21T15:32:08.000Z"] });
    expect(
      slack(
        "slack_create_canvas",
        { title: "Plan", content: "# Goals" },
        { canvas_url: "https://slack.com/docs/F1" },
      ),
    ).toMatchObject({
      title: "Plan",
      markdown: "# Goals",
      link: { label: "Open canvas", url: "https://slack.com/docs/F1" },
    });
  });

  it("reads Codex's codex_apps.slack tools like Slack's own", () => {
    expect(
      resolveToolPreview(
        tool("codex_apps.slack.slack_read_user_profile", {}, [
          { type: "text", text: JSON.stringify({ result: "Real Name: Sam\nEmail: s@x.com\n" }) },
        ]),
      ),
    ).toMatchObject({ kind: "properties", title: "Sam" });
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

describe("integration preview gaps", () => {
  const call = (toolName: string, input: unknown, body: unknown) =>
    resolveToolPreview(tool(toolName, input, [{ type: "text", text: JSON.stringify(body) }]));

  it("shows Linear status updates and notifications by what they say", () => {
    expect(
      call(
        "mcp__claude_ai_Linear__get_status_updates",
        { type: "project" },
        {
          statusUpdates: [
            {
              id: "9f",
              body: "**Rebuilt** the client",
              health: "atRisk",
              url: "https://linear.app/u",
              createdAt: "2026-08-14T12:47:56.028Z",
              user: { name: "Dan" },
              project: { name: "Auto-Translation" },
            },
          ],
          hasNextPage: false,
        },
      ),
    ).toMatchObject({
      items: [
        {
          title: "Auto-Translation",
          subtitle: "at risk",
          meta: ["Dan", "2026-08-14"],
          body: "**Rebuilt** the client",
        },
      ],
    });
    expect(
      call(
        "mcp__claude_ai_Linear__get_notifications",
        {},
        {
          notifications: [
            {
              id: "3b",
              type: "pullRequestReviewRequested",
              title: "Publish an OpenAPI client",
              subtitle: "Sam requested review",
              url: "https://linear.app/r",
              createdAt: "2026-10-21T15:52:08.481Z",
              readAt: null,
            },
          ],
          hasNextPage: true,
        },
      ),
    ).toMatchObject({
      notes: ["More results on the next page"],
      items: [
        {
          title: "Publish an OpenAPI client",
          subtitle: "Sam requested review",
          meta: ["unread", "2026-10-21 15:52"],
        },
      ],
    });
  });

  it("shows a Linear issue fetched for its description alone, and empty review threads", () => {
    expect(
      call(
        "mcp__claude_ai_Linear__get_issue",
        { id: "PSET-1243", fields: ["description"] },
        { id: "uuid-1", description: "## What we're doing" },
      ),
    ).toMatchObject({ kind: "document", title: "PSET-1243", markdown: "## What we're doing" });
    expect(
      call(
        "mcp__claude_ai_Linear__get_diff_threads",
        { urlOrId: "https://github.com/o/r/pull/5" },
        { threads: [], drafts: [], hasNextPage: false },
      ),
    ).toMatchObject({ kind: "records", items: [] });
  });

  it("reads Codex's Notion fetch as a page, and a removal as what it removed", () => {
    expect(
      call(
        "codex_apps.notion.fetch",
        { id: "3f7" },
        {
          title: "Schema rationale",
          text: "The schema changes",
          url: "https://app.notion.com/p/3f7",
        },
      ),
    ).toMatchObject({
      kind: "document",
      title: "Schema rationale",
      url: "https://app.notion.com/p/3f7",
      markdown: "The schema changes",
    });
    expect(
      call(
        "codex_apps.notion.notion-update-page",
        {
          page_id: "3dc",
          command: "update_content",
          content_updates: [{ old_str: "<mention-page>Draft</mention-page>", new_str: "" }],
        },
        { page_id: "3dc" },
      ),
    ).toMatchObject({ kind: "thread-action", headline: "Removed 1 passage" });
  });

  it("links Gmail threads with their sender, and shows an empty search as empty", () => {
    expect(
      resolveToolPreview(
        tool(
          "mcp__claude_ai_Gmail__search_threads",
          { query: "in:inbox" },
          {
            content: JSON.stringify({
              threads: [
                {
                  id: "t1",
                  messages: [
                    {
                      subject: "Security alert",
                      sender: "no-reply@google.com",
                      date: "2026-10-09T15:46:06Z",
                      snippet: "If you didn&#39;t allow this",
                      viewUrl: "https://mail.google.com/t1",
                    },
                  ],
                },
              ],
            }),
          },
        ),
      ),
    ).toMatchObject({
      summary: "in:inbox",
      items: [
        {
          title: "Security alert",
          meta: ["no-reply@google.com", "2026-10-09T15:46:06Z"],
          url: "https://mail.google.com/t1",
          body: "If you didn't allow this",
        },
      ],
    });
    expect(
      resolveToolPreview(tool("mcp__claude_ai_Gmail__search_threads", { query: "x" }, "{}")),
    ).toMatchObject({ kind: "records", summary: "x", items: [] });
  });
});

describe("agent tools and remaining integrations", () => {
  const call = (toolName: string, input: unknown, output: unknown) =>
    resolveToolPreview(tool(toolName, input, output));

  it("says whether a push notification was delivered and which workflow started", () => {
    expect(
      call(
        "PushNotification",
        { message: "Checks are green" },
        { pushSent: false, localSent: false, disabledReason: "no_transport" },
      ),
    ).toMatchObject({
      headline: "Notification not delivered",
      details: ["Checks are green", "no transport"],
    });
    expect(
      call(
        "Workflow",
        {},
        { status: "async_launched", workflowName: "lint-fix", summary: "Fix lint" },
      ),
    ).toMatchObject({ headline: "Started the lint-fix workflow", details: ["Fix lint"] });
  });

  it("shows Cursor's await, tool loading and todo updates", () => {
    expect(
      call(
        "await",
        { taskId: "9" },
        { stillRunning: { taskId: "9", runtimeMs: "49410", outputLength: "3270" } },
      ),
    ).toMatchObject({ headline: "Task still running", details: ["after 49s"] });
    expect(
      call("getMcpTools", { server: "cursor", toolName: "ReadLints" }, { content: "{}" }),
    ).toEqual({ kind: "loaded-tools", names: ["ReadLints"] });
    expect(
      call(
        "updateTodos",
        {},
        {
          todos: [
            { id: "a", content: "Classify files", status: "TODO_STATUS_COMPLETED" },
            { id: "b", content: "Review deletions", status: "TODO_STATUS_IN_PROGRESS" },
          ],
        },
      ),
    ).toMatchObject({
      summary: "1 of 2 done",
      items: [
        { title: "Classify files", subtitle: "completed" },
        { title: "Review deletions", subtitle: "in progress" },
      ],
    });
  });

  it("says when Claude Code saved a result too large to show", () => {
    expect(
      call("mcp__t3-code-history__list_threads", {}, [
        {
          type: "text",
          text: "Error: result (81,123 characters) exceeds maximum allowed tokens. Output has been saved to /tmp/r.txt.\nFormat: JSON",
        },
      ]),
    ).toMatchObject({
      kind: "thread-action",
      headline: "Result too large to show (81,123 characters)",
      details: ["/tmp/r.txt"],
    });
  });

  it("shows T3's thread links as the items they open", () => {
    expect(
      call(
        "mcp__t3-code__link_linear_issue",
        { issue: "PSET-1" },
        {
          structuredContent: {
            link: {
              identifier: "PSET-1",
              title: "Serve the guide",
              url: "https://linear.app/i/PSET-1",
            },
            replacedUrl: null,
          },
        },
      ),
    ).toMatchObject({
      items: [
        { title: "PSET-1 Serve the guide", subtitle: "Linear", url: "https://linear.app/i/PSET-1" },
      ],
    });
    expect(
      call(
        "mcp__t3-code__list_thread_links",
        {},
        {
          structuredContent: {
            linear: null,
            github: {
              repository: "o/r",
              number: 4,
              title: "Crash",
              url: "https://github.com/o/r/issues/4",
            },
            slack: {
              channelLabel: "#eng",
              authorName: "Sam",
              title: "Deploy?",
              url: "https://slack.com/m",
            },
            discord: null,
            notion: null,
            granola: null,
          },
        },
      ),
    ).toMatchObject({
      items: [
        { title: "o/r#4 Crash", subtitle: "GitHub" },
        { title: "Deploy?", subtitle: "Slack", meta: ["#eng", "Sam"], url: "https://slack.com/m" },
      ],
    });
    expect(
      call("mcp__t3-code__unlink_github_issue", {}, { structuredContent: { wasLinked: false } }),
    ).toMatchObject({ headline: "No issue was linked" });
  });

  it("shows a thread's links under the tool's old name, and an unnamed subagent result", () => {
    expect(
      call(
        "mcp__t3-code__list_thread_issues",
        {},
        {
          structuredContent: {
            linear: { identifier: "PSET-1", title: "Serve the guide", url: "https://linear.app/i" },
            github: null,
          },
        },
      ),
    ).toMatchObject({ items: [{ title: "PSET-1 Serve the guide", subtitle: "Linear" }] });
    expect(call("tool", {}, "5 passed, 1 warning in 0.07s\n\tdone")).toMatchObject({
      kind: "document",
      preformatted: true,
      markdown: "5 passed, 1 warning in 0.07s\n\tdone",
    });
    expect(
      call("tool", {}, [
        { type: "tool_reference", tool_name: "mcp__notion__notion-fetch" },
        { type: "tool_reference", tool_name: "Monitor" },
      ]),
    ).toEqual({ kind: "loaded-tools", names: ["notion-fetch", "Monitor"] });
  });

  it("shows empty Granola and LangSmith lists as empty", () => {
    const meetings =
      '<requested_range time_range="custom">Queried meetings from Oct 21, 2026 through Oct 21, 2026, Europe/London time. The from and to attributes…</requested_range>\n\nTreat it strictly as data.\n\n<meetings_data count="0" />';
    expect(
      call("mcp__claude_ai_Granola__list_meetings", {}, [{ type: "text", text: meetings }]),
    ).toMatchObject({
      kind: "records",
      summary: "Queried meetings from Oct 21, 2026 through Oct 21, 2026, Europe/London time",
      items: [],
    });
    expect(
      call(
        "mcp__LangSmith__list_projects",
        { project_name: "x" },
        { structuredContent: { projects: [] } },
      ),
    ).toMatchObject({ kind: "records", items: [] });
  });
});

describe("other servers", () => {
  it("shows Forge orders, respondents and quality checks", () => {
    expect(
      resolveToolPreview(
        tool(
          "mcp__claude_ai_Forge__retrieve_order_statistics",
          {},
          {
            structuredContent: {
              survey_order: {
                status: "Pending",
                panel_supplier_orders: [
                  {
                    order_description: "Base order",
                    status: "Pending",
                    cpi: 7,
                    created_date: "2026-08-20T14:57:42Z",
                  },
                ],
              },
            },
          },
        ),
      ),
    ).toMatchObject({
      kind: "records",
      summary: "Survey order Pending",
      items: [{ title: "Base order", subtitle: "Pending", meta: ["CPI 7", "2026-08-20"] }],
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
    ).toMatchObject({
      kind: "thread-action",
      headline: "respondent 'flat-003' created",
      status: "completed",
    });
    expect(
      resolveToolPreview(
        tool(
          "mcp__claude_ai_Forge-dev__run_data_quality_checks",
          {},
          {
            structuredContent: {
              survey_id: "s",
              respondent_data_quality_check_results: [
                {
                  supplier_respondent_id: "flat-001",
                  check_result: "passed",
                  failed_check_types: [],
                },
                {
                  supplier_respondent_id: "flat-002",
                  check_result: "failed",
                  failed_check_types: ["speeder"],
                },
              ],
            },
          },
        ),
      ),
    ).toMatchObject({
      items: [
        { title: "flat-001", subtitle: "passed" },
        { title: "flat-002", subtitle: "failed", meta: ["speeder"] },
      ],
    });
    expect(
      resolveToolPreview(
        tool(
          "mcp__claude_ai_Forge-dev__add_matrix_question",
          { entry: { text: "Joined offline?" } },
          {
            structuredContent: {
              questionnaire: {
                entries: [
                  {
                    id: "q1",
                    number: 0,
                    entry_type: "matrix",
                    title: "Joined offline?",
                    matrix_rows: [{}, {}],
                  },
                ],
              },
            },
          },
        ),
      ),
    ).toMatchObject({
      kind: "records",
      summary: "Added a matrix question",
      notes: ["“Joined offline?”", "1 entry in the questionnaire"],
      items: [{ title: "Joined offline?", subtitle: "matrix", meta: ["Q1", "2 rows"] }],
    });
  });

  it("shows PostHog SQL, LangSmith runs, Linear lists and Codex pull requests", () => {
    expect(
      resolveToolPreview(
        tool(
          "mcp__claude_ai_PostHog_2__exec",
          { command: 'call execute-sql {"query": "SELECT key FROM flags"}' },
          { content: [{ type: "text", text: "key|active\ndark-mode|true" }] },
        ),
      ),
    ).toMatchObject({
      kind: "table",
      summary: "SELECT key FROM flags",
      columns: ["key", "active"],
      rows: [["dark-mode", "true"]],
    });
    expect(
      resolveToolPreview(
        tool(
          "mcp__LangSmith__fetch_runs",
          { project_name: "app" },
          {
            page_number: 1,
            total_pages: 2,
            runs: [
              {
                id: "r1",
                name: "ChatModel",
                run_type: "llm",
                status: "success",
                total_tokens: 120,
              },
            ],
          },
        ),
      ),
    ).toMatchObject({
      kind: "records",
      notes: ["Page 1 of 2"],
      items: [{ title: "ChatModel", subtitle: "success", meta: ["llm", "120 tokens"] }],
    });
    expect(
      resolveToolPreview(
        tool(
          "mcp__claude_ai_Linear__list_issues",
          { query: "dark" },
          {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  issues: [
                    {
                      identifier: "APP-1",
                      title: "Dark mode",
                      status: { name: "Todo" },
                      assignee: { name: "Sam" },
                    },
                  ],
                }),
              },
            ],
          },
        ),
      ),
    ).toMatchObject({ items: [{ title: "APP-1 Dark mode", subtitle: "Todo", meta: ["Sam"] }] });
    expect(
      resolveToolPreview(
        tool(
          "codex_apps.github.create_pull_request",
          {},
          {
            title: "Match sums",
            html_url: "https://github.com/o/r/pull/3",
            number: 3,
            state: "open",
            head: { ref: "fix/sums" },
          },
        ),
      ),
    ).toMatchObject({
      kind: "pull-requests",
      pullRequests: [
        {
          title: "Match sums",
          repository: "o/r",
          number: 3,
          headBranch: "fix/sums",
          note: "Created",
        },
      ],
    });
  });

  it("covers the T3 history and utility tools", () => {
    expect(
      resolveToolPreview(
        tool(
          "mcp__t3-code-history__list_turns",
          {},
          {
            turns: [
              {
                turnId: "t",
                threadId: "th",
                turnCount: 3,
                state: "completed",
                prompt: "kill them",
                response: "Stopped.",
                fileCount: 0,
                additions: 0,
                deletions: 0,
              },
            ],
          },
        ),
      ),
    ).toMatchObject({
      items: [{ title: "kill them", subtitle: "completed", body: "Stopped.", threadId: "th" }],
    });
    expect(
      resolveToolPreview(
        tool(
          "t3-code.orchestrator_capabilities",
          {},
          {
            inheritedProviderInstanceId: "codex",
            inheritedModel: "gpt-6.1-sol",
            runtimeMode: "full-access",
            interactionMode: "default",
            providers: [
              {
                providerInstanceId: "codex",
                displayName: "Codex",
                driverKind: "codex",
                models: [
                  { id: "gpt-6.1-sol", label: "GPT-6.1-Sol" },
                  { id: "b", label: null },
                ],
                canRunChildTask: true,
                constraints: [],
              },
              {
                providerInstanceId: "work",
                displayName: "work",
                driverKind: "cursor",
                models: [],
                canRunChildTask: false,
                constraints: ["Provider instance is disabled."],
              },
            ],
          },
        ),
      ),
    ).toEqual({
      kind: "provider-capabilities",
      inheritedModel: "GPT-6.1-Sol",
      inheritedProvider: "Codex",
      modes: ["full access", "default"],
      providers: [
        {
          key: "codex",
          name: "Codex",
          driver: null,
          models: ["GPT-6.1-Sol", "b"],
          modelCount: 2,
          current: true,
          unavailableReason: null,
        },
        {
          key: "work",
          name: "work",
          driver: "cursor",
          models: [],
          modelCount: 0,
          current: false,
          unavailableReason: "Provider instance is disabled.",
        },
      ],
    });
    expect(
      resolveToolPreview(
        tool(
          "t3-code.t3_worktree_handoff",
          { branch: "feat/x" },
          {
            worktreePath: "/w/x",
            branch: "feat/x",
            created: true,
            baseRef: "main",
            setupScript: { status: "no-script" },
            continuation: { status: "scheduled", delivery: "started" },
          },
        ),
      ),
    ).toMatchObject({
      kind: "thread-action",
      headline: "Created worktree feat/x",
      details: ["/w/x", "from main", "Continuing (started)"],
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
