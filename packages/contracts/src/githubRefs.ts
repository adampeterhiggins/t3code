import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

/** Longest rendered release notes or commit message sent to a client or inlined into a prompt. */
export const GITHUB_REF_MARKDOWN_MAX_CHARS = 32_000;

const COMMIT_SHA = /^[0-9a-f]{7,40}$/i;
const ACTIONS_ID = /^\d{1,20}$/u;

/**
 * What a GitHub link to a point in a repository's history, or to a GitHub Actions run or job,
 * names. `tree` is a branch or a tag: the URL cannot tell them apart, so the server decides when
 * it reads it. A `tree` ref may hold slashes (`feature/x`), which also makes it indistinguishable
 * from a folder until it is read. A `run` or `job` ref is its numeric id.
 */
export interface GitHubRefLink {
  readonly repository: string;
  readonly linkType: "release" | "tree" | "commit" | "run" | "job";
  readonly ref: string;
}

/**
 * Splits a github.com release (`releases/tag/v1.2.0`), branch or tag (`tree/main`), commit
 * (`commit/<sha>`), Actions run (`actions/runs/<id>[/attempts/<n>]`), or Actions job
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
  "workflow-run",
  "workflow-job",
]);
export type GitHubRefType = typeof GitHubRefType.Type;

/**
 * A release, tag, branch, commit, or GitHub Actions run or job as read when it was linked, for
 * chips and hover cards.
 */
export const GitHubRefContext = Schema.Struct({
  /** `owner/repo`. */
  repository: Schema.String,
  refType: GitHubRefType,
  /** The tag or branch name, the full commit SHA, or the run or job id. */
  ref: Schema.String,
  /**
   * A release's name, the subject line of the commit the ref points at, a run's workflow and
   * number (`ci #12`), or a job's workflow and name (`ci / test`).
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
