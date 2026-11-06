import { describe, expect, it } from "vite-plus/test";

import { inlineMarkdownUnitMarks, parseInlineMarkdown } from "./composer-rich-text";

describe("composer rich text markdown", () => {
  it("preserves unmatched markers, escaped markers, and identifiers", () => {
    for (const text of [
      "plain text",
      "snake_case",
      "unmatched **",
      "** spaced **",
      "\\*literal\\*",
    ]) {
      expect(parseInlineMarkdown(text)).toEqual([{ text, marks: [] }]);
    }
  });

  it("renders triple markers and nested styles", () => {
    expect(parseInlineMarkdown("***both***")).toEqual([
      { text: "both", marks: ["bold", "italic"] },
    ]);
    expect(parseInlineMarkdown("*a **b** c*")).toEqual([
      { text: "a ", marks: ["italic"] },
      { text: "b", marks: ["italic", "bold"] },
      { text: " c", marks: ["italic"] },
    ]);
    expect(parseInlineMarkdown("**a `code` c**")).toEqual([
      { text: "a ", marks: ["bold"] },
      { text: "code", marks: ["bold", "code"] },
      { text: " c", marks: ["bold"] },
    ]);
  });

  it("preserves crossing italic and bold spans", () => {
    expect(parseInlineMarkdown("*a**b*****c**")).toEqual([
      { text: "a", marks: ["italic"] },
      { text: "b", marks: ["italic", "bold"] },
      { text: "c", marks: ["bold"] },
    ]);
  });

  it("keeps repeated and alternate delimiters literal inside an active mark", () => {
    const repeated = "*".repeat(10_000);
    expect(parseInlineMarkdown(repeated + "text" + repeated)).toEqual([
      { text: repeated.slice(2) + "text", marks: ["bold"] },
      { text: repeated.slice(2), marks: [] },
    ]);
    const alternate = "__".repeat(5_000);
    expect(parseInlineMarkdown("**~~" + alternate + "text" + alternate + "~~**")).toEqual([
      { text: alternate + "text" + alternate, marks: ["bold", "strike"] },
    ]);
  });

  it("keeps code span contents literal", () => {
    expect(parseInlineMarkdown("`**not bold**`")).toEqual([
      { text: "**not bold**", marks: ["code"] },
    ]);
  });

  it("parses links, binding tighter than emphasis", () => {
    const link = "link:https://example.com/a_(b)";
    expect(parseInlineMarkdown("see [the **docs**](https://example.com/a_(b)) now")).toEqual([
      { text: "see ", marks: [] },
      { text: "the ", marks: [link] },
      { text: "docs", marks: [link, "bold"] },
      { text: " now", marks: [] },
    ]);
    expect(parseInlineMarkdown("**[a](u)** *x [y* z](v)")).toEqual([
      { text: "a", marks: ["bold", "link:u"] },
      { text: " *x ", marks: [] },
      { text: "y* z", marks: ["link:v"] },
    ]);
    expect(parseInlineMarkdown("[a](u)[b](v)")).toEqual([
      { text: "a", marks: ["link:u"] },
      { text: "b", marks: ["link:v"] },
    ]);
  });

  it("leaves non-links, and file links that become chips, literal", () => {
    for (const text of [
      "[]()",
      "[a]()",
      "[a] (u)",
      "[a](u v)",
      "\\[a](u)",
      "[a.ts](src/a.ts)",
      "- [ ] task",
    ]) {
      expect(parseInlineMarkdown(text)).toEqual([{ text, marks: [] }]);
    }
  });

  it("maps each source character to its marks, or null for a dropped delimiter", () => {
    const bold = ["bold"];
    expect(inlineMarkdownUnitMarks("**`*` w** \\*")).toEqual([
      null,
      null,
      null,
      ["bold", "code"],
      null,
      bold,
      bold,
      null,
      null,
      [],
      [],
      [],
    ]);
  });
});
