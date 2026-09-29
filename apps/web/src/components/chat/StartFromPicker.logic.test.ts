import { describe, expect, it } from "vite-plus/test";

import {
  resolveBranchStart,
  threadsForBranch,
  threadsForPullRequest,
} from "./StartFromPicker.logic";

const PR_URL = "https://github.com/acme/app/pull/516";

function thread(
  overrides: Partial<Parameters<typeof threadsForBranch>[0][number]> & { id: string },
) {
  return {
    branch: null,
    archivedAt: null,
    updatedAt: "2026-09-01T00:00:00.000Z",
    pullRequests: [],
    linkedPullRequest: null,
    branchPullRequest: null,
    ...overrides,
  };
}

function link(url: string, source: "manual" | "stack-dismissed") {
  return {
    host: "github.com",
    repository: "acme/app",
    number: 516,
    url,
    source,
    linkedAt: "2026-09-01T00:00:00.000Z",
    snapshot: null,
    stack: null,
  };
}

describe("threadsForPullRequest", () => {
  it("finds threads on the head branch or linked to the pull request, newest first", () => {
    const threads = [
      thread({ id: "on-branch", branch: "ah/audience", updatedAt: "2026-09-02T00:00:00.000Z" }),
      thread({ id: "linked", pullRequests: [link(PR_URL, "manual")] }),
      thread({ id: "unrelated", branch: "main", updatedAt: "2026-09-03T00:00:00.000Z" }),
    ];
    const found = threadsForPullRequest(threads, { url: PR_URL, headBranch: "ah/audience" });
    expect(found.map((t) => t.id)).toEqual(["on-branch", "linked"]);
  });

  it("ignores archived threads and dismissed stack links", () => {
    const threads = [
      thread({ id: "archived", branch: "ah/audience", archivedAt: "2026-09-02T00:00:00.000Z" }),
      thread({ id: "dismissed", pullRequests: [link(PR_URL, "stack-dismissed")] }),
    ];
    expect(threadsForPullRequest(threads, { url: PR_URL, headBranch: "ah/audience" })).toEqual([]);
  });
});

describe("threadsForBranch", () => {
  it("matches a remote ref against threads on its local name", () => {
    const threads = [thread({ id: "a", branch: "feature/x" }), thread({ id: "b", branch: "main" })];
    const found = threadsForBranch(threads, {
      name: "origin/feature/x",
      isRemote: true,
      isDefault: false,
    });
    expect(found.map((t) => t.id)).toEqual(["a"]);
  });

  it("never treats the default branch as taken", () => {
    const threads = [thread({ id: "a", branch: "main" })];
    expect(threadsForBranch(threads, { name: "main", isRemote: false, isDefault: true })).toEqual(
      [],
    );
  });
});

describe("resolveBranchStart", () => {
  const root = "/repo";

  it("works in the project checkout when the branch is checked out there", () => {
    expect(resolveBranchStart({ name: "main", worktreePath: root }, root)).toEqual({
      branch: "main",
      worktreePath: null,
      envMode: "local",
    });
  });

  it("reuses the worktree a branch is already checked out in", () => {
    expect(resolveBranchStart({ name: "feat", worktreePath: "/wt/feat" }, root)).toEqual({
      branch: "feat",
      worktreePath: "/wt/feat",
      envMode: "worktree",
    });
  });

  it("bases a new worktree on a branch checked out nowhere", () => {
    expect(resolveBranchStart({ name: "origin/feat", worktreePath: null }, root)).toEqual({
      branch: "origin/feat",
      worktreePath: null,
      envMode: "worktree",
    });
  });
});
