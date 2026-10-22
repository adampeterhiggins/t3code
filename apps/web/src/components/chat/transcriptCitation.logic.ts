import {
  ASSISTANT_CITATION_MAX_MARKDOWN_LENGTH,
  ASSISTANT_CITATION_MAX_SEGMENTS,
  MessageId,
  type AssistantCitation,
  type AssistantCitationSegment,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import {
  assistantCitationsToPlainText,
  renderAssistantCitationsAsText,
} from "@t3tools/shared/assistantCitations";
import { workLogEntryIsToolLike, type TimelineEntry, type WorkLogEntry } from "../../session-logic";
import { workEntryDisplayLabel, type MessagesTimelineRow } from "./MessagesTimeline.logic";

const TOOL_DETAIL_MAX_LENGTH = 400;

/** Where an excerpt starts or ends. A quote keeps only the selected part of a message. */
export interface TranscriptEndpoint {
  readonly itemId: string;
  readonly quote?: { readonly text: string; readonly markdown?: string };
}

/** The id a citation segment uses: the message id, or the tool call's turn item id. */
export function transcriptItemId(entry: TimelineEntry): string {
  if (entry.kind === "message") return entry.message.id;
  if (entry.kind === "work") return entry.entry.id;
  return entry.id;
}

function isCitableTool(entry: WorkLogEntry): boolean {
  return workLogEntryIsToolLike(entry) && entry.tone !== "thinking";
}

function fence(text: string): string {
  const longestRun = Math.max(0, ...Array.from(text.matchAll(/`+/g), (match) => match[0].length));
  const marker = "`".repeat(Math.max(3, longestRun + 1));
  return `${marker}text\n${text}\n${marker}`;
}

/** One-line labels read inline, as the tool row shows them; anything longer gets a block. */
function codeSpan(text: string): string {
  if (text.includes("\n")) return fence(text);
  const longestRun = Math.max(0, ...Array.from(text.matchAll(/`+/g), (match) => match[0].length));
  const marker = "`".repeat(longestRun + 1);
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${marker}${pad}${text}${pad}${marker}`;
}

function truncate(text: string, length: number): string {
  return text.length > length ? `${text.slice(0, length)}…` : text;
}

function toolStatus(entry: WorkLogEntry): string | null {
  switch (entry.toolLifecycleStatus) {
    case "failed":
    case "declined":
    case "stopped":
      return entry.toolLifecycleStatus;
    case "inProgress":
      return "running";
    default:
      return entry.tone === "error" ? "failed" : null;
  }
}

function renderTool(entry: WorkLogEntry, workspaceRoot: string | undefined) {
  const label = workEntryDisplayLabel(entry, workspaceRoot).trim() || entry.label;
  const name = entry.toolTitle?.trim();
  const status = toolStatus(entry);
  const rawDetail = entry.detail?.trim();
  const detail =
    rawDetail && rawDetail !== label ? truncate(rawDetail, TOOL_DETAIL_MAX_LENGTH) : null;
  const heading = ["Tool call", name, status].filter(Boolean).join(" · ");
  return {
    text: [`${heading}: ${label}`, detail].filter(Boolean).join("\n"),
    markdown: [`**${heading}:** ${codeSpan(label)}`, detail ? fence(detail) : null]
      .filter(Boolean)
      .join("\n\n"),
  };
}

/**
 * Quotes every message and tool call from one endpoint to the other, in timeline order, so
 * entries hidden by collapsed tool groups or folded turns are included as well. Reasoning
 * and other activity are left out.
 */
export function buildTranscriptCitation({
  threadRef,
  entries,
  from,
  to,
  workspaceRoot,
}: {
  threadRef: ScopedThreadRef;
  entries: ReadonlyArray<TimelineEntry>;
  from: TranscriptEndpoint;
  to: TranscriptEndpoint;
  workspaceRoot: string | undefined;
}): AssistantCitation | null {
  let startIndex = entries.findIndex((entry) => transcriptItemId(entry) === from.itemId);
  let endIndex = entries.findIndex((entry) => transcriptItemId(entry) === to.itemId);
  if (startIndex < 0 || endIndex < 0) return null;
  let [first, last] = [from, to];
  if (startIndex > endIndex) {
    [startIndex, endIndex] = [endIndex, startIndex];
    [first, last] = [to, from];
  }

  const segments: AssistantCitationSegment[] = [];
  const texts: string[] = [];
  const markdowns: string[] = [];
  for (let index = startIndex; index <= endIndex; index += 1) {
    const entry = entries[index]!;
    if (entry.kind === "work") {
      if (!isCitableTool(entry.entry)) continue;
      const rendered = renderTool(entry.entry, workspaceRoot);
      segments.push({ kind: "tool", id: entry.entry.id });
      texts.push(rendered.text);
      markdowns.push(rendered.markdown);
      continue;
    }
    if (entry.kind !== "message" || entry.message.role === "system") continue;
    const { role } = entry.message;
    const quote = index === startIndex ? first.quote : index === endIndex ? last.quote : undefined;
    const text = quote
      ? quote.text
      : role === "user"
        ? assistantCitationsToPlainText(entry.message.text)
        : entry.message.text;
    const markdown = quote
      ? (quote.markdown ?? quote.text)
      : role === "user"
        ? renderAssistantCitationsAsText(entry.message.text)
        : entry.message.text;
    if (text.trim().length === 0) continue;
    const speaker = role === "user" ? "User" : "Assistant";
    segments.push({ kind: role, id: entry.message.id });
    texts.push(`${speaker}:\n${text.trim()}`);
    markdowns.push(`**${speaker}**\n\n${markdown.trim()}`);
  }
  if (segments.length === 0 || segments.length > ASSISTANT_CITATION_MAX_SEGMENTS) return null;

  const text = texts.join("\n\n");
  const markdown = markdowns.join("\n\n");
  return {
    version: 1,
    environmentId: threadRef.environmentId,
    threadId: threadRef.threadId,
    messageId: MessageId.make(segments[0]!.id),
    text,
    ...(markdown.length <= ASSISTANT_CITATION_MAX_MARKDOWN_LENGTH ? { markdown } : {}),
    start: 0,
    end: text.length,
    prefix: "",
    suffix: "",
    segments,
  };
}

/** The row that shows a timeline item: its message row, or the tool row that lists the call. */
export function transcriptItemRowIndex(
  rows: ReadonlyArray<MessagesTimelineRow>,
  itemId: string,
): number {
  return rows.findIndex((row) => {
    if (row.kind === "message") return row.message.id === itemId;
    if (row.kind === "work") return row.groupedEntries.some((entry) => entry.id === itemId);
    if (row.kind === "work-live") {
      return row.entry.id === itemId || row.groupedEntries.some((entry) => entry.id === itemId);
    }
    return false;
  });
}

/** The first row showing any item a citation quotes, so a folded or collapsed start still lands. */
export function citationRowIndex(
  rows: ReadonlyArray<MessagesTimelineRow>,
  citation: AssistantCitation,
): number {
  if (!citation.segments) {
    return rows.findIndex((row) => row.kind === "message" && row.message.id === citation.messageId);
  }
  for (const segment of citation.segments) {
    const index = transcriptItemRowIndex(rows, segment.id);
    if (index >= 0) return index;
  }
  return -1;
}
