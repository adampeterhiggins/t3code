import type { DocumentToolPreview, PreviewRecord, ToolPreview } from "./toolPreview.ts";
import { forgeToolPreview } from "./forgeToolPreview.ts";
import { historyToolPreview } from "./historyToolPreview.ts";
import { serviceToolPreview } from "./serviceToolPreview.ts";
import {
  recordOf,
  action,
  cellText,
  documentPreview,
  firstLine,
  inferredPreview,
  isRecord,
  link,
  properties,
  propertyRows,
  records,
  str,
  table,
  type Record_,
} from "./previewBuilders.ts";

// --- Notion ---

function notionPageUrl(pageId: string | null): string | null {
  return pageId ? `https://app.notion.com/p/${pageId.replaceAll("-", "")}` : null;
}

function notionPreview(tool: string, input: Record_, result: unknown): ToolPreview | null {
  const data = isRecord(result) ? result : null;
  switch (tool) {
    case "notion-update-page": {
      const url = notionPageUrl(str(input.page_id));
      const pageLink = link("Open page", url);
      const command = str(input.command);
      if (command === "update_properties" && isRecord(input.properties)) {
        return properties(propertyRows(input.properties), {
          summary: "Updated properties",
          link: pageLink,
        });
      }
      if (Array.isArray(input.content_updates)) {
        const updates = input.content_updates.filter(isRecord).flatMap((update) => {
          const next = str(update.new_str);
          return next ? [next] : [];
        });
        return documentPreview(updates.join("\n\n---\n\n"), {
          summary: `Updated ${updates.length} passage${updates.length === 1 ? "" : "s"}`,
          link: pageLink,
        });
      }
      const content = str(input.new_str) ?? str(input.content);
      return content
        ? documentPreview(content, {
            summary: command === "replace_content" ? "Replaced the content" : "Added content",
            link: pageLink,
          })
        : properties([["Command", command ?? "update"]], { link: pageLink });
    }
    case "notion-create-pages": {
      const created = Array.isArray(data?.pages) ? data.pages : [];
      const requested = Array.isArray(input.pages) ? input.pages : [];
      const pages = (created.length > 0 ? created : requested).filter(isRecord);
      return records(
        pages.map((page, index) => {
          const props = isRecord(page.properties) ? page.properties : {};
          return {
            key: str(page.id) ?? String(index),
            title: str(props.title) ?? str(page.title) ?? "Untitled page",
            subtitle: str(input.creation_mode),
            meta: [],
            url: str(page.url),
            body: null,
            threadId: null,
          };
        }),
        { summary: `Created ${pages.length} page${pages.length === 1 ? "" : "s"}` },
      );
    }
    case "notion-fetch": {
      const text = str(data?.text);
      return text
        ? documentPreview(text, {
            title: str(data?.title),
            url: str(data?.url)?.startsWith("http") ? str(data?.url) : null,
          })
        : null;
    }
    case "notion-query-data-sources": {
      if (!Array.isArray(data?.results)) return null;
      const rows = data.results.filter(isRecord);
      const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))].filter(
        (column) => column !== "url",
      );
      return table(
        columns,
        rows.map((row) => columns.map((column) => cellText(row[column]) ?? "")),
        { summary: `${rows.length} row${rows.length === 1 ? "" : "s"}` },
      );
    }
    case "notion-create-file-upload":
      // The upload headers carry a bearer token; show only what was uploaded.
      return properties(
        (
          [
            ["File", str(data?.filename) ?? str(input.filename)],
            ["Type", str(data?.content_type) ?? str(input.content_type)],
            ["Expires", str(data?.expires_at)],
          ] as const
        ).flatMap(([key, value]) => (value ? [[key, value] as const] : [])),
        { summary: "Prepared a file upload" },
      );
    case "notion-search": {
      const results = Array.isArray(data?.results) ? data.results.filter(isRecord) : null;
      if (!results) return null;
      return records(
        results.map((item, index) => ({
          key: str(item.id) ?? String(index),
          title: str(item.title) ?? "Untitled",
          subtitle: str(item.type),
          meta: [str(item.timestamp)].filter((meta): meta is string => meta !== null),
          url: str(item.url),
          body: str(item.highlight),
          threadId: null,
        })),
        { summary: str(input.query) },
      );
    }
    default: {
      const text = str(data?.result);
      if (text) return documentPreview(notionMarkupText(text), { summary: null });
      return inferredPreview(result, str(input.query));
    }
  }
}

