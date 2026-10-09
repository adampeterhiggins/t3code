import { ScheduledTaskSchedule, type OrchestrationV2TurnItem } from "@t3tools/contracts";
import { resolveT3McpToolId } from "@t3tools/shared/t3McpToolPresentation";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import {
  claudeUtilityToolPreview,
  genericToolPreview,
  integrationToolPreview,
} from "./integrationToolPreview.ts";
import { t3UtilityToolPreview } from "./t3UtilityToolPreview.ts";
import { toolCallArgs, toolResultData, toolResultText } from "./itemDetail.ts";

/**
 * A tool call's preview as data, for tools whose arguments and result read better
 * as a card than as `key value` lines and JSON. Clients render each kind; a tool
 * without one keeps the generic body.
 */
export type ToolPreview =
  | ThreadToolPreview
  | ThreadListToolPreview
  | ThreadActionToolPreview
  | ThreadSearchToolPreview
  | ContextTransfersToolPreview
  | TaskToolPreview
  | ScheduledTasksToolPreview
  | PullRequestToolPreview
  | BrowserToolPreview
  | LoadedToolsPreview
  | SlackMessagesPreview
  | QuestionsToolPreview
  | AgentMessageToolPreview
  | SkillToolPreview
  | MonitorToolPreview
  | WakeupToolPreview
  | HtmlPageToolPreview
  | RecordsToolPreview
  | TableToolPreview
  | DocumentToolPreview
  | PropertiesToolPreview;

/** What a generic card says above its content: the query, a link out, and notes. */
interface PreviewHeader {
  /** The query or target the call ran with. */
  readonly summary: string | null;
  readonly link: { readonly label: string; readonly url: string } | null;
  /** Short facts such as a result count, a truncation, or an empty-result hint. */
  readonly notes: ReadonlyArray<string>;
}

export interface PreviewRecord {
  readonly key: string;
  readonly title: string;
  /** A status or type, shown as a badge. */
  readonly subtitle: string | null;
  /** Times, people and other short facts. */
  readonly meta: ReadonlyArray<string>;
  readonly url: string | null;
  readonly body: string | null;
  /** A T3 thread the record belongs to, which the card opens. */
  readonly threadId: string | null;
}

/** A list of items, such as search results, events, issues or log lines. */
export interface RecordsToolPreview extends PreviewHeader {
  readonly kind: "records";
  readonly items: ReadonlyArray<PreviewRecord>;
  /** Items the result held beyond `items`. */
  readonly more: number;
}

export interface TableToolPreview extends PreviewHeader {
  readonly kind: "table";
  readonly columns: ReadonlyArray<string>;
  readonly rows: ReadonlyArray<ReadonlyArray<string>>;
  readonly more: number;
}

/** A page, message or file whose text is the point, as markdown. */
export interface DocumentToolPreview extends PreviewHeader {
  readonly kind: "document";
  readonly title: string | null;
  readonly url: string | null;
  readonly markdown: string;
  /** Plain monospace text rather than markdown, for listings and raw data. */
  readonly preformatted: boolean;
}

/** One object's fields as a two-column list. */
export interface PropertiesToolPreview extends PreviewHeader {
  readonly kind: "properties";
  readonly title: string | null;
  readonly url: string | null;
  readonly rows: ReadonlyArray<readonly [string, string]>;
}

export interface ThreadToolPreview {
  readonly kind: "thread";
  readonly threadId: string;
  readonly title: string;
  readonly status: string | null;
  readonly model: string | null;
  readonly branch: string | null;
  /** The newest items the call returned, oldest first. */
  readonly items: ReadonlyArray<{
    readonly key: string;
    readonly label: string;
    readonly text: string;
  }>;
  /** Items the call returned beyond `items`. */
  readonly moreItems: number;
}

export interface ThreadListToolPreview {
  readonly kind: "threads";
  readonly threads: ReadonlyArray<{
    readonly threadId: string;
    readonly title: string;
    readonly status: string | null;
    readonly model: string | null;
  }>;
}

/** A call that did one thing to a thread: interrupt, fork, rename, configure, organize. */
export interface ThreadActionToolPreview {
  readonly kind: "thread-action";
  readonly headline: string;
  readonly status: string | null;
  readonly details: ReadonlyArray<string>;
  /** The thread acted on or created; null when the call acted on its own thread. */
  readonly threadId: string | null;
}

export interface ThreadSearchToolPreview {
  readonly kind: "thread-search";
  readonly query: string | null;
  readonly matches: ReadonlyArray<{
    readonly threadId: string;
    readonly source: string | null;
    readonly snippet: string;
  }>;
}

