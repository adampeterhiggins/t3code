import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { describe, expect, it } from "vite-plus/test";

import type { MarkdownNode } from "~/vendor/mdast-find-and-replace";
import { COLOR_CODE, describeColorCode, remarkColorCodes, wholeColorCode } from "./colorCodes";
import { remarkGitHubIssueReferences } from "./githubIssueMarkdown";

const REPOSITORY = "https://github.com/acme/web";

/** `linkBare` is true for the user's own messages, where `#123` links to the repository. */
function colorCodes(markdown: string, repositoryUrl: string | null | undefined, linkBare = false) {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown) as MarkdownNode;
  remarkGitHubIssueReferences(linkBare ? (repositoryUrl ?? null) : null)(tree);
  remarkColorCodes(repositoryUrl)(tree);
  const found: string[] = [];
  const visit = (node: MarkdownNode) => {
    const properties = (
      node.data as
        | { hProperties?: { dataColorCode?: string; dataColorReference?: string } }
        | undefined
    )?.hProperties;
    if (properties?.dataColorCode) {
      found.push(
        [node.type, properties.dataColorCode, properties.dataColorReference ?? node.url]
          .filter(Boolean)
          .join(" "),
      );
    }
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
    expect(colorCodes("Use #F2EDE5, not `#000fff` or [#abc](https://x.dev)", null)).toEqual([
      "text #F2EDE5",
    ]);
  });

  it("preserves explicit issue and pull request links with numeric colour labels", () => {
    expect(
      colorCodes(
        `[#6264](${REPOSITORY}/issues/6264) and [#6258](${REPOSITORY}/pull/6258)`,
        REPOSITORY,
      ),
    ).toEqual([]);
  });

  it("checks numbers that may be issues against the thread's repository", () => {
    expect(colorCodes("#333333 and #012345", REPOSITORY)).toEqual([
      `text #333333 ${REPOSITORY}/issues/333333`,
      "text #012345",
    ]);
    expect(colorCodes("#333333 and #012345", REPOSITORY, true)).toEqual(["text #012345"]);
    // Outside GitHub it is a colour; with no thread to ask, it stays text.
    expect(colorCodes("#333333 and #F2EDE5", null)).toEqual(["text #333333", "text #F2EDE5"]);
    expect(colorCodes("#333333 and #F2EDE5", undefined)).toEqual(["text #F2EDE5"]);
    expect(colorCodes("acme/api#333 and [#333](https://x.dev)", REPOSITORY, true)).toEqual([]);
  });
});

describe("wholeColorCode", () => {
  it("accepts inline code that is only a colour", () => {
    expect(wholeColorCode(" #E5484D ")).toBe("#E5484D");
    expect(wholeColorCode("color: #E5484D")).toBeNull();
    expect(wholeColorCode("#123")).toBe("#123");
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
