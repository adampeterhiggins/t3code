import {
  DevinReviewError,
  type DevinReviewFinding,
  type DevinReviewSeverity,
  type DevinReviewProgress,
  type DevinReviewProgressStep,
  type DevinReviewProgressStream,
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
const MAX_PROGRESS_STEPS = 40;
const MAX_STEP_DETAIL_CHARS = 200;

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

const NullableInt = Schema.optional(Schema.NullOr(Schema.Int));
const SuggestedEdit = Schema.optional(
  Schema.NullOr(Schema.Struct({ type: Schema.String, prompt: Text })),
);
const findingFields = {
  id: Schema.String,
  title: Text,
  file_path: Text,
  start_line: NullableInt,
  end_line: NullableInt,
  pr_comment_thread_id: Text,
  pr_comment_id: Schema.optional(Schema.NullOr(Schema.Union([Schema.String, Schema.Number]))),
  pr_comment_url: Text,
  dismissed_by_user: Flag,
  resolved_by_devin: Flag,
  resolution_reason: Text,
  impact_summary: Text,
};
const Bug = Schema.Struct({
  ...findingFields,
  severity: Text,
  description: Text,
  suggested_edit: SuggestedEdit,
});
const Analysis = Schema.Struct({ ...findingFields, analysis: Text });
const SecurityFinding = Schema.Struct({
  ...findingFields,
  severity: Text,
  category: Text,
  confidence: Text,
  cwe_id: Text,
  description: Text,
  reasoning: Text,
  recommendation: Text,
  suggested_edit: SuggestedEdit,
});

const JobResult = Schema.Struct({
  sections: Schema.optional(
    Schema.NullOr(Schema.Array(Schema.Struct({ title: Schema.String, text: Text }))),
  ),
  lifeguard_result: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        bugs: Schema.optional(Schema.NullOr(Schema.Array(Bug))),
        analyses: Schema.optional(Schema.NullOr(Schema.Array(Analysis))),
        security_findings: Schema.optional(Schema.NullOr(Schema.Array(SecurityFinding))),
      }),
    ),
  ),
});
type DevinReviewJobResult = typeof JobResult.Type;
const decodeJobResult = Schema.decodeUnknownEffect(JobResult);

/**
 * One finding as Devin's review data has it, with the GitHub comment Devin posted it as, if any.
 * Whether that comment's thread is resolved or outdated is only known to GitHub.
 */
export interface DevinFinding extends Omit<
  DevinReviewFinding,
  "url" | "resolved" | "outdated" | "source" | "threadId"
> {
  readonly threadId: string | null;
  readonly commentId: string | null;
  readonly commentUrl: string | null;
}

