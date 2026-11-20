import type { DevinReviewFinding } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  devinFindingFixPrompt,
  devinFindingLocation,
  devinFindingPrompt,
  devinFindingStateLabel,
  devinReviewFindingCountLabel,
  devinReviewRunLabel,
  devinReviewStatusPresentation,
  devinReviewSummaryHasNews,
  devinReviewablePullRequests,
  partitionDevinFindings,
  projectForDevinReview,
  readDevinReviewInvolvement,
} from "./devinReview.logic";

function finding(overrides: Partial<DevinReviewFinding>): DevinReviewFinding {
  return {
    id: "f",
    kind: "bug",
    severity: "low",
    title: "Title",
    body: "Body",
    path: null,
    startLine: null,
    endLine: null,
    url: "https://github.com/o/r/pull/1#discussion_r1",
    resolved: false,
    outdated: false,
    ...overrides,
  };
}

describe("devinFindingLocation", () => {
  it.each([
    [{ path: null, startLine: 3, endLine: 4 }, null],
    [{ path: "a.ts", startLine: null, endLine: null }, "a.ts"],
    [{ path: "a.ts", startLine: 3, endLine: 3 }, "a.ts:3"],
    [{ path: "a.ts", startLine: null, endLine: 7 }, "a.ts:7"],
    [{ path: "a.ts", startLine: 3, endLine: 9 }, "a.ts:3–9"],
  ])("%o → %s", (input, expected) => {
    expect(devinFindingLocation(input)).toBe(expected);
  });
});

describe("partitionDevinFindings", () => {
  it("puts open findings first by severity and keeps Devin's order on ties", () => {
    const { open, closed } = partitionDevinFindings([
      finding({ id: "low", severity: "low" }),
      finding({ id: "resolved-high", severity: "high", resolved: true }),
      finding({ id: "high-1", severity: "high" }),
      finding({ id: "outdated", severity: "medium", outdated: true }),
      finding({ id: "high-2", severity: "high" }),
      finding({ id: "info", severity: "info" }),
      finding({ id: "dismissed", severity: "low", devinState: "dismissed" }),
      finding({ id: "devin-open", severity: "low", devinState: "open" }),
    ]);
    expect(open.map((entry) => entry.id)).toEqual([
      "high-1",
      "high-2",
      "low",
      "devin-open",
      "info",
    ]);
    expect(closed.map((entry) => entry.id)).toEqual(["resolved-high", "outdated", "dismissed"]);
  });
});

describe("devinReviewStatusPresentation", () => {
  it("reads a missing head review as new commits when Devin left findings earlier", () => {
    expect(devinReviewStatusPresentation({ status: "none", findingCount: 2 }).label).toBe(
      "New commits since review",
    );
    expect(devinReviewStatusPresentation({ status: "none", findingCount: 0 }).label).toBe(
      "Not reviewed",
    );
    expect(devinReviewStatusPresentation({ status: "completed", findingCount: 2 }).label).toBe(
      "Reviewed",
    );
  });
});

describe("devinReviewFindingCountLabel", () => {
  it.each([
    [0, 0, "No findings"],
    [0, 1, "1 finding, resolved"],
    [0, 3, "3 findings, all resolved"],
    [1, 3, "1 open finding"],
    [2, 3, "2 open findings"],
  ])("%i open of %i → %s", (open, total, expected) => {
    expect(devinReviewFindingCountLabel(open, total)).toBe(expected);
  });
});

describe("devinFindingPrompt", () => {
  it("names the pull request, location and comment, then the body", () => {
    expect(
      devinFindingPrompt(
        finding({ severity: "high", title: "Null deref", path: "a.ts", startLine: 2, endLine: 4 }),
        { repository: "o/r", number: 1 },
      ),
    ).toBe(
      [
        "Devin Review finding on o/r#1 (high severity): Null deref",
        "Location: a.ts:2–4",
        "Comment: https://github.com/o/r/pull/1#discussion_r1",
        "",
        "Body",
      ].join("\n"),
    );
  });
});

