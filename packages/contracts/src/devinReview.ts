import * as Schema from "effect/Schema";
import { IsoDateTime, PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const DEVIN_REVIEW_MARKDOWN_MAX_CHARS = 64_000;

/**
 * How the environment calls Devin's API: the `devin` CLI's own login on this environment, or a
 * pasted service user key.
 */
export const DevinReviewAccount = Schema.Struct({
  method: Schema.Literals(["devin-login", "service-key"]),
  orgId: TrimmedNonEmptyString,
  /** The signed-in Devin user, for a Devin login. */
  userName: Schema.NullOr(Schema.String),
});
export type DevinReviewAccount = typeof DevinReviewAccount.Type;

/**
 * Devin's API can only start a review and report its status. Findings are read from the pull
 * request on GitHub, so they need no connection; `connected` adds status and Run review.
 */
export const DevinReviewConnectionState = Schema.Struct({
  phase: Schema.Literals(["disconnected", "waiting", "connected", "failed"]),
  account: Schema.NullOr(DevinReviewAccount),
  /** While waiting, the Devin sign-in page to open, once the CLI has printed it. */
  signInUrl: Schema.NullOr(Schema.String),
  message: Schema.NullOr(Schema.String),
});
export type DevinReviewConnectionState = typeof DevinReviewConnectionState.Type;

export const DevinReviewConnectInput = Schema.Struct({
  /** A `cog_…` service user key with ViewReview, plus UseReviewManual to start reviews. */
  apiKey: TrimmedNonEmptyString.check(Schema.isMaxLength(512)),
  orgId: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
});
export type DevinReviewConnectInput = typeof DevinReviewConnectInput.Type;

/**
 * Devin's review states, plus `none` when Devin has no review of the head commit and
 * `unknown` when the environment has no Devin connection to ask.
 */
export const DevinReviewStatus = Schema.Literals([
  "pending",
  "running",
  "completed",
  "errored",
  "cancelled",
  "skipped",
  "none",
  "unknown",
]);
export type DevinReviewStatus = typeof DevinReviewStatus.Type;

export const DevinReviewSeverity = Schema.Literals(["high", "medium", "low", "info"]);
export type DevinReviewSeverity = typeof DevinReviewSeverity.Type;

/** One inline comment Devin Review left on the pull request. */
export const DevinReviewFinding = Schema.Struct({
  id: Schema.String,
  /** Devin's own category, such as `bug` or `analysis`. */
  kind: Schema.String,
  severity: DevinReviewSeverity,
  title: Schema.String,
  /** The comment's markdown without Devin's metadata marker and title line. */
  body: Schema.String,
  path: Schema.NullOr(Schema.String),
  startLine: Schema.NullOr(Schema.Int),
  endLine: Schema.NullOr(Schema.Int),
  /** The comment on GitHub. */
  url: Schema.String,
  /** The comment's review thread was resolved on GitHub. */
  resolved: Schema.Boolean,
  /** The comment no longer maps onto the pull request's current diff. */
  outdated: Schema.Boolean,
  /**
   * The rest come from Devin's own review data, read with a Devin login; null without it.
   * Who the finding affects and how, in one sentence.
   */
  impactSummary: Schema.optional(Schema.NullOr(Schema.String)),
  /** Devin's suggested instructions for fixing the finding, written for a coding agent. */
  suggestedFixPrompt: Schema.optional(Schema.NullOr(Schema.String)),
  /** Devin's own state for the finding, which can differ from GitHub's thread. */
  devinState: Schema.optional(Schema.NullOr(Schema.Literals(["open", "dismissed", "resolved"]))),
  /** Why Devin considers it dismissed or resolved. */
  resolutionReason: Schema.optional(Schema.NullOr(Schema.String)),
});
export type DevinReviewFinding = typeof DevinReviewFinding.Type;

export const DevinReviewSummary = Schema.Struct({
  /** `owner/repo`. */
  repository: TrimmedNonEmptyString,
  number: PositiveInt,
  title: Schema.String,
  pullRequestUrl: Schema.String,
  /** Devin's page for the review, `https://app.devin.ai/review/<owner>/<repo>/pull/<n>`. */
  reviewUrl: Schema.String,
  status: DevinReviewStatus,
  /** The commit Devin's status refers to. */
  commitSha: Schema.NullOr(Schema.String),
  /** When Devin accepted the review Devin's status refers to. */
  statusAt: Schema.NullOr(IsoDateTime),
  /** Unresolved findings that still apply to the current diff. */
  openFindingCount: Schema.Int,
  findingCount: Schema.Int,
});
export type DevinReviewSummary = typeof DevinReviewSummary.Type;

/** One section of Devin's walkthrough of the change, such as its Overview. */
export const DevinReviewWalkthroughSection = Schema.Struct({
  title: Schema.String,
  /** Markdown. */
  text: Schema.String,
});
export type DevinReviewWalkthroughSection = typeof DevinReviewWalkthroughSection.Type;

/** One time Devin reviewed the pull request. */
export const DevinReviewRun = Schema.Struct({
  id: Schema.String,
  /** `full` reviews the whole change; `incremental` only what changed since the last run. */
  kind: Schema.Literals(["full", "incremental"]),
  status: Schema.String,
  commitSha: Schema.String,
  createdAt: IsoDateTime,
});
export type DevinReviewRun = typeof DevinReviewRun.Type;

export const DevinReviewContext = Schema.Struct({
  ...DevinReviewSummary.fields,
  findings: Schema.Array(DevinReviewFinding),
  /**
   * Devin's walkthrough of the change and its review runs, newest first. Read from Devin's own
   * (undocumented) review API with a Devin login; null when unavailable, which never fails a read.
   */
  walkthrough: Schema.optional(Schema.NullOr(Schema.Array(DevinReviewWalkthroughSection))),
  runs: Schema.optional(Schema.NullOr(Schema.Array(DevinReviewRun))),
  markdown: Schema.String.check(Schema.isMaxLength(DEVIN_REVIEW_MARKDOWN_MAX_CHARS)),
});
export type DevinReviewContext = typeof DevinReviewContext.Type;

/** A GitHub pull request URL or a Devin Review URL. */
export const DevinReviewGetInput = Schema.Struct({
  url: TrimmedNonEmptyString.check(Schema.isMaxLength(2048)),
});
export type DevinReviewGetInput = typeof DevinReviewGetInput.Type;

/** Open pull requests the connected GitHub account authored or was asked to review. */
export const DevinReviewListInput = Schema.Struct({
  involvement: Schema.optional(Schema.Literals(["authored", "reviewing", "all"])),
});
export type DevinReviewListInput = typeof DevinReviewListInput.Type;
export const DevinReviewListResult = Schema.Struct({
  reviews: Schema.Array(DevinReviewSummary),
});
export type DevinReviewListResult = typeof DevinReviewListResult.Type;

/** Devin's current answer for one pull request's review, without reading GitHub. */
export const DevinReviewStatusSnapshot = Schema.Struct({
  status: DevinReviewStatus,
  commitSha: Schema.NullOr(Schema.String),
  /** When Devin accepted the review this status refers to. */
  statusAt: Schema.NullOr(IsoDateTime),
});
export type DevinReviewStatusSnapshot = typeof DevinReviewStatusSnapshot.Type;

/** Status and finding counts for several pull requests at once, such as a thread's linked ones. */
export const DevinReviewSummariesInput = Schema.Struct({
  urls: Schema.Array(TrimmedNonEmptyString.check(Schema.isMaxLength(2048))).check(
    Schema.isMaxLength(20),
  ),
});
export type DevinReviewSummariesInput = typeof DevinReviewSummariesInput.Type;
export const DevinReviewSummariesResult = Schema.Struct({
  /** In input order; a pull request that cannot be read is left out. */
  reviews: Schema.Array(DevinReviewSummary),
});
export type DevinReviewSummariesResult = typeof DevinReviewSummariesResult.Type;

export class DevinReviewError extends Schema.TaggedError<DevinReviewError>()("DevinReviewError", {
  reason: Schema.Literals([
    "not-connected",
    "revoked",
    "forbidden",
    "rate-limited",
    "not-found",
    "invalid-url",
    "github",
    "api",
  ]),
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}

export interface DevinReviewPullRequestRef {
  /** `owner/repo`. */
  readonly repository: string;
  readonly number: number;
}

const DEVIN_REVIEW_PATH = /^\/review\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/u;
const GITHUB_PULL_PATH = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/[a-z]*)?\/?$/u;

/**
 * The pull request a Devin Review link (`https://app.devin.ai/review/<owner>/<repo>/pull/<n>`)
 * names. With `acceptGitHub`, a `github.com/<owner>/<repo>/pull/<n>` link is accepted too.
 */
export function parseDevinReviewUrl(
  value: string,
  options: { readonly acceptGitHub?: boolean } = {},
): DevinReviewPullRequestRef | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  const pattern =
    host === "app.devin.ai"
      ? DEVIN_REVIEW_PATH
      : options.acceptGitHub === true && host === "github.com"
        ? GITHUB_PULL_PATH
        : null;
  const match = pattern?.exec(url.pathname);
  const [owner, repo, number] = [match?.[1], match?.[2], Number(match?.[3])];
  if (owner === undefined || repo === undefined) return null;
  if (!Number.isSafeInteger(number) || number <= 0) return null;
  return { repository: `${owner}/${repo}`, number };
}

export function devinReviewUrl(ref: DevinReviewPullRequestRef): string {
  return `https://app.devin.ai/review/${ref.repository}/pull/${ref.number}`;
}

export function devinReviewPullRequestUrl(ref: DevinReviewPullRequestRef): string {
  return `https://github.com/${ref.repository}/pull/${ref.number}`;
}