/** Notion's `<database url="{{…}}">` style markup as readable lines. */
function notionMarkupText(text: string): string {
  return text
    .replace(/<([a-z-0-9]+)[^>]*\btitle="([^"]+)"[^>]*\/?>/g, "$2")
    .replace(/<([a-z-0-9]+)[^>]*\bname="([^"]+)"[^>]*\/?>/g, "$2")
    .replace(/<\/?[a-z][a-z-0-9]*[^>]*>/g, "")
    .replace(/\{\{(https?:[^}]+)\}\}/g, "$1")
    .trim();
}

// --- Datadog ---

interface DatadogSections {
  readonly preamble: string;
  readonly metadata: ReadonlyMap<string, string>;
  readonly format: "yaml" | "tsv" | "json" | null;
  readonly data: string;
}

/** Datadog's MCP wraps results as `<METADATA>…</METADATA>` and a `<YAML_DATA>` / `<TSV_DATA>` / `<JSON_DATA>` block. */
function datadogSections(text: string): DatadogSections | null {
  const metadataBlock = /<METADATA>([\s\S]*?)<\/METADATA>/.exec(text);
  const dataBlock = /<(YAML|TSV|JSON)_DATA>([\s\S]*?)<\/\1_DATA>/.exec(text);
  if (!metadataBlock && !dataBlock) return null;
  const metadata = new Map<string, string>();
  for (const match of (metadataBlock?.[1] ?? "").matchAll(/<([a-z_]+)>([\s\S]*?)<\/\1>/g)) {
    metadata.set(match[1]!, match[2]!.trim());
  }
  const preamble = text.slice(0, metadataBlock?.index ?? dataBlock?.index ?? 0).trim();
  const kind = dataBlock?.[1];
  return {
    preamble,
    metadata,
    format: kind === "YAML" ? "yaml" : kind === "TSV" ? "tsv" : kind === "JSON" ? "json" : null,
    data: dataBlock?.[2]?.trim() ?? "",
  };
}

/** The top-level scalar fields of each `- key: value` item in a YAML list. */
function yamlListItems(yaml: string): Array<Record<string, string>> {
  const items: Array<Record<string, string>> = [];
  let current: Record<string, string> | null = null;
  for (const line of yaml.split("\n")) {
    const start = /^- ([A-Za-z_.@]+): ?(.*)$/.exec(line);
    const field = /^ {2}([A-Za-z_.@]+): ?(.*)$/.exec(line);
    if (start) {
      current = {};
      items.push(current);
      if (start[2]) current[start[1]!] = unquote(start[2]);
    } else if (field && current && field[2]) {
      current[field[1]!] = unquote(field[2]);
    }
  }
  return items;
}

function unquote(value: string): string {
  return value.replace(/^"(.*)"$/, "$1").trim();
}

