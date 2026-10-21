import {
  type GitHubRefLink,
  type LinearObjectType,
  parseGranolaNoteId,
  parseNotionPageId,
  parseGitHubIssueUrl,
  parseGitHubRefUrl,
} from "@t3tools/contracts";
import { parseChangeRequestUrl } from "./changeRequestUrl.ts";
import { parseNewThreadLink, parseThreadLinkPrompt, promptLinkAppPath } from "./promptLinks.ts";

/**
 * A link in composer text to something the composer can attach as a chip instead: a Linear
 * issue, project, document, or initiative, a GitHub issue, a pull request, a GitHub repository
 * root, a GitHub release, tag, branch, or commit, a Slack or Discord message, a Notion page, a
 * Granola note, or a T3 Code prompt link.
 */
export type ComposerObjectLink =
  | { readonly kind: "notion-page"; readonly url: string; readonly pageId: string }
  | { readonly kind: "granola-note"; readonly url: string; readonly noteId: string }
  | { readonly kind: "linear-issue"; readonly url: string; readonly identifier: string }
  | {
      readonly kind: "linear-object";
      readonly url: string;
      readonly objectType: LinearObjectType;
      /** The URL slug id, such as `bc857ff37b9f`, which Linear looks objects up by. */
      readonly slugId: string;
      /** The name the URL spells, such as `Structured discussion guide`, when it has one. */
      readonly name: string | null;
    }
  | {
      readonly kind: "slack-message";
      readonly url: string;
      /** The subdomain, such as `acme` in `acme.slack.com`. */
      readonly workspace: string;
      readonly channelId: string;
      readonly ts: string;
      /** The thread the message replies in, when the link says so. */
      readonly threadTs: string | null;
    }
  | {
      readonly kind: "discord-message";
      readonly url: string;
      readonly guildId: string;
      /** The channel or thread the message was posted in. */
      readonly channelId: string;
      readonly messageId: string;
    }
  | { readonly kind: "github-issue"; readonly url: string }
  | { readonly kind: "pull-request"; readonly url: string }
  | ({ readonly kind: "github-ref"; readonly url: string } & GitHubRefLink)
  | {
      readonly kind: "prompt-link";
      readonly url: string;
      /** The prompt the link opens with, hidden characters removed. */
      readonly prompt: string | null;
      /** `owner/name`, or `owner/name#123` when the link opens a pull request. */
      readonly target: string | null;
    }
  | {
      readonly kind: "repository";
      readonly url: string;
      readonly nameWithOwner: string;
      readonly remoteUrl: string;
    };

const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/giu;
const LEADING_URL = /^https?:\/\/[^\s<>"'`]+/iu;
// Sentence punctuation and closing brackets that end prose rather than the link.
const TRAILING_PUNCTUATION = /[.,;:!?)\]}>]+$/u;
const LINEAR_ISSUE_IDENTIFIER = /^[A-Za-z][A-Za-z0-9]*-\d+$/u;
// Linear names these by `<title-slug>-<slug id>`; a bare slug id also opens them.
const LINEAR_SLUG = /^(?:(.*)-)?([0-9a-f]{12})$/iu;
const LINEAR_OBJECT_TYPES: ReadonlySet<string> = new Set<LinearObjectType>([
  "project",
  "document",
  "initiative",
]);
const SLACK_CHANNEL_ID = /^[CDG][A-Z0-9]{2,}$/u;
// `p` and the message timestamp without its dot: the last six digits are the fraction.
const SLACK_PERMALINK_TS = /^p(\d{7,})$/u;
const SLACK_TS = /^\d{1,12}\.\d{1,9}$/u;
// A fence comes first so backticks inside it are not read as spans. An unclosed fence runs to the
// end, as markdown renders it.
const MARKDOWN_CODE = /(`{3,}|~{3,})[\s\S]*?(?:\1|$)|(`+)[^\n]*?\2/gu;

/** Where `text` has markdown code spans and fences, as `[start, end)` pairs in order. */
function markdownCodeRanges(text: string): ReadonlyArray<readonly [number, number]> {
  return Array.from(text.matchAll(MARKDOWN_CODE), (match) => [
    match.index,
    match.index + match[0].length,
  ]);
}

function isInRanges(ranges: ReadonlyArray<readonly [number, number]>, index: number): boolean {
  return ranges.some(([start, end]) => index >= start && index < end);
}

/**
 * A Slack message permalink, `https://<workspace>.slack.com/archives/<channel>/p<ts>`, with
 * `?thread_ts=` when the message is a reply. Channel links (no message) are not attachable.
 */
