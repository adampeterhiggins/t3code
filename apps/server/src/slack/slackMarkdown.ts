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

function convertToken(
  body: string,
  names: ReadonlyMap<string, string>,
  groups: ReadonlyMap<string, string>,
): string {
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
      const group = command.replace(/^subteam\^/, "");
      return `@${groups.get(group) ?? group}`;
    }
    default:
      return label ? `[${label}](${target})` : target;
  }
}

/**
 * Converts Slack mrkdwn to markdown. Angle-bracket tokens (mentions, channel
 * links, broadcasts, links) become markdown, and Slack's three HTML entities
 * are decoded. `names` maps user ids to the names to show, and `groups` user
 * group ids to their handles.
 *
 * Slack writes bold as `*text*` and strike as `~text~`. CommonMark reads a
 * single `*` as italic and does not strike `~text~`, so the hover card would
 * show Slack's bold in italics. Italic underscores and inline code already
 * agree with CommonMark, so they stay. Code and links are left untouched:
 * Slack does not format inside them, and a `*` in a URL is not emphasis. Code
 * is held out as a placeholder rather than split around, so bold that spans
 * inline code still pairs up.
 *
 * Slack opens a code block at any three backticks, mid-line or not, and the
 * `•` list markers its composer writes are plain text; both are rewritten to
 * the CommonMark shapes that render the same way.
 */
export function slackTextToMarkdown(
  text: string,
  names: ReadonlyMap<string, string>,
  groups: ReadonlyMap<string, string> = new Map(),
): string {
  const code: Array<string> = [];
  const held = text.replace(CODE_SPANS, (span) => {
    code.push(decodeEntities(span));
    return `\uE001${code.length - 1}\uE001`;
  });
  const converted = translateMrkdwn(
    bulletsToMarkdown(
      decodeEntities(
        held.replace(/<([^<>]+)>/g, (_, body: string) => convertToken(body, names, groups)),
      ),
    ),
  );
  return converted
    .replace(/\uE001(\d+)\uE001/g, (_, index: string) => {
      const span = code[Number(index)] ?? "";
      if (!span.startsWith("```")) return span;
      const body = span.slice(3, -3).replace(/^\n/, "").replace(/\n$/, "");
      // A fence must sit on its own lines; \uE002 marks where a line break may be needed.
      return `\uE002\`\`\`\n${body}\n\`\`\`\uE002`;
    })
    .replace(/[ \t]*\uE002[ \t]*/g, (marker, offset: number, whole: string) => {
      const next = whole[offset + marker.length];
      return offset === 0 || whole[offset - 1] === "\n" || next === undefined || next === "\n"
        ? ""
        : "\n";
    });
}

const CODE_SPANS = /```[\s\S]*?```|`[^`\n]*`/g;

/**
 * The mentions `text` shows once converted, as `slackTextToMarkdown` writes them, so a client
 * can highlight them the way Slack does.
 */
export function slackMentionLabels(
  text: string,
  names: ReadonlyMap<string, string>,
  groups: ReadonlyMap<string, string> = new Map(),
): ReadonlyArray<string> {
  const labels = new Set<string>();
  for (const match of text.replace(CODE_SPANS, "").matchAll(/<([@#!][^<>]*)>/g)) {
    const label = decodeEntities(convertToken(match[1]!, names, groups));
    if (/^[@#]/.test(label)) labels.add(label);
  }
  return [...labels];
}

/** Drops the bold and strike markers added for markdown, for a plain label. */
export function slackMarkdownToPlain(text: string): string {
  let out = "";
  let last = 0;
  for (const match of text.matchAll(CODE_SPANS)) {
    const index = match.index ?? last;
    out += text.slice(last, index).replaceAll("**", "").replaceAll("~~", "");
    out += match[0];
    last = index + match[0].length;
  }
  return out + text.slice(last).replaceAll("**", "").replaceAll("~~", "");
}

const BULLET_LINE = /^( *)[•◦▪▫]\uFE0E?[ \t]+/;
const LIST_LINE = /^ *(?:-|\d+[.)])[ \t]/;

/**
 * Slack's composer writes list items as `• item`, nested ones four spaces per level with `◦` or
 * `▪︎`. Markdown lists keep the hanging indent Slack draws. A line after a list gets a blank line
 * first, or markdown would fold it into the last item.
 */
function bulletsToMarkdown(text: string): string {
  const out: Array<string> = [];
  let inList = false;
  for (const line of text.split("\n")) {
    const bullet = BULLET_LINE.exec(line);
    if (bullet) {
      const depth = Math.ceil(bullet[1]!.length / 4);
      out.push(`${"  ".repeat(depth)}- ${line.slice(bullet[0].length)}`);
      inList = true;
      continue;
    }
    const listLine = LIST_LINE.test(line);
    if (inList && !listLine && line.trim() !== "") out.push("");
    inList = listLine;
    out.push(line);
  }
  return out.join("\n");
}

function translateMrkdwn(text: string): string {
  const stash: Array<string> = [];
  const held = text.replace(/\[[^\]\n]*\]\([^)\n]*\)|https?:\/\/[^\s<>)\]]+/g, (link) => {
    stash.push(link);
    return `\uE000${stash.length - 1}\uE000`;
  });
  const formatted = replaceMarker(
    replaceMarker(held, "~", (inner) => `~~${inner}~~`),
    "*",
    (inner) => `**${inner}**`,
  );
  return formatted.replace(/\uE000(\d+)\uE000/g, (_, index: string) => stash[Number(index)] ?? "");
}

function replaceMarker(text: string, marker: "*" | "~", wrap: (inner: string) => string): string {
  return text
    .split("\n")
    .map((line) => replaceMarkerInLine(line, marker, wrap))
    .join("\n");
}

/** Letters and digits bind a marker to a word. Punctuation, as in Slack, does not. */
function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /[\p{L}\p{N}]/u.test(char);
}

function canOpen(line: string, index: number, marker: string): boolean {
  const next = line[index + 1];
  if (next === undefined || next === marker || /\s/.test(next)) return false;
  if (index === 0) return true;
  const prev = line[index - 1]!;
  return prev !== marker && !isWordChar(prev);
}

function findClose(line: string, from: number, marker: string): number {
  for (let index = from; index < line.length; index++) {
    if (line[index] !== marker) continue;
    const prev = line[index - 1];
    if (prev === undefined || prev === marker || /\s/.test(prev)) continue;
    const next = line[index + 1];
    if (isWordChar(next)) continue;
    return index;
  }
  return -1;
}

function replaceMarkerInLine(
  line: string,
  marker: "*" | "~",
  wrap: (inner: string) => string,
): string {
  let result = "";
  let index = 0;
  while (index < line.length) {
    if (line[index] !== marker || !canOpen(line, index, marker)) {
      result += line[index];
      index += 1;
      continue;
    }
    const close = findClose(line, index + 1, marker);
    if (close === -1) {
      result += line[index];
      index += 1;
      continue;
    }
    result += wrap(line.slice(index + 1, close));
    index = close + 1;
  }
  return result;
}

/** The user group ids `text` mentions without a label, for resolving their handles. */
export function mentionedGroupIds(text: string): ReadonlyArray<string> {
  return [...text.matchAll(/<!subteam\^([A-Z0-9]+)>/g)].map((match) => match[1]!);
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
  /** From `slackMentionLabels`. */
  readonly mentions?: ReadonlyArray<string> | undefined;
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
        mentions: message.mentions,
      })),
    },
    maxChars,
  );
}
