import { describe, expect, it } from "@effect/vitest";
import type { DevinReviewFinding, DevinReviewSummary } from "@t3tools/contracts";

import {
  type DevinReviewThreadComment,
  devinReviewSeverity,
  isDevinReviewAuthor,
  parseDevinReviewComment,
  renderDevinReviewMarkdown,
} from "./devinReviewMarkdown.ts";

const BADGE = `<!-- devin-review-badge-begin -->
<a href="https://app.devin.ai/review/acme/app/pull/7" target="_blank"><picture><img src="https://static.devin.ai/assets/gh-devin-review-light.svg?v=4" alt="Devin Review"></picture></a>
<!-- devin-review-badge-end -->`;
const FOOTER = "---\n*Was this helpful? React with 👍 or 👎 to provide feedback.*";

// Shaped like the inline comments Devin Review posts as devin-ai-integration[bot].
const bugBody = `<!-- devin-review-comment {"id": "BUG_pr-review-job-1_0001", "file_path": "src/upload.ts", "start_line": 68, "end_line": 74, "side": "RIGHT", "based_on_repo_rules": true, "kind": "bug"} -->

🔴 **Retries never back off**

\`retry()\` resets its delay on every attempt.

<details>
<summary>Learn more</summary>

**Recommended fix:** keep the delay between attempts.

</details>

${BADGE}

${FOOTER}`;

const comment = (
  body: string,
  overrides: Partial<DevinReviewThreadComment> = {},
): DevinReviewThreadComment => ({
  body,
  url: "https://github.com/acme/app/pull/7#discussion_r1",
  path: "src/upload.ts",
  line: 80,
  startLine: 74,
  originalLine: 74,
  originalStartLine: 68,
  resolved: false,
  outdated: false,
  ...overrides,
});

describe("parseDevinReviewComment", () => {
  it("reads the marker and title, and drops Devin's badge and feedback footer", () => {
    const finding = parseDevinReviewComment(comment(bugBody));
    expect(finding).toMatchObject({
      id: "BUG_pr-review-job-1_0001",
      kind: "bug",
      severity: "high",
      title: "Retries never back off",
      path: "src/upload.ts",
      startLine: 68,
      endLine: 74,
    });
    expect(finding.body).toMatch(/^`retry\(\)` resets/u);
    expect(finding.body).toContain("</details>");
    for (const dropped of ["devin-review", "Was this helpful", "static.devin.ai", "🔴"]) {
      expect(finding.body).not.toContain(dropped);
    }
  });

  it("maps every severity marker Devin uses, and anything else to info", () => {
    expect(
      ["🔴", "🟡", "🟨", "🟠", "🔵", "🔍", "✨", ""].map((prefix) => devinReviewSeverity(prefix)),
    ).toEqual(["high", "medium", "medium", "medium", "low", "info", "info", "info"]);
  });

  it("keeps a comment without a marker, falling back to GitHub's lines", () => {
    const finding = parseDevinReviewComment(
      comment(
        `✨ **Blast Radius Reviewer: P2 — Fresh-clone build fails**\n\nBody\n\n*[View in Devin Review](https://app.devin.ai/review/acme/app/pull/7) · [Custom reviewer](https://app.devin.ai/x)*`,
      ),
    );
    expect(finding).toMatchObject({
      id: "https://github.com/acme/app/pull/7#discussion_r1",
      kind: "comment",
      severity: "info",
      title: "Blast Radius Reviewer: P2 — Fresh-clone build fails",
      body: "Body",
      startLine: 74,
      endLine: 80,
    });
  });

  it("recognizes the bot by its GraphQL and REST logins only", () => {
    expect(
      ["devin-ai-integration", "devin-ai-integration[bot]", "devin", null].map(isDevinReviewAuthor),
    ).toEqual([true, true, false, false]);
  });
});

const summary: DevinReviewSummary = {
  repository: "acme/app",
  number: 7,
  title: "Retry uploads",
  pullRequestUrl: "https://github.com/acme/app/pull/7",
  reviewUrl: "https://app.devin.ai/review/acme/app/pull/7",
  status: "completed",
  commitSha: "0123456789abcdef0123",
  statusAt: "2026-11-01T00:00:00Z",
  openFindingCount: 2,
  findingCount: 3,
};

const finding = (overrides: Partial<DevinReviewFinding>): DevinReviewFinding => ({
  id: "id",
  kind: "bug",
  severity: "medium",
  title: "Finding",
  body: "Body",
  path: "src/a.ts",
  startLine: 1,
  endLine: 1,
  url: "https://github.com/acme/app/pull/7#discussion_r1",
  resolved: false,
  outdated: false,
  ...overrides,
});

