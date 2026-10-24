import { SourceControlProviderKind } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  GITHUB_ISSUE_REFERENCE,
  githubIssueReferenceUrl,
  githubRepositoryUrl,
} from "./githubIssueReferences.ts";

const references = (text: string) =>
  Array.from(text.matchAll(GITHUB_ISSUE_REFERENCE), (match) => match[0]);

describe("GITHUB_ISSUE_REFERENCE", () => {
  it("matches qualified and bare references in prose", () => {
    expect(references("See acme/api#7, PR #679 and (#12).")).toEqual(["acme/api#7", "#679", "#12"]);
  });

  it("skips fragments, paths, entities, and words that continue", () => {
    expect(references("page#1 a/b/c#2 &#123; #4a #5-b C# #0")).toEqual([]);
  });
});

describe("githubIssueReferenceUrl", () => {
  it("links a qualified reference anywhere, on the thread's host when it has one", () => {
    expect(githubIssueReferenceUrl("acme/api", "7", null)).toBe(
      "https://github.com/acme/api/issues/7",
    );
    expect(githubIssueReferenceUrl("acme/api", "7", "https://ghe.example.com/x/y")).toBe(
      "https://ghe.example.com/acme/api/issues/7",
    );
  });

  it("links a bare reference only with a repository", () => {
    expect(githubIssueReferenceUrl(undefined, "7", "https://github.com/acme/api")).toBe(
      "https://github.com/acme/api/issues/7",
    );
    expect(githubIssueReferenceUrl(undefined, "7", null)).toBeNull();
  });
});

describe("githubRepositoryUrl", () => {
  it("is the repository's web URL for GitHub projects only", () => {
    expect(
      githubRepositoryUrl({
        provider: SourceControlProviderKind.make("github"),
        canonicalKey: "github.com/acme/api",
        displayName: "Acme/API",
      }),
    ).toBe("https://github.com/Acme/API");
    expect(
      githubRepositoryUrl({
        provider: SourceControlProviderKind.make("gitlab"),
        canonicalKey: "gitlab.com/acme/api",
      }),
    ).toBeNull();
    expect(githubRepositoryUrl(null)).toBeNull();
  });

  it("prefers the web URL of the repository gh opens pull requests in", () => {
    expect(
      githubRepositoryUrl({
        provider: SourceControlProviderKind.make("github"),
        canonicalKey: "github.com/acme/api",
        displayName: "acme/api",
        webUrl: "https://github.com/me/api",
      }),
    ).toBe("https://github.com/me/api");
  });
});
