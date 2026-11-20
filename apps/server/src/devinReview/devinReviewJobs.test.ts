import { assert, describe, it } from "@effect/vitest";
import type { DevinReviewFinding } from "@t3tools/contracts";

import {
  type DevinReviewJob,
  mergeFindingDetails,
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

describe("stripJobResult and mergeFindingDetails", () => {
  const finding = (id: string, commentId: string): DevinReviewFinding => ({
    id,
    kind: "bug",
    severity: "high",
    title: id,
    body: "",
    path: "src/a.ts",
    startLine: 1,
    endLine: 1,
    url: `https://github.com/acme/app/pull/7#discussion_r${commentId}`,
    resolved: false,
    outdated: false,
  });

  it("keeps the walkthrough and per-finding data, and matches findings by id or comment", () => {
    const stripped = stripJobResult({
      sections: [
        { title: "Overview", text: "Adds uploads." },
        { title: "1. Retry", text: null },
      ],
      lifeguard_result: {
        bugs: [
          {
            id: "BUG_1",
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
            pr_comment_url: "https://github.com/acme/app/pull/7#discussion_r102",
            suggested_edit: { type: "diff" },
            resolved_by_devin: true,
            resolution_reason: "Fixed in abc",
          },
        ],
        analyses: [{ id: "ANALYSIS_1", pr_comment_id: 103, impact_summary: null }],
      },
    });
    assert.deepStrictEqual(stripped.walkthrough, [
      { title: "Overview", text: "Adds uploads." },
      { title: "1. Retry", text: "" },
    ]);

    const merged = mergeFindingDetails(
      [
        // GitHub's marker id differs, so the comment id has to match.
        finding("other-id", "101"),
        finding("BUG_2", "999"),
        finding("ANALYSIS_1", "103"),
        finding("UNKNOWN", "104"),
      ],
      stripped.findings,
    );
    assert.deepStrictEqual(
      merged.map((item) => [
        item.impactSummary,
        item.suggestedFixPrompt,
        item.devinState,
        item.resolutionReason,
      ]),
      [
        [
          "Uploads stall.",
          "Back off between retries.",
          "dismissed",
          "Dismissed by a reviewer on the code host",
        ],
        [null, null, "resolved", "Fixed in abc"],
        [null, null, "open", null],
        [undefined, undefined, undefined, undefined],
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