/** The few kilobytes of a job result worth keeping; the rest is file contents and diffs. */
interface StrippedJobResult {
  readonly walkthrough: ReadonlyArray<DevinReviewWalkthroughSection>;
  readonly findings: ReadonlyArray<DevinFinding>;
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

/** Matches the emoji Devin puts on the GitHub comment: 🔴 severe, 🟡 non-severe, 🔍 analysis. */
function severityOf(value: string | null | undefined): DevinReviewSeverity {
  switch (value?.toLowerCase()) {
    case "severe":
    case "critical":
    case "high":
    case "error":
      return "high";
    case "low":
      return "low";
    case "info":
      return "info";
    default:
      return "medium";
  }
}

function devinFinding(
  finding: typeof Analysis.Type,
  fields: Pick<DevinFinding, "kind" | "severity" | "body" | "suggestedFixPrompt">,
): DevinFinding {
  const endLine = finding.end_line ?? finding.start_line ?? null;
  return {
    id: finding.id,
    ...fields,
    title: finding.title?.trim() || "Devin Review finding",
    path: finding.file_path ?? null,
    startLine: finding.start_line ?? endLine,
    endLine,
    threadId: finding.pr_comment_thread_id ?? null,
    commentId:
      finding.pr_comment_id == null
        ? commentIdFromUrl(finding.pr_comment_url)
        : String(finding.pr_comment_id),
    commentUrl: finding.pr_comment_url ?? null,
    impactSummary: finding.impact_summary ?? null,
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

const promptOf = (edit: typeof Bug.Type.suggested_edit) =>
  edit?.type === "prompt" ? (edit.prompt ?? null) : null;

function securityBody(finding: typeof SecurityFinding.Type): string {
  const facts = [
    finding.category,
    finding.cwe_id,
    finding.confidence ? `${finding.confidence} confidence` : null,
  ].filter((fact) => fact != null && fact !== "");
  return [
    facts.length === 0 ? null : `**Security:** ${facts.join(" · ")}`,
    finding.description,
    finding.reasoning ? `**Reasoning:** ${finding.reasoning}` : null,
    finding.recommendation ? `**Recommendation:** ${finding.recommendation}` : null,
  ]
    .filter((part) => part != null && part.trim() !== "")
    .join("\n\n");
}

export function stripJobResult(result: DevinReviewJobResult): StrippedJobResult {
  const walkthrough = (result.sections ?? []).slice(0, MAX_SECTIONS).map((section) => ({
    title: section.title,
    text: capText(section.text ?? "", MAX_SECTION_CHARS),
  }));
  const lifeguard = result.lifeguard_result;
  const findings = [
    ...(lifeguard?.bugs ?? []).map((bug) =>
      devinFinding(bug, {
        kind: "bug",
        severity: severityOf(bug.severity),
        body: bug.description ?? "",
        suggestedFixPrompt: promptOf(bug.suggested_edit),
      }),
    ),
    ...(lifeguard?.analyses ?? []).map((analysis) =>
      devinFinding(analysis, {
        kind: "analysis",
        severity: "info",
        body: analysis.analysis ?? "",
        suggestedFixPrompt: null,
      }),
    ),
    ...(lifeguard?.security_findings ?? []).map((security) =>
      devinFinding(security, {
        kind: "security",
        severity: severityOf(security.severity),
        body: securityBody(security),
        suggestedFixPrompt: promptOf(security.suggested_edit),
      }),
    ),
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

/** Each finding once, as the latest result has it. Pass results oldest first. */
export function latestFindings(
  results: ReadonlyArray<StrippedJobResult>,
): ReadonlyArray<DevinFinding> {
  const byId = new Map<string, DevinFinding>();
  for (const result of results)
    for (const finding of result.findings) byId.set(finding.id, finding);
  return [...byId.values()];
}

/** A Devin Review thread on the pull request, as GitHub reports it. */
export interface GitHubReviewThread {
  /** The thread's node id. */
  readonly id: string | null;
  /** The finding parsed from the thread's first comment, carrying GitHub's thread state. */
  readonly finding: DevinReviewFinding;
}

export const githubFinding = (thread: GitHubReviewThread): DevinReviewFinding => ({
  ...thread.finding,
  source: "github",
  threadId: thread.id,
});

/**
 * Devin's findings, each with the state of the GitHub thread Devin posted it as. Devin's own
 * record of a thread lags GitHub's, so GitHub's resolved and outdated flags win. A finding Devin
 * did not post links to its review page instead. A Devin thread Devin's data does not list is
 * kept as GitHub reads it, so no finding is lost.
 */
export function combineFindings(
  devin: ReadonlyArray<DevinFinding>,
  threads: ReadonlyArray<GitHubReviewThread>,
  reviewUrl: string,
): ReadonlyArray<DevinReviewFinding> {
  const byKey = new Map<string, GitHubReviewThread>();
  for (const thread of threads) {
    byKey.set(thread.finding.id, thread);
    const commentId = commentIdFromUrl(thread.finding.url);
    if (commentId !== null) byKey.set(`comment:${commentId}`, thread);
    if (thread.id !== null) byKey.set(`thread:${thread.id}`, thread);
  }
  const matched = new Set<GitHubReviewThread>();
  const findings = devin.map(({ threadId, commentId, commentUrl, ...finding }) => {
    const thread =
      (threadId === null ? undefined : byKey.get(`thread:${threadId}`)) ??
      (commentId === null ? undefined : byKey.get(`comment:${commentId}`)) ??
      byKey.get(finding.id);
    if (thread !== undefined) {
      matched.add(thread);
      return {
        ...finding,
        url: thread.finding.url,
        resolved: thread.finding.resolved,
        outdated: thread.finding.outdated,
        source: "github",
        threadId: thread.id ?? threadId,
      } satisfies DevinReviewFinding;
    }
    // Posted, but GitHub did not return the thread (it reads the first 100): Devin's state stands in.
    if (threadId !== null || commentId !== null || commentUrl !== null) {
      return {
        ...finding,
        url: commentUrl ?? reviewUrl,
        resolved: finding.devinState !== "open",
        outdated: false,
        source: "github",
        threadId,
      } satisfies DevinReviewFinding;
    }
    return {
      ...finding,
      url: reviewUrl,
      resolved: false,
      outdated: false,
      source: "devin",
      threadId: null,
    } satisfies DevinReviewFinding;
  });
  return [...findings, ...threads.filter((thread) => !matched.has(thread)).map(githubFinding)];
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

const ToolCall = Schema.Struct({
  name: Schema.String,
  args: Schema.optional(Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown))),
});
const Iteration = Schema.Struct({
  tool_calls: Schema.optional(Schema.NullOr(Schema.Array(ToolCall))),
});
const ProgressStream = Schema.Struct({
  status: Schema.optional(Schema.NullOr(Schema.String)),
  awaiting_model: Flag,
  iterations: Schema.optional(Schema.NullOr(Schema.Array(Iteration))),
});
const LifeguardProgress = Schema.Struct({
  ...ProgressStream.fields,
  streams: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        bug_check: Schema.optional(Schema.NullOr(ProgressStream)),
        security: Schema.optional(Schema.NullOr(ProgressStream)),
        code_quality: Schema.optional(Schema.NullOr(ProgressStream)),
      }),
    ),
  ),
});
type LifeguardProgress = typeof LifeguardProgress.Type;
const decodeProgress = Schema.decodeUnknownEffect(LifeguardProgress);

