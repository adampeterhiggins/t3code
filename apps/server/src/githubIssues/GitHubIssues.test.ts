import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ChildProcessSpawner } from "effect/process";

import * as GitHubCli from "../sourceControl/GitHubCli.ts";
import * as GitHubIssues from "./GitHubIssues.ts";

const calls: Array<ReadonlyArray<string>> = [];

function output(stdout: string) {
  return {
    exitCode: ChildProcessSpawner.ExitCode(0),
    stdout,
    stderr: "",
    stdoutTruncated: false,
    stderrTruncated: false,
    stdoutInvalidUtf8: false,
  };
}

const issueJson = (number: number, kind: "issues" | "pull" = "issues") => ({
  number,
  title: `Issue ${number}`,
  url: `https://github.com/acme/app/${kind}/${number}`,
  state: "CLOSED",
  stateReason: "NOT_PLANNED",
  author: { login: "ada" },
  assignees: [{ login: "bo" }],
  labels: [{ name: "bug", color: "d73a4a" }],
  updatedAt: "2026-09-30T00:00:00Z",
});

const commit = (oid: string, headline: string) => ({
  oid,
  messageHeadline: headline,
  message: `${headline}\n\nWhy it changed.`,
  committedDate: "2026-10-20T10:33:05Z",
  additions: 12,
  deletions: 3,
  changedFilesIfAvailable: 2,
  author: { name: "Ada Lovelace", user: { login: "ada" } },
});
const SHA = "ad4eeea9da2ad42884d1974c67e555aedd5350b3";
const empty = { release: null, branch: null, tag: null, object: null };

// What the ref query answers for each `ref` variable.
const refRepositories: Record<string, unknown> = {
  "v1.2.0": {
    ...empty,
    release: {
      name: "Retry fix",
      tagName: "v1.2.0",
      description: "## What's Changed\n* Retries now back off",
      isPrerelease: true,
      publishedAt: "2026-10-20T10:37:41Z",
      createdAt: "2026-10-20T10:33:05Z",
      author: { login: "ada" },
      tagCommit: commit(SHA, "Back off retries"),
    },
    tag: { target: { target: commit(SHA, "Back off retries") } },
  },
  "v1.1.0": { ...empty, tag: { target: { target: commit(SHA, "Older work") } } },
  "feature/retry": { ...empty, branch: { target: commit(SHA, "Back off retries") } },
  "feature/retry/src": empty,
  [SHA.slice(0, 7)]: { ...empty, object: commit(SHA, "Back off retries") },
};

// What the file query finds at each `<ref>:<path>` expression; a folder is a tree, not a blob.
const fileObjects: Record<string, unknown> = {
  "feature/retry:src/retry.ts": {
    byteSize: 64,
    isBinary: false,
    isTruncated: false,
    text: "export const tries = 3;\nexport const backoff = 2;\nexport const cap = 30;\n",
  },
  "feature/retry:src": {},
  [`${SHA}:logo.png`]: { byteSize: 2048, isBinary: true, isTruncated: false, text: null },
};

const actionsJob = {
  id: 7,
  run_id: 5,
  name: "plan (prod)",
  workflow_name: "terraform",
  html_url: "https://github.com/acme/app/actions/runs/5/job/7",
  status: "completed",
  conclusion: "failure",
  head_branch: "feature/retry",
  head_sha: SHA,
  run_attempt: 1,
  started_at: "2026-11-06T08:35:34Z",
  completed_at: "2026-11-06T08:36:01Z",
  steps: [
    { name: "Plan", status: "completed", conclusion: "success" },
    { name: "Surface plan failures", status: "completed", conclusion: "failure" },
  ],
};

// What `gh api repos/acme/app/<path>` answers.
const restResponses: Record<string, unknown> = {
  "actions/jobs/7": actionsJob,
  "actions/runs/5": {
    id: 5,
    name: "terraform",
    display_title: "Back off retries",
    run_number: 407,
    run_attempt: 1,
    event: "pull_request",
    status: "completed",
    conclusion: "failure",
    head_branch: "feature/retry",
    head_sha: SHA,
    html_url: "https://github.com/acme/app/actions/runs/5",
    created_at: "2026-11-06T08:35:31Z",
    actor: { login: "ada" },
    pull_requests: [{ number: 482 }],
  },
  "actions/runs/5/jobs?per_page=100": {
    jobs: [actionsJob, { ...actionsJob, id: 8, name: "lint", conclusion: "success" }],
  },
};

