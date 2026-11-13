import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

/** Longest rendered release notes or commit message sent to a client or inlined into a prompt. */
export const GITHUB_REF_MARKDOWN_MAX_CHARS = 32_000;

const COMMIT_SHA = /^[0-9a-f]{7,40}$/i;
const ACTIONS_ID = /^\d{1,20}$/u;

const LINE_ANCHOR = /^#L(\d{1,9})(?:C\d+)?(?:-L(\d{1,9})(?:C\d+)?)?$/u;

/** The lines a file link's `#L6` or `#L6-L9` anchor selects, first to last. */
export interface GitHubLineRange {
  readonly start: number;
  readonly end: number;
}

/**
 * A `tree` ref is a branch or tag (the server tells which) and may hold slashes, so it looks like
 * a folder until read. A `blob` ref is `<git ref>/<path>`, split once the server finds which
 * prefix is the ref. A `run` or `job` ref is its numeric id.
 */
export interface GitHubRefLink {
  readonly repository: string;
  readonly linkType: "release" | "tree" | "blob" | "commit" | "run" | "job";
  readonly ref: string;
  /** A `blob` link's line anchor. */
  readonly lines?: GitHubLineRange;
}

/** `6` for one line, `6-9` for several. */
export function formatGitHubLineRange(lines: GitHubLineRange): string {
  return lines.start === lines.end ? `${lines.start}` : `${lines.start}-${lines.end}`;
}

function parseLineAnchor(hash: string): GitHubLineRange | undefined {
  const match = LINE_ANCHOR.exec(hash);
  if (match === null) return undefined;
  const first = Number(match[1]);
  const last = match[2] === undefined ? first : Number(match[2]);
  return { start: Math.min(first, last), end: Math.max(first, last) };
}

/**
 * Splits a github.com release (`releases/tag/v1.2.0`), branch or tag (`tree/main`), file
 * (`blob/<ref>/<path>[#L6-L9]`), commit (`commit/<sha>`), Actions run (`actions/runs/<id>[/attempts/<n>]`), or Actions job
 * (`actions/runs/<id>/job/<id>`) link. Anything else, including GitHub Enterprise, returns null.
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
  if (section === "blob" && rest.length > 1) {
    const lines = parseLineAnchor(parsed.hash);
    return {
      repository,
      linkType: "blob",
      ref: rest.join("/"),
      ...(lines === undefined ? {} : { lines }),
    };
  }
  if (section === "commit" && rest.length === 1 && COMMIT_SHA.test(rest[0]!)) {
    return { repository, linkType: "commit", ref: rest[0]!.toLowerCase() };
  }
  if (section === "actions" && rest[0] === "runs" && ACTIONS_ID.test(rest[1] ?? "")) {
    const [, runId, sub, subId] = rest;
    if (rest.length === 2 || (rest.length === 4 && sub === "attempts" && ACTIONS_ID.test(subId!))) {
      return { repository, linkType: "run", ref: runId! };
    }
    if (rest.length === 4 && sub === "job" && ACTIONS_ID.test(subId!)) {
      return { repository, linkType: "job", ref: subId! };
    }
  }
  return null;
}

export const GitHubRefUrl = TrimmedNonEmptyString.check(
  Schema.isMaxLength(2_048),
  Schema.makeFilter((url) => parseGitHubRefUrl(url) !== null),
);

export const GitHubGetRefInput = Schema.Struct({ url: GitHubRefUrl });
export type GitHubGetRefInput = typeof GitHubGetRefInput.Type;

export const GitHubRefType = Schema.Literals([
  "release",
  "tag",
  "branch",
  "commit",
  "file",
  "workflow-run",
  "workflow-job",
]);
export type GitHubRefType = typeof GitHubRefType.Type;

/**
 * A release, tag, branch, commit, file, or GitHub Actions run or job as read when it was linked,
 * for chips and hover cards.
 */
export const GitHubRefContext = Schema.Struct({
  /** `owner/repo`. */
  repository: Schema.String,
  refType: GitHubRefType,
  /** The tag or branch name, the full commit SHA, the run or job id, or the ref a file was read at. */
  ref: Schema.String,
  /**
   * A release's name, the subject line of the commit the ref points at, a run's workflow and
   * number (`ci #12`), a job's workflow and name (`ci / test`), or a file's path and linked lines
   * (`src/a.ts:6-9`).
   */
  title: Schema.String,
  url: Schema.String,
  /** The commit the ref points at, or the one a run built. */
  sha: Schema.NullOr(Schema.String),
  authorLogin: Schema.NullOr(Schema.String),
  /** When the release was published, the commit was made, or the run or job started. */
  date: Schema.NullOr(Schema.String),
  isPrerelease: Schema.Boolean,
  markdown: Schema.String.check(Schema.isMaxLength(GITHUB_REF_MARKDOWN_MAX_CHARS)),
});
export type GitHubRefContext = typeof GitHubRefContext.Type;
