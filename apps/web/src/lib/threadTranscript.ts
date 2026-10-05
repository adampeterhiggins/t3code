import type { OrchestrationV2ThreadProjection } from "@t3tools/contracts";
import { replaceComposerContextReferences } from "@t3tools/shared/composerContextReferences";
import * as DateTime from "effect/DateTime";

import { deriveTimelineEntriesFromVisibleTurnItems, type WorkLogEntry } from "../session-logic";
import type { ChatMessage } from "../types";
import { resolveUserMessageContext } from "./composerContextRecords";

/** Concise keeps the conversation; full adds the work log and proposed plans. */
export type TranscriptDetail = "concise" | "full";

export interface ThreadTranscript {
  readonly markdown: string;
  readonly messageCount: number;
  readonly toolCallCount: number;
}

type TranscriptItem =
  | { readonly kind: "user" | "assistant"; readonly text: string }
  | { readonly kind: "work"; readonly entry: WorkLogEntry }
  | { readonly kind: "plan"; readonly markdown: string };

function userMessageText(message: ChatMessage): string {
  // Inline context chips are links to records only T3 can resolve; keep their labels.
  const text = replaceComposerContextReferences(
    resolveUserMessageContext(message).text,
    (reference) => (reference.image ? `[image: ${reference.label}]` : reference.label),
  ).trim();
  const unmentioned = (message.attachments ?? [])
    .filter((attachment) => !text.includes(attachment.name))
    .map((attachment) => `[${attachment.type}: ${attachment.name}]`);
  return [text, ...unmentioned].filter((part) => part.length > 0).join("\n\n");
}

/** Inline code that survives backticks inside the value. */
function inlineCode(value: string): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  return singleLine.includes("`") ? `\`\` ${singleLine} \`\`` : `\`${singleLine}\``;
}

function formatWorkEntry(entry: WorkLogEntry): string {
  let line = `- **${entry.label}**`;
  if (entry.command) {
    line += ` ${inlineCode(entry.command)}`;
  } else if (entry.detail && !entry.detail.includes("\n") && entry.detail.length <= 200) {
    line += ` — ${entry.detail}`;
  }
  if (entry.changedFiles && entry.changedFiles.length > 0) {
    line += `: ${entry.changedFiles.map(inlineCode).join(", ")}`;
  }
  return line;
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function formatHeader(input: {
  readonly projection: OrchestrationV2ThreadProjection;
  readonly projectTitle: string | null;
  readonly exportedAt: Date;
}): string {
  const { thread } = input.projection;
  const lines = [
    `thread: ${yamlString(thread.title)}`,
    ...(input.projectTitle ? [`project: ${yamlString(input.projectTitle)}`] : []),
    ...(thread.branch ? [`branch: ${yamlString(thread.branch)}`] : []),
    `provider: ${yamlString(thread.modelSelection.instanceId)}`,
    `model: ${yamlString(thread.modelSelection.model)}`,
    `created: ${DateTime.formatIso(thread.createdAt)}`,
    `exported: ${input.exportedAt.toISOString()}`,
  ];
  return ["---", ...lines, "---"].join("\n");
}

/** Messages, plans, and work in the order the thread's timeline shows them. */
function transcriptItems(
  projection: OrchestrationV2ThreadProjection,
  detail: TranscriptDetail,
): TranscriptItem[] {
  const entries = deriveTimelineEntriesFromVisibleTurnItems({
    visibleTurnItems: projection.visibleTurnItems,
    optimisticMessages: [],
    attempts: projection.attempts,
    nodes: projection.nodes,
    plans: projection.plans,
  });
  const items: TranscriptItem[] = [];
  for (const entry of entries) {
    switch (entry.kind) {
      case "message": {
        const { message } = entry;
        if (message.role !== "user" && message.role !== "assistant") break;
        const text = message.role === "user" ? userMessageText(message) : message.text.trim();
        if (text.length > 0) items.push({ kind: message.role, text });
        break;
      }
      case "proposed-plan":
        if (detail === "full") {
          items.push({ kind: "plan", markdown: entry.proposedPlan.planMarkdown });
        }
        break;
      case "work":
        // Reasoning is always left out.
        if (detail === "full" && entry.entry.tone !== "thinking") {
          items.push({ kind: "work", entry: entry.entry });
        }
        break;
      case "event":
        break;
    }
  }
  return items;
}

/**
 * Renders a thread as Markdown for pasting into another app. Reasoning is
 * always left out; `full` interleaves the work log (tool calls, commands, file
 * edits) and proposed plans in timeline order.
 */
export function buildThreadTranscript(input: {
  readonly projection: OrchestrationV2ThreadProjection;
  readonly projectTitle: string | null;
  readonly detail: TranscriptDetail;
  readonly includeHeader: boolean;
  readonly exportedAt: Date;
}): ThreadTranscript {
  const items = transcriptItems(input.projection, input.detail);

  const blocks: string[] = [];
  if (input.includeHeader) blocks.push(formatHeader(input));
  blocks.push(`# ${input.projection.thread.title}`);
  let speaker: "user" | "assistant" | null = null;
  let workLines: string[] = [];
  let messageCount = 0;
  let toolCallCount = 0;
  const flushWork = () => {
    if (workLines.length === 0) return;
    blocks.push(workLines.join("\n"));
    workLines = [];
  };
  for (const item of items) {
    const itemSpeaker = item.kind === "user" ? "user" : "assistant";
    if (itemSpeaker !== speaker) {
      flushWork();
      blocks.push(itemSpeaker === "user" ? "## User" : "## Assistant");
      speaker = itemSpeaker;
    }
    if (item.kind === "work") {
      toolCallCount += 1;
      workLines.push(formatWorkEntry(item.entry));
      continue;
    }
    flushWork();
    if (item.kind === "plan") {
      blocks.push(`### Plan\n\n${item.markdown.trim()}`);
    } else {
      messageCount += 1;
      blocks.push(item.text);
    }
  }
  flushWork();

  return { markdown: `${blocks.join("\n\n")}\n`, messageCount, toolCallCount };
}

/** A filesystem-safe `.md` name from the thread title. */
export function transcriptFileName(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "");
  return `${slug || "transcript"}.md`;
}
