import {
  DevinReviewError,
  type DevinReviewFinding,
  type DevinReviewPullRequestRef,
  type DevinReviewRun,
  type DevinReviewWalkthroughSection,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";

/**
 * Devin's web app reads review jobs from this undocumented API. It accepts the `devin` CLI's
 * login token but was never seen to accept a service key, and may change without notice, so
 * everything read here is optional enrichment of what GitHub already says.
 */
const DEVIN_APP_API_URL = "https://api.devin.ai";
const MAX_INCREMENTAL_RESULTS = 5;
const MAX_RUNS = 50;
const MAX_SECTIONS = 30;
const MAX_SECTION_CHARS = 8_000;

const Text = Schema.optional(Schema.NullOr(Schema.String));
const Flag = Schema.optional(Schema.NullOr(Schema.Boolean));

const ReviewJob = Schema.Struct({
  job_id: Schema.String,
  status: Schema.String,
  commit_sha: Schema.String,
  job_type: Schema.String,
  created_at: Schema.String,
  versions: Schema.optional(
    Schema.NullOr(
      Schema.Array(
        Schema.Struct({
          id: Schema.String,
          created_at: Schema.String,
          metadata: Schema.optional(Schema.NullOr(Schema.Struct({ is_finished: Flag }))),
        }),
      ),
    ),
  ),
});
export type DevinReviewJob = typeof ReviewJob.Type;
const decodeJobs = Schema.decodeUnknownEffect(Schema.Struct({ jobs: Schema.Array(ReviewJob) }));

const findingFields = {
  id: Schema.String,
  pr_comment_id: Schema.optional(Schema.NullOr(Schema.Union([Schema.String, Schema.Number]))),
  pr_comment_url: Text,
  dismissed_by_user: Flag,
  resolved_by_devin: Flag,
  resolution_reason: Text,
  impact_summary: Text,
};
const Bug = Schema.Struct({
  ...findingFields,
  suggested_edit: Schema.optional(
    Schema.NullOr(Schema.Struct({ type: Schema.String, prompt: Text })),
  ),
});
const Analysis = Schema.Struct(findingFields);

const JobResult = Schema.Struct({
  sections: Schema.optional(
    Schema.NullOr(Schema.Array(Schema.Struct({ title: Schema.String, text: Text }))),
  ),
  lifeguard_result: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        bugs: Schema.optional(Schema.NullOr(Schema.Array(Bug))),
        analyses: Schema.optional(Schema.NullOr(Schema.Array(Analysis))),
      }),
    ),
  ),
});
type DevinReviewJobResult = typeof JobResult.Type;
const decodeJobResult = Schema.decodeUnknownEffect(JobResult);

/** What Devin knows about one finding beyond its GitHub comment. */
interface DevinFindingDetail {
  /** Devin's finding id and the GitHub comment id, either of which identifies the comment. */
  readonly keys: ReadonlyArray<string>;
  readonly impactSummary: string | null;
  readonly suggestedFixPrompt: string | null;
  readonly devinState: "open" | "dismissed" | "resolved";
  readonly resolutionReason: string | null;
}

/** The few kilobytes of a job result worth keeping; the rest is file contents and diffs. */
interface StrippedJobResult {
  readonly walkthrough: ReadonlyArray<DevinReviewWalkthroughSection>;
  readonly findings: ReadonlyArray<DevinFindingDetail>;
}

export interface JobVersionRef {
  readonly jobId: string;
  readonly versionId: string;
}

const COMMENT_ID = /#discussion_r(\d+)$/u;
const commentIdFromUrl = (url: string | null | undefined) =>
  url == null ? null : (COMMENT_ID.exec(url)?.[1] ?? null);

const capText = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

function findingDetail(
  finding: typeof Analysis.Type,
  suggestedFixPrompt: string | null | undefined,
): DevinFindingDetail {
  const commentId =
    finding.pr_comment_id == null
      ? commentIdFromUrl(finding.pr_comment_url)
      : String(finding.pr_comment_id);
  return {
    keys: commentId === null ? [finding.id] : [finding.id, commentId],
    impactSummary: finding.impact_summary ?? null,
    suggestedFixPrompt: suggestedFixPrompt ?? null,
    // A reviewer dismissing a finding on GitHub also marks it resolved by Devin; the dismissal is
    // the more specific fact, so it wins.
    devinState: finding.dismissed_by_user
      ? "dismissed"
      : finding.resolved_by_devin
        ? "resolved"
        : "open",
    resolutionReason: finding.resolution_reason ?? null,
  };
}

export function stripJobResult(result: DevinReviewJobResult): StrippedJobResult {
  const walkthrough = (result.sections ?? []).slice(0, MAX_SECTIONS).map((section) => ({
    title: section.title,
    text: capText(section.text ?? "", MAX_SECTION_CHARS),
  }));
  const lifeguard = result.lifeguard_result;
  const findings = [
    ...(lifeguard?.bugs ?? []).map((bug) =>
      findingDetail(bug, bug.suggested_edit?.type === "prompt" ? bug.suggested_edit.prompt : null),
    ),
    ...(lifeguard?.analyses ?? []).map((analysis) => findingDetail(analysis, null)),
  ];
  return { walkthrough, findings };
}

