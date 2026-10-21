import type { ChatThreadMessage } from "@t3tools/contracts";

import { truncate } from "./issueMarkdown.ts";

const SEPARATOR = "\n\n";

export interface ChatRenderedMessage {
  readonly id: string;
  readonly authorName: string;
  /** When it was posted, as the byline shows it. */
  readonly postedAt: string;
  readonly postedAtIso: string;
  readonly avatarUrl: string | null;
  /** Already markdown. */
  readonly text: string;
  readonly files: ReadonlyArray<string>;
}

export interface ChatThreadSnapshot {
  /** `Slack`, `Discord`: the service the heading names. */
  readonly service: string;
  readonly channelLabel: string;
  readonly url: string;
  readonly scope: "thread" | "message";
  /** In chronological order; the first is the thread's parent. */
  readonly messages: ReadonlyArray<ChatRenderedMessage>;
  readonly linkedId: string;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export interface RenderedChatThread {
  readonly markdown: string;
  /** The messages the markdown kept, as clients draw them. */
  readonly messages: ReadonlyArray<ChatThreadMessage>;
}

/**
 * Renders a chat thread or message as the markdown an agent receives. Within `maxChars`, the
 * header, the thread's parent and the linked message are always kept (cut if they alone
 * overflow), then the newest other messages fill what is left. Gaps show as
 * `_N messages omitted._`.
 */
export function renderChatThread(
  snapshot: ChatThreadSnapshot,
  maxChars: number,
): RenderedChatThread {
  const { messages } = snapshot;
  const isThread = snapshot.scope === "thread";
  const header = [
    `# ${snapshot.service} ${isThread ? "thread" : "message"} in ${snapshot.channelLabel}`,
    `url: ${snapshot.url}`,
    ...(isThread ? [plural(Math.max(messages.length - 1, 0), "reply", "replies")] : []),
  ].join("\n");

  const markLinked = isThread && messages.length > 1;
  const rendered = messages.map((message) => {
    const byline = `**${message.authorName}** · ${message.postedAt}${
      markLinked && message.id === snapshot.linkedId ? " · linked message" : ""
    }`;
    const files =
      message.files.length > 0 ? `Files: ${message.files.join(", ")} (not downloaded)` : null;
    return [byline, message.text.trim(), files].filter((part) => part).join("\n");
  });

  const assemble = (kept: ReadonlySet<number>) => {
    const parts = [header];
    let gap = 0;
    for (let index = 0; index < rendered.length; index++) {
      if (!kept.has(index)) {
        gap++;
        continue;
      }
      if (gap > 0) parts.push(`_${plural(gap, "message", "messages")} omitted._`);
      gap = 0;
      parts.push(rendered[index]!);
    }
    if (gap > 0) parts.push(`_${plural(gap, "message", "messages")} omitted._`);
    return parts.join(SEPARATOR);
  };

  const linkedIndex = messages.findIndex((message) => message.id === snapshot.linkedId);
  const kept = new Set([0, linkedIndex].filter((index) => index >= 0 && index < rendered.length));
  const required = assemble(kept);
  if (required.length > maxChars) {
    // Share what the header and markers leave evenly between the kept messages.
    const keptLength = [...kept].reduce((sum, index) => sum + rendered[index]!.length, 0);
    const share = Math.max(Math.floor((maxChars - (required.length - keptLength)) / kept.size), 0);
    for (const index of kept) rendered[index] = truncate(rendered[index]!, share);
    return {
      markdown: truncate(assemble(kept), maxChars),
      messages: structured(snapshot, kept, share),
    };
  }
  for (let index = rendered.length - 1; index > 0; index--) {
    if (kept.has(index)) continue;
    const candidate = new Set(kept).add(index);
    if (assemble(candidate).length > maxChars) break;
    kept.add(index);
  }
  return {
    markdown: truncate(assemble(kept), maxChars),
    messages: structured(snapshot, kept, maxChars),
  };
}

function structured(
  snapshot: ChatThreadSnapshot,
  kept: ReadonlySet<number>,
  maxTextChars: number,
): ReadonlyArray<ChatThreadMessage> {
  // As in the markdown: a lone message is not marked.
  const linkedId =
    snapshot.scope === "thread" && snapshot.messages.length > 1 ? snapshot.linkedId : null;
  return [...kept]
    .toSorted((a, b) => a - b)
    .map((index) => {
      const message = snapshot.messages[index]!;
      return {
        index,
        authorName: message.authorName,
        avatarUrl: message.avatarUrl,
        postedAt: message.postedAtIso,
        text: truncate(message.text.trim(), maxTextChars),
        files: message.files,
        linked: message.id === linkedId,
      };
    });
}
