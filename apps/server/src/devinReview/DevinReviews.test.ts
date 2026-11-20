import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";
import * as Layer from "effect/Layer";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { ChildProcessSpawner } from "effect/process";

import * as GitHubCli from "../sourceControl/GitHubCli.ts";
import { DevinReviewAuth } from "./DevinReviewAuth.ts";
import * as DevinReviews from "./DevinReviews.ts";

const PR_URL = "https://github.com/acme/app/pull/7";

const output = (stdout: unknown) => ({
  exitCode: ChildProcessSpawner.ExitCode(0),
  stdout: JSON.stringify(stdout),
  stderr: "",
  stdoutTruncated: false,
  stderrTruncated: false,
});

const thread = (id: string, commentId: number) => ({
  isResolved: false,
  isOutdated: false,
  comments: {
    nodes: [
      {
        author: { login: "devin-ai-integration" },
        body: `<!-- devin-review-comment {"id": "${id}", "kind": "bug"} -->\n\n🔴 **Bug ${id}**\n\nBody.`,
        url: `${PR_URL}#discussion_r${commentId}`,
        path: "src/a.ts",
        line: 3,
      },
    ],
  },
});

const pullRequest = (number: number) => ({
  number,
  title: `PR ${number}`,
  url: `https://github.com/acme/app/pull/${number}`,
  reviewThreads: { nodes: [thread("BUG_1", 101), thread("BUG_2", 102)] },
});

const jobs = {
  jobs: [
    {
      job_id: "job-1",
      status: "completed",
      commit_sha: "abc",
      job_type: "pr_review",
      created_at: "2026-11-02T10:00:00Z",
      versions: [{ id: "v1", created_at: "2026-11-02T10:01:00Z", metadata: { is_finished: true } }],
    },
  ],
};

const jobResult = {
  sections: [{ title: "Overview", text: "Adds uploads.", changes: [] }],
  file_contents_at_base: { "src/a.ts": "…" },
  lifeguard_result: {
    bugs: [
      {
        id: "BUG_1",
        pr_comment_id: "101",
        impact_summary: "Uploads stall.",
        suggested_edit: { type: "prompt", prompt: "Back off between retries." },
      },
    ],
    analyses: [],
  },
};

/** Devin's public status endpoint answers; the review app's API answers with `app`. */
const devinApi = (
  seen: Array<string>,
  app: (path: string) => readonly [number, unknown] = (path) =>
    path.endsWith("/jobs") ? [200, jobs] : [200, jobResult],
  reviewStatus = "completed",
) =>
  HttpClient.make((request) =>
    Effect.sync(() => {
      const path = new URL(request.url).pathname;
      seen.push(path);
      const [status, body] = path.startsWith("/v3/")
        ? [200, { status: reviewStatus, commit_sha: "abc", created_at: "2026-11-02T10:00:00Z" }]
        : app(path);
      return HttpClientResponse.fromWeb(request, new Response(JSON.stringify(body), { status }));
    }),
  );

const reviews = (options: {
  readonly method?: "devin-login" | "service-key";
  readonly http: HttpClient.HttpClient;
  readonly execute?: GitHubCli.GitHubCli["Service"]["execute"];
}) =>
  DevinReviews.layer.pipe(
    Layer.provide([
      Layer.mock(GitHubCli.GitHubCli)({
        execute:
          options.execute ??
          (() => Effect.succeed(output({ data: { repository: { pullRequest: pullRequest(7) } } }))),
      }),
      Layer.mock(DevinReviewAuth)({
        credentials: Effect.succeedSome({
          method: options.method ?? "devin-login",
          apiKey: "token",
          orgId: "org-acme",
        }),
        markRevoked: Effect.void,
      }),
      Layer.succeed(HttpClient.HttpClient, options.http),
    ]),
  );

const get = DevinReviews.DevinReviews.use((service) => service.get({ url: PR_URL }));

