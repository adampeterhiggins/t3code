import type { OrchestrationV2TurnItem } from "@t3tools/contracts";
import { resolveT3McpToolId } from "@t3tools/shared/t3McpToolPresentation";
import * as DateTime from "effect/DateTime";

import { toolCallArgs, toolResultData } from "./itemDetail.ts";

/**
 * A tool call's preview as data, for tools whose arguments and result read better
 * as a card than as `key value` lines and JSON. Clients render each kind; a tool
 * without one keeps the generic body.
 */
export type ToolPreview =
  | ThreadToolPreview
  | TaskToolPreview
  | PullRequestToolPreview
  | BrowserToolPreview
  | LoadedToolsPreview
  | SlackThreadPreview
  | QuestionsToolPreview
  | AgentMessageToolPreview
  | SkillToolPreview
  | MonitorToolPreview
  | WakeupToolPreview
  | HtmlPageToolPreview;

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
    /** What the call did to it: `Already linked`, `Watching`, and so on. */
    readonly note: string | null;
  }>;
}

export interface BrowserToolPreview {
  readonly kind: "browser";
  /** What was acted on: a locator, key, URL, or typed text. */
  readonly target: string | null;
  readonly text: string | null;
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

export interface SlackThreadPreview {
  readonly kind: "slack-thread";
  readonly messages: ReadonlyArray<{
    readonly author: string;
    readonly time: string | null;
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
  readonly recipient: string;
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
    summary: str(result.summary) ?? str(result.latestTerminalSummary),
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

function browserPreview(input: Record_, result: Record_ | null): BrowserToolPreview {
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
    text: str(input.text),
    expression: str(input.expression),
    value: hasValue ? (JSON.stringify(result.value, null, 2) ?? "undefined") : null,
    page: browserPage(result),
  };
}

/** Strips the `mcp__server__` prefix Claude gives deferred tools, so chips read as names. */
function shortToolName(name: string): string {
  return /^mcp__.+?__(.+)$/.exec(name)?.[1] ?? name;
}

// Slack MCP prints threads as `=== THREAD PARENT MESSAGE ===` and `--- Reply 1 of 4 ---`
// sections, each opening with `From:`, `Time:` and `Message TS:` lines.
const SLACK_SECTION = /^(?:=== THREAD PARENT MESSAGE ===|--- Reply \d+ of \d+ ---)$/m;

function slackThreadPreview(result: Record_): SlackThreadPreview | null {
  const text = str(result.messages);
  if (!text || !SLACK_SECTION.test(text)) return null;
  const messages = text
    .split(SLACK_SECTION)
    .slice(1)
    .flatMap((section) => {
      const lines = section.replace(/\n=== THREAD REPLIES[^\n]*===\n/, "\n").split("\n");
      let author: string | null = null;
      let time: string | null = null;
      const body: string[] = [];
      for (const line of lines) {
        const from = /^From: (.+?)(?: \([A-Z0-9]+\))?$/.exec(line);
        if (from && author === null) author = from[1]!;
        else if (line.startsWith("Time: ") && time === null) time = line.slice(6).trim();
        else if (!line.startsWith("Message TS: ")) body.push(line);
      }
      const message = body.join("\n").trim();
      return author && message ? [{ author, time, text: message }] : [];
    });
  return messages.length > 0 ? { kind: "slack-thread", messages } : null;
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

function t3ToolPreview(tool: string, input: Record_, result: Record_ | null): ToolPreview | null {
  switch (tool) {
    case "t3_thread_read":
      return result ? threadPreview(result) : null;
    case "task_status":
    case "delegate_task":
      return result ? taskPreview(result, input) : null;
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
      return tool.startsWith("preview_") && tool !== "preview_snapshot"
        ? browserPreview(input, result)
        : null;
  }
}

/** A dynamic tool call's preview, or null when the generic body says it best. */
export function resolveToolPreview(item: OrchestrationV2TurnItem): ToolPreview | null {
  if (item.type !== "dynamic_tool" || item.status === "failed") return null;
  const input = toolCallArgs(item.input);
  if (!isRecord(input)) return null;
  const result = item.outputOmitted === true ? null : toolResultData(item.output);
  const resultRecord = isRecord(result) ? result : null;
  const t3Tool = resolveT3McpToolId(item.toolName);
  if (t3Tool) return t3ToolPreview(t3Tool, input, resultRecord);
  return claudeToolPreview(item, input, resultRecord);
}

function claudeToolPreview(
  item: DynamicToolItem,
  input: Record_,
  result: Record_ | null,
): ToolPreview | null {
  const tool = item.toolName ?? "";
  if (tool.endsWith("slack_read_thread")) return result ? slackThreadPreview(result) : null;
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
        ? { kind: "agent-message", recipient, summary: str(input.summary), message }
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