describe("renderDevinReviewMarkdown", () => {
  it("puts the most severe file first and lists closed findings briefly", () => {
    const markdown = renderDevinReviewMarkdown(
      summary,
      [
        finding({ title: "Medium in a", path: "src/a.ts", startLine: 3, endLine: 5 }),
        finding({ title: "High in b", path: "src/b.ts", severity: "high" }),
        finding({ title: "Fixed", resolved: true, body: "Long resolved body" }),
      ],
      10_000,
    );
    expect(markdown).toContain("Status: completed · commit 0123456789ab");
    expect(markdown).toContain("2 open findings, 1 resolved or outdated.");
    expect(markdown.indexOf("### src/b.ts")).toBeLessThan(markdown.indexOf("### src/a.ts"));
    expect(markdown).toContain("src/a.ts:3-5 · bug");
    expect(markdown).toContain("- [resolved] Medium · Fixed · src/a.ts:1");
    expect(markdown).not.toContain("Long resolved body");
  });

  it("adds Devin's walkthrough before the findings, and each finding's impact and fix prompt", () => {
    const markdown = renderDevinReviewMarkdown(
      summary,
      [
        finding({
          title: "Stalls",
          impactSummary: "Uploads stall.",
          suggestedFixPrompt: "Back off between retries.",
          devinState: "dismissed",
          resolutionReason: "Dismissed by a reviewer on the code host",
        }),
      ],
      10_000,
      {
        walkthrough: [
          { title: "Overview", text: "Adds retries." },
          { title: "1. Retry loop", text: "y".repeat(5_000) },
        ],
      },
    );
    expect(markdown.indexOf("## Walkthrough\n\n### Overview\n\nAdds retries.")).toBeGreaterThan(0);
    expect(markdown.indexOf("### 1. Retry loop")).toBeLessThan(
      markdown.indexOf("## Open findings"),
    );
    expect(markdown).not.toContain("y".repeat(3_000));
    expect(markdown).toContain(
      "Devin marks this dismissed: Dismissed by a reviewer on the code host",
    );
    expect(markdown).toContain("**Impact:** Uploads stall.");
    expect(markdown).toContain("Back off between retries.");
  });

  it("stops at the cap and says how many findings it left out", () => {
    const findings = Array.from({ length: 20 }, (_, index) =>
      finding({
        title: `Finding ${index}`,
        body: "x".repeat(400),
        suggestedFixPrompt: "z".repeat(200),
      }),
    );
    const markdown = renderDevinReviewMarkdown(summary, findings, 2_000, {
      walkthrough: [{ title: "Overview", text: "w".repeat(500) }],
    });
    expect(markdown.length).toBeLessThanOrEqual(2_000);
    expect(markdown).toContain("## Walkthrough");
    const shown = markdown.match(/#### /gu)?.length ?? 0;
    expect(shown).toBeGreaterThan(0);
    expect(markdown).toContain(`… ${20 - shown} more findings not shown.`);
  });

  it("marks security findings, and says which have no GitHub thread to resolve", () => {
    const markdown = renderDevinReviewMarkdown(
      summary,
      [
        finding({
          title: "Credentials in output",
          kind: "security",
          source: "devin",
          url: summary.reviewUrl,
          threadId: null,
          devinState: "open",
        }),
        finding({ title: "Posted", source: "github", threadId: "PRRT_1" }),
        finding({
          title: "Fixed by Devin",
          kind: "security",
          source: "devin",
          url: summary.reviewUrl,
          devinState: "resolved",
        }),
      ],
      10_000,
    );
    expect(markdown).toContain("2 open findings (1 security), 1 resolved or outdated.");
    expect(markdown).toContain("#### Medium · Security · Credentials in output");
    expect(markdown).toContain(
      `Devin only, not posted to GitHub, so there is no thread to resolve: ${summary.reviewUrl}`,
    );
    expect(markdown).toContain(
      `GitHub thread (thread PRRT_1): https://github.com/acme/app/pull/7#discussion_r1\nDevin Review: ${summary.reviewUrl}`,
    );
    expect(markdown).toContain("- [resolved by Devin] Medium · Security · Fixed by Devin");
    expect(markdown).not.toContain("may be missing");
  });

  it("warns that security findings may be missing when read from GitHub alone", () => {
    const markdown = renderDevinReviewMarkdown(summary, [finding({})], 10_000, {
      githubOnlyReason: "Devin Review is not connected",
    });
    expect(markdown).toContain(
      "Findings were read from GitHub's review comments alone (Devin Review is not connected). Security findings Devin did not post to GitHub may be missing",
    );
  });
});
