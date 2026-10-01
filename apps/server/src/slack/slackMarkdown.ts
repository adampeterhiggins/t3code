import * as DateTime from "effect/DateTime";

import { truncate } from "../issueMarkdown.ts";

const SEPARATOR = "\n\n";
const BROADCASTS = new Set(["here", "channel", "everyone"]);

/** A Slack message timestamp (`1727779620.000100`) as an ISO date-time. */
export function slackTsToIso(ts: string): string {
  return DateTime.formatIso(DateTime.makeUnsafe(Math.floor(Number(ts) * 1_000)));
}

/** `2026-09-29 10:47 UTC`, the time a message header shows. */
export function slackTsToDisplay(ts: string): string {
  const iso = slackTsToIso(ts);
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

function decodeEntities(text: string): string {
  return text.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
}

function convertToken(body: string, names: ReadonlyMap<string, string>): string {
  const bar = body.indexOf("|");
  const target = bar === -1 ? body : body.slice(0, bar);
  const label = bar === -1 ? "" : body.slice(bar + 1);
  switch (target[0]) {
    case "@": {
      const id = target.slice(1);
      return `@${names.get(id) ?? (label.replace(/^@/, "") || id)}`;
    }
    case "#":
      return `#${label || target.slice(1)}`;
    case "!": {
      const command = target.slice(1);
      if (BROADCASTS.has(command)) return `@${command}`;
      if (label) return label;
      return `@${command.replace(/^subteam\^/, "")}`;
    }
    default:
      return label ? `[${label}](${target})` : target;
  }
}

/**
 * Converts Slack mrkdwn's angle-bracket tokens (mentions, channel links,
 * broadcasts, links) to markdown and decodes Slack's three HTML entities.
 * `names` maps user ids to the names to show.
 */
export function slackTextToMarkdown(text: string, names: ReadonlyMap<string, string>): string {
  return decodeEntities(
    text.replace(/<([^<>]+)>/g, (_, body: string) => convertToken(body, names)),
  );
}

/** The user ids `text` mentions, for resolving their names. */
export function mentionedUserIds(text: string): ReadonlyArray<string> {
  return [...text.matchAll(/<@([A-Z0-9]+)(?:\|[^>]*)?>/g)].map((match) => match[1]!);
}

export interface SlackRenderedMessage {
  readonly ts: string;
  readonly authorName: string;
  /** Already converted with `slackTextToMarkdown`. */
  readonly text: string;
  readonly files: ReadonlyArray<string>;
}

export interface SlackThreadSnapshot {
  readonly channelLabel: string;
  readonly url: string;
  readonly scope: "thread" | "message";
  /** In chronological order; the first is the thread's parent. */
  readonly messages: ReadonlyArray<SlackRenderedMessage>;
  readonly linkedTs: string;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * Renders a thread or message as the markdown an agent receives. Within
 * `maxChars`, the header, the thread's parent and the linked message are always
 * kept (cut if they alone overflow), then the newest other messages fill what is
 * left. Gaps show as `_N messages omitted._`.
 */
export function renderSlackThreadMarkdown(snapshot: SlackThreadSnapshot, maxChars: number): string {
  const { messages } = snapshot;
  const isThread = snapshot.scope === "thread";
  const header = [
    `# Slack ${isThread ? "thread" : "message"} in ${snapshot.channelLabel}`,
    `url: ${snapshot.url}`,
    ...(isThread ? [plural(Math.max(messages.length - 1, 0), "reply", "replies")] : []),
  ].join("\n");

  const markLinked = isThread && messages.length > 1;
  const rendered = messages.map((message) => {
    const byline = `**${message.authorName}** · ${slackTsToDisplay(message.ts)}${
      markLinked && message.ts === snapshot.linkedTs ? " · linked message" : ""
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

  const linkedIndex = messages.findIndex((message) => message.ts === snapshot.linkedTs);
  const kept = new Set([0, linkedIndex].filter((index) => index >= 0 && index < rendered.length));
  const required = assemble(kept);
  if (required.length > maxChars) {
    // Share what the header and markers leave evenly between the kept messages.
    const keptLength = [...kept].reduce((sum, index) => sum + rendered[index]!.length, 0);
    const share = Math.floor((maxChars - (required.length - keptLength)) / kept.size);
    for (const index of kept) rendered[index] = truncate(rendered[index]!, Math.max(share, 0));
    return truncate(assemble(kept), maxChars);
  }
  for (let index = rendered.length - 1; index > 0; index--) {
    if (kept.has(index)) continue;
    const candidate = new Set(kept).add(index);
    if (assemble(candidate).length > maxChars) break;
    kept.add(index);
  }
  return truncate(assemble(kept), maxChars);
}