/** The reviewer works in a clone under `/home/ubuntu/repos/<repo>/`; show paths inside it. */
const REPO_PREFIX = /^\/home\/ubuntu\/repos\/[^/]+\//u;
const CD_PREFIX = /^cd\s+(?:\/tmp\/|\/home\/ubuntu\/repos\/)\S+\s+&&\s+/u;

const stringArg = (args: Readonly<Record<string, unknown>>, ...keys: ReadonlyArray<string>) => {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return null;
};
const shortDetail = (text: string | null) =>
  text === null
    ? null
    : capText(text.replace(REPO_PREFIX, "").split("\n")[0]!.trim(), MAX_STEP_DETAIL_CHARS);

function progressStep(call: typeof ToolCall.Type): DevinReviewProgressStep {
  const args = call.args ?? {};
  switch (call.name) {
    case "Read":
      return { tool: call.name, detail: shortDetail(stringArg(args, "file_path", "path")) };
    case "bash": {
      const command = stringArg(args, "command");
      return { tool: call.name, detail: shortDetail(command?.replace(CD_PREFIX, "") ?? null) };
    }
    case "grep":
    case "glob":
      return { tool: call.name, detail: shortDetail(stringArg(args, "pattern")) };
    case "special_files":
      return {
        tool: call.name,
        detail: null,
        count: Array.isArray(args.files) ? args.files.length : 0,
      };
    default:
      return { tool: call.name, detail: null };
  }
}

function progressStream(
  kind: DevinReviewProgressStream["kind"],
  stream: typeof ProgressStream.Type,
  keep: (call: typeof ToolCall.Type) => boolean = () => true,
): DevinReviewProgressStream {
  const steps = (stream.iterations ?? []).flatMap((iteration): DevinReviewProgressStep[] => {
    const calls = iteration.tool_calls ?? [];
    if (calls.length === 0) return [{ tool: "finalizing", detail: null }];
    return calls.filter(keep).map(progressStep);
  });
  const omittedSteps = Math.max(0, steps.length - MAX_PROGRESS_STEPS);
  return {
    kind,
    status: stream.status ?? "running",
    awaitingModel: stream.awaiting_model === true,
    steps: steps.slice(omittedSteps),
    omittedSteps,
  };
}

/**
 * Devin's progress keeps every tool call's full arguments, including the findings it reports;
 * keep one short line per call. In parallel mode the top level only clones and reads rules files,
 * as Devin's own page shows it.
 */
export function stripProgress(jobId: string, progress: LifeguardProgress): DevinReviewProgress {
  const parallel = progress.streams ?? {};
  const streams = [
    ["bug_check", parallel.bug_check],
    ["security", parallel.security],
    ["code_quality", parallel.code_quality],
  ] as const;
  const running = streams.flatMap(([kind, stream]) =>
    stream == null ? [] : [progressStream(kind, stream)],
  );
  const setup = progressStream(
    "review",
    progress,
    running.length === 0
      ? undefined
      : (call) => call.name === "clone" || call.name === "special_files",
  );
  return {
    jobId,
    status: progress.status ?? "running",
    streams: running.length === 0 || setup.steps.length > 0 ? [setup, ...running] : running,
  };
}

/** The newest review Devin has queued or is running. */
export const runningJob = (jobs: ReadonlyArray<DevinReviewJob>) =>
  newestFirst(jobs).find((job) => job.status === "pending" || job.status === "running") ?? null;

export const fetchJobProgress = (token: string, ref: DevinReviewPullRequestRef, jobId: string) =>
  getJson(token, `/pr-review/lifeguard-progress/${encodeURIComponent(jobId)}`, ref).pipe(
    Effect.flatMap(decodeProgress),
    Effect.map((progress) => stripProgress(jobId, progress)),
    Effect.mapError((error) => (error._tag === "DevinReviewError" ? error : shapeError())),
  );