export interface ContextTransfersToolPreview {
  readonly kind: "context-transfers";
  readonly transfers: ReadonlyArray<{
    readonly id: string;
    readonly sourceThreadId: string;
    readonly targetThreadId: string;
    readonly status: string | null;
  }>;
}

export interface ScheduledTasksToolPreview {
  readonly kind: "scheduled-tasks";
  readonly tasks: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly enabled: boolean;
    readonly schedule: ScheduledTaskSchedule | null;
  }>;
}

export interface TaskToolPreview {
  readonly kind: "task";
  readonly threadId: string | null;
  readonly title: string | null;
  readonly status: string | null;
  readonly model: string | null;
  readonly summary: string | null;
}

export interface PullRequestToolPreview {
  readonly kind: "pull-requests";
  readonly pullRequests: ReadonlyArray<{
    readonly url: string;
    readonly repository: string | null;
    readonly number: number | null;
    readonly title: string | null;
    readonly state: "open" | "closed" | "merged" | null;
    readonly isDraft: boolean;
    readonly headBranch: string | null;
    /** What the call did to it: `Already linked`, `Watching`, and so on. */
    readonly note: string | null;
  }>;
}

export interface BrowserToolPreview {
  readonly kind: "browser";
  /** What was acted on: a locator, key, URL, or typed text. */
  readonly target: string | null;
  readonly text: string | null;
  /** What the call did when that is not a target or typed text: a resize, a scroll, a recording. */
  readonly detail: string | null;
  /** JavaScript the call evaluated, shown as code. */
  readonly expression: string | null;
  /** The evaluation's value as JSON, when the call returned one. */
  readonly value: string | null;
  readonly page: { readonly url: string; readonly title: string | null } | null;
}

export interface LoadedToolsPreview {
  readonly kind: "loaded-tools";
  readonly names: ReadonlyArray<string>;
}

export interface SlackMessagesPreview {
  readonly kind: "slack-messages";
  readonly messages: ReadonlyArray<{
    readonly author: string;
    readonly time: string | null;
    /** The channel a search result came from. */
    readonly channel: string | null;
    readonly url: string | null;
    readonly text: string;
  }>;
}

export interface QuestionsToolPreview {
  readonly kind: "questions";
  readonly questions: ReadonlyArray<{
    readonly question: string;
    readonly options: ReadonlyArray<{ readonly label: string; readonly selected: boolean }>;
    /** An answer that matches no option, such as free text. */
    readonly otherAnswer: string | null;
  }>;
}

export interface AgentMessageToolPreview {
  readonly kind: "agent-message";
  /** A subagent's name or id; null for a message to a T3 thread. */
  readonly recipient: string | null;
  /** The T3 thread the message went to. */
  readonly threadId: string | null;
  readonly summary: string | null;
  readonly message: string;
}

export interface SkillToolPreview {
  readonly kind: "skill";
  readonly skill: string;
  readonly args: string | null;
}

export interface MonitorToolPreview {
  readonly kind: "monitor";
  readonly description: string | null;
  readonly command: string;
}

export interface WakeupToolPreview {
  readonly kind: "wakeup";
  /** When the agent wakes, as an ISO timestamp. */
  readonly at: string | null;
  readonly reason: string | null;
  readonly prompt: string | null;
}

export interface HtmlPageToolPreview {
  readonly kind: "html-page";
  readonly title: string | null;
  /** Short facts about the page: its size and theme. */
  readonly details: ReadonlyArray<string>;
}

type DynamicToolItem = Extract<OrchestrationV2TurnItem, { readonly type: "dynamic_tool" }>;
type Record_ = Record<string, unknown>;

