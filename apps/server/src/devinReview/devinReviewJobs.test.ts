import { assert, describe, it } from "@effect/vitest";
import {
  type DevinReviewJob,
  type GitHubReviewThread,
  combineFindings,
  latestFindings,
  reviewRuns,
  runningJob,
  selectJobResults,
  stripJobResult,
  stripProgress,
} from "./devinReviewJobs.ts";

const job = (
  id: string,
  type: string,
  createdAt: string,
  options: { readonly status?: string; readonly finished?: boolean } = {},
): DevinReviewJob => ({
  job_id: id,
  status: options.status ?? "completed",
  commit_sha: `sha-${id}`,
  job_type: type,
  created_at: createdAt,
  versions: [
    { id: `${id}-v1`, created_at: createdAt, metadata: { is_finished: false } },
    { id: `${id}-v2`, created_at: createdAt, metadata: { is_finished: options.finished ?? true } },
  ],
});

describe("selectJobResults", () => {
  it("reads the latest finished full review, then the incremental ones since it, oldest first", () => {
    const jobs = [
      job("inc-old", "diff_only", "2026-11-01T09:00:00Z"),
      job("full-old", "pr_review", "2026-11-01T10:00:00Z"),
      job("full", "pr_review", "2026-11-02T10:00:00Z"),
      job("inc-1", "diff_only", "2026-11-02T11:00:00Z"),
      job("cancelled", "pr_review", "2026-11-02T11:30:00Z", { status: "cancelled" }),
      job("inc-2", "diff_only", "2026-11-02T12:00:00Z"),
      job("running", "pr_review", "2026-11-02T13:00:00Z", { status: "running", finished: false }),
    ];
    assert.deepStrictEqual(selectJobResults(jobs), {
      full: { jobId: "full", versionId: "full-v2" },
      incremental: [
        { jobId: "inc-1", versionId: "inc-1-v2" },
        { jobId: "inc-2", versionId: "inc-2-v2" },
      ],
    });
    assert.deepStrictEqual(selectJobResults([]), { full: null, incremental: [] });
    assert.strictEqual(runningJob(jobs)?.job_id, "running");
    assert.strictEqual(runningJob(jobs.slice(0, -1)), null);
  });

  it("lists runs newest first, naming Devin's job types", () => {
    const runs = reviewRuns([
      job("full", "pr_review", "2026-11-02T10:00:00Z"),
      job("inc", "diff_only", "2026-11-02T11:00:00Z", { status: "cancelled" }),
      job("other", "something_new", "2026-11-02T12:00:00Z"),
    ]);
    assert.deepStrictEqual(runs, [
      {
        id: "inc",
        kind: "incremental",
        status: "cancelled",
        commitSha: "sha-inc",
        createdAt: "2026-11-02T11:00:00Z",
      },
      {
        id: "full",
        kind: "full",
        status: "completed",
        commitSha: "sha-full",
        createdAt: "2026-11-02T10:00:00Z",
      },
    ]);
  });
});

