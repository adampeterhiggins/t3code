import { assert, describe, it } from "@effect/vitest";

import {
  type GitHubIssueComment,
  type GitHubIssueDetail,
  renderGitHubIssueMarkdown,
  selectGitHubIssueComments,
} from "./gitHubIssueMarkdown.ts";

const comment = (overrides: Partial<GitHubIssueComment>): GitHubIssueComment => ({
  authorLogin: "bo",
  authorAssociation: "NONE",
  body: "A comment",
  createdAt: "2026-01-02T00:00:00Z",
  isMinimized: false,
  ...overrides,
});

const issue: GitHubIssueDetail = {
  repository: "acme/app",
  number: 7,
  title: "Login button does nothing",
  url: "https://github.com/acme/app/issues/7",
  body: "Clicking login has no effect.",
  state: "closed",
  stateReason: "not planned",
  authorLogin: "ada",
  assigneeLogins: ["cy"],
  labels: ["bug"],
  milestone: "v2",
  comments: [
    comment({ authorLogin: "cy", authorAssociation: "MEMBER", body: "Repro'd on main." }),
    comment({ authorLogin: "ada", body: "Still happens", createdAt: "2026-01-03T00:00:00Z" }),
  ],
};

describe("selectGitHubIssueComments", () => {
  it("drops hidden, empty, and +1 comments", () => {
    const selected = selectGitHubIssueComments({
      authorLogin: "ada",
      comments: [
        comment({ body: "+1" }),
        comment({ body: "👍🏽" }),
        comment({ body: "Same here!" }),
        comment({ body: "   " }),
        comment({ body: "Spam", isMinimized: true }),
        comment({ body: "Happens on Safari 18 too" }),
      ],
    });
    assert.deepEqual(
      selected.map((entry) => entry.body),
      ["Happens on Safari 18 too"],
    );
  });

  it("marks the issue's author and maintainers", () => {
    const selected = selectGitHubIssueComments(issue);
    assert.deepEqual(
      selected.map((entry) => entry.author),
      ["cy (maintainer)", "ada (author)"],
    );
  });
});

describe("renderGitHubIssueMarkdown", () => {
  it("renders the header, description, and comments", () => {
    const markdown = renderGitHubIssueMarkdown(issue, 32_000);
    assert.include(markdown, "# acme/app#7: Login button does nothing");
    assert.include(markdown, "State: Closed (not planned)");
    assert.include(markdown, "Assignees: cy");
    assert.include(markdown, "Milestone: v2");
    assert.include(markdown, "## Description\nClicking login has no effect.");
    assert.include(markdown, "**cy (maintainer)** (2026-01-02):\nRepro'd on main.");
    assert.isBelow(markdown.indexOf("Repro'd"), markdown.indexOf("Still happens"));
  });

  it("keeps the newest comments when the budget runs out", () => {
    const markdown = renderGitHubIssueMarkdown(
      {
        ...issue,
        comments: [
          comment({ body: "old ".repeat(100), createdAt: "2026-01-01T00:00:00Z" }),
          comment({ body: "newest", createdAt: "2026-01-05T00:00:00Z" }),
        ],
      },
      400,
    );
    assert.include(markdown, "newest");
    assert.include(markdown, "_1 earlier comment omitted._");
    assert.isAtMost(markdown.length, 400);
  });
});