describe("devinFindingFixPrompt", () => {
  it("puts Devin's fix first and a reference line after, or null without a fix", () => {
    expect(
      devinFindingFixPrompt(
        finding({
          title: "Null deref",
          path: "a.ts",
          startLine: 2,
          endLine: 4,
          suggestedFixPrompt: "  Guard the lookup.\n",
        }),
        { repository: "o/r", number: 1 },
      ),
    ).toBe(
      [
        "Guard the lookup.",
        "",
        "Devin Review finding on o/r#1: Null deref at a.ts:2–4 (https://github.com/o/r/pull/1#discussion_r1)",
      ].join("\n"),
    );
    expect(
      devinFindingFixPrompt(finding({ suggestedFixPrompt: " " }), { repository: "o/r", number: 1 }),
    ).toBeNull();
    expect(devinFindingFixPrompt(finding({}), { repository: "o/r", number: 1 })).toBeNull();
  });
});

describe("devinFindingStateLabel", () => {
  it.each([
    [{ resolved: true, outdated: false, devinState: "dismissed" as const }, "Resolved"],
    [{ resolved: false, outdated: true, devinState: null }, "Outdated"],
    [{ resolved: false, outdated: false, devinState: "dismissed" as const }, "Dismissed by Devin"],
    [{ resolved: false, outdated: false, devinState: "resolved" as const }, "Resolved by Devin"],
    [{ resolved: false, outdated: false, devinState: "open" as const }, null],
    [{ resolved: false, outdated: false }, null],
  ])("%o → %s", (input, expected) => {
    expect(devinFindingStateLabel(input)).toBe(expected);
  });
});

describe("devinReviewRunLabel", () => {
  it("names the kind, a readable status and the short sha", () => {
    expect(
      devinReviewRunLabel({
        kind: "incremental",
        status: "COMPLETED_WITH_ERRORS",
        commitSha: "abcdef123456",
      }),
    ).toBe("Incremental · completed with errors · abcdef1");
    expect(devinReviewRunLabel({ kind: "full", status: "", commitSha: "abc" })).toBe(
      "Full review · abc",
    );
  });
});

describe("projectForDevinReview", () => {
  const projects = [
    { id: "a", environmentId: "remote", repositoryIdentity: { owner: "Acme", name: "App" } },
    { id: "b", environmentId: "local", repositoryIdentity: { owner: "acme", name: "app" } },
    {
      id: "c",
      environmentId: "local",
      repositoryIdentity: { canonicalKey: "github.com/acme/web" },
    },
    { id: "d", environmentId: "local", repositoryIdentity: null },
  ];

  it("matches owner/repo case-insensitively and prefers the given environment", () => {
    expect(projectForDevinReview(projects, "acme/app", "local")?.id).toBe("b");
    expect(projectForDevinReview(projects, "ACME/app", "other")?.id).toBe("a");
  });

  it("falls back to the canonical key and returns null without a match", () => {
    expect(projectForDevinReview(projects, "acme/web", "local")?.id).toBe("c");
    expect(projectForDevinReview(projects, "acme/none", "local")).toBeNull();
  });
});

describe("readDevinReviewInvolvement", () => {
  it("defaults to all when storage is empty, invalid, or throws", () => {
    expect(readDevinReviewInvolvement({ getItem: () => "reviewing" })).toBe("reviewing");
    expect(readDevinReviewInvolvement({ getItem: () => "bogus" })).toBe("all");
    expect(
      readDevinReviewInvolvement({
        getItem: () => {
          throw new Error("denied");
        },
      }),
    ).toBe("all");
  });
});

describe("devinReviewablePullRequests", () => {
  it("keeps GitHub pull requests only", () => {
    expect(
      devinReviewablePullRequests([
        { url: "https://github.com/o/r/pull/1" },
        { url: "https://gitlab.com/o/r/-/merge_requests/2" },
        { url: "https://github.com/o/r/pull/3/files" },
      ]).map((link) => link.url),
    ).toEqual(["https://github.com/o/r/pull/1", "https://github.com/o/r/pull/3/files"]);
  });
});

describe("devinReviewSummaryHasNews", () => {
  it.each([
    ["unknown", 0, false],
    ["none", 0, false],
    ["unknown", 2, true],
    ["running", 0, true],
    ["completed", 0, true],
  ] as const)("%s with %i findings → %s", (status, findingCount, expected) => {
    expect(devinReviewSummaryHasNews({ status, findingCount })).toBe(expected);
  });
});
