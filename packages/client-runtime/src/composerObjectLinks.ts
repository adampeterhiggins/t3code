import { parseNotionPageId, parseGitHubIssueUrl } from "@t3tools/contracts";
import { parseChangeRequestUrl } from "@t3tools/shared/changeRequestUrl";

/**
 * A link in composer text to something the composer can attach as a chip instead: a Linear
 * issue, a GitHub issue, a pull request, a GitHub repository root, a Slack message, or a Notion page.
 */
export type ComposerObjectLink =
  | { readonly kind: "notion-page"; readonly url: string; readonly pageId: string }
  | { readonly kind: "linear-issue"; readonly url: string; readonly identifier: string }
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
  | { readonly kind: "github-issue"; readonly url: string }
  | { readonly kind: "pull-request"; readonly url: string }
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
const SLACK_CHANNEL_ID = /^[CDG][A-Z0-9]{2,}$/u;
// `p` and the message timestamp without its dot: the last six digits are the fraction.
const SLACK_PERMALINK_TS = /^p(\d{7,})$/u;
const SLACK_TS = /^\d{1,12}\.\d{1,9}$/u;

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
  const notionPageId = parseNotionPageId(url);
  if (notionPageId !== null) return { kind: "notion-page", url, pageId: notionPageId };
  const segments = parsed.pathname.split("/").filter(Boolean);

  // https://linear.app/<workspace>/issue/<ENG-123>/<slug>
  if (parsed.hostname.toLowerCase() === "linear.app") {
    const identifier = segments[1] === "issue" ? segments[2] : undefined;
    return identifier !== undefined && LINEAR_ISSUE_IDENTIFIER.test(identifier)
      ? { kind: "linear-issue", url, identifier: identifier.toUpperCase() }
      : null;
  }
  if (parsed.hostname.toLowerCase().endsWith(".slack.com")) {
    return parseSlackMessageLink(url, parsed, segments);
  }
  if (parseChangeRequestUrl(url) !== null) return { kind: "pull-request", url };
  if (!isGitHubHost(parsed.hostname)) return null;
  if (parseGitHubIssueUrl(url) !== null) return { kind: "github-issue", url };
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

/** The fragment of a link to one remark (`#issuecomment-1`, `#discussion_r1`), without its `#`. */
function commentAnchor(hash: string): string {
  return /^#(?:issuecomment-|discussion_r|r|pullrequestreview-)\d+$/u.test(hash)
    ? hash.slice(1)
    : "";
}

/**
 * The short name a bare link reads as once it is recognised: `owner/repo#7` for a pull request
 * or issue (`owner/repo#7 L4-L14` for lines of one of its files, `owner/repo#7issuecomment-1` for
 * one remark on it), `ENG-123` for a Linear issue,
 * `owner/repo` for a repository. Null for ordinary links, and for Slack messages: an attached one
 * is already a chip, so a bare one was not attached and should not read as if it were.
 */
export function objectLinkLabel(url: string): string | null {
  const link = parseComposerObjectLink(url);
  switch (link?.kind) {
    case undefined:
      return null;
    case "notion-page":
      return "Notion page";
    case "linear-issue":
      return link.identifier;
    case "slack-message":
      return null;
    case "repository":
      return link.nameWithOwner;
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

/** Every attachable link in `text`, in order, with where it sits. */
export function findComposerObjectLinks(
  text: string,
): ReadonlyArray<{ readonly link: ComposerObjectLink; readonly index: number }> {
  const found: Array<{ link: ComposerObjectLink; index: number }> = [];
  for (const match of text.matchAll(URL_PATTERN)) {
    // A markdown link's target already has text the writer chose to show.
    if (text.slice(match.index - 2, match.index) === "](") continue;
    const url = match[0].replace(TRAILING_PUNCTUATION, "");
    const link = parseComposerObjectLink(url);
    if (link !== null) found.push({ link, index: match.index });
  }
  return found;
}

/**
 * Where `url` sits in `text` as a whole link (not the start of a longer one), choosing the
 * occurrence nearest `hint`. Null once the user has edited it away.
 */
export function locateComposerObjectLink(
  text: string,
  url: string,
  hint: number,
): { readonly start: number; readonly end: number } | null {
  let best: { start: number; end: number } | null = null;
  for (let start = text.indexOf(url); start !== -1; start = text.indexOf(url, start + 1)) {
    const end = start + url.length;
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
  const rest = before.slice(start + found.index + found.link.url.length);
  return /^[.,;:!?)\]}>]*$/u.test(rest) ? { link: found.link, index: start + found.index } : null;
}