function datadogPreview(tool: string, input: Record_, text: string | null): ToolPreview | null {
  if (!text) return null;
  const summary = str(input.query) ?? str(input.filter) ?? str(input.name_filter);
  const sections = datadogSections(text);
  if (!sections) {
    try {
      return inferredPreview(JSON.parse(text), summary) ?? documentPreview(text);
    } catch {
      return documentPreview(text);
    }
  }
  const meta = sections.metadata;
  const urlKey = [...meta.keys()].find((key) => key.endsWith("_url") && key !== "base_url");
  const count = meta.get("count") ?? meta.get("total_rows") ?? meta.get("total_buckets");
  const fields = {
    summary,
    link: link("Open in Datadog", urlKey ? (meta.get(urlKey) ?? null) : null),
    notes: [
      count ? `${count} result${count === "1" ? "" : "s"}` : null,
      meta.get("empty_result_hint"),
      meta.get("truncation_message"),
      meta.get("message"),
    ],
  };
  switch (sections.format) {
    case "tsv": {
      const [head, ...lines] = sections.data.split("\n").filter((line) => line.length > 0);
      return table(
        head?.split("\t") ?? [],
        lines.map((line) => line.split("\t")),
        fields,
      );
    }
    case "json": {
      let parsed: unknown;
      try {
        parsed = JSON.parse(sections.data);
      } catch {
        return documentPreview(sections.data, { ...fields, preformatted: true });
      }
      if (Array.isArray(parsed) && parsed.every((item) => isRecord(item) && "expression" in item)) {
        // Metric queries: one row per expression with its points.
        return table(
          ["Expression", "Points", "From"],
          parsed
            .filter(isRecord)
            .map((series) => [
              str(series.expression) ?? "",
              String(series.point_count ?? ""),
              str(series.start_time) ?? "",
            ]),
          fields,
        );
      }
      const inferred = inferredPreview(parsed, summary);
      return inferred?.kind === "records" ? records(inferred.items, fields) : inferred;
    }
    case "yaml": {
      const items = yamlListItems(sections.data);
      if (items.length === 0) {
        return documentPreview(sections.data, { ...fields, preformatted: true });
      }
      return records(
        items.map((item, index) => ({
          key: item.span_id ?? item.id ?? String(index),
          title: firstLine(
            item.message ?? item.name ?? item.resource_name ?? Object.values(item)[0] ?? "Item",
          ),
          subtitle: item.status ?? null,
          meta: [item.timestamp, item.service].filter((meta): meta is string => Boolean(meta)),
          url: null,
          body: null,
          threadId: null,
        })),
        fields,
      );
    }
    default:
      return documentPreview(sections.preamble || text, fields);
  }
}

// --- Google ---

function eventTime(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const dateTime = str(value.dateTime);
  if (dateTime) return dateTime.slice(0, 16).replace("T", " ");
  return str(value.date);
}

function calendarPreview(tool: string, result: unknown): ToolPreview | null {
  const data = isRecord(result) ? result : null;
  if (tool === "list_calendars" && Array.isArray(data?.calendars)) {
    return records(
      data.calendars.filter(isRecord).map((calendar, index) => ({
        key: str(calendar.id) ?? String(index),
        title: str(calendar.summary) ?? str(calendar.id) ?? "Calendar",
        subtitle: calendar.primary === true ? "primary" : null,
        meta: [str(calendar.timeZone), str(calendar.accessRole)].filter(
          (meta): meta is string => meta !== null,
        ),
        url: null,
        body: null,
        threadId: null,
      })),
    );
  }
  if (tool === "list_events" && Array.isArray(data?.events)) {
    return records(
      data.events.filter(isRecord).map((event, index) => {
        const start = eventTime(event.start);
        const end = eventTime(event.end);
        const attendees = Array.isArray(event.attendees) ? event.attendees.length : 0;
        return {
          key: str(event.id) ?? String(index),
          title: str(event.summary) ?? "(No title)",
          subtitle: str(event.status) === "cancelled" ? "cancelled" : null,
          meta: [
            start ? `${start}${end ? `–${end.slice(-5)}` : ""}` : null,
            attendees > 0 ? `${attendees} attendee${attendees === 1 ? "" : "s"}` : null,
          ].filter((meta): meta is string => meta !== null),
          url: str(event.conferenceUrl) ?? str(event.htmlLink),
          body: null,
          threadId: null,
        };
      }),
    );
  }
  return inferredPreview(result);
}

function drivePreview(tool: string, input: Record_, result: unknown): ToolPreview | null {
  const data = isRecord(result) ? result : null;
  const content = str(data?.fileContent);
  if (content) {
    return documentPreview(content, {
      url: str(input.fileId) ? `https://drive.google.com/open?id=${str(input.fileId)}` : null,
    });
  }
  if (tool === "get_file_metadata" && data) {
    return properties(
      propertyRows(
        Object.fromEntries(
          Object.entries(data).filter(([key]) => !/^can[A-Z]|contentSnippet/.test(key)),
        ),
      ),
      {
        title: str(data.title) ?? str(data.name),
        url: str(data.webViewLink) ?? str(data.alternateLink),
        notes: [str(data.contentSnippet) ? firstLine(str(data.contentSnippet)!) : null],
      },
    );
  }
  return inferredPreview(result);
}

// --- Slack ---

