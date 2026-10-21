import * as DateTime from "effect/DateTime";
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
        const edits = input.content_updates.filter(isRecord);
        const updates = edits.flatMap((update) => {
          const next = str(update.new_str);
          return next ? [next] : [];
        });
        if (updates.length === 0) {
          return action(`Removed ${edits.length} passage${edits.length === 1 ? "" : "s"}`, []);
        }
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
    // Codex's Notion app names it `fetch`.
    case "fetch":
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

function slackSendPreview(input: Record_, result: unknown): DocumentToolPreview | null {
  const message = str(input.message);
  if (!message) return null;
  const data = isRecord(result) ? result : null;
  const channel = isRecord(data?.channel_info) ? data.channel_info : null;
  const isDraft = str(data?.draft_id) !== null || str(data?.result)?.startsWith("Draft") === true;
  const postAt = typeof input.post_at === "number" ? input.post_at : null;
  return documentPreview(message, {
    summary: str(channel?.name) ? `#${str(channel?.name)}` : str(input.channel_id),
    link: link(
      isDraft ? "Open draft channel" : "Open in Slack",
      str(data?.message_link) ?? str(data?.channel_link),
    ),
    notes: [
      isDraft ? "Saved as a draft, not sent" : null,
      postAt === null
        ? null
        : `Scheduled for ${DateTime.formatIso(DateTime.makeUnsafe(postAt * 1000))}`,
      str(input.thread_ts) ? "In a thread" : null,
    ],
  });
}

// `=== Message from Name (U123) at 2026-10-09 09:46:09 BST ===` sections.
const SLACK_CHANNEL_MESSAGE = /^=== Message from (.+?)(?: \([A-Z0-9]+\))? at (.+?) === ?$/m;
// Concise reads: `Name: text [2026-10-21 16:32:08 BST]` blocks, where the text may hold blank lines.
const SLACK_CONCISE_MESSAGE =
  /(?:^|\n\n)([^:\n]{1,80}): ([\s\S]*?) \[(\d{4}-\d\d-\d\d \d\d:\d\d(?::\d\d)? [A-Z]{2,5})\](?=\n\n|\s*$)/g;

function slackChannelPreview(text: string | null): ToolPreview | null {
  if (!text) return null;
  const header = /^Channel: (.+?)(?: \([A-Z0-9]+\))?$/m.exec(text);
  const channel = header?.[1] ?? null;
  const parts = text.split(SLACK_CHANNEL_MESSAGE);
  const items: PreviewRecord[] = [];
  for (let index = 1; index + 2 < parts.length; index += 3) {
    const body = (parts[index + 2] ?? "")
      .split("\n")
      .filter((line) => !line.startsWith("Message TS: "))
      .join("\n")
      .trim();
    if (!parts[index]) continue;
    items.push(slackMessageRecord(parts[index]!, parts[index + 1]!, body, index));
  }
  if (items.length === 0) {
    const messages = header ? text.slice(header.index + header[0].length).trim() : text;
    for (const match of messages.matchAll(SLACK_CONCISE_MESSAGE)) {
      items.push(slackMessageRecord(match[1]!, match[3]!, match[2]!, match.index));
    }
  }
  return items.length > 0
    ? records(items, { summary: channel })
    : documentPreview(slackPlainText(text), { summary: channel });
}

function slackMessageRecord(author: string, time: string, body: string, index: number) {
  return {
    key: `${time}:${index}`,
    title: author.trim(),
    subtitle: null,
    meta: [time],
    url: null,
    body: slackPlainText(body),
    threadId: null,
  } satisfies PreviewRecord;
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

/** A `Name: value` line of a Slack MCP section, or null when it is missing or blank. */
function slackField(section: string, name: string): string | null {
  return new RegExp(`^${name}: ?(.*)$`, "m").exec(section)?.[1]?.trim() || null;
}

function slackPermalink(section: string): string | null {
  return /\((https?:[^)]+)\)/.exec(slackField(section, "Permalink") ?? "")?.[1] ?? null;
}

