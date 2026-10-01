import { parseGitHubIssueUrl } from "@t3tools/contracts";
import { parseChangeRequestUrl } from "@t3tools/shared/changeRequestUrl";

/**
 * A link in composer text to something the composer can attach as a chip instead: a Linear
 * issue, a GitHub issue, a pull request, or a GitHub repository root.
 */
export type ComposerObjectLink =
  | { readonly kind: "linear-issue"; readonly url: string; readonly identifier: string }
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
  const segments = parsed.pathname.split("/").filter(Boolean);

  // https://linear.app/<workspace>/issue/<ENG-123>/<slug>
  if (parsed.hostname.toLowerCase() === "linear.app") {
    const identifier = segments[1] === "issue" ? segments[2] : undefined;
    return identifier !== undefined && LINEAR_ISSUE_IDENTIFIER.test(identifier)
      ? { kind: "linear-issue", url, identifier: identifier.toUpperCase() }
      : null;
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
