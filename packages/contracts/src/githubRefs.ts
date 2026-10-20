import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

/** Longest rendered release notes or commit message sent to a client or inlined into a prompt. */
export const GITHUB_REF_MARKDOWN_MAX_CHARS = 32_000;

const COMMIT_SHA = /^[0-9a-f]{7,40}$/i;

/**
 * What a GitHub link to a point in a repository's history names. `tree` is a branch or a tag:
 * the URL cannot tell them apart, so the server decides when it reads it. A `tree` ref may hold
 * slashes (`feature/x`), which also makes it indistinguishable from a folder until it is read.
 */
export interface GitHubRefLink {
  readonly repository: string;
  readonly linkType: "release" | "tree" | "commit";
  readonly ref: string;
}

/**
 * Splits a github.com release (`/owner/repo/releases/tag/v1.2.0`), branch or tag
 * (`/owner/repo/tree/main`), or commit (`/owner/repo/commit/<sha>`) link into its parts. Anything
 * else, including GitHub Enterprise hosts, returns null.
 */
export function parseGitHubRefUrl(url: string): GitHubRefLink | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "github.com") return null;
  let segments: string[];
  try {
    segments = parsed.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return null;
  }
  const [owner, name, section, ...rest] = segments;
  if (!owner || !name || !section) return null;
  const repository = `${owner}/${name}`;
  if (section === "releases" && rest[0] === "tag" && rest.length > 1) {
    return { repository, linkType: "release", ref: rest.slice(1).join("/") };
  }
  if (section === "tree" && rest.length > 0) {
    return { repository, linkType: "tree", ref: rest.join("/") };
  }
  if (section === "commit" && rest.length === 1 && COMMIT_SHA.test(rest[0]!)) {
    return { repository, linkType: "commit", ref: rest[0]!.toLowerCase() };
  }
  return null;
}

export const GitHubRefUrl = TrimmedNonEmptyString.check(
  Schema.isMaxLength(2_048),
  Schema.makeFilter((url) => parseGitHubRefUrl(url) !== null),
);

export const GitHubGetRefInput = Schema.Struct({ url: GitHubRefUrl });
export type GitHubGetRefInput = typeof GitHubGetRefInput.Type;

export const GitHubRefType = Schema.Literals(["release", "tag", "branch", "commit"]);
export type GitHubRefType = typeof GitHubRefType.Type;

/** A release, tag, branch, or commit as read when it was linked, for chips and hover cards. */
export const GitHubRefContext = Schema.Struct({
  /** `owner/repo`. */
  repository: Schema.String,
  refType: GitHubRefType,
  /** The tag or branch name, or the full commit SHA. */
  ref: Schema.String,
  /** A release's name, or the subject line of the commit the ref points at. */
  title: Schema.String,
  url: Schema.String,
  /** The commit the ref points at. */
  sha: Schema.NullOr(Schema.String),
  authorLogin: Schema.NullOr(Schema.String),
  /** When the release was published, or when the commit was made. */
  date: Schema.NullOr(Schema.String),
  isPrerelease: Schema.Boolean,
  markdown: Schema.String.check(Schema.isMaxLength(GITHUB_REF_MARKDOWN_MAX_CHARS)),
});
export type GitHubRefContext = typeof GitHubRefContext.Type;
