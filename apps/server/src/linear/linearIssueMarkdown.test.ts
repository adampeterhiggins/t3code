import { assert, describe, it } from "@effect/vitest";

import {
  type LinearIssueDetail,
  parseLinearIssueRef,
  renderLinearIssueMarkdown,
} from "./linearIssueMarkdown.ts";

describe("parseLinearIssueRef", () => {
  it("reads identifiers and linear.app issue URLs", () => {
    assert.strictEqual(parseLinearIssueRef("eng-123"), "ENG-123");
    assert.strictEqual(parseLinearIssueRef(" FD_OPS-9 "), "FD_OPS-9");
    assert.strictEqual(
      parseLinearIssueRef("https://linear.app/focaldata/issue/ENG-42/fix-the-thing"),
      "ENG-42",
    );
  });

  it("treats everything else as search text", () => {
    assert.strictEqual(parseLinearIssueRef("login bug"), null);
    assert.strictEqual(parseLinearIssueRef("123-ENG"), null);
    assert.strictEqual(parseLinearIssueRef("https://example.com/org/issue/ENG-1"), null);
  });
});

const issue: LinearIssueDetail = {
  identifier: "ENG-1",
  title: "Fix login",
  url: "https://linear.app/acme/issue/ENG-1",
  description: "The login button does nothing.",
  stateName: "In Progress",
  priorityLabel: "High",
  assigneeName: "Ada",
  teamName: "Engineering",
  projectName: null,
  labels: ["bug"],
  parent: null,
  children: [{ identifier: "ENG-2", title: "Add test", stateName: "Todo" }],
  links: [{ title: "PR #1", url: "https://github.com/acme/app/pull/1" }],
  comments: [
    { author: "Bo", createdAt: "2026-01-02T00:00:00Z", body: "Second" },
    { author: "Ada", createdAt: "2026-01-01T00:00:00Z", body: "First" },
  ],
};

describe("renderLinearIssueMarkdown", () => {
  it("renders every section with comments in chronological order", () => {
    const markdown = renderLinearIssueMarkdown(issue, 32_000);
    assert.include(markdown, "# ENG-1: Fix login");
    assert.include(markdown, "Priority: High");
    assert.include(markdown, "## Description\nThe login button does nothing.");
    assert.include(markdown, "- ENG-2 Add test (Todo)");
    assert.include(markdown, "- [PR #1](https://github.com/acme/app/pull/1)");
    assert.isBelow(markdown.indexOf("First"), markdown.indexOf("Second"));
  });

  it("drops the oldest comments before cutting the description", () => {
    const long = {
      ...issue,
      comments: [
        { author: "Ada", createdAt: "2026-01-01T00:00:00Z", body: "old ".repeat(100) },
        { author: "Bo", createdAt: "2026-01-02T00:00:00Z", body: "newest" },
      ],
    };
    const markdown = renderLinearIssueMarkdown(long, 600);
    assert.isAtMost(markdown.length, 600);
    assert.include(markdown, "The login button does nothing.");
    assert.include(markdown, "newest");
    assert.notInclude(markdown, "old old");
    assert.include(markdown, "_1 earlier comment omitted._");
  });

  it("truncates a description that alone exceeds the budget", () => {
    const markdown = renderLinearIssueMarkdown(
      { ...issue, description: "x".repeat(5_000), comments: [] },
      1_000,
    );
    assert.isAtMost(markdown.length, 1_000);
    assert.include(markdown, "…[truncated]");
    assert.include(markdown, "## Sub-issues");
  });
});