function parseSlackMessageLink(url: string, parsed: URL, segments: ReadonlyArray<string>) {
  const host = parsed.hostname.toLowerCase();
  if (!host.endsWith(".slack.com") || host === "app.slack.com") return null;
  if (segments.length !== 3 || segments[0] !== "archives") return null;
  const channelId = segments[1]!;
  const digits = SLACK_PERMALINK_TS.exec(segments[2]!)?.[1];
  if (!SLACK_CHANNEL_ID.test(channelId) || digits === undefined) return null;
  const threadTs = parsed.searchParams.get("thread_ts");
  return {
    kind: "slack-message",
    url,
    workspace: host.split(".")[0]!,
    channelId,
    ts: `${digits.slice(0, -6)}.${digits.slice(-6)}`,
    threadTs: threadTs !== null && SLACK_TS.test(threadTs) ? threadTs : null,
  } as const;
}

const DISCORD_HOSTS = new Set([
  "discord.com",
  "ptb.discord.com",
  "canary.discord.com",
  "discordapp.com",
  "ptb.discordapp.com",
  "canary.discordapp.com",
]);
const DISCORD_SNOWFLAKE = /^\d{15,25}$/u;

/**
 * A Discord message link, `https://discord.com/channels/<guild>/<channel>/<message>`. Direct
 * messages (`@me`) and channel links (no message) are not attachable: the bot reads servers only.
 */
function parseDiscordMessageLink(url: string, segments: ReadonlyArray<string>) {
  if (segments.length !== 4 || segments[0] !== "channels") return null;
  const [, guildId, channelId, messageId] = segments as [string, string, string, string];
  if (![guildId, channelId, messageId].every((id) => DISCORD_SNOWFLAKE.test(id))) return null;
  return { kind: "discord-message", url, guildId, channelId, messageId } as const;
}

// Matches the record's bound; a longer link stays a link.
const PROMPT_LINK_MAX_URL_LENGTH = 32_000;

/**
 * A T3 Code prompt link on the hosted app: `/new?prompt=…` (optionally with a repository or pull
 * request) or a thread link carrying `?prompt=`. Null when the link would not open, such as one
 * whose prompt is only hidden characters.
 */
function parsePromptLink(url: string) {
  if (url.length > PROMPT_LINK_MAX_URL_LENGTH) return null;
  const appPath = promptLinkAppPath(url);
  if (appPath === null) return null;
  const search = new URL(url).search;
  if (appPath.startsWith("/new")) {
    const parsed = parseNewThreadLink(search);
    if (!parsed.ok) return null;
    const link = parsed.value;
    if (link.kind === "pull-request") {
      const { owner, name, number } = link.pullRequest;
      return {
        kind: "prompt-link",
        url,
        prompt: link.prompt?.text ?? null,
        target: `${owner}/${name}#${number}`,
      } as const;
    }
    return {
      kind: "prompt-link",
      url,
      prompt: link.prompt.text,
      target: link.repository ? `${link.repository.owner}/${link.repository.name}` : null,
    } as const;
  }
  const prompt = parseThreadLinkPrompt(search);
  return prompt.ok && prompt.value !== null
    ? ({ kind: "prompt-link", url, prompt: prompt.value.text, target: null } as const)
    : null;
}

function isGitHubHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "github.com" || host.endsWith(".github.com") || host.split(".").includes("github")
  );
}