describe("stripJobResult, latestFindings and combineFindings", () => {
  const REVIEW_URL = "https://app.devin.ai/review/acme/app/pull/7";
  const commentUrl = (commentId: string) =>
    `https://github.com/acme/app/pull/7#discussion_r${commentId}`;
  const thread = (
    id: string | null,
    findingId: string,
    commentId: string,
    state: { readonly resolved?: boolean; readonly outdated?: boolean } = {},
  ): GitHubReviewThread => ({
    id,
    finding: {
      id: findingId,
      kind: "bug",
      severity: "high",
      title: `GitHub's ${findingId}`,
      body: "From GitHub.",
      path: "src/a.ts",
      startLine: 1,
      endLine: 1,
      url: commentUrl(commentId),
      resolved: state.resolved ?? false,
      outdated: state.outdated ?? false,
    },
  });

  const stripped = stripJobResult({
    sections: [
      { title: "Overview", text: "Adds uploads." },
      { title: "1. Retry", text: null },
    ],
    lifeguard_result: {
      bugs: [
        {
          id: "BUG_1",
          title: "Retries never back off",
          severity: "severe",
          description: "`retry()` resets its delay.",
          file_path: "src/upload.ts",
          start_line: 68,
          end_line: 74,
          pr_comment_thread_id: "PRRT_1",
          pr_comment_id: "101",
          impact_summary: "Uploads stall.",
          suggested_edit: { type: "prompt", prompt: "Back off between retries." },
          // A dismissal on GitHub sets both flags.
          dismissed_by_user: true,
          resolved_by_devin: true,
          resolution_reason: "Dismissed by a reviewer on the code host",
        },
        {
          id: "BUG_2",
          severity: "non-severe",
          pr_comment_url: commentUrl("102"),
          suggested_edit: { type: "diff" },
          resolved_by_devin: true,
          resolution_reason: "Fixed in abc",
        },
      ],
      analyses: [{ id: "ANALYSIS_1", title: "Docs drift", analysis: "Stale.", pr_comment_id: 103 }],
      security_findings: [
        {
          id: "SEC_1",
          title: "Credentials in output",
          severity: "warning",
          category: "Secrets Exposure",
          confidence: "high",
          cwe_id: "CWE-200",
          description: "Prints the connector's password.",
          recommendation: "Print only the status.",
          suggested_edit: { type: "prompt", prompt: "Discard the response body." },
          file_path: "README.md",
          start_line: 28,
          end_line: 28,
        },
      ],
    },
  });

  it("keeps the walkthrough and every finding Devin reported, security ones included", () => {
    assert.deepStrictEqual(stripped.walkthrough, [
      { title: "Overview", text: "Adds uploads." },
      { title: "1. Retry", text: "" },
    ]);
    assert.deepStrictEqual(
      stripped.findings.map((finding) => [
        finding.id,
        finding.kind,
        finding.severity,
        finding.threadId,
        finding.commentId,
        finding.devinState,
        finding.suggestedFixPrompt,
      ]),
      [
        ["BUG_1", "bug", "high", "PRRT_1", "101", "dismissed", "Back off between retries."],
        ["BUG_2", "bug", "medium", null, "102", "resolved", null],
        ["ANALYSIS_1", "analysis", "info", null, "103", "open", null],
        ["SEC_1", "security", "medium", null, null, "open", "Discard the response body."],
      ],
    );
    const security = stripped.findings[3]!;
    assert.strictEqual(
      security.body,
      "**Security:** Secrets Exposure · CWE-200 · high confidence\n\nPrints the connector's password.\n\n**Recommendation:** Print only the status.",
    );
    assert.deepStrictEqual(
      [security.path, security.startLine, security.endLine],
      ["README.md", 28, 28],
    );
  });

  it("keeps each finding once, as the latest result has it", () => {
    const later = stripJobResult({
      lifeguard_result: { bugs: [{ id: "BUG_2", title: "Renamed" }, { id: "BUG_3" }] },
    });
    assert.deepStrictEqual(
      latestFindings([stripped, later]).map((finding) => [finding.id, finding.title]),
      [
        ["BUG_1", "Retries never back off"],
        ["BUG_2", "Renamed"],
        ["ANALYSIS_1", "Docs drift"],
        ["SEC_1", "Credentials in output"],
        ["BUG_3", "Devin Review finding"],
      ],
    );
  });

  it("takes each posted finding's thread state from GitHub, and links unposted ones to Devin", () => {
    const findings = combineFindings(
      stripped.findings,
      [
        // Devin still says open; GitHub's resolved thread wins.
        thread("PRRT_1", "BUG_1", "101", { resolved: false }),
        // Matched by comment id; the thread id comes from GitHub.
        thread("PRRT_2", "BUG_2", "102", { outdated: true }),
        // A Devin thread Devin's data does not list is kept as GitHub reads it.
        thread("PRRT_9", "BUG_9", "109", { resolved: true }),
      ],
      REVIEW_URL,
    );
    assert.deepStrictEqual(
      findings.map((finding) => [
        finding.id,
        finding.source,
        finding.threadId,
        finding.url,
        finding.resolved,
        finding.outdated,
        finding.title,
      ]),
      [
        ["BUG_1", "github", "PRRT_1", commentUrl("101"), false, false, "Retries never back off"],
        ["BUG_2", "github", "PRRT_2", commentUrl("102"), false, true, "Devin Review finding"],
        // Posted, but its thread was not among those GitHub returned: Devin's state stands in.
        ["ANALYSIS_1", "github", null, REVIEW_URL, false, false, "Docs drift"],
        ["SEC_1", "devin", null, REVIEW_URL, false, false, "Credentials in output"],
        ["BUG_9", "github", "PRRT_9", commentUrl("109"), true, false, "GitHub's BUG_9"],
      ],
    );
  });
});

describe("stripProgress", () => {
  const repo = "/home/ubuntu/repos/cin-fd-surveys";

  it("keeps one short line per tool call, relative to the repository", () => {
    const progress = stripProgress("job-1", {
      status: "running",
      awaiting_model: true,
      iterations: [
        { tool_calls: [{ name: "clone", args: { repo: "acme/web" } }] },
        { tool_calls: [{ name: "special_files", args: { files: ["REVIEW.md", "AGENTS.md"] } }] },
        {
          tool_calls: [
            { name: "Read", args: { file_path: `${repo}/src/app.ts` } },
            { name: "bash", args: { command: `cd ${repo} && git diff --stat\nls -a` } },
            { name: "grep", args: { pattern: "process.env", path: repo } },
            { name: "report_bugs", args: { bugs: [{ id: "BUG-0001", title: "Secret" }] } },
          ],
        },
        { tool_calls: [] },
      ],
    });
    assert.deepStrictEqual(progress, {
      jobId: "job-1",
      status: "running",
      streams: [
        {
          kind: "review",
          status: "running",
          awaitingModel: true,
          omittedSteps: 0,
          steps: [
            { tool: "clone", detail: null },
            { tool: "special_files", detail: null, count: 2 },
            { tool: "Read", detail: "src/app.ts" },
            { tool: "bash", detail: "git diff --stat" },
            { tool: "grep", detail: "process.env" },
            { tool: "report_bugs", detail: null },
            { tool: "finalizing", detail: null },
          ],
        },
      ],
    });
  });

  it("shows parallel agents after the setup steps, and only the latest steps of each", () => {
    const reads = Array.from({ length: 45 }, (_, index) => ({
      tool_calls: [{ name: "Read", args: { path: `${repo}/f${index}.ts` } }],
    }));
    const progress = stripProgress("job-2", {
      status: "running",
      iterations: [
        { tool_calls: [{ name: "clone", args: {} }] },
        { tool_calls: [{ name: "bash", args: { command: "ls" } }] },
      ],
      streams: {
        bug_check: { status: "running", iterations: reads },
        security: { status: "completed", awaiting_model: false, iterations: [] },
      },
    });
    assert.deepStrictEqual(
      progress.streams.map((stream) => [stream.kind, stream.status, stream.steps.length]),
      [
        ["review", "running", 1],
        ["bug_check", "running", 40],
        ["security", "completed", 0],
      ],
    );
    assert.strictEqual(progress.streams[1]?.omittedSteps, 5);
    assert.deepStrictEqual(progress.streams[1]?.steps[0], { tool: "Read", detail: "f5.ts" });
  });
});
