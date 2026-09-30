import type { OrchestrationThread } from "@t3tools/contracts";
import { replaceComposerContextReferences } from "@t3tools/shared/composerContextReferences";

import { deriveWorkLogEntries, type WorkLogEntry } from "../session-logic";
import { resolveUserMessageContext } from "./composerContextRecords";

/** Concise keeps the conversation; full adds the work log and proposed plans. */
export type TranscriptDetail = "concise" | "full";

export interface ThreadTranscript {
  readonly markdown: string;
  readonly messageCount: number;
  readonly toolCallCount: number;
}

type TranscriptItem =
  | { readonly kind: "user" | "assistant"; readonly createdAt: string; readonly text: string }
  | { readonly kind: "work"; readonly createdAt: string; readonly entry: WorkLogEntry }
  | { readonly kind: "plan"; readonly createdAt: string; readonly markdown: string };

function userMessageText(message: OrchestrationThread["messages"][number]): string {
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
  const fence = singleLine.includes("`") ? "``" : "`";
  return fence === "``" ? `\`\` ${singleLine} \`\`` : `\`${singleLine}\``;
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
  readonly thread: OrchestrationThread;
  readonly projectTitle: string | null;
  readonly exportedAt: Date;
}): string {
  const { thread } = input;
  const lines = [
    `thread: ${yamlString(thread.title)}`,
    ...(input.projectTitle ? [`project: ${yamlString(input.projectTitle)}`] : []),
    ...(thread.branch ? [`branch: ${yamlString(thread.branch)}`] : []),
    `provider: ${yamlString(thread.modelSelection.instanceId)}`,
    `model: ${yamlString(thread.modelSelection.model)}`,
    `created: ${thread.createdAt}`,
    `exported: ${input.exportedAt.toISOString()}`,
  ];
  return ["---", ...lines, "---"].join("\n");
}

/**
 * Renders a thread as Markdown for pasting into another app. Reasoning and
 * system messages are always left out; `full` interleaves the work log (tool
 * calls, commands, file edits) and proposed plans in time order.
 */
export function buildThreadTranscript(input: {
  readonly thread: OrchestrationThread;
  readonly projectTitle: string | null;
  readonly detail: TranscriptDetail;
  readonly includeHeader: boolean;
  readonly exportedAt: Date;
}): ThreadTranscript {
  const { thread, detail } = input;
  const items: TranscriptItem[] = [];
  let messageCount = 0;
  for (const message of thread.messages) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    const text = message.role === "user" ? userMessageText(message) : message.text.trim();
    if (text.length === 0) continue;
    messageCount += 1;
    items.push({ kind: message.role, createdAt: message.createdAt, text });
  }
  const workEntries = detail === "full" ? deriveWorkLogEntries(thread.activities) : [];
  for (const entry of workEntries) {
    items.push({ kind: "work", createdAt: entry.createdAt, entry });
  }
  if (detail === "full") {
    for (const plan of thread.proposedPlans) {
      items.push({ kind: "plan", createdAt: plan.createdAt, markdown: plan.planMarkdown });
    }
  }
  // Stable sort keeps messages ahead of work stamped in the same instant.
  items.sort((left, right) => left.createdAt.localeCompare(right.createdAt));

  const blocks: string[] = [];
  if (input.includeHeader) blocks.push(formatHeader(input));
  blocks.push(`# ${thread.title}`);
  let speaker: "user" | "assistant" | null = null;
  let workLines: string[] = [];
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
      workLines.push(formatWorkEntry(item.entry));
      continue;
    }
    flushWork();
    blocks.push(item.kind === "plan" ? `### Plan\n\n${item.markdown.trim()}` : item.text);
  }
  flushWork();

  return {
    markdown: `${blocks.join("\n\n")}\n`,
    messageCount,
    toolCallCount: workEntries.length,
  };
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