/** What one URL names, or null for an ordinary link. */
export function parseComposerObjectLink(url: string): ComposerObjectLink | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  const promptLink = parsePromptLink(url);
  if (promptLink !== null) return promptLink;
  const notionPageId = parseNotionPageId(url);
  if (notionPageId !== null) return { kind: "notion-page", url, pageId: notionPageId };
  const granolaNoteId = parseGranolaNoteId(url);
  if (granolaNoteId !== null) return { kind: "granola-note", url, noteId: granolaNoteId };
  const segments = parsed.pathname.split("/").filter(Boolean);

  // https://linear.app/<workspace>/issue/<ENG-123>/<slug>, or
  // https://linear.app/<workspace>/project/<slug>-<slug id>/<tab> (and documents and initiatives)
  if (parsed.hostname.toLowerCase() === "linear.app") {
    const [, type, name] = segments;
    if (type === undefined || name === undefined) return null;
    if (type === "issue") {
      return LINEAR_ISSUE_IDENTIFIER.test(name)
        ? { kind: "linear-issue", url, identifier: name.toUpperCase() }
        : null;
    }
    const slug = LINEAR_SLUG.exec(name);
    if (!LINEAR_OBJECT_TYPES.has(type) || slug === null) return null;
    const words = slug[1]?.replaceAll("-", " ").trim() ?? "";
    return {
      kind: "linear-object",
      url,
      objectType: type as LinearObjectType,
      slugId: slug[2]!.toLowerCase(),
      name: words === "" ? null : `${words.charAt(0).toUpperCase()}${words.slice(1)}`,
    };
  }
  if (parsed.hostname.toLowerCase().endsWith(".slack.com")) {
    return parseSlackMessageLink(url, parsed, segments);
  }
  if (DISCORD_HOSTS.has(parsed.hostname.toLowerCase())) {
    return parseDiscordMessageLink(url, segments);
  }
  if (parseChangeRequestUrl(url) !== null) return { kind: "pull-request", url };
  if (!isGitHubHost(parsed.hostname)) return null;
  if (parseGitHubIssueUrl(url) !== null) return { kind: "github-issue", url };
  const ref = parseGitHubRefUrl(url);
  if (ref !== null) return { kind: "github-ref", url, ...ref };
  // Only a repository root: a link to a file or a tree is about that file, not a clone.
  if (parsed.hostname.toLowerCase() === "github.com" && segments.length === 2) {
    const nameWithOwner = `${segments[0]}/${segments[1]!.replace(/\.git$/iu, "")}`;
    return {
      kind: "repository",
      url,
      nameWithOwner,
      remoteUrl: `https://github.com/${nameWithOwner}`,
    };
  }
  return null;
}

/**
 * The fragment of a link to one remark (`#issuecomment-1`, `#discussion_r1`), without its `#`, or
 * an empty string for any other fragment.
 */
export function commentAnchor(hash: string): string {
  return /^#(?:issuecomment-|discussion_r|r|pullrequestreview-)\d+$/u.test(hash)
    ? hash.slice(1)
    : "";
}

const LINEAR_OBJECT_NOUNS: Record<LinearObjectType, string> = {
  project: "Linear project",
  document: "Linear document",
  initiative: "Linear initiative",
};

/**
 * The short name a bare link reads as once it is recognised: `owner/repo#7` for a pull request
 * or issue (`owner/repo#7 L4-L14` for lines of one of its files, `owner/repo#7issuecomment-1` for
 * one remark on it), `ENG-123` for a Linear issue, the name a Linear project, document, or
 * initiative link spells (`Roadmap`), `owner/repo` for a repository, and
 * `owner/repo@v1.2.0` for a release, tag, branch, or commit (`owner/repo@abc1234`). Null for ordinary links, and for Slack or Discord messages and prompt links:
 * an attached one is already a chip, so a bare one was not attached and should not read as if it
 * were.
 */
export function objectLinkLabel(url: string): string | null {
  const link = parseComposerObjectLink(url);
  switch (link?.kind) {
    case undefined:
      return null;
    case "notion-page":
      return "Notion page";
    case "granola-note":
      return "Granola note";
    case "linear-issue":
      return link.identifier;
    case "linear-object":
      return link.name ?? LINEAR_OBJECT_NOUNS[link.objectType];
    case "slack-message":
    case "discord-message":
    case "prompt-link":
      return null;
    case "repository":
      return link.nameWithOwner;
    case "github-ref":
      // A `tree` link with a slash may be a folder, which is not a ref; it keeps its URL.
      if (link.linkType === "tree" && link.ref.includes("/")) return null;
      return `${link.repository}@${link.linkType === "commit" ? link.ref.slice(0, 7) : link.ref}`;
    case "github-issue": {
      const issue = parseGitHubIssueUrl(url);
      if (issue === null) return null;
      return `${issue.repository}#${issue.number}${commentAnchor(new URL(url).hash)}`;
    }
    case "pull-request": {
      const changeRequest = parseChangeRequestUrl(url);
      if (changeRequest === null) return null;
      // The parsed repository is lower-cased for matching; show it as the link writes it.
      const repository = new URL(url).pathname
        .split("/")
        .filter(Boolean)
        .slice(0, changeRequest.repository.split("/").length)
        .join("/");
      // A link to lines of one file, or to one remark, keeps it, or the label would name the
      // whole change.
      const hash = new URL(url).hash;
      const lines = /^#diff-[0-9a-f]{64}([LR]\d+(?:-[LR]\d+)?)$/iu.exec(hash)?.[1];
      return lines === undefined
        ? `${repository}#${changeRequest.number}${commentAnchor(hash)}`
        : `${repository}#${changeRequest.number} ${lines}`;
    }
  }
}

