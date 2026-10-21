import { assert, describe, it } from "@effect/vitest";

import { renderLinearObjectMarkdown } from "./linearObjectMarkdown.ts";

describe("renderLinearObjectMarkdown", () => {
  it("lists what is set, the content, and the object's lists", () => {
    const markdown = renderLinearObjectMarkdown(
      {
        objectType: "project",
        title: "Roadmap",
        url: "https://linear.app/acme/project/roadmap-0123456789ab",
        facts: [
          ["Status", "In Progress"],
          ["Lead", null],
          ["Teams", ""],
        ],
        content: "Ship the plan.",
        lists: [
          { heading: "Milestones", items: [] },
          { heading: "Issues", items: ["ENG-1 Fix login (Todo)"] },
        ],
      },
      10_000,
    );

    assert.strictEqual(
      markdown,
      [
        "# Project: Roadmap",
        "https://linear.app/acme/project/roadmap-0123456789ab",
        "",
        "Status: In Progress",
        "",
        "## Description",
        "Ship the plan.",
        "",
        "## Issues",
        "- ENG-1 Fix login (Todo)",
      ].join("\n"),
    );
  });

  it("keeps the header and lists whole and cuts the content to fit", () => {
    const markdown = renderLinearObjectMarkdown(
      {
        objectType: "document",
        title: "Spec",
        url: "https://linear.app/acme/document/spec-0123456789ab",
        facts: [],
        content: "word ".repeat(1_000),
        lists: [],
      },
      300,
    );

    assert.isAtMost(markdown.length, 300);
    assert.isTrue(markdown.startsWith("# Document: Spec\nhttps://linear.app/acme/document/spec-"));
    assert.isTrue(markdown.endsWith("…[truncated]"));
  });
});