describe("DevinReviews.get", () => {
  it.effect("adds Devin's walkthrough, runs, and finding details, reading a result once", () => {
    const seen: Array<string> = [];
    return Effect.gen(function* () {
      const review = yield* get;
      yield* get;
      assert.deepStrictEqual(review.walkthrough, [{ title: "Overview", text: "Adds uploads." }]);
      assert.deepStrictEqual(
        review.runs?.map((run) => [run.id, run.kind]),
        [["job-1", "full"]],
      );
      assert.deepStrictEqual(
        review.findings.map((finding) => [finding.id, finding.impactSummary]),
        [
          ["BUG_1", "Uploads stall."],
          ["BUG_2", undefined],
        ],
      );
      assert.include(review.markdown, "## Walkthrough");
      assert.include(review.markdown, "Back off between retries.");
      assert.deepStrictEqual(
        seen.filter((path) => path.startsWith("/pr-review/job-result/")),
        ["/pr-review/job-result/job-1/v1"],
      );
    }).pipe(Effect.provide(reviews({ http: devinApi(seen) })));
  });

  it.effect("re-reads a review in flight after 10 seconds, a finished one after a minute", () => {
    const statusReads = (status: string) => {
      const seen: Array<string> = [];
      return Effect.gen(function* () {
        yield* get;
        yield* TestClock.adjust("15 seconds");
        yield* get;
        return seen.filter((path) => path.startsWith("/v3/")).length;
      }).pipe(Effect.provide(reviews({ http: devinApi(seen, undefined, status) })));
    };
    return Effect.gen(function* () {
      assert.strictEqual(yield* statusReads("running"), 2);
      assert.strictEqual(yield* statusReads("completed"), 1);
    });
  });

  it.effect("returns GitHub's findings alone when Devin's review API fails", () =>
    Effect.gen(function* () {
      const review = yield* get;
      assert.isNull(review.walkthrough);
      assert.isNull(review.runs);
      assert.strictEqual(review.status, "completed");
      assert.deepStrictEqual(
        review.findings.map((finding) => finding.impactSummary),
        [undefined, undefined],
      );
    }).pipe(Effect.provide(reviews({ http: devinApi([], () => [500, { detail: "boom" }]) }))),
  );

  it.effect("does not call Devin's review API with a service key", () => {
    const seen: Array<string> = [];
    return Effect.gen(function* () {
      const review = yield* get;
      assert.isNull(review.walkthrough);
      assert.deepStrictEqual(seen, ["/v3/organizations/org-acme/pr-reviews"]);
    }).pipe(Effect.provide(reviews({ method: "service-key", http: devinApi(seen) })));
  });
});

describe("DevinReviews.trigger", () => {
  it.effect("reports Devin's reply to a started review as the status every reader sees", () => {
    const seen: Array<string> = [];
    const http = HttpClient.make((request) =>
      Effect.sync(() => {
        seen.push(`${request.method} ${new URL(request.url).pathname}`);
        const body =
          request.method === "POST"
            ? { status: "pending", commit_sha: "def", created_at: "2026-11-18T15:00:00Z" }
            : { status: "completed", commit_sha: "abc", created_at: "2026-11-02T10:00:00Z" };
        return HttpClientResponse.fromWeb(request, new Response(JSON.stringify(body)));
      }),
    );
    return Effect.gen(function* () {
      const service = yield* DevinReviews.DevinReviews;
      yield* service.status({ url: PR_URL });
      yield* service.trigger({ url: PR_URL });
      const status = yield* service.status({ url: PR_URL });
      assert.deepStrictEqual(status, {
        status: "pending",
        commitSha: "def",
        statusAt: "2026-11-18T15:00:00Z",
      });
      assert.strictEqual(seen.filter((entry) => entry.startsWith("GET /v3/")).length, 1);
    }).pipe(Effect.provide(reviews({ http, method: "service-key" })));
  });
});

describe("DevinReviews.summaries", () => {
  it.effect(
    "reads every pull request in one call, in input order, skipping unreadable ones",
    () => {
      const calls: Array<ReadonlyArray<string>> = [];
      const execute: GitHubCli.GitHubCli["Service"]["execute"] = (input) => {
        calls.push(input.args);
        return Effect.succeed(
          output({ data: { r0: { pullRequest: pullRequest(9) }, r1: { pullRequest: null } } }),
        );
      };
      return Effect.gen(function* () {
        const result = yield* DevinReviews.DevinReviews.use((service) =>
          service.summaries({
            urls: [
              "https://github.com/acme/app/pull/9",
              "not a url",
              "https://app.devin.ai/review/acme/app/pull/8",
              "https://github.com/acme/app/pull/9/files",
            ],
          }),
        );
        assert.deepStrictEqual(
          result.reviews.map((review) => [review.number, review.status, review.findingCount]),
          [[9, "completed", 2]],
        );
        assert.strictEqual(calls.length, 1);
        assert.includeMembers([...calls[0]!], ["o0=acme", "n1=app", "p0=9", "p1=8"]);
      }).pipe(Effect.provide(reviews({ http: devinApi([]), execute })));
    },
  );

  it.effect("reads one at a time when one pull request fails the batch", () => {
    const notFound = () =>
      Effect.fail(
        new GitHubCli.GitHubPullRequestNotFoundError({ command: "gh", cwd: "", cause: null }),
      );
    const execute: GitHubCli.GitHubCli["Service"]["execute"] = (input) => {
      if (input.args.includes("p1=8")) return notFound();
      const number = Number(input.args.find((arg) => arg.startsWith("p0="))?.slice(3));
      return number === 8
        ? notFound()
        : Effect.succeed(output({ data: { r0: { pullRequest: pullRequest(number) } } }));
    };
    return Effect.gen(function* () {
      const result = yield* DevinReviews.DevinReviews.use((service) =>
        service.summaries({
          urls: [
            "https://github.com/acme/app/pull/9",
            "https://github.com/acme/app/pull/8",
            "https://github.com/acme/app/pull/7",
          ],
        }),
      );
      assert.deepStrictEqual(
        result.reviews.map((review) => review.number),
        [9, 7],
      );
    }).pipe(Effect.provide(reviews({ http: devinApi([]), execute })));
  });
});