function slackSendPreview(input: Record_, result: unknown): DocumentToolPreview | null {
  const message = str(input.message);
  if (!message) return null;
  const data = isRecord(result) ? result : null;
  const channel = isRecord(data?.channel_info) ? data.channel_info : null;
  const isDraft = str(data?.draft_id) !== null || str(data?.result)?.startsWith("Draft") === true;
  return documentPreview(message, {
    summary: str(channel?.name) ? `#${str(channel?.name)}` : str(input.channel_id),
    link: link(
      isDraft ? "Open draft channel" : "Open in Slack",
      str(data?.message_link) ?? str(data?.channel_link),
    ),
    notes: [
      isDraft ? "Saved as a draft, not sent" : null,
      str(input.thread_ts) ? "In a thread" : null,
    ],
  });
}

// `=== Message from Name (U123) at 2026-10-09 09:46:09 BST ===` sections.
const SLACK_CHANNEL_MESSAGE = /^=== Message from (.+?)(?: \([A-Z0-9]+\))? at (.+?) === ?$/m;

function slackChannelPreview(text: string | null): ToolPreview | null {
  if (!text) return null;
  const channel = /^Channel: (.+?)(?: \([A-Z0-9]+\))?$/m.exec(text)?.[1] ?? null;
  const parts = text.split(SLACK_CHANNEL_MESSAGE);
  const items: PreviewRecord[] = [];
  for (let index = 1; index + 2 < parts.length; index += 3) {
    const body = (parts[index + 2] ?? "")
      .split("\n")
      .filter((line) => !line.startsWith("Message TS: "))
      .join("\n")
      .trim();
    if (!parts[index]) continue;
    items.push({
      key: `${parts[index + 1]}:${index}`,
      title: parts[index]!,
      subtitle: null,
      meta: [parts[index + 1]!],
      url: null,
      body: slackPlainText(body),
      threadId: null,
    });
  }
  return items.length > 0
    ? records(items, { summary: channel })
    : documentPreview(slackPlainText(text), { summary: channel });
}

function slackPlainText(text: string): string {
  return text
    .replace(/<@[A-Z0-9]+\|([^>]+)>/g, "@$1")
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, "#$1")
    .replace(/<([^>|]+)\|([^>]+)>/g, "$2")
    .replace(/<(https?:[^>]+)>/g, "$1")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .trim();
}

