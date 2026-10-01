import { describe, expect, it } from "vite-plus/test";

import { threadsForPullRequest } from "./pullRequests.ts";

const PR_URL = "https://github.com/acme/app/pull/516";

function thread(
  overrides: Partial<Parameters<typeof threadsForPullRequest>[0][number]> & { id: string },
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
