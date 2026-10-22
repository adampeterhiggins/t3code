import type { Root } from "mdast";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { describe, expect, it } from "vite-plus/test";

import { remarkChatMentions } from "./chatThreadMentions";

function mentionsIn(markdown: string, mentions: ReadonlyArray<string>): Array<string> {
  const tree = unified().use(remarkParse).parse(markdown) as Root;
  remarkChatMentions(mentions)(tree);
  const found: Array<string> = [];
  const visit = (node: Root | Root["children"][number]) => {
    if (node.type === "text" && node.data?.hName === "span") found.push(node.value);
    if ("children" in node) node.children.forEach(visit);
  };
  visit(tree);
  return found;
}

describe("remarkChatMentions", () => {
  it("marks multi-word mentions, preferring the longest", () => {
    expect(
      mentionsIn("@Ben Lobo will do, cc @Ben and @fdai-eng in #eng", [
        "@Ben",
        "@Ben Lobo",
        "@fdai-eng",
        "#eng",
      ]),
    ).toEqual(["@Ben Lobo", "@Ben", "@fdai-eng", "#eng"]);
  });

  it("skips code, links, and longer names", () => {
    expect(mentionsIn("`@Ben` [@Ben](https://x.test) @Benjamin **@Ben**", ["@Ben"])).toEqual([
      "@Ben",
    ]);
  });
});