const newestFirst = (jobs: ReadonlyArray<DevinReviewJob>) =>
  jobs.toSorted((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));

const finishedVersion = (job: DevinReviewJob): JobVersionRef | null => {
  if (job.status !== "completed") return null;
  const version = (job.versions ?? [])
    .filter((candidate) => candidate.metadata?.is_finished === true)
    .toSorted((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  return version === undefined ? null : { jobId: job.job_id, versionId: version.id };
};

/**
 * The results to read: the latest finished full review, whose findings already include every
 * earlier review's, then the finished incremental reviews since it, oldest first.
 */
export function selectJobResults(jobs: ReadonlyArray<DevinReviewJob>): {
  readonly full: JobVersionRef | null;
  readonly incremental: ReadonlyArray<JobVersionRef>;
} {
  const sorted = newestFirst(jobs);
  const fullIndex = sorted.findIndex(
    (job) => job.job_type === "pr_review" && finishedVersion(job) !== null,
  );
  const full = fullIndex === -1 ? null : finishedVersion(sorted[fullIndex]!);
  const incremental = (fullIndex === -1 ? sorted : sorted.slice(0, fullIndex))
    .filter((job) => job.job_type === "diff_only")
    .flatMap((job) => finishedVersion(job) ?? [])
    .slice(0, MAX_INCREMENTAL_RESULTS)
    .toReversed();
  return { full, incremental };
}

const RUN_KIND: Record<string, DevinReviewRun["kind"]> = {
  pr_review: "full",
  diff_only: "incremental",
};

export function reviewRuns(jobs: ReadonlyArray<DevinReviewJob>): ReadonlyArray<DevinReviewRun> {
  return newestFirst(jobs)
    .flatMap((job) => {
      const kind = RUN_KIND[job.job_type];
      if (kind === undefined) return [];
      return [
        {
          id: job.job_id,
          kind,
          status: job.status,
          commitSha: job.commit_sha,
          createdAt: job.created_at,
        },
      ];
    })
    .slice(0, MAX_RUNS);
}

/**
 * Adds Devin's own data to the findings read from GitHub, matched by Devin's finding id or the
 * GitHub comment id. Later details win, so pass results oldest first.
 */
export function mergeFindingDetails(
  findings: ReadonlyArray<DevinReviewFinding>,
  details: ReadonlyArray<DevinFindingDetail>,
): ReadonlyArray<DevinReviewFinding> {
  const byKey = new Map<string, DevinFindingDetail>();
  for (const detail of details) for (const key of detail.keys) byKey.set(key, detail);
  return findings.map((finding) => {
    const commentId = commentIdFromUrl(finding.url);
    const detail = byKey.get(finding.id) ?? (commentId === null ? undefined : byKey.get(commentId));
    if (detail === undefined) return finding;
    return {
      ...finding,
      impactSummary: detail.impactSummary,
      suggestedFixPrompt: detail.suggestedFixPrompt,
      devinState: detail.devinState,
      resolutionReason: detail.resolutionReason,
    };
  });
}

const prPath = (ref: DevinReviewPullRequestRef) =>
  `github.com/${ref.repository}/pull/${ref.number}`;

const getJson = Effect.fn("devin_review.app_api")(function* (
  token: string,
  path: string,
  ref: DevinReviewPullRequestRef,
) {
  const httpClient = yield* HttpClient.HttpClient;
  const failure = (detail: string) => new DevinReviewError({ reason: "api", detail });
  // Fetch negotiates and decodes gzip itself.
  const response = yield* HttpClientRequest.get(`${DEVIN_APP_API_URL}${path}`).pipe(
    HttpClientRequest.setUrlParams({ pr_path: prPath(ref) }),
    HttpClientRequest.setHeader("authorization", `Bearer ${token}`),
    HttpClientRequest.acceptJson,
    httpClient.execute,
    Effect.mapError(() => failure("Could not reach Devin's review API.")),
  );
  if (response.status < 200 || response.status >= 300) {
    return yield* failure(`Devin's review API returned HTTP ${response.status}.`);
  }
  return yield* response.json.pipe(
    Effect.mapError(() => failure("Devin's review API returned invalid JSON.")),
  );
});

const shapeError = () =>
  new DevinReviewError({ reason: "api", detail: "Devin's review API changed shape." });

export const fetchReviewJobs = (token: string, ref: DevinReviewPullRequestRef) =>
  getJson(token, "/pr-review/jobs", ref).pipe(
    Effect.flatMap(decodeJobs),
    Effect.map((response) => response.jobs),
    Effect.mapError((error) => (error._tag === "DevinReviewError" ? error : shapeError())),
  );

export const fetchJobResult = (
  token: string,
  ref: DevinReviewPullRequestRef,
  version: JobVersionRef,
) =>
  getJson(
    token,
    `/pr-review/job-result/${encodeURIComponent(version.jobId)}/${encodeURIComponent(version.versionId)}`,
    ref,
  ).pipe(
    Effect.flatMap(decodeJobResult),
    Effect.map(stripJobResult),
    Effect.mapError((error) => (error._tag === "DevinReviewError" ? error : shapeError())),
  );
