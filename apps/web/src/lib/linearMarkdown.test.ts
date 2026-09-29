import { describe, expect, it } from "vite-plus/test";

import { formatLinearMarkdownForPreview, linearLinkLabel } from "./linearMarkdown";

const ISSUE_URL = "https://linear.app/acme/issue/ENG-1/fix-login";

describe("linearLinkLabel", () => {
  it("names issues by identifier and projects or documents by name", () => {
    expect(linearLinkLabel("https://linear.app/acme/issue/eng-42/some-slug")).toBe("ENG-42");
    expect(linearLinkLabel("https://linear.app/acme/project/fd-symphony-agents-3f2a9c1b7e4d")).toBe(
      "Fd symphony agents",
    );
    expect(linearLinkLabel("https://linear.app/acme/document/launch-plan-9a8b7c6d5e4f")).toBe(
      "Launch plan",
    );
    expect(linearLinkLabel("https://example.com/acme/issue/ENG-1")).toBeNull();
  });
});

describe("formatLinearMarkdownForPreview", () => {
  it("drops the issue's own URL line", () => {
    expect(
      formatLinearMarkdownForPreview(`# ENG-1: Fix login\n${ISSUE_URL}\n\nState: Todo`, ISSUE_URL),
    ).toBe("# ENG-1: Fix login\n\nState: Todo");
  });

  it("labels bare, autolinked, and self-titled links to Linear pages", () => {
    const other = "https://linear.app/acme/issue/ENG-7/other";
    expect(formatLinearMarkdownForPreview(`See ${other} and <${other}>.`, ISSUE_URL)).toBe(
      `See [ENG-7](${other}) and [ENG-7](${other}).`,
    );
    expect(formatLinearMarkdownForPreview(`- [${other}](${other})`, ISSUE_URL)).toBe(
      `- [ENG-7](${other})`,
    );
  });

  it("keeps links that already have their own text, and other sites", () => {
    const markdown =
      "[the bug](https://linear.app/acme/issue/ENG-7/x) and https://github.com/acme/app/pull/1";
    expect(formatLinearMarkdownForPreview(markdown, ISSUE_URL)).toBe(markdown);
  });
});
