import { linearIssueReferences } from "@t3tools/shared/linearIssueReferences";
import { describe, expect, it } from "vite-plus/test";

import { markdownWithLinearIssueLinks } from "./markdownDocument";

const references = linearIssueReferences("acme", ["ENG"]);

describe("markdownWithLinearIssueLinks", () => {
  it("links bare identifiers to the workspace", () => {
    expect(markdownWithLinearIssueLinks("Fixes ENG-12 and **ENG-3**.", references)).toBe(
      "Fixes [ENG-12](https://linear.app/acme/issue/ENG-12) and **[ENG-3](https://linear.app/acme/issue/ENG-3)**.",
    );
  });

  it("leaves code and existing links as written", () => {
    const markdown =
      "`ENG-1`\n\n```\nENG-2\n```\n\n[ENG-3](https://linear.app/acme/issue/ENG-3) https://linear.app/acme/issue/ENG-4";
    expect(markdownWithLinearIssueLinks(markdown, references)).toBe(markdown);
  });

  it("does nothing until the workspace's teams are known", () => {
    expect(markdownWithLinearIssueLinks("ENG-12", null)).toBe("ENG-12");
  });
});
