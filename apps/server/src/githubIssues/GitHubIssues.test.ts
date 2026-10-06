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

const execute: GitHubCli.GitHubCli["Service"]["execute"] = (input) => {
  calls.push(input.args);
  const [, action, reference] = input.args;
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
});
