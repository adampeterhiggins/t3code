import * as DateTime from "effect/DateTime";

import { type RenderedChatThread, renderChatThread } from "../chatThreadMarkdown.ts";

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
  readonly avatarUrl: string | null;
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

/** Renders a thread or message as the markdown an agent receives; see `renderChatThread`. */
export function renderSlackThread(
  snapshot: SlackThreadSnapshot,
  maxChars: number,
): RenderedChatThread {
  return renderChatThread(
    {
      service: "Slack",
      channelLabel: snapshot.channelLabel,
      url: snapshot.url,
      scope: snapshot.scope,
      linkedId: snapshot.linkedTs,
      messages: snapshot.messages.map((message) => ({
        id: message.ts,
        authorName: message.authorName,
        avatarUrl: message.avatarUrl,
        postedAt: slackTsToDisplay(message.ts),
        postedAtIso: slackTsToIso(message.ts),
        text: message.text,
        files: message.files,
      })),
    },
    maxChars,
  );
}
