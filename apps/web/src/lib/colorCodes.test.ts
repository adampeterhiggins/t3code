import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { describe, expect, it } from "vite-plus/test";

import type { MarkdownNode } from "~/vendor/mdast-find-and-replace";
import { COLOR_CODE, describeColorCode, remarkColorCodes, wholeColorCode } from "./colorCodes";

function colorCodes(markdown: string) {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown) as MarkdownNode;
  remarkColorCodes()(tree);
  const found: string[] = [];
  const visit = (node: MarkdownNode) => {
    const data = node.data as { hProperties?: { dataColorCode?: string } } | undefined;
    if (data?.hProperties?.dataColorCode) found.push(data.hProperties.dataColorCode);
    node.children?.forEach(visit);
  };
  visit(tree);
  return found;
}

describe("COLOR_CODE", () => {
  it("finds 3, 4, 6 and 8 digit hex colours", () => {
    expect("#fff, #000a then #F2EDE5 and #1f6feb80.".match(COLOR_CODE)).toEqual([
      "#fff",
      "#000a",
      "#F2EDE5",
      "#1f6feb80",
    ]);
  });

  it("leaves issue references, fragments, entities and anchors alone", () => {
    expect(
      "#123 #123456 page#abc &#abc; #abc-def #abcde #abcdefabc acme/web#bad".match(COLOR_CODE),
    ).toBeNull();
  });
});

describe("remarkColorCodes", () => {
  it("marks colours in prose but not in code or links", () => {
    expect(colorCodes("Use #F2EDE5, not `#000fff` or [#abc](https://x.dev)")).toEqual(["#F2EDE5"]);
  });
});

describe("wholeColorCode", () => {
  it("accepts inline code that is only a colour", () => {
    expect(wholeColorCode(" #E5484D ")).toBe("#E5484D");
    expect(wholeColorCode("color: #E5484D")).toBeNull();
    expect(wholeColorCode("#123")).toBeNull();
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
