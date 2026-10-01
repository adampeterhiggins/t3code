import { parseGitHubIssueUrl, type ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { gitHubIssueContextRecord, threadsForGitHubIssue } from "./githubIssues.ts";

const url = "https://github.com/acme/app/issues/7";

describe("parseGitHubIssueUrl", () => {
  it("reads github.com and enterprise issue links", () => {
    expect(parseGitHubIssueUrl(url)).toEqual({
      host: "github.com",
      repository: "acme/app",
      number: 7,
    });
    expect(parseGitHubIssueUrl("https://ghe.acme.dev/a/b/issues/3#issuecomment-1")?.number).toBe(3);
  });

  it("rejects pull requests and other links", () => {
    for (const other of [
      "https://github.com/acme/app/pull/7",
      "https://github.com/acme/app/issues",
      "http://github.com/acme/app/issues/7",
      "#7",
    ]) {
      expect(parseGitHubIssueUrl(other), other).toBeNull();
    }
  });
});

describe("threadsForGitHubIssue", () => {
  const link = {
    groupId: "a" as ThreadId,
    threadIds: ["a", "b"] as ThreadId[],
    repository: "acme/app",
    number: 7,
    title: "Issue",
    url,
    linkedAt: "2026-09-30T00:00:00.000Z",
  };
  const thread = (id: string, updatedAt: string, archivedAt: string | null = null) => ({
    id: id as ThreadId,
    updatedAt,
    archivedAt,
  });

  it("finds a linked group's live threads, newest first", () => {
    const threads = [
      thread("a", "2026-09-01"),
      thread("b", "2026-09-02"),
      thread("c", "2026-09-03"),
      thread("d", "2026-09-04", "2026-09-05"),
    ];
    expect(threadsForGitHubIssue(threads, [link], url).map((entry) => entry.id)).toEqual([
      "b",
      "a",
    ]);
    expect(threadsForGitHubIssue(threads, [link], `${url}0`)).toEqual([]);
    expect(threadsForGitHubIssue(threads, null, url)).toEqual([]);
  });
});

describe("gitHubIssueContextRecord", () => {
  it("gives one issue one context id", () => {
    const record = gitHubIssueContextRecord({
      repository: "Acme/my.app",
      number: 7,
      title: "Fix login",
      url,
      state: "open",
      stateReason: null,
      authorLogin: "ada",
      assigneeLogins: [],
      labels: [],
      updatedAt: "2026-09-30T00:00:00.000Z",
      markdown: "# acme/app#7",
    });
    expect(record.contextId).toBe("github-issue_acme-my-app_7");
    expect(record.label).toBe("#7");
  });
});
