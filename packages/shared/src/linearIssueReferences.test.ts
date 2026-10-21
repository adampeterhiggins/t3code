import { describe, expect, it } from "vite-plus/test";

import {
  linearIssueReferences,
  linearIssueReferenceUrl,
  mayHaveLinearIssueReference,
} from "./linearIssueReferences.ts";

function identifiers(text: string, teamKeys: ReadonlyArray<string>) {
  const references = linearIssueReferences("acme", teamKeys);
  return references === null ? [] : Array.from(text.matchAll(references.pattern), (m) => m[0]);
}

describe("linearIssueReferences", () => {
  it("matches only the workspace's team keys", () => {
    expect(identifiers("PSET-1250, ENG-7, UTF-8 and ISO-8601", ["PSET", "ENG"])).toEqual([
      "PSET-1250",
      "ENG-7",
    ]);
  });

  it("skips identifiers inside longer words, slugs, and lower-case branch names", () => {
    expect(
      identifiers("XPSET-1 PSET-12-fix PSET-3a adam/pset-1250-serve (PSET-4).", ["PSET"]),
    ).toEqual(["PSET-4"]);
  });

  it("is null without a workspace or a usable team key", () => {
    expect(linearIssueReferences("", ["ENG"])).toBeNull();
    expect(linearIssueReferences("acme", [])).toBeNull();
    expect(linearIssueReferences("acme", ["a|b", "eng"])).toBeNull();
  });

  it("cheaply rules out text without an identifier", () => {
    expect(mayHaveLinearIssueReference("no issues here, pset-1")).toBe(false);
    expect(mayHaveLinearIssueReference("see ENG-12")).toBe(true);
  });

  it("links to the issue in the workspace", () => {
    expect(linearIssueReferenceUrl("acme", "ENG-12")).toBe("https://linear.app/acme/issue/ENG-12");
  });
});