/** Slack's `### Result n of m` user sections and `1. #channel (C1) - type - …` lines. */
function slackDirectoryPreview(tool: string, text: string | null): ToolPreview | null {
  if (!text) return null;
  if (tool === "slack_search_users") {
    const sections = text.split(/^### Result \d+ of \d+$/m).slice(1);
    return records(
      sections.map((section, index) => {
        const field = (name: string) =>
          new RegExp(`^${name}: ?(.*)$`, "m").exec(section)?.[1]?.trim() || null;
        return {
          key: field("User ID") ?? String(index),
          title: field("Name") ?? "User",
          subtitle: field("Title"),
          meta: [field("Email"), field("Timezone")].filter((meta): meta is string => meta !== null),
          url: /\((https?:[^)]+)\)/.exec(field("Permalink") ?? "")?.[1] ?? null,
          body: null,
          threadId: null,
        };
      }),
    );
  }
  const channels = [...text.matchAll(/^\d+\. (#\S+) \(([A-Z0-9]+)\) - (\S+)(?: - (.*))?$/gm)];
  return channels.length > 0
    ? records(
        channels.map((match) => ({
          key: match[2]!,
          title: match[1]!,
          subtitle: match[3]!.replaceAll("_", " "),
          meta: match[4] ? [match[4]] : [],
          url: null,
          body: null,
          threadId: null,
        })),
      )
    : documentPreview(text);
}

function slackFilePreview(text: string | null): ToolPreview | null {
  if (!text) return null;
  const rows = [...text.matchAll(/^(Title|MIME Type|Size|Created): (.+)$/gm)].map(
    (match) => [match[1]!, match[2]!.trim()] as const,
  );
  return rows.length > 0 ? properties(rows) : null;
}

// --- Granola ---

function granolaPreview(text: string | null): ToolPreview | null {
  if (!text) return null;
  const meetings = [...text.matchAll(/<meeting ([^>]*)>([\s\S]*?)<\/meeting>/g)];
  if (meetings.length === 0) return documentPreview(text);
  return records(
    meetings.map((match, index) => {
      const attribute = (name: string) =>
        new RegExp(`\\b${name}="([^"]*)"`).exec(match[1]!)?.[1] ?? null;
      const participants = /<known_participants>([\s\S]*?)<\/known_participants>/
        .exec(match[2]!)?.[1]
        ?.trim()
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">");
      return {
        key: attribute("id") ?? String(index),
        title: attribute("title") ?? "Meeting",
        subtitle: null,
        meta: [attribute("date")].filter((meta): meta is string => meta !== null),
        url: attribute("url"),
        body: participants ?? null,
        threadId: null,
      };
    }),
  );
}

// --- Linear ---

function linearIssueDocument(issue: Record_): DocumentToolPreview {
  const identifier = str(issue.identifier) ?? str(issue.id);
  const title = str(issue.title);
  return documentPreview(str(issue.description) ?? "", {
    title: [identifier, title].filter(Boolean).join(" ") || null,
    url: str(issue.url),
    notes: [
      isRecord(issue.status) ? str(issue.status.name) : str(issue.status),
      isRecord(issue.assignee) ? str(issue.assignee.name) : str(issue.assignee),
    ],
  });
}

function nameOf(value: unknown): string | null {
  return isRecord(value) ? (str(value.name) ?? str(value.displayName)) : str(value);
}

function linearRecord(kind: string, item: Record_, index: number): PreviewRecord {
  const base = { key: str(item.id) ?? String(index), url: str(item.url), threadId: null };
  switch (kind) {
    case "issues":
      return {
        ...base,
        title:
          [str(item.identifier) ?? str(item.id), str(item.title)].filter(Boolean).join(" ") ||
          "Issue",
        subtitle: nameOf(item.status) ?? nameOf(item.state),
        meta: [
          nameOf(item.assignee),
          nameOf(item.priority) ?? (typeof item.priority === "number" ? `P${item.priority}` : null),
          str(item.updatedAt)?.slice(0, 10) ?? null,
        ].filter((meta): meta is string => meta !== null),
        body: null,
      };
    case "projects":
      return {
        ...base,
        title: str(item.name) ?? "Project",
        subtitle: nameOf(item.status),
        meta: [
          nameOf(item.lead),
          Array.isArray(item.teams)
            ? item.teams.map(nameOf).filter(Boolean).join(", ") || null
            : null,
        ].filter((meta): meta is string => meta !== null),
        body: null,
      };
    case "users":
      return {
        ...base,
        title: str(item.name) ?? str(item.displayName) ?? "User",
        subtitle: item.isActive === false ? "inactive" : null,
        meta: [str(item.email), str(item.status)].filter((meta): meta is string => meta !== null),
        body: null,
      };
    case "comments":
      return {
        ...base,
        title: nameOf(item.user) ?? nameOf(item.author) ?? "Comment",
        subtitle: null,
        meta: [str(item.createdAt)?.slice(0, 16).replace("T", " ") ?? null].filter(
          (meta): meta is string => meta !== null,
        ),
        body: str(item.body),
      };
    default:
      return (
        recordOf(item, index) ?? { ...base, title: "Item", subtitle: null, meta: [], body: null }
      );
  }
}

function linearPreview(tool: string, input: Record_, result: unknown): ToolPreview | null {
  const data = isRecord(result) ? result : null;
  if (!data) return inferredPreview(result);
  if ((tool === "get_issue" || tool === "save_issue") && str(data.title)) {
    return linearIssueDocument(data);
  }
  if (
    (tool === "get_project" || tool === "save_project" || tool === "get_document") &&
    (str(data.name) ?? str(data.title))
  ) {
    return documentPreview(str(data.description) ?? str(data.content) ?? "", {
      title: str(data.name) ?? str(data.title),
      url: str(data.url),
      notes: [nameOf(data.status), nameOf(data.lead)],
    });
  }
  const listKey = [
    "issues",
    "projects",
    "users",
    "comments",
    "teams",
    "cycles",
    "documents",
    "labels",
    "milestones",
    "notifications",
    "statusUpdates",
  ].find((key) => Array.isArray(data[key]));
  if (listKey) {
    const raw = data[listKey];
    const list = Array.isArray(raw) ? raw.filter(isRecord) : [];
    return records(
      list.map((item, index) => linearRecord(listKey, item, index)),
      {
        summary: str(input.query),
        notes: [data.hasNextPage === true ? "More results on the next page" : null],
      },
    );
  }
  return inferredPreview(result, str(input.query));
}

// --- Entry point ---

/** `mcp__server__tool` or `server.tool`, with Claude.ai's `claude_ai_` connector prefix dropped. */
function splitIntegrationToolName(
  toolName: string,
): { readonly server: string; readonly tool: string } | null {
  const mcp = /^mcp__(.+?)__(.+)$/.exec(toolName);
  const dotted = mcp ? null : /^([A-Za-z][\w-]*)\.([\w.-]+)$/.exec(toolName);
  const match = mcp ?? dotted;
  if (!match) return null;
  return {
    server: match[1]!.replace(/^claude_ai_/, "").toLowerCase(),
    tool: match[2]!,
  };
}

/**
 * Cards for third-party MCP tools (Notion, Datadog, Slack, Google, Linear and others), and
 * a card inferred from the JSON for any other server's result.
 */
export function integrationToolPreview(
  toolName: string,
  input: Record_,
  result: unknown,
  text: string | null,
): ToolPreview | null {
  const name = splitIntegrationToolName(toolName);
  if (!name) return null;
  const summary = str(input.command) ?? str(input.query);
  return (
    serverToolPreview(name.server, name.tool, input, result, text) ??
    genericToolPreview(result, text, summary)
  );
}

/** Any tool's result as an inferred card, or its text as a document. */
export function genericToolPreview(
  result: unknown,
  text: string | null,
  summary: string | null = null,
): ToolPreview | null {
  const meaningful = text && !/^(\{\}|\[\])$/.test(text.trim()) ? text : null;
  return (
    inferredPreview(result, summary) ??
    (meaningful ? documentPreview(meaningful, { summary }) : null)
  );
}

function serverToolPreview(
  server: string,
  tool: string,
  input: Record_,
  result: unknown,
  text: string | null,
): ToolPreview | null {
  if (server === "notion") return notionPreview(tool, input, result);
  if (server === "datadog") return datadogPreview(tool, input, text);
  if (server === "google_calendar") return calendarPreview(tool, result);
  if (server === "google_drive") return drivePreview(tool, input, result);
  if (server === "granola") return granolaPreview(text);
  if (server === "linear") return linearPreview(tool, input, result);
  if (server === "t3-code-history") return historyToolPreview(tool, input, result);
  if (server === "forge" || server === "forge-dev") return forgeToolPreview(tool, input, result);
  const service = serviceToolPreview(server, tool, input, result, text);
  if (service) return service;
  if (server === "slack") {
    if (tool === "slack_send_message" || tool === "slack_send_message_draft") {
      return slackSendPreview(input, result);
    }
    if (tool === "slack_read_channel") {
      return slackChannelPreview(isRecord(result) ? str(result.messages) : text);
    }
    if (tool === "slack_search_users" || tool === "slack_search_channels") {
      return slackDirectoryPreview(tool, isRecord(result) ? str(result.results) : text);
    }
    if (tool === "slack_read_file") return slackFilePreview(text);
  }
  return null;
}

/** Claude Code's own tools outside the agent-message and question cards. */
export function claudeUtilityToolPreview(
  toolName: string,
  input: Record_,
  result: unknown,
  text: string | null,
): ToolPreview | null {
  const data = isRecord(result) ? result : null;
  switch (toolName) {
    case "TaskStop":
      return action("Stopped a background task", [
        str(data?.command) ?? str(data?.message),
        str(data?.task_type)?.replaceAll("_", " ") ?? null,
      ]);
    case "EnterWorktree":
      return action("Entered a worktree", [
        str(data?.worktreeBranch),
        str(data?.worktreePath) ?? str(input.path),
      ]);
    case "ExitWorktree":
      return action("Left the worktree", [str(data?.message)]);
    case "ListAgents": {
      const listing = str(data?.listing) ?? text;
      return listing ? documentPreview(listing, { preformatted: true }) : null;
    }
    case "ReadMcpResourceTool": {
      const contents = Array.isArray(data?.contents) ? data.contents.filter(isRecord) : [];
      const resource = contents[0];
      const body = str(resource?.text);
      return body
        ? documentPreview(body, {
            title: str(resource?.uri) ?? str(input.uri),
            summary: str(input.server),
          })
        : null;
    }
    default:
      return null;
  }
}