const OBJECT_LINK_NOUNS: Record<ComposerObjectLink["kind"], string> = {
  "notion-page": "Notion page",
  "granola-note": "Granola note",
  "linear-issue": "Linear issue",
  "linear-object": "Linear project, document, or initiative",
  "slack-message": "Slack message",
  "discord-message": "Discord message",
  "github-issue": "GitHub issue",
  "pull-request": "pull request",
  "github-ref": "GitHub release, branch, tag, or commit",
  "prompt-link": "T3 Code prompt link",
  repository: "repository",
};

/** What an attachable link points at, as a sentence names it: "Linear issue". */
export function composerObjectLinkNoun(kind: string): string {
  return Object.hasOwn(OBJECT_LINK_NOUNS, kind)
    ? OBJECT_LINK_NOUNS[kind as ComposerObjectLink["kind"]]
    : "link";
}

/** What a chip for the link says without reading the object it names: `owner/repo#12`. */
export function composerObjectLinkChipLabel(
  link: Pick<ComposerObjectLink, "kind" | "url">,
): string {
  const noun = composerObjectLinkNoun(link.kind);
  return objectLinkLabel(link.url) ?? `${noun.charAt(0).toUpperCase()}${noun.slice(1)}`;
}

/**
 * Every attachable link in `text`, in order, with where it sits. A link in markdown code is code,
 * not a reference, so it is left out.
 */
export function findComposerObjectLinks(
  text: string,
): ReadonlyArray<{ readonly link: ComposerObjectLink; readonly index: number }> {
  const found: Array<{ link: ComposerObjectLink; index: number }> = [];
  const code = markdownCodeRanges(text);
  for (const match of text.matchAll(URL_PATTERN)) {
    // A markdown link's target already has text the writer chose to show.
    if (text.slice(match.index - 2, match.index) === "](") continue;
    if (isInRanges(code, match.index)) continue;
    const url = match[0].replace(TRAILING_PUNCTUATION, "");
    const link = parseComposerObjectLink(url);
    if (link !== null) found.push({ link, index: match.index });
  }
  return found;
}

/**
 * Where `url` sits in `text` as a whole link (not the start of a longer one) outside markdown
 * code, choosing the occurrence nearest `hint`. Null once the user has edited it away or into code.
 */
export function locateComposerObjectLink(
  text: string,
  url: string,
  hint: number,
): { readonly start: number; readonly end: number } | null {
  let best: { start: number; end: number } | null = null;
  const code = markdownCodeRanges(text);
  for (let start = text.indexOf(url); start !== -1; start = text.indexOf(url, start + 1)) {
    const end = start + url.length;
    if (isInRanges(code, start)) continue;
    // Read the link here the way `findComposerObjectLinks` would, so a longer link is skipped.
    const whole = LEADING_URL.exec(text.slice(start))?.[0].replace(TRAILING_PUNCTUATION, "");
    if (whole !== url) continue;
    if (best === null || Math.abs(start - hint) < Math.abs(best.start - hint)) {
      best = { start, end };
    }
  }
  return best;
}

/**
 * The attachable link the user just finished typing: `cursor` sits after a whitespace character
 * that ends a link (sentence punctuation between them is fine). Null while still typing one.
 */
export function findTypedComposerObjectLink(
  text: string,
  cursor: number,
): { readonly link: ComposerObjectLink; readonly index: number } | null {
  if (!/\s/u.test(text[cursor - 1] ?? "")) return null;
  const before = text.slice(0, cursor - 1);
  const start = before.search(/\S+$/u);
  if (start === -1) return null;
  const found = findComposerObjectLinks(before.slice(start)).at(-1);
  if (found === undefined) return null;
  const index = start + found.index;
  // A backtick right before the link opens a code span the user has not closed yet.
  if (text[index - 1] === "`" || isInRanges(markdownCodeRanges(text), index)) return null;
  const rest = before.slice(index + found.link.url.length);
  return /^[.,;:!?)\]}>]*$/u.test(rest) ? { link: found.link, index } : null;
}

/**
 * The attachable links a paste of `pastedText` at `pasteStart` put in `prompt`, with where each
 * sits in the prompt. A link the paste landed inside markdown code is left out, as is one the
 * pasted text itself wraps in code.
 */
export function findPastedComposerObjectLinks(
  prompt: string,
  pastedText: string,
  pasteStart: number,
): ReadonlyArray<{ readonly link: ComposerObjectLink; readonly index: number }> {
  const code = markdownCodeRanges(prompt);
  return findComposerObjectLinks(pastedText)
    .map(({ link, index }) => ({ link, index: pasteStart + index }))
    .filter(({ link, index }) => !(prompt.startsWith(link.url, index) && isInRanges(code, index)));
}
