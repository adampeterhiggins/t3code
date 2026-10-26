import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { describe, expect, it } from "vite-plus/test";

import type { MarkdownNode } from "~/vendor/mdast-find-and-replace";
import { COLOR_CODE, describeColorCode, remarkColorCodes, wholeColorCode } from "./colorCodes";
import { remarkGitHubIssueReferences } from "./githubIssueMarkdown";

function colorCodes(markdown: string) {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown) as MarkdownNode;
  remarkGitHubIssueReferences("https://github.com/acme/web")(tree);
  remarkColorCodes()(tree);
  const found: string[] = [];
  const visit = (node: MarkdownNode) => {
    const code = (node.data as { hProperties?: { dataColorCode?: string } } | undefined)
      ?.hProperties?.dataColorCode;
    if (code) found.push(code);
    node.children?.forEach(visit);
  };
  visit(tree);
  return found;
}

describe("COLOR_CODE", () => {
  it("finds 3, 4, 6 and 8 digit hex colours, including all-digit ones", () => {
    expect("#fff, #0008 then #F2EDE5, #333333 and #1f6feb80.".match(COLOR_CODE)).toEqual([
      "#fff",
      "#0008",
      "#F2EDE5",
      "#333333",
      "#1f6feb80",
    ]);
  });

  it("leaves fragments, entities and anchors alone", () => {
    expect("page#abc &#abc; #abc-def #abcde #abcdefabc acme/web#bad".match(COLOR_CODE)).toBeNull();
  });
});

describe("remarkColorCodes", () => {
  it("marks colours in prose but not in code or links", () => {
    expect(colorCodes("Use #F2EDE5, not `#000fff` or [#abc](https://x.dev)")).toEqual(["#F2EDE5"]);
  });

  it("leaves all-digit codes as issue and pull request references", () => {
    expect(colorCodes("Merge #403 after #6719, then #333 and [#6264](https://x.dev)")).toEqual([]);
    expect(colorCodes("#333333 and #012345")).toEqual(["#012345"]);
  });
});

describe("wholeColorCode", () => {
  it("accepts inline code that is only a colour", () => {
    expect(wholeColorCode(" #E5484D ")).toBe("#E5484D");
    expect(wholeColorCode("color: #E5484D")).toBeNull();
    expect(wholeColorCode("#123")).toBeNull();
    expect(wholeColorCode("#0a0")).toBe("#0a0");
  });
});

describe("describeColorCode", () => {
  it("expands short forms and reports contrast", () => {
    expect(describeColorCode("#fff")).toEqual({
      rgb: "255 255 255",
      hsl: "0 0% 100%",
      contrastOnWhite: "1.00",
      contrastOnBlack: "21.00",
      prefersDarkText: true,
    });
    expect(describeColorCode("#0008")).toMatchObject({
      rgb: "0 0 0 / 53%",
      prefersDarkText: false,
    });
    expect(describeColorCode("#1F6FEB").hsl).toBe("216 84% 52%");
  });
});