const execute: GitHubCli.GitHubCli["Service"]["execute"] = (input) => {
  calls.push(input.args);
  const restPath = input.args[0] === "api" ? input.args[1]?.replace("repos/acme/app/", "") : null;
  if (restPath && restPath in restResponses) {
    return Effect.succeed(output(JSON.stringify(restResponses[restPath])));
  }
  if (input.args.some((arg) => arg.startsWith("f0="))) {
    const repository = Object.fromEntries(
      input.args.flatMap((arg) => {
        const match = /^(f\d+)=(.*)$/su.exec(arg);
        return match === null ? [] : [[match[1], fileObjects[match[2]!] ?? null]];
      }),
    );
    return Effect.succeed(output(JSON.stringify({ data: { repository } })));
  }
  if (input.args[0] === "api") {
    const ref = input.args.find((arg) => arg.startsWith("ref="))?.slice(4) ?? "";
    return Effect.succeed(
      output(JSON.stringify({ data: { repository: refRepositories[ref] ?? empty } })),
    );
  }
  const [, action, reference] = input.args;
  if (action === "list" && input.cwd === "/issues-disabled") {
    return Effect.fail(
      new GitHubCli.GitHubPullRequestNotFoundError({ command: "gh", cwd: input.cwd, cause: null }),
    );
  }
  if (action === "list")
    return Effect.succeed(output(JSON.stringify([issueJson(1), issueJson(2)])));
  if (reference === "404") {
    return Effect.fail(
      new GitHubCli.GitHubPullRequestNotFoundError({ command: "gh", cwd: input.cwd, cause: null }),
    );
  }
  if (reference === "9") return Effect.succeed(output(JSON.stringify(issueJson(9, "pull"))));
  return Effect.succeed(
    output(
      JSON.stringify({
        ...issueJson(Number(reference?.split("/").at(-1) ?? reference)),
        body: "Broken.",
        milestone: null,
        comments: [
          {
            author: { login: "cy" },
            authorAssociation: "MEMBER",
            body: "On it.",
            createdAt: "2026-09-30T00:00:00Z",
            isMinimized: false,
          },
        ],
      }),
    ),
  );
};

const layer = it.layer(
  GitHubIssues.layer.pipe(Layer.provide(Layer.mock(GitHubCli.GitHubCli)({ execute }))),
);

