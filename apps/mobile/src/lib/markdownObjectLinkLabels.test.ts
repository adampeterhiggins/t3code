import { describe, expect, it } from "vite-plus/test";
import { markdownWithObjectLinkLabels } from "./markdownDocument";

describe("markdownWithObjectLinkLabels", () => {
  it("renames a bare pull request link but keeps chosen link text", () => {
    const href = "https://github.com/acme/api/pull/7";
    expect(markdownWithObjectLinkLabels(`See ${href} and [the PR](${href}).`)).toEqual({
      markdown: `See [acme/api#7](<${href}>) and [the PR](${href}).`,
      urls: [href],
    });
  });

  it("renames autolinks and links whose text is their URL", () => {
    const href = "https://github.com/acme/api/issues/12";
    expect(markdownWithObjectLinkLabels(`<${href}> [${href}](${href})`).markdown).toBe(
      `[acme/api#12](<${href}>) [acme/api#12](<${href}>)`,
    );
  });

  it("leaves ordinary links and code untouched", () => {
    const markdown = "Read https://example.com and `https://github.com/acme/api/pull/7`.";
    expect(markdownWithObjectLinkLabels(markdown)).toEqual({ markdown, urls: [] });
  });
});
