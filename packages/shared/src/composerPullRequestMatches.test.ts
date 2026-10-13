import { describe, expect, it } from "vite-plus/test";

import {
  composerPullRequestRepositories,
  filterComposerPullRequestMatches,
} from "./composerPullRequestMatches.ts";

const entry = (number: number, updatedAt: string) => ({
  number,
  projectId: "p1",
  repository: "owner/repo",
  updatedAt,
});

describe("filterComposerPullRequestMatches", () => {
  it("ranks the exact number above newer substring matches", () => {
    const result = filterComposerPullRequestMatches({
      entries: [entry(1234, "2026-01-03"), entry(123, "2026-01-01"), entry(1230, "2026-01-02")],
      projectId: "p1",
      repository: "owner/repo",
      query: "123",
      limit: 10,
    });
    expect(result.map((match) => match.number)).toEqual([123, 1234, 1230]);
  });

  it("leaves the caller's array untouched", () => {
    // The sort runs on a copy; mutating the input would reorder whatever the caller holds.
    const entries = [entry(2, "2026-01-01"), entry(1, "2026-01-02")];
    const snapshot = entries.map((match) => match.number);
    filterComposerPullRequestMatches({
      entries,
      projectId: "p1",
      repository: "owner/repo",
      query: "",
      limit: 10,
    });
    expect(entries.map((match) => match.number)).toEqual(snapshot);
  });

  it("de-duplicates and honours the limit", () => {
    const result = filterComposerPullRequestMatches({
      entries: [entry(7, "2026-01-02"), entry(7, "2026-01-01"), entry(8, "2026-01-03")],
      projectId: "p1",
      repository: "owner/repo",
      query: "",
      limit: 1,
    });
    expect(result).toHaveLength(1);
  });
});

describe("thread repository numeric references", () => {
  it("includes attached repositories and visible PR links, normalizes and deduplicates them", () => {
    expect(
      composerPullRequestRepositories({
        projectId: "p1" as import("@t3tools/contracts").ProjectId,
        repository: "owner/repo",
        remoteUrls: ["git@github.com:Other/Repo.git", "https://github.com/other/repo"],
        pullRequests: [
          { host: "github.com", repository: "other/repo" },
          { host: "gitlab.com", repository: "group/nested/repo" },
          { host: "github.com", repository: "removed/repo", source: "stack-dismissed" },
        ],
      }),
    ).toEqual([
      { projectId: "p1", repository: "owner/repo" },
      { projectId: "p1", host: "github.com", repository: "other/repo" },
      { projectId: "p1", host: "gitlab.com", repository: "group/nested/repo" },
    ]);
  });

  it("keeps identical numbers across repositories and hosts and excludes unlinked repositories", () => {
    const primary = { ...entry(6310, "2026-01-01"), host: "github.com" };
    const linked = { ...primary, repository: "other/repo", updatedAt: "2026-01-02" };
    const enterprise = { ...linked, host: "github.example.com" };
    const matches = filterComposerPullRequestMatches({
      entries: [
        primary,
        linked,
        enterprise,
        linked,
        { ...linked, repository: "unlinked/repo" },
        { ...linked, projectId: "p2" },
      ],
      projectId: "p1",
      repository: "owner/repo",
      query: "6310",
      limit: 12,
      repositories: [
        { projectId: "p1", host: "github.com", repository: "other/repo" },
        { projectId: "p1", host: "github.example.com", repository: "other/repo" },
      ],
    });
    expect(matches).toEqual([linked, enterprise, primary]);
  });
});

it("matches detail responses whose host is carried only by their URL", () => {
  const detail = {
    ...entry(6310, "2026-01-01"),
    projectId: "credential-checkout",
    repository: "linked/repo",
    url: "https://github.com/linked/repo/pull/6310",
  };
  expect(
    filterComposerPullRequestMatches({
      entries: [detail, { ...detail, host: "github.com" }],
      projectId: "p1",
      repository: "owner/repo",
      repositories: [{ projectId: "p1", repository: "linked/repo", host: "github.com" }],
      query: "6310",
      limit: 12,
    }),
  ).toEqual([detail]);
});
