import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { describe, expect, it } from "vite-plus/test";

import type { MarkdownNode } from "~/vendor/mdast-find-and-replace";
import { remarkGitHubIssueReferences } from "./githubIssueMarkdown";

function links(markdown: string, repositoryUrl: string | null) {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown) as MarkdownNode;
  remarkGitHubIssueReferences(repositoryUrl)(tree);
  const found: string[] = [];
  const visit = (node: MarkdownNode) => {
    if (node.type === "link") found.push(`${node.children?.[0]?.value} ${node.url}`);
    node.children?.forEach(visit);
  };
  visit(tree);
  return found;
}

describe("remarkGitHubIssueReferences", () => {
  it("links qualified references, and bare ones only with the thread's repository", () => {
    expect(links("acme/api#7 and #8, not `#9`", null)).toEqual([
      "acme/api#7 https://github.com/acme/api/issues/7",
    ]);
    expect(links("Fixed in #8.", "https://github.com/acme/web")).toEqual([
      "#8 https://github.com/acme/web/issues/8",
    ]);
  });
});
