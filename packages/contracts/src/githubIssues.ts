import * as Schema from "effect/Schema";

import { IsoDateTime, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

/** Longest rendered issue body sent to a client or inlined into a prompt. */
export const GITHUB_ISSUE_MARKDOWN_MAX_CHARS = 32_000;

const ISSUE_URL_PATTERN =
  /^https:\/\/([^/\s]+)\/([^/\s]+)\/([^/\s]+)\/issues\/(\d+)\/?(?:[?#].*)?$/;

/**
 * Splits a GitHub issue URL (`https://github.com/owner/repo/issues/12`, or the same path on a
 * GitHub Enterprise host) into its parts. Pull request URLs and anything else return null.
 */
export function parseGitHubIssueUrl(
  url: string,
): { host: string; repository: string; number: number } | null {
  const match = ISSUE_URL_PATTERN.exec(url.trim());
  if (!match) return null;
  const number = Number(match[4]);
  if (!Number.isSafeInteger(number) || number <= 0) return null;
  return { host: match[1]!.toLowerCase(), repository: `${match[2]}/${match[3]}`, number };
}

/** An `https://<host>/<owner>/<repo>/issues/<n>` link, the identity every issue RPC takes. */
export const GitHubIssueUrl = TrimmedNonEmptyString.check(
  Schema.isMaxLength(2_048),
  Schema.makeFilter((url) => parseGitHubIssueUrl(url) !== null),
);

export const GitHubIssueSummary = Schema.Struct({
  /** `owner/repo`. */
  repository: Schema.String,
  number: Schema.Int,
  title: Schema.String,
  url: Schema.String,
  state: Schema.Literals(["open", "closed"]),
  /** Why a closed issue closed: `completed`, `not planned`, or `duplicate`. */
  stateReason: Schema.NullOr(Schema.String),
  authorLogin: Schema.NullOr(Schema.String),
  assigneeLogins: Schema.Array(Schema.String),
  labels: Schema.Array(Schema.Struct({ name: Schema.String, color: Schema.String })),
  updatedAt: IsoDateTime,
});
export type GitHubIssueSummary = typeof GitHubIssueSummary.Type;

export const GitHubIssueStateFilter = Schema.Literals(["open", "closed", "all"]);
export type GitHubIssueStateFilter = typeof GitHubIssueStateFilter.Type;

/**
 * `githubIssues.list` payload. Issues come from the repository `cwd` is checked out from. A
 * number (`123`, `#123`) or issue URL is looked up directly; other text runs GitHub's issue
 * search. Without text, the most recently updated issues in `state` are listed.
 */
export const GitHubListIssuesInput = Schema.Struct({
  cwd: TrimmedNonEmptyString.check(Schema.isMaxLength(4_096)),
  query: Schema.optional(Schema.String.check(Schema.isMaxLength(256))),
  state: Schema.optional(GitHubIssueStateFilter),
});
export type GitHubListIssuesInput = typeof GitHubListIssuesInput.Type;

export const GitHubListIssuesResult = Schema.Struct({
  issues: Schema.Array(GitHubIssueSummary),
});
export type GitHubListIssuesResult = typeof GitHubListIssuesResult.Type;

export const GitHubGetIssueInput = Schema.Struct({ url: GitHubIssueUrl });
export type GitHubGetIssueInput = typeof GitHubGetIssueInput.Type;

/** An issue snapshot: summary fields plus a server-rendered markdown body and comments. */
export const GitHubIssueContext = Schema.Struct({
  ...GitHubIssueSummary.fields,
  markdown: Schema.String.check(Schema.isMaxLength(GITHUB_ISSUE_MARKDOWN_MAX_CHARS)),
});
export type GitHubIssueContext = typeof GitHubIssueContext.Type;

/**
 * A GitHub issue linked to a thread and its chat tabs, the same way a Linear issue is. `groupId`
 * is the tab group's id (the thread itself when it has no tabs). The repository, number, title,
 * and url are copied when linked; clients read the issue's state live.
 */
export const GitHubIssueThreadLink = Schema.Struct({
  groupId: ThreadId,
  threadIds: Schema.Array(ThreadId),
  repository: Schema.String,
  number: Schema.Int,
  title: Schema.String,
  url: Schema.String,
  linkedAt: IsoDateTime,
});
export type GitHubIssueThreadLink = typeof GitHubIssueThreadLink.Type;

export const GitHubIssueThreadLinks = Schema.Array(GitHubIssueThreadLink);
export type GitHubIssueThreadLinks = typeof GitHubIssueThreadLinks.Type;

/** Links the thread's tab group to an issue, replacing any GitHub issue it was linked to. */
export const GitHubLinkThreadInput = Schema.Struct({ threadId: ThreadId, url: GitHubIssueUrl });
export type GitHubLinkThreadInput = typeof GitHubLinkThreadInput.Type;

export const GitHubUnlinkThreadInput = Schema.Struct({ threadId: ThreadId });
export type GitHubUnlinkThreadInput = typeof GitHubUnlinkThreadInput.Type;

export const GitHubIssueErrorReason = Schema.Literals([
  "unavailable",
  "not-authenticated",
  "rate-limited",
  "not-found",
  "api",
]);
export type GitHubIssueErrorReason = typeof GitHubIssueErrorReason.Type;

export class GitHubIssueError extends Schema.TaggedError<GitHubIssueError>()("GitHubIssueError", {
  reason: GitHubIssueErrorReason,
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return this.detail;
  }
}