function isRecord(value: unknown): value is Record_ {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function str(value: unknown): string | null {
  return isText(value) ? value : null;
}

function positiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

const MAX_THREAD_ITEMS = 4;

const THREAD_ITEM_LABELS: Readonly<Record<string, string>> = {
  user_message: "User",
  assistant_message: "Agent",
  reasoning: "Thinking",
  command_execution: "Command",
  file_change: "Edit",
};

function threadPreview(result: Record_): ThreadToolPreview | null {
  const thread = isRecord(result.thread) ? result.thread : null;
  const threadId = str(thread?.threadId);
  if (!thread || !threadId) return null;
  const items = (Array.isArray(result.items) ? result.items : []).filter(isRecord);
  const shown = items.slice(-MAX_THREAD_ITEMS).flatMap((item, index) => {
    const type = str(item.type) ?? "item";
    const text = str(item.text) ?? str(item.title);
    if (!text) return [];
    const label = THREAD_ITEM_LABELS[type] ?? "Tool";
    return [{ key: str(item.itemId) ?? String(index), label, text: text.trim() }];
  });
  return {
    kind: "thread",
    threadId,
    title: str(thread.title) ?? "Untitled thread",
    status: str(thread.status),
    model: str(thread.model),
    branch: str(thread.branch),
    items: shown,
    moreItems: Math.max(0, items.length - shown.length),
  };
}

function taskPreview(result: Record_, input: Record_): TaskToolPreview | null {
  const status = str(result.status);
  if (!status) return null;
  return {
    kind: "task",
    threadId: str(result.childThreadId),
    title: str(input.title),
    status: status === "running" && str(result.workState) ? str(result.workState) : status,
    model: str(result.model),
    // A cancellation reports no summary; its reason says why.
    summary: str(result.summary) ?? str(result.latestTerminalSummary) ?? str(input.reason),
  };
}

function pullRequestNote(tool: string, result: Record_): string | null {
  switch (tool) {
    case "link_pull_request":
      return result.alreadyLinked === true ? "Already linked" : "Linked";
    case "unlink_pull_request":
      return "Unlinked";
    case "watch_pull_request":
      return result.wasWatching === true ? "Already watching" : "Watching";
    case "unwatch_pull_request":
      return result.wasWatching === false ? "Was not watching" : "Stopped watching";
    default:
      return null;
  }
}

function pullRequestRow(
  value: Record_,
  note: string | null,
): PullRequestToolPreview["pullRequests"][number] | null {
  const url = str(value.url);
  if (!url) return null;
  const state = value.state;
  return {
    url,
    repository: str(value.repository),
    number: positiveInt(value.number),
    title: str(value.title),
    state: state === "open" || state === "closed" || state === "merged" ? state : null,
    isDraft: value.isDraft === true,
    headBranch: str(value.headBranch),
    note,
  };
}

function pullRequestPreview(tool: string, result: Record_): PullRequestToolPreview | null {
  const rows = Array.isArray(result.pullRequests)
    ? result.pullRequests.filter(isRecord).map((pr) => pullRequestRow(pr, null))
    : [pullRequestRow(result, pullRequestNote(tool, result))];
  const pullRequests = rows.filter((row) => row !== null);
  return pullRequests.length > 0 || Array.isArray(result.pullRequests)
    ? { kind: "pull-requests", pullRequests }
    : null;
}

function browserPage(result: Record_ | null): BrowserToolPreview["page"] {
  if (!result) return null;
  const url = str(result.url);
  if (url) return { url, title: str(result.title) };
  // Actions report only the page they ran on, for the row's site icon.
  const icon = isRecord(result.toolIcon) ? result.toolIcon : null;
  const pageUrl = str(icon?.pageUrl);
  return pageUrl ? { url: pageUrl, title: null } : null;
}

/** What a browser call acted on or changed, for tools whose input is not a locator, key or URL. */
function browserDetail(tool: string, input: Record_, result: Record_ | null): string | null {
  switch (tool) {
    case "preview_resize": {
      const viewport = isRecord(result?.viewport) ? result.viewport : null;
      const size = viewport ? `${String(viewport.width)}×${String(viewport.height)}` : null;
      return [str(input.preset) ?? str(input.mode), size].filter(Boolean).join(" · ") || null;
    }
    case "preview_set_appearance":
      return str(result?.colorScheme) ?? str(input.colorScheme);
    case "preview_select": {
      const selected = Array.isArray(result?.selected) ? result.selected : input.values;
      return Array.isArray(selected) ? `Selected ${selected.filter(isText).join(", ")}` : null;
    }
    case "preview_upload": {
      const paths = Array.isArray(input.paths) ? input.paths.filter(isText) : [];
      return paths.length === 0 ? "Cancelled the file picker" : paths.join(", ");
    }
    case "preview_drag":
      return str(input.source) && str(input.target)
        ? `${str(input.source)} → ${str(input.target)}`
        : null;
    case "preview_dialog":
      return input.accept === false ? "Dismissed the dialog" : "Accepted the dialog";
    case "preview_recording_start":
      return "Started recording";
    case "preview_recording_stop":
      return str(result?.path) ? `Saved ${str(result?.path)}` : "Stopped recording";
    case "preview_wait_for":
      return str(input.text)
        ? `Waited for “${str(input.text)}”`
        : str(input.urlIncludes)
          ? `Waited for a URL with ${str(input.urlIncludes)}`
          : null;
    case "preview_scroll":
      return typeof input.deltaY === "number"
        ? `Scrolled ${input.deltaY > 0 ? "down" : "up"} ${Math.abs(input.deltaY)}px`
        : null;
    default:
      return null;
  }
}

function browserPreview(tool: string, input: Record_, result: Record_ | null): BrowserToolPreview {
  const modifiers = Array.isArray(input.modifiers) ? input.modifiers.filter(isText) : [];
  const key = str(input.key);
  const target =
    str(input.locator) ??
    str(input.selector) ??
    (key ? [...modifiers, key].join("+") : null) ??
    str(input.url) ??
    null;
  const hasValue = result !== null && Object.hasOwn(result, "value");
  return {
    kind: "browser",
    target,
    text: tool === "preview_type" ? str(input.text) : null,
    detail: browserDetail(tool, input, result),
    expression: str(input.expression),
    value: hasValue ? (JSON.stringify(result.value, null, 2) ?? "undefined") : null,
    page: browserPage(result),
  };
}

/** Strips the `mcp__server__` prefix Claude gives deferred tools, so chips read as names. */
function shortToolName(name: string): string {
  return /^mcp__.+?__(.+)$/.exec(name)?.[1] ?? name;
}

/** Slack's `<url|label>`, `<@U123|Name>` and `<url>` markup as the text a reader sees. */
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

// Slack MCP prints threads as `=== THREAD PARENT MESSAGE ===` and `--- Reply 1 of 4 ---`
// sections, and detailed search results as `### Result 1 of 3` sections. Each opens with
// `Field: value` lines (`From:`, `Time:`, `Channel:`), then the message text.
const SLACK_THREAD_SECTION = /^(?:=== THREAD PARENT MESSAGE ===|--- Reply \d+ of \d+ ---)$/m;
const SLACK_SEARCH_SECTION = /^### Result \d+ of \d+$/m;
const SLACK_FIELD =
  /^(From|Time|Message TS|Message_ts|Channel|Participants|Reply count|Permalink|Text): ?(.*)$/;
// Concise search results: `1. #channel - Author: text 2026-10-07 15:44:14 BST`, where a DM's
// channel is `DM with Sam Rivera, Jo Patel`.
const SLACK_CONCISE_RESULT = /^\d+\. (#\S+|DM with [^\n]+?|\S+) - ([^:\n]+?): /m;

function slackSection(section: string): SlackMessagesPreview["messages"][number] | null {
  const lines = section
    .replace(/\n=== THREAD REPLIES[^\n]*===\n/, "\n")
    .trim()
    .split("\n");
  const fields = new Map<string, string>();
  let index = 0;
  for (; index < lines.length; index += 1) {
    const field = SLACK_FIELD.exec(lines[index]!);
    if (!field) break;
    fields.set(field[1]!, field[2]!.trim());
    // `Text:` opens the message itself.
    if (field[1] === "Text") {
      index += 1;
      break;
    }
  }
  const author = fields.get("From")?.replace(/ \((?:ID: )?[A-Z0-9]+\)$/, "");
  const text = slackPlainText(
    // Detailed search results end each message with a `---` rule.
    [fields.get("Text") ?? "", ...lines.slice(index)].join("\n").replace(/(?:\n|^)-{3,}\s*$/, ""),
  );
  if (!author || !text) return null;
  const permalink = /\((https?:[^)]+)\)/.exec(fields.get("Permalink") ?? "")?.[1] ?? null;
  return {
    author,
    time: fields.get("Time") ?? null,
    channel: fields.get("Channel")?.replace(/ \(ID: [A-Z0-9]+\)$/, "") ?? null,
    url: permalink,
    text,
  };
}

function slackConciseResults(text: string): SlackMessagesPreview["messages"] {
  const parts = text.split(SLACK_CONCISE_RESULT);
  const messages: Array<SlackMessagesPreview["messages"][number]> = [];
  // split with two capture groups yields [before, channel, author, body, channel, ...].
  for (let index = 1; index + 2 < parts.length; index += 3) {
    const body = slackPlainText(parts[index + 2]!.replace(/\n\d+\. [\s\S]*$/, ""));
    const time = /\s(\d{4}-\d\d-\d\d \d\d:\d\d(?::\d\d)? [A-Z]{2,5})$/.exec(body);
    const text = time ? body.slice(0, time.index).trimEnd() : body;
    if (text) {
      messages.push({
        author: parts[index + 1]!.trim(),
        time: time?.[1] ?? null,
        channel: parts[index]!,
        url: null,
        text,
      });
    }
  }
  return messages;
}

/** Concise thread reads: `THREAD: <parent>` then one `> Author: reply` line per reply. */
function slackConciseThread(text: string): SlackMessagesPreview["messages"] {
  const [parent = "", ...rest] = text.slice("THREAD: ".length).split(/\n(?=> )/);
  const replies = rest.flatMap((block) => {
    const reply = /^> ([^:\n]+): ([\s\S]*)$/.exec(block.trim());
    if (!reply) return [];
    const body = slackPlainText(reply[2]!.replace(/^> ?/gm, ""));
    return body
      ? [{ author: reply[1]!.trim(), time: null, channel: null, url: null, text: body }]
      : [];
  });
  const parentText = slackPlainText(parent);
  return [
    ...(parentText
      ? [{ author: "Thread", time: null, channel: null, url: null, text: parentText }]
      : []),
    ...replies,
  ];
}

function slackPreview(text: string | null): SlackMessagesPreview | null {
  if (!text) return null;
  if (text.startsWith("THREAD: ")) {
    const messages = slackConciseThread(text);
    return messages.length > 0 ? { kind: "slack-messages", messages } : null;
  }
  const separator = SLACK_THREAD_SECTION.test(text)
    ? SLACK_THREAD_SECTION
    : SLACK_SEARCH_SECTION.test(text)
      ? SLACK_SEARCH_SECTION
      : null;
  const messages =
    separator === null
      ? slackConciseResults(text)
      : text
          .split(separator)
          .slice(1)
          .flatMap((section) => {
            const message = slackSection(section);
            return message ? [message] : [];
          });
  // A search that found nothing still reads as a Slack search, not as its raw fields.
  const emptySearch =
    /^## Messages \(0 results\)$/m.test(text) || /^# Search Results for:[^\n]*\s*$/.test(text);
  return messages.length > 0 || emptySearch ? { kind: "slack-messages", messages } : null;
}

function questionsPreview(input: Record_, result: Record_ | null): QuestionsToolPreview | null {
  const questions = (Array.isArray(input.questions) ? input.questions : []).filter(isRecord);
  const answers = isRecord(result?.answers) ? result.answers : {};
  const shown = questions.flatMap((entry) => {
    const question = str(entry.question);
    if (!question) return [];
    const answer = str(answers[question]);
    // Multi-select answers arrive comma-joined.
    const chosen = new Set(answer?.split(", ") ?? []);
    const options = (Array.isArray(entry.options) ? entry.options : []).flatMap((option) => {
      const label = isRecord(option) ? str(option.label) : null;
      return label ? [{ label, selected: chosen.has(label) || answer === label }] : [];
    });
    const matched = options.some((option) => option.selected);
    return [{ question, options, otherAnswer: answer && !matched ? answer : null }];
  });
  return shown.length > 0 ? { kind: "questions", questions: shown } : null;
}

function htmlPagePreview(input: Record_, result: Record_ | null): HtmlPageToolPreview {
  const width = positiveInt(result?.width) ?? positiveInt(input.width);
  const height = positiveInt(result?.contentHeight) ?? positiveInt(input.height);
  const appearance = str(input.appearance);
  const consoleMessages = Array.isArray(result?.consoleMessages) ? result.consoleMessages : [];
  const title = /<title>([^<]*)<\/title>/i.exec(str(input.html) ?? "")?.[1]?.trim();
  return {
    kind: "html-page",
    title: str(input.title) ?? (title || null),
    details: [
      width && height ? `${width}×${height}` : height ? `${height}px tall` : null,
      appearance,
      consoleMessages.length > 0
        ? `${consoleMessages.length} console message${consoleMessages.length === 1 ? "" : "s"}`
        : null,
    ].filter((detail) => detail !== null),
  };
}

function launchedThreadPreview(input: Record_, result: Record_): ThreadToolPreview | null {
  const threadId = str(result.threadId);
  if (!threadId) return null;
  const selection = isRecord(result.modelSelection) ? result.modelSelection : null;
  const workspace = isRecord(input.workspaceStrategy) ? input.workspaceStrategy : null;
  const message = str(input.message);
  return {
    kind: "thread",
    threadId,
    title: str(input.title) ?? "New thread",
    status: str(result.status),
    model: str(selection?.model),
    branch: str(workspace?.branch),
    items: message ? [{ key: "message", label: "Message", text: message.trim() }] : [],
    moreItems: 0,
  };
}

function threadListPreview(result: Record_): ThreadListToolPreview | null {
  if (!Array.isArray(result.threads)) return null;
  return {
    kind: "threads",
    threads: result.threads.filter(isRecord).flatMap((thread) => {
      const threadId = str(thread.threadId);
      return threadId
        ? [
            {
              threadId,
              title: str(thread.title) ?? "Untitled thread",
              status: str(thread.status),
              model: str(thread.model),
            },
          ]
        : [];
    }),
  };
}

const decodeSchedule = Schema.decodeUnknownOption(ScheduledTaskSchedule);

function scheduledTasksPreview(result: Record_): ScheduledTasksToolPreview | null {
  const tasks = Array.isArray(result.tasks) ? result.tasks.filter(isRecord) : [result];
  const shown = tasks.flatMap((task) => {
    const id = str(task.scheduledTaskId);
    return id
      ? [
          {
            id,
            title: str(task.title) ?? "Scheduled task",
            enabled: task.enabled !== false,
            schedule: Option.getOrNull(decodeSchedule(task.schedule)),
          },
        ]
      : [];
  });
  return shown.length > 0 || Array.isArray(result.tasks)
    ? { kind: "scheduled-tasks", tasks: shown }
    : null;
}

function threadAction(
  headline: string,
  fields: Partial<Omit<ThreadActionToolPreview, "kind" | "headline">> = {},
): ThreadActionToolPreview {
  return {
    kind: "thread-action",
    headline,
    status: fields.status ?? null,
    details: fields.details ?? [],
    threadId: fields.threadId ?? null,
  };
}

function modelSelectionDetails(value: unknown): { model: string | null; details: string[] } {
  const selection = isRecord(value) ? value : null;
  const options = Array.isArray(selection?.options)
    ? selection.options.filter(isRecord).flatMap((option) => {
        const id = str(option.id);
        return id && option.value !== undefined ? [`${id} ${String(option.value)}`] : [];
      })
    : [];
  const instance = str(selection?.instanceId);
  return {
    model: str(selection?.model),
    details: [instance, ...options].filter((detail) => detail !== null),
  };
}

/** The tab titles of a chat-tab group result. */
function tabTitles(result: Record_ | null): string[] {
  return Array.isArray(result?.tabs)
    ? result.tabs.filter(isRecord).flatMap((tab) => {
        const title = str(tab.title);
        return title ? [title] : [];
      })
    : [];
}

function sourcePointLabel(value: unknown): string | null {
  const point = isRecord(value) ? value : null;
  switch (point?.type) {
    case "latest_stable":
      return "From the latest stable point";
    case "run":
      return "From a run";
    case "checkpoint":
      return "From a checkpoint";
    default:
      return null;
  }
}

const ORGANIZE_LABELS: Readonly<Record<string, string>> = {
  pin: "Pinned",
  unpin: "Unpinned",
  snooze: "Snoozed",
  unsnooze: "Unsnoozed",
  settle: "Settled",
  unsettle: "Unsettled",
  archive: "Archived",
  unarchive: "Unarchived",
  mark_unread: "Marked unread",
  hide: "Hidden from the sidebar",
  unhide: "Shown in the sidebar",
  move_to_group: "Moved to a group",
  remove_from_group: "Removed from its group",
};

function organizePreview(input: Record_, result: Record_ | null): ThreadActionToolPreview | null {
  const action = str(input.action);
  if (!action) return null;
  const group = str(input.groupName);
  const until = str(input.snoozedUntil);
  const headline =
    action === "move_to_group" && group
      ? `Moved to “${group}”`
      : (ORGANIZE_LABELS[action] ?? action.replaceAll("_", " "));
  return threadAction(headline, {
    threadId: str(input.threadId),
    details: [
      action === "snooze" && until ? `Until ${until}` : null,
      result?.settlesWhenTurnEnds === true ? "Takes effect when this turn ends" : null,
    ].filter((detail) => detail !== null),
  });
}

function metadataUpdatePreview(
  input: Record_,
  result: Record_ | null,
): ThreadActionToolPreview | null {
  const action = str(input.action);
  const title = str(result?.title) ?? str(input.title);
  const threadId = str(result?.threadId) ?? str(input.threadId);
  const pr = isRecord(input.pullRequest) ? input.pullRequest : null;
  switch (action) {
    case "rename":
      return threadAction(title ? `Renamed to “${title}”` : "Renamed the thread", { threadId });
    case "regenerate_title":
      return threadAction("Regenerated the title", {
        threadId,
        details: title ? [title] : [],
      });
    case "link_pull_request": {
      const label =
        str(pr?.repository) && positiveInt(pr?.number)
          ? `${str(pr?.repository)}#${positiveInt(pr?.number)}`
          : "a pull request";
      return threadAction(`Linked ${label}`, { threadId });
    }
    case "unlink_pull_request":
      return threadAction("Unlinked the pull request", { threadId });
    default:
      return null;
  }
}

function threadSearchPreview(input: Record_, result: Record_): ThreadSearchToolPreview | null {
  if (!Array.isArray(result.matches)) return null;
  return {
    kind: "thread-search",
    query: str(input.query),
    matches: result.matches.filter(isRecord).flatMap((match) => {
      const threadId = str(match.threadId);
      return threadId
        ? [{ threadId, source: str(match.source), snippet: str(match.snippet) ?? "" }]
        : [];
    }),
  };
}

function contextTransfersPreview(result: Record_): ContextTransfersToolPreview | null {
  if (!Array.isArray(result.transfers)) return null;
  return {
    kind: "context-transfers",
    transfers: result.transfers.filter(isRecord).flatMap((transfer) => {
      const id = str(transfer.id);
      const sourceThreadId = str(transfer.sourceThreadId);
      const targetThreadId = str(transfer.targetThreadId);
      return id && sourceThreadId && targetThreadId
        ? [{ id, sourceThreadId, targetThreadId, status: str(transfer.status) }]
        : [];
    }),
  };
}

const DELIVERY_LABELS: Readonly<Record<string, string>> = {
  started: "Started a run",
  queued: "Queued",
  steered: "Steered the running turn",
  restarted: "Restarted the run",
};

function t3ToolPreview(tool: string, input: Record_, result: Record_ | null): ToolPreview | null {
  switch (tool) {
    case "t3_thread_read":
      return result ? threadPreview(result) : null;
    case "task_status":
    case "delegate_task":
    case "task_cancel":
      return result ? taskPreview(result, input) : null;
    case "t3_thread_launch":
      return result ? launchedThreadPreview(input, result) : null;
    case "t3_thread_list":
    case "create_threads":
      return result ? threadListPreview(result) : null;
    case "t3_thread_start":
      return result ? (threadListPreview(result) ?? launchedThreadPreview(input, result)) : null;
    case "t3_thread_wait":
      return result
        ? threadAction(result.timedOut === true ? "Stopped waiting" : "Waited for the run", {
            threadId: str(result.threadId) ?? str(input.threadId),
            status: str(result.status),
            details: result.timedOut === true ? ["The wait timed out"] : [],
          })
        : null;
    case "t3_thread_interrupt":
      return threadAction("Interrupted the run", {
        threadId: str(result?.threadId) ?? str(input.threadId),
        status: str(result?.status),
        details: [str(input.reason)].filter((detail) => detail !== null),
      });
    case "t3_thread_configuration": {
      if (!result) return null;
      const { model, details } = modelSelectionDetails(result.modelSelection);
      return threadAction(model ?? "Thread configuration", {
        threadId: str(input.threadId),
        details: [
          ...details,
          [str(result.runtimeMode), str(result.interactionMode)]
            .filter((mode) => mode !== null)
            .join(" · "),
        ].filter((detail) => detail.length > 0),
      });
    }
    case "t3_thread_configure": {
      const { model, details } = modelSelectionDetails(input.modelSelection);
      return model
        ? threadAction(`Switched to ${model}`, { threadId: str(input.threadId), details })
        : null;
    }
    case "t3_thread_fork": {
      const title = str(input.title);
      return threadAction(title ? `Forked as “${title}”` : "Forked the thread", {
        threadId: str(result?.targetThreadId),
        details: [sourcePointLabel(input.sourcePoint)].filter((detail) => detail !== null),
      });
    }
    case "t3_thread_merge_back":
      return threadAction("Merged context back", {
        threadId: str(result?.targetThreadId) ?? str(input.targetThreadId),
        details: [sourcePointLabel(input.sourcePoint)].filter((detail) => detail !== null),
      });
    case "t3_thread_search":
      return result ? threadSearchPreview(input, result) : null;
    case "t3_thread_transfers":
      return result ? contextTransfersPreview(result) : null;
    case "t3_thread_group_name": {
      const name = str(result?.name) ?? str(input.name);
      const tabs = tabTitles(result);
      return threadAction(name ? `Named the group “${name}”` : "Cleared the group name", {
        threadId: str(input.threadId),
        details: tabs.length > 0 ? [tabs.join(", ")] : [],
      });
    }
    case "t3_thread_tabs": {
      const tabs = tabTitles(result);
      return result
        ? threadAction(`${tabs.length} tab${tabs.length === 1 ? "" : "s"}`, {
            threadId: str(input.threadId),
            details: tabs.length > 0 ? [tabs.join(", ")] : [],
          })
        : null;
    }
    case "t3_thread_tab_open": {
      const title = str(input.title);
      const { model } = modelSelectionDetails(input.modelSelection);
      const verb = isRecord(input.fork) ? "Forked into a tab" : "Opened a tab";
      return threadAction(title ? `${verb} “${title}”` : verb, {
        threadId: str(result?.threadId),
        details: [model].filter((detail) => detail !== null),
      });
    }
    case "t3_thread_organize":
      return organizePreview(input, result);
    case "t3_thread_update":
      return metadataUpdatePreview(input, result);
    case "t3_thread_send_attachments": {
      const count = Array.isArray(input.attachments) ? input.attachments.length : 0;
      const label = `Sent ${count} attachment${count === 1 ? "" : "s"}`;
      return {
        kind: "agent-message",
        recipient: null,
        threadId: str(result?.threadId) ?? str(input.threadId),
        summary: label,
        message: str(input.message) ?? "",
      };
    }
    case "t3_thread_send": {
      const message = str(input.message);
      if (!message) return null;
      const delivery = str(result?.delivery);
      return {
        kind: "agent-message",
        recipient: null,
        threadId: str(input.threadId),
        summary: delivery ? (DELIVERY_LABELS[delivery] ?? delivery) : null,
        message,
      };
    }
    case "schedule_task":
    case "update_scheduled_task":
    case "list_scheduled_tasks":
      return result ? scheduledTasksPreview(result) : null;
    case "link_pull_request":
    case "unlink_pull_request":
    case "watch_pull_request":
    case "unwatch_pull_request":
    case "list_thread_pull_requests":
      return result ? pullRequestPreview(tool, result) : null;
    case "html_preview":
    case "html_render":
      return htmlPagePreview(input, result);
    default:
      return tool.startsWith("preview_") ? browserPreview(tool, input, result) : null;
  }
}

/** A dynamic tool call's preview, or null when the generic body says it best. */
export function resolveToolPreview(item: OrchestrationV2TurnItem): ToolPreview | null {
  if (item.type !== "dynamic_tool" || item.status === "failed") return null;
  const input = toolCallArgs(item.input);
  if (!isRecord(input)) return null;
  const result = item.outputOmitted === true ? null : toolResultData(item.output);
  const resultRecord = isRecord(result) ? result : null;
  const text = item.outputOmitted === true ? null : toolResultText(item.output);
  const t3Tool = resolveT3McpToolId(item.toolName);
  // T3 tools without their own card still show their result as one.
  if (t3Tool) {
    return (
      t3ToolPreview(t3Tool, input, resultRecord) ??
      t3UtilityToolPreview(t3Tool, input, result) ??
      genericToolPreview(result, text)
    );
  }
  const toolName = item.toolName ?? "";
  return (
    claudeToolPreview(item, input, resultRecord) ??
    claudeUtilityToolPreview(toolName, input, result, text) ??
    integrationToolPreview(toolName, input, result, text)
  );
}

function claudeToolPreview(
  item: DynamicToolItem,
  input: Record_,
  result: Record_ | null,
): ToolPreview | null {
  const tool = item.toolName ?? "";
  if (tool.endsWith("slack_read_thread")) return slackPreview(str(result?.messages));
  if (/slack_search_public(?:_and_private)?$/.test(tool)) return slackPreview(str(result?.results));
  switch (tool) {
    case "ToolSearch": {
      const matches = Array.isArray(result?.matches) ? result.matches.filter(isText) : [];
      return matches.length > 0
        ? { kind: "loaded-tools", names: matches.map(shortToolName) }
        : null;
    }
    case "AskUserQuestion":
      return questionsPreview(input, result);
    case "SendMessage": {
      const recipient = str(input.to) ?? str(input.recipient);
      const message = str(input.message);
      return recipient && message
        ? { kind: "agent-message", recipient, threadId: null, summary: str(input.summary), message }
        : null;
    }
    case "Skill": {
      const skill = str(input.skill);
      return skill ? { kind: "skill", skill, args: str(input.args) } : null;
    }
    case "Monitor": {
      const command = str(input.command);
      return command ? { kind: "monitor", description: str(input.description), command } : null;
    }
    case "ScheduleWakeup": {
      const scheduledFor = typeof result?.scheduledFor === "number" ? result.scheduledFor : null;
      return {
        kind: "wakeup",
        at: scheduledFor === null ? null : DateTime.formatIso(DateTime.makeUnsafe(scheduledFor)),
        reason: str(input.reason),
        prompt: str(input.prompt),
      };
    }
    default:
      return null;
  }
}
