import type { AssetResource, OrchestrationV2TurnItem } from "@t3tools/contracts";
import {
  classifyToolActivity,
  collectToolFilePaths,
  summarizeToolActivityInput,
} from "@t3tools/shared/toolActivity";
import { readToolOutputImage, toolOutputImages } from "@t3tools/shared/toolOutput";
import * as DateTime from "effect/DateTime";

const MAX_TEXT_BLOCK_DEPTH = 4;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Wire projection replaces a large dynamic input with `{ summary, truncated: true }`. */
function isSummarizedValue(value: unknown): boolean {
  return isRecord(value) && value.truncated === true && typeof value.summary === "string";
}

function textFromBlocks(value: unknown, depth: number): string | null {
  if (depth > MAX_TEXT_BLOCK_DEPTH) return null;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const parts = value.map((block) => textFromBlocks(block, depth + 1));
    return parts.every((part) => part !== null)
      ? parts.filter((part) => part !== "").join("\n")
      : null;
  }
  if (!isRecord(value)) return null;
  if (value.type === "text" && typeof value.text === "string") return value.text;
  // Images clients can show render on their own (see turnItemOutputImages).
  if (value.type === "image") return readToolOutputImage(value) ? "" : "[image]";
  if (value.type === "resource_link" && typeof value.uri === "string") return value.uri;
  if (value.type === "resource" && isRecord(value.resource)) {
    const resource = value.resource;
    if (typeof resource.text === "string") return resource.text;
    if (typeof resource.uri === "string") return resource.uri;
  }
  const keys = Object.keys(value).filter((key) => key !== "isError" && key !== "is_error");
  // MCP results and provider tool results wrap their text in `content`.
  // `structuredContent` usually repeats it as data, so it only shows when the
  // text is empty.
  if (keys.length === 1 && keys[0] === "content") return textFromBlocks(value.content, depth + 1);
  if (keys.length === 2 && keys.includes("content") && keys.includes("structuredContent")) {
    const text = textFromBlocks(value.content, depth + 1);
    return text?.trim() ? text : null;
  }
  return null;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** MCP tools often return JSON as minified text, one document per line. Indent each. */