layer("GitHubIssues", (it) => {
  it.effect("lists issues in the checkout's repository", () =>
    Effect.gen(function* () {
      const issues = yield* GitHubIssues.GitHubIssues;
      calls.length = 0;
      const result = yield* issues.listIssues({ cwd: "/repo", query: "login", state: "all" });
      assert.deepEqual(calls[0], [
        "issue",
        "list",
        "--state",
        "all",
        "--limit",
        "50",
        "--search",
        "login",
        "--json",
        "number,title,url,state,stateReason,author,assignees,labels,updatedAt",
      ]);
      assert.deepEqual(result.issues[0], {
        repository: "acme/app",
        number: 1,
        title: "Issue 1",
        url: "https://github.com/acme/app/issues/1",
        state: "closed",
        stateReason: "not planned",
        authorLogin: "ada",
        assigneeLogins: ["bo"],
        labels: [{ name: "bug", color: "d73a4a" }],
        updatedAt: "2026-09-30T00:00:00Z",
      });
    }),
  );

  it.effect("lists nothing in a repository with issues turned off", () =>
    Effect.gen(function* () {
      const issues = yield* GitHubIssues.GitHubIssues;
      const result = yield* issues.listIssues({ cwd: "/issues-disabled" });
      assert.deepEqual(result.issues, []);
    }),
  );

  it.effect("looks a number up directly, and finds nothing for a missing issue or a PR", () =>
    Effect.gen(function* () {
      const issues = yield* GitHubIssues.GitHubIssues;
      calls.length = 0;
      const found = yield* issues.listIssues({ cwd: "/repo", query: "#3" });
      assert.deepEqual(calls[0]?.slice(0, 3), ["issue", "view", "3"]);
      assert.strictEqual(found.issues[0]?.number, 3);
      assert.deepEqual((yield* issues.listIssues({ cwd: "/repo", query: "404" })).issues, []);
      assert.deepEqual((yield* issues.listIssues({ cwd: "/repo", query: "9" })).issues, []);
    }),
  );

  it.effect("renders an issue snapshot with its comments", () =>
    Effect.gen(function* () {
      const issues = yield* GitHubIssues.GitHubIssues;
      const issue = yield* issues.getIssue({ url: "https://github.com/acme/app/issues/5" });
      assert.strictEqual(issue.number, 5);
      assert.include(issue.markdown, "# acme/app#5: Issue 5");
      assert.include(issue.markdown, "**cy (maintainer)** (2026-09-30):\nOn it.");
    }),
  );

  it.effect("reads a release link, with its notes", () =>
    Effect.gen(function* () {
      const issues = yield* GitHubIssues.GitHubIssues;
      const url = "https://github.com/acme/app/releases/tag/v1.2.0";
      const ref = yield* issues.getRef({ url });
      assert.include(ref, {
        repository: "acme/app",
        refType: "release",
        ref: "v1.2.0",
        title: "Retry fix",
        url,
        sha: SHA,
        authorLogin: "ada",
        isPrerelease: true,
      });
      assert.include(ref.markdown, "# acme/app release Retry fix");
      assert.include(ref.markdown, "Pre-release");
      assert.include(ref.markdown, "* Retries now back off");
    }),
  );

  it.effect("reads a release link whose tag has no release as the tag", () =>
    Effect.gen(function* () {
      const issues = yield* GitHubIssues.GitHubIssues;
      const ref = yield* issues.getRef({
        url: "https://github.com/acme/app/releases/tag/v1.1.0",
      });
      assert.include(ref, { refType: "tag", ref: "v1.1.0", title: "Older work", sha: SHA });
    }),
  );

  it.effect("tells a branch from a folder in a tree link", () =>
    Effect.gen(function* () {
      const issues = yield* GitHubIssues.GitHubIssues;
      const branch = yield* issues.getRef({
        url: "https://github.com/acme/app/tree/feature/retry",
      });
      assert.include(branch, { refType: "branch", ref: "feature/retry", authorLogin: "ada" });
      assert.include(branch.markdown, `Head commit: ${SHA}`);
      const folder = yield* Effect.flip(
        issues.getRef({ url: "https://github.com/acme/app/tree/feature/retry/src" }),
      );
      assert.strictEqual(folder.reason, "not-found");
    }),
  );

  it.effect("reads a commit link as its full SHA and message", () =>
    Effect.gen(function* () {
      const issues = yield* GitHubIssues.GitHubIssues;
      const ref = yield* issues.getRef({
        url: `https://github.com/acme/app/commit/${SHA.slice(0, 7)}`,
      });
      assert.include(ref, { refType: "commit", ref: SHA, title: "Back off retries" });
      assert.include(ref.markdown, "Changes: 2 files, +12 −3");
      assert.include(ref.markdown, "Why it changed.");
    }),
  );

  it.effect("reads a file link at a ref with slashes, with its linked lines", () =>
    Effect.gen(function* () {
      const issues = yield* GitHubIssues.GitHubIssues;
      const file = yield* issues.getRef({
        url: "https://github.com/acme/app/blob/feature/retry/src/retry.ts#L2-L3",
      });
      assert.include(file, {
        refType: "file",
        ref: "feature/retry",
        title: "src/retry.ts:2-3",
        sha: null,
      });
      assert.include(file.markdown, "Lines: 2–3 of 3");
      assert.include(
        file.markdown,
        "## Lines 2-3\n\n```ts\nexport const backoff = 2;\nexport const cap = 30;\n```",
      );
      assert.include(file.markdown, "## File\n\n```ts\nexport const tries = 3;");

      const folder = yield* Effect.flip(
        issues.getRef({ url: "https://github.com/acme/app/blob/feature/retry/src" }),
      );
      assert.strictEqual(folder.reason, "not-found");

      const binary = yield* issues.getRef({
        url: `https://github.com/acme/app/blob/${SHA}/logo.png`,
      });
      assert.include(binary, { ref: SHA, sha: SHA, title: "logo.png" });
      assert.include(binary.markdown, "Binary file; its contents are not included.");
    }),
  );

  it.effect("reads an Actions run with its jobs, and a job with its failed step", () =>
    Effect.gen(function* () {
      const issues = yield* GitHubIssues.GitHubIssues;
      const run = yield* issues.getRef({
        url: "https://github.com/acme/app/actions/runs/5/attempts/1",
      });
      assert.include(run, {
        refType: "workflow-run",
        ref: "5",
        title: "terraform #407",
        sha: SHA,
      });
      assert.include(run.markdown, "Result: failure");
      assert.include(run.markdown, "Pull requests: #482");
      assert.include(
        run.markdown,
        "- [plan (prod)](https://github.com/acme/app/actions/runs/5/job/7): failure (failed: Surface plan failures)",
      );
      assert.include(
        run.markdown,
        "- [lint](https://github.com/acme/app/actions/runs/5/job/7): success",
      );

      const job = yield* issues.getRef({
        url: "https://github.com/acme/app/actions/runs/5/job/7?pr=482",
      });
      assert.include(job, { refType: "workflow-job", ref: "7", title: "terraform / plan (prod)" });
      assert.include(job.markdown, "Failed steps: Surface plan failures");
      assert.include(job.markdown, "Run: https://github.com/acme/app/actions/runs/5");
    }),
  );
});