/** Slack's `### Result n of m` user and channel sections and `1. #channel (C1) - type - …` lines. */
function slackDirectoryPreview(tool: string, text: string | null): ToolPreview | null {
  if (!text) return null;
  const sections = text.split(/^### Result \d+ of \d+$/m).slice(1);
  if (tool === "slack_search_users") {
    return records(
      sections.map((section, index) => ({
        key: slackField(section, "User ID") ?? String(index),
        title: slackField(section, "Name") ?? "User",
        subtitle: slackField(section, "Title"),
        meta: [slackField(section, "Email"), slackField(section, "Timezone")].filter(
          (meta): meta is string => meta !== null,
        ),
        url: slackPermalink(section),
        body: null,
        threadId: null,
      })),
    );
  }
  if (sections.length > 0) {
    return records(
      sections.map((section, index) => ({
        key: String(index),
        title: slackField(section, "Name") ?? "Channel",
        subtitle: slackField(section, "Is Archived") === "true" ? "archived" : null,
        meta: [
          slackField(section, "Creator")?.replace(/ \(<@[A-Z0-9]+>?\)$/, "") ?? null,
          slackField(section, "Created"),
        ].filter((meta): meta is string => meta !== null),
        url: slackPermalink(section),
        body: slackField(section, "Purpose"),
        threadId: null,
      })),
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

/** `### #name` sections of `- **Type:** Public Channel` bullets. */
function slackUserChannelsPreview(text: string | null): ToolPreview | null {
  if (!text) return null;
  const sections = text.split(/^### /m).slice(1);
  if (sections.length === 0) return documentPreview(text, { preformatted: true });
  return records(
    sections.map((section, index) => {
      const field = (name: string) =>
        new RegExp(`^- \\*\\*${name}:\\*\\* (.+)$`, "m").exec(section)?.[1]?.trim() ?? null;
      return {
        key: field("ID") ?? String(index),
        title: section.split("\n")[0]!.trim(),
        subtitle: field("Type"),
        meta: field("Archived") === "Yes" ? ["archived"] : [],
        url: null,
        body: field("Topic") ?? field("Purpose"),
        threadId: null,
      };
    }),
    { notes: [/^Pagination: More results/m.test(text) ? "More channels on the next page" : null] },
  );
}

/** Detailed `## Member n` sections, or concise `@handle (Display Name)` lines. */
function slackMembersPreview(text: string | null): ToolPreview | null {
  if (!text) return null;
  const sections = text.split(/^## Member \d+$/m).slice(1);
  if (sections.length > 0) {
    return records(
      sections.map((section, index) => ({
        key: slackField(section, "User ID") ?? String(index),
        title: slackField(section, "Real Name") ?? slackField(section, "Display Name") ?? "Member",
        subtitle: slackField(section, "Username"),
        meta: [slackField(section, "Email"), slackField(section, "Title")].filter(
          (meta): meta is string => meta !== null,
        ),
        url: null,
        body: null,
        threadId: null,
      })),
    );
  }
  const handles = [...text.matchAll(/^(@\S+) \((.+)\)$/gm)];
  return handles.length > 0
    ? records(
        handles.map((match) => ({
          key: match[1]!,
          title: match[2]!,
          subtitle: match[1]!,
          meta: [],
          url: null,
          body: null,
          threadId: null,
        })),
      )
    : documentPreview(text, { preformatted: true });
}

function slackProfilePreview(text: string | null): ToolPreview | null {
  if (!text) return null;
  // Concise profiles are unlabelled lines; detailed ones are `Field: value`, with `No` flags.
  const rows = [...text.matchAll(/^([A-Z][A-Za-z ]*): ?(.*)$/gm)].flatMap((match) => {
    const value = match[2]!.trim();
    return value && value !== "No" ? [[match[1]!, value] as const] : [];
  });
  if (rows.length < 2) return documentPreview(text, { preformatted: true });
  const field = (name: string) => rows.find(([key]) => key === name)?.[1] ?? null;
  return properties(rows, { title: field("Real Name") ?? field("Display Name") });
}

/** `:emoji: × 2 — Name (U1), Name (U2)` lines. */
function slackReactionsPreview(text: string | null): ToolPreview | null {
  if (!text) return null;
  const rows = [...text.matchAll(/^(:\S+:) × (\d+) — (.+)$/gm)].map(
    (match) => [`${match[1]} × ${match[2]}`, match[3]!.replace(/ \([A-Z0-9]+\)/g, "")] as const,
  );
  return rows.length > 0 ? properties(rows) : documentPreview(text);
}

/** `Found 3 custom emojis matching "x":` then `:a:, :b: (alias for :c:)`. */
function slackEmojisPreview(text: string | null): ToolPreview | null {
  if (!text) return null;
  const found = /^(.*):\n([\s\S]+)$/.exec(text.trim());
  if (!found) return documentPreview(text);
  return records(
    found[2]!.split(/,\s*/).map((emoji) => {
      const alias = /^(:\S+:) \(alias for (:\S+:)\)$/.exec(emoji.trim());
      return {
        key: alias?.[1] ?? emoji.trim(),
        title: alias?.[1] ?? emoji.trim(),
        subtitle: alias ? `alias for ${alias[2]}` : null,
        meta: [],
        url: null,
        body: null,
        threadId: null,
      };
    }),
    { summary: found[1]! },
  );
}

function slackFilePreview(text: string | null): ToolPreview | null {
  if (!text) return null;
  const rows = [...text.matchAll(/^(Title|MIME Type|Size|Created): (.+)$/gm)].map(
    (match) => [match[1]!, match[2]!.trim()] as const,
  );
  return rows.length > 0 ? properties(rows) : null;
}

function slackToolPreview(
  tool: string,
  input: Record_,
  result: unknown,
  text: string | null,
): ToolPreview | null {
  const data = isRecord(result) ? result : null;
  // Slack's MCP wraps its text in one JSON field, named for what the tool returns.
  const body = str(data?.messages) ?? str(data?.results) ?? str(data?.members) ?? str(data?.result);
  const output = body ?? text;
  switch (tool) {
    case "slack_send_message":
    case "slack_send_message_draft":
    case "slack_schedule_message":
      return slackSendPreview(input, result);
    case "slack_create_canvas": {
      const content = str(input.content);
      return content
        ? documentPreview(content, {
            title: str(input.title),
            link: link("Open canvas", str(data?.canvas_url)),
          })
        : null;
    }
    case "slack_read_channel":
      return slackChannelPreview(output);
    case "slack_search_users":
    case "slack_search_channels":
      return slackDirectoryPreview(tool, output);
    case "slack_list_user_channels":
      return slackUserChannelsPreview(output);
    case "slack_list_channel_members":
      return slackMembersPreview(output);
    case "slack_read_user_profile":
      return slackProfilePreview(output);
    case "slack_get_reactions":
      return slackReactionsPreview(output);
    case "slack_search_emojis":
      return slackEmojisPreview(output);
    case "slack_read_file":
      return slackFilePreview(text);
    default:
      return null;
  }
}

function granolaPreview(text: string | null, result: unknown): ToolPreview | null {
  if (!text) return null;
  const meetings = [...text.matchAll(/<meeting ([^>]*)>([\s\S]*?)<\/meeting>/g)];
  if (meetings.length === 0) {
    // An empty list still carries Granola's range note and data-handling preamble.
    if (/<meetings_data [^>]*count="0"/.test(text)) {
      return records([], {
        summary: /<requested_range [^>]*>([^.<]+)/.exec(text)?.[1]?.trim() ?? null,
      });
    }
    return (isRecord(result) ? inferredPreview(result) : null) ?? documentPreview(text);
  }
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
    case "statusUpdates":
      return {
        ...base,
        title: nameOf(item.project) ?? nameOf(item.initiative) ?? "Status update",
        subtitle:
          str(item.health)
            ?.replace(/([a-z])([A-Z])/g, "$1 $2")
            .toLowerCase() ?? null,
        meta: [nameOf(item.user), str(item.createdAt)?.slice(0, 10) ?? null].filter(
          (meta): meta is string => meta !== null,
        ),
        body: str(item.body),
      };
    case "notifications":
      return {
        ...base,
        title: str(item.title) ?? "Notification",
        subtitle: str(item.subtitle),
        meta: [
          item.readAt === null ? "unread" : null,
          str(item.createdAt)?.slice(0, 16).replace("T", " ") ?? null,
        ].filter((meta): meta is string => meta !== null),
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
  if (
    (tool === "get_issue" || tool === "save_issue") &&
    (str(data.title) ?? str(data.description))
  ) {
    return linearIssueDocument({ identifier: str(input.id), ...data });
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
    "threads",
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

/**
 * Claude Code swaps a result too large for the model's context for a note naming the file it
 * saved the result to; the card says so rather than showing the note as the result.
 */
export function oversizedResultPreview(text: string | null): ToolPreview | null {
  const match =
    /^Error: result \(([\d,]+) characters\) exceeds maximum allowed tokens\. Output has been saved to (\S+?)\.?\n/.exec(
      text ?? "",
    );
  return match ? action(`Result too large to show (${match[1]} characters)`, [match[2]!]) : null;
}

/** Any tool's result as an inferred card, or its text as a document. */
export function genericToolPreview(
  result: unknown,
  text: string | null,
  summary: string | null = null,
): ToolPreview | null {
  const meaningful = text && !/^(\{\}|\[\])$/.test(text.trim()) ? text : null;
  const values = isRecord(result) ? Object.values(result) : [];
  if (values.length === 1 && Array.isArray(values[0]) && values[0].length === 0) {
    return records([], { summary });
  }
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
  if (server === "codex_apps") {
    // Codex names connector tools `codex_apps.<app>.<tool>`; GitHub's have their own card below.
    const app = /^([\w-]+)\.(.+)$/.exec(tool);
    const preview = app
      ? serverToolPreview(app[1]!.toLowerCase(), app[2]!, input, result, text)
      : null;
    if (preview) return preview;
  }
  if (server === "notion") return notionPreview(tool, input, result);
  if (server === "datadog") return datadogPreview(tool, input, text);
  if (server === "google_calendar") return calendarPreview(tool, result);
  if (server === "google_drive") return drivePreview(tool, input, result);
  if (server === "granola") return granolaPreview(text, result);
  if (server === "linear") return linearPreview(tool, input, result);
  if (server === "t3-code-history") return historyToolPreview(tool, input, result);
  if (server === "forge" || server === "forge-dev") return forgeToolPreview(tool, input, result);
  const service = serviceToolPreview(server, tool, input, result, text);
  if (service) return service;
  if (server === "slack") return slackToolPreview(tool, input, result, text);
  return null;
}

/** `updateTodos` statuses such as `TODO_STATUS_IN_PROGRESS`. */
function todoStatus(value: unknown): string | null {
  return (
    str(value)
      ?.replace(/^TODO_STATUS_/, "")
      .replaceAll("_", " ")
      .toLowerCase() ?? null
  );
}

/** Claude Code's and Cursor's own tools outside the agent-message and question cards. */
export function agentUtilityToolPreview(
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
    case "PushNotification": {
      const delivered = data?.pushSent === true || data?.localSent === true;
      return action(delivered ? "Sent a notification" : "Notification not delivered", [
        str(input.message),
        delivered ? null : (str(data?.disabledReason)?.replaceAll("_", " ") ?? null),
      ]);
    }
    case "Workflow": {
      const name = str(data?.workflowName) ?? str(input.name);
      return data?.status === "async_launched"
        ? action(name ? `Started the ${name} workflow` : "Started a workflow", [str(data.summary)])
        : null;
    }
    // Claude's name for a subagent tool result whose call was never seen: the output is all
    // there is.
    case "tool": {
      // A ToolSearch result is a list of `tool_reference` blocks.
      const loaded = (Array.isArray(result) ? result : []).filter(isRecord).flatMap((block) => {
        const name = block.type === "tool_reference" ? str(block.tool_name) : null;
        return name ? [name.replace(/^mcp__.+?__/, "")] : [];
      });
      if (loaded.length > 0) return { kind: "loaded-tools", names: loaded };
      return (
        inferredPreview(result) ?? (text ? documentPreview(text, { preformatted: true }) : null)
      );
    }
    case "cua_repl.js":
      // Accessibility trees are tab-indented; images show in the raw output.
      return text ? documentPreview(text, { preformatted: true }) : null;
    // Cursor's tools.
    case "await": {
      const running = isRecord(data?.stillRunning) ? data.stillRunning : null;
      const runtime = Number(running?.runtimeMs);
      return running
        ? action("Task still running", [
            Number.isFinite(runtime) ? `after ${Math.round(runtime / 1000)}s` : null,
          ])
        : null;
    }
    case "getMcpTools": {
      const name = str(input.toolName);
      return name ? { kind: "loaded-tools", names: [name] } : null;
    }
    case "updateTodos": {
      const raw = Array.isArray(data?.todos) ? data.todos : input.todos;
      const todos = (Array.isArray(raw) ? raw : []).filter(isRecord);
      const done = todos.filter((todo) => todoStatus(todo.status) === "completed").length;
      return todos.length > 0
        ? records(
            todos.map((todo, index) => ({
              key: str(todo.id) ?? String(index),
              title: str(todo.content) ?? "Todo",
              subtitle: todoStatus(todo.status),
              meta: [],
              url: null,
              body: null,
              threadId: null,
            })),
            { summary: `${done} of ${todos.length} done` },
          )
        : null;
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