function prettyJsonText(text: string): string {
  const trimmed = text.trim();
  if (!/^[[{]/.test(trimmed)) return text;
  const whole = parseJson(trimmed);
  if (whole !== undefined) return JSON.stringify(whole, null, 2);
  const lines = trimmed.split("\n").filter((line) => line.trim());
  const documents = lines.map((line) => parseJson(line.trim()));
  if (documents.some((document) => document === undefined)) return text;
  return documents.map((document) => JSON.stringify(document, null, 2)).join("\n\n");
}

/** Formats a tool input or output for display: text blocks as text, the rest as JSON. */
function formatToolValue(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = textFromBlocks(value, 0);
  if (text !== null) return text.trim() ? prettyJsonText(text) : null;
  let json: string | undefined;
  try {
    json = JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
  if (json === undefined || json === "{}" || json === "[]") return null;
  return json;
}

/**
 * The call a tool row's body shows above its result: the full command, the
 * arguments as `key value` pairs, or formatted text when they are not flat.
 */
export function toolCallLines(input: {
  readonly command?: string | undefined;
  readonly args?: unknown;
}): {
  readonly command: string | null;
  readonly args: ReadonlyArray<readonly [string, string]> | null;
  readonly argsText: string | null;
} {
  if (input.command !== undefined) {
    // The row title truncates to its width, so the body always has the full command.
    const command = input.command.trim();
    return { command: command || null, args: null, argsText: null };
  }
  const args = input.args;
  if (isRecord(args) && !isSummarizedValue(args)) {
    const entries = Object.entries(args).flatMap(
      ([key, value]): Array<readonly [string, string]> => {
        if (value === undefined) return [];
        // An empty string or null can be the point of a call (a clear or reset), so show it.
        return [
          [
            key,
            typeof value === "string" && value !== ""
              ? value
              : (JSON.stringify(value) ?? String(value)),
          ],
        ];
      },
    );
    return { command: null, args: entries.length > 0 ? entries : null, argsText: null };
  }
  return { command: null, args: null, argsText: formatToolValue(args) };
}

function toolCallHasLines(lines: ReturnType<typeof toolCallLines>): boolean {
  return lines.command !== null || lines.args !== null || lines.argsText !== null;
}

const LIVE_TURN_ITEM_STATUSES: ReadonlySet<OrchestrationV2TurnItem["status"]> = new Set([
  "idle",
  "pending",
  "running",
  "waiting",
]);

/**
 * Cache key for a fetched item. A running item keeps one key, so an open row
 * fetches once while it streams and again when it finishes, not on every update.
 */
export function turnItemDetailRevision(item: OrchestrationV2TurnItem): string {
  return LIVE_TURN_ITEM_STATUSES.has(item.status) ? "live" : DateTime.formatIso(item.updatedAt);
}

/** True when the timeline item withholds content that `getTurnItem` returns. */
export function turnItemNeedsDetailFetch(item: OrchestrationV2TurnItem): boolean {
  switch (item.type) {
    case "command_execution":
      return item.outputOmitted === true;
    case "dynamic_tool":
      return item.outputOmitted === true || isSummarizedValue(item.input);
    default:
      return false;
  }
}

type FileChangeItem = Extract<OrchestrationV2TurnItem, { readonly type: "file_change" }>;

/**
 * Fork: true when a successful edit's diff was left off the wire. Timelines carry an edit's
 * identity and line counts only; `getTurnItem` returns the stored diff for its preview.
 */
export function fileChangeDiffWithheld(item: OrchestrationV2TurnItem): item is FileChangeItem {
  return (
    item.type === "file_change" &&
    item.status !== "failed" &&
    item.diffStr === undefined &&
    item.oldStr === undefined &&
    item.newStr === undefined
  );
}

/**
 * Fork: an edit's bounded preview, a unified diff block (`Diff\n<patch>`, or a note when it is
 * too large) after its line counts. Null when the item carries no diff, or for a failed edit,
 * whose `diffStr` holds the provider's error.
 */
export function fileChangePreviewText(item: OrchestrationV2TurnItem): string | null {
  if (item.type !== "file_change" || item.status === "failed") return null;
  if (item.diffStr === undefined && item.oldStr === undefined && item.newStr === undefined) {
    return null;
  }
  return (
    summarizeToolActivityInput({
      file_path: item.fileName,
      ...(item.diffStr !== undefined ? { diff: item.diffStr } : {}),
      ...(item.oldStr !== undefined ? { old_string: item.oldStr } : {}),
      ...(item.newStr !== undefined ? { new_string: item.newStr } : {}),
      ...(item.additions !== undefined && item.deletions !== undefined
        ? { linesAdded: item.additions, linesRemoved: item.deletions }
        : {}),
    }) ?? null
  );
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** Fork: the first line a read asked for, from its tool input. */
function readStartLine(input: Record<string, unknown>): number | null {
  return positiveInteger(input.offset ?? input.start_line ?? input.startLine);
}

/** Fork: a file read's line range from its tool input: `Lines 10–49`, `From line 10`, `First 40 lines`. */
export function toolReadRangeLabel(input: unknown): string | null {
  if (!isRecord(input)) return null;
  const start = readStartLine(input);
  const end = positiveInteger(input.end_line ?? input.endLine);
  const limit = positiveInteger(input.limit);
  if (start !== null && end !== null) return `Lines ${start}–${end}`;
  if (start !== null && limit !== null) return `Lines ${start}–${start + limit - 1}`;
  if (start !== null) return `From line ${start}`;
  if (limit !== null) return `First ${limit} lines`;
  return null;
}

/** Fork: a file read's contents, as one file whose first line is `startLine`. */
export interface ReadFileOutput {
  /** The file read, for syntax highlighting; null when the call names none. */
  readonly path: string | null;
  readonly text: string;
  readonly startLine: number;
}

// `cat -n` (Claude: `     1\t`, `1→`) and OpenCode (`1: `, `00001| `) line prefixes.
const READ_LINE_NUMBER = /^ *(\d+)(?:\t|→|: ?|\| ?)/;
// Lines providers put around numbered contents: `<path>…</path>`, `<content>`, `(End of file…)`.
const READ_WRAPPER_LINE = /^(?:<\/?[a-z-]+>.*|\(.*\)|\[.*\])?$/;

/**
 * Text with consecutive line numbers on every line. Only wrapper lines, such as a provider's
 * end-of-file note, may come before or after them; they are dropped.
 */
function stripReadLineNumbers(text: string): { text: string; startLine: number } | null {
  const lines = text.split("\n");
  const isWrapper = (line: string) => READ_WRAPPER_LINE.test(line.trim());
  const first = lines.findIndex((line) => READ_LINE_NUMBER.test(line));
  if (first < 0 || !lines.slice(0, first).every(isWrapper)) return null;
  const startLine = Number(READ_LINE_NUMBER.exec(lines[first]!)![1]);
  const contents: string[] = [];
  for (const line of lines.slice(first)) {
    const match = READ_LINE_NUMBER.exec(line);
    if (!match || Number(match[1]) !== startLine + contents.length) break;
    contents.push(line.slice(match[0].length));
  }
  if (!lines.slice(first + contents.length).every(isWrapper)) return null;
  return { text: contents.join("\n"), startLine };
}

/**
 * Fork: a completed file read's contents without the JSON, wrappers and line numbers each
 * provider reports them in. Null for other tools, image reads and withheld output.
 */
export function turnItemReadFile(item: OrchestrationV2TurnItem): ReadFileOutput | null {
  if (item.type !== "dynamic_tool" || item.outputOmitted === true) return null;
  const read = classifyToolActivity({
    itemType: "dynamic_tool_call",
    data: { toolName: item.toolName, input: item.input },
  });
  if (read !== "read") return null;
  const output = item.output;
  if (isRecord(output) && output.type === "image") return null;
  const input = isRecord(item.input) ? item.input : {};
  let path = collectToolFilePaths({ input: item.input })[0] ?? null;
  let file: { text: string; startLine: number | null } | null = null;
  // Claude nests the file under `file`; Cursor reports `{ content, totalLines }`.
  const record = isRecord(output) ? (isRecord(output.file) ? output.file : output) : null;
  if (typeof record?.content === "string") {
    file = { text: record.content, startLine: positiveInteger(record.startLine) };
    if (typeof record.filePath === "string") path = record.filePath;
  } else {
    // Claude's older text results, OpenCode and Pi report text, numbered or not.
    const text = textFromBlocks(output, 0);
    if (text?.trim()) file = stripReadLineNumbers(text) ?? { text, startLine: null };
  }
  if (file === null || !file.text.trim()) return null;
  return {
    path,
    text: file.text.replace(/\n+$/, ""),
    startLine: file.startLine ?? readStartLine(input) ?? 1,
  };
}

/** Older Claude bash rows stored the raw `{ stdout, stderr, interrupted, ... }` result. */
function commandOutputText(output: string): string {
  if (!output.trimStart().startsWith('{"stdout"')) return output;
  const parsed = parseJson(output.trim());
  if (
    !isRecord(parsed) ||
    typeof parsed.stdout !== "string" ||
    typeof parsed.stderr !== "string" ||
    typeof parsed.interrupted !== "boolean"
  ) {
    return output;
  }
  return [parsed.stdout, parsed.stderr]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join("\n");
}

/** The tool output carried by a fetched item, formatted for display. */
export function turnItemOutputText(item: OrchestrationV2TurnItem): string | null {
  switch (item.type) {
    case "command_execution":
      return item.output?.trim() ? commandOutputText(item.output) || null : null;
    case "dynamic_tool":
      return item.outputOmitted === true
        ? null
        : (turnItemReadFile(item)?.text ?? formatToolValue(item.output));
    case "file_search":
      return item.results?.length
        ? item.results
            .map((result) =>
              [
                `${result.fileName}${result.line === undefined ? "" : `:${result.line}`}`,
                result.preview?.trim(),
              ]
                .filter(Boolean)
                .join("\n"),
            )
            .join("\n")
        : null;
    case "web_search":
      return item.results?.length
        ? item.results
            .map((result) =>
              [
                result.title?.trim() || result.url,
                result.title ? result.url : undefined,
                result.snippet?.trim(),
              ]
                .filter(Boolean)
                .join("\n"),
            )
            .join("\n\n")
        : null;
    default:
      return null;
  }
}

/**
 * Images in a fetched item's tool output, as assets. The detail read leaves
 * the bytes out, so each loads over HTTP by its index.
 */
export function turnItemOutputImages(
  item: OrchestrationV2TurnItem,
): ReadonlyArray<Extract<AssetResource, { readonly _tag: "tool-output-image" }>> {
  if (item.type !== "dynamic_tool" || item.outputOmitted === true) return [];
  return toolOutputImages(item.output).map((_, index) => ({
    _tag: "tool-output-image",
    threadId: item.threadId,
    itemId: item.id,
    index,
  }));
}

/**
 * Whether expanding the item shows anything. Rows without content must not
 * offer a disclosure, otherwise they open to an empty panel.
 */
export function turnItemHasDetail(item: OrchestrationV2TurnItem): boolean {
  switch (item.type) {
    case "reasoning":
      return item.text.trim().length > 0;
    case "command_execution":
      return (
        toolCallLines({ command: item.input }).command !== null ||
        item.outputOmitted === true ||
        Boolean(item.output?.trim()) ||
        (item.exitCode !== undefined && item.exitCode !== 0)
      );
    case "file_change":
    case "checkpoint":
    case "fork":
    case "handoff":
      return true;
    case "file_search":
      return (item.results?.length ?? 0) > 0 || Boolean(item.pattern?.trim());
    case "web_search":
      return (item.results?.length ?? 0) > 0 || (item.patterns?.length ?? 0) > 0;
    case "dynamic_tool":
      return item.outputOmitted === true || toolCallHasLines(toolCallLines({ args: item.input }));
    case "approval_request":
      return Boolean(item.prompt?.trim());
    case "user_input_request":
      return item.questions.length > 0;
    case "notification":
      return Boolean(item.detail?.trim());
    case "system_notice":
      return item.message.trim().length > 0;
    case "error":
      return item.failure.message.trim().length > 0;
    case "proposed_plan":
      return item.markdown.trim().length > 0;
    case "todo_list":
      return item.steps.length > 0;
    case "subagent":
      return item.childThreadId !== null;
    default:
      return false;
  }
}
