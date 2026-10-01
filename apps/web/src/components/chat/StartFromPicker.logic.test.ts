import { describe, expect, it } from "vite-plus/test";

import { resolveBranchStart, threadsForBranch } from "./StartFromPicker.logic";

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
