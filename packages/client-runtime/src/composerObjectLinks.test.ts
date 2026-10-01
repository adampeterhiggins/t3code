import { describe, expect, it } from "vite-plus/test";

import {
  findComposerObjectLinks,
  findTypedComposerObjectLink,
  locateComposerObjectLink,
  objectLinkLabel,
  parseComposerObjectLink,
} from "./composerObjectLinks.ts";

describe("parseComposerObjectLink", () => {
  it("reads a Linear issue link as its identifier", () => {
    expect(
      parseComposerObjectLink("https://linear.app/acme/issue/eng-123/fix-the-thing"),
    ).toMatchObject({ kind: "linear-issue", identifier: "ENG-123" });
    expect(parseComposerObjectLink("https://linear.app/acme/project/roadmap-abc")).toBeNull();
  });

  it("tells pull requests, issues, and repository roots apart", () => {
    expect(parseComposerObjectLink("https://github.com/acme/api/pull/7")?.kind).toBe(
      "pull-request",
    );
    expect(parseComposerObjectLink("https://gitlab.com/acme/api/-/merge_requests/7")?.kind).toBe(
      "pull-request",
    );
    expect(parseComposerObjectLink("https://github.com/acme/api/issues/12")?.kind).toBe(
      "github-issue",
    );
    expect(parseComposerObjectLink("https://github.com/acme/api.git")).toMatchObject({
      kind: "repository",
      nameWithOwner: "acme/api",
      remoteUrl: "https://github.com/acme/api",
    });
  });

  it("leaves ordinary links alone", () => {
    expect(parseComposerObjectLink("https://github.com/acme/api/blob/main/README.md")).toBeNull();
    expect(parseComposerObjectLink("https://github.com/acme")).toBeNull();
    expect(parseComposerObjectLink("https://sentry.io/organizations/acme/issues/123")).toBeNull();
    expect(parseComposerObjectLink("https://example.com/acme/api")).toBeNull();
  });
});

describe("objectLinkLabel", () => {
  it("names pull requests, issues, Linear issues, and repositories", () => {
    expect(objectLinkLabel("https://github.com/Acme/API/pull/7/files")).toBe("Acme/API#7");
    expect(objectLinkLabel("https://gitlab.com/acme/group/api/-/merge_requests/3")).toBe(
      "acme/group/api#3",
    );
    expect(objectLinkLabel("https://github.com/acme/api/issues/12")).toBe("acme/api#12");
    expect(objectLinkLabel("https://linear.app/acme/issue/eng-123/fix-the-thing")).toBe("ENG-123");
    expect(objectLinkLabel("https://github.com/acme/api.git")).toBe("acme/api");
  });

  it("has no label for ordinary links", () => {
    expect(objectLinkLabel("https://github.com/acme/api/blob/main/README.md")).toBeNull();
    expect(objectLinkLabel("https://example.com/acme/api")).toBeNull();
  });
});

describe("findComposerObjectLinks", () => {
  it("finds links in prose without their trailing punctuation", () => {
    const text =
      "See https://github.com/acme/api/pull/7, and (https://linear.app/acme/issue/ENG-1).";
    expect(findComposerObjectLinks(text).map(({ link, index }) => [link.url, index])).toEqual([
      ["https://github.com/acme/api/pull/7", 4],
      ["https://linear.app/acme/issue/ENG-1", 45],
    ]);
  });

  it("skips markdown link targets", () => {
    expect(findComposerObjectLinks("[the PR](https://github.com/acme/api/pull/7)")).toEqual([]);
  });
});

describe("locateComposerObjectLink", () => {
  const url = "https://github.com/acme/api";

  it("picks the whole-link occurrence nearest the hint", () => {
    const text = `${url}/pull/7 then ${url} and ${url}.`;
    const first = text.indexOf(`${url} `);
    const second = text.lastIndexOf(url);
    expect(locateComposerObjectLink(text, url, 0)).toEqual({
      start: first,
      end: first + url.length,
    });
    expect(locateComposerObjectLink(text, url, text.length)).toEqual({
      start: second,
      end: second + url.length,
    });
  });

  it("returns null once the link is gone", () => {
    expect(locateComposerObjectLink(`${url}/pull/7`, url, 0)).toBeNull();
  });
});

describe("findTypedComposerObjectLink", () => {
  const url = "https://github.com/acme/api/pull/7";

  it("finds a link once whitespace ends it", () => {
    const text = `See ${url}, `;
    expect(findTypedComposerObjectLink(text, text.length)).toEqual({
      link: { kind: "pull-request", url },
      index: 4,
    });
    expect(findTypedComposerObjectLink(`${url}\n`, url.length + 1)?.index).toBe(0);
  });

  it("waits while the link is still being typed", () => {
    expect(findTypedComposerObjectLink(`See ${url}`, url.length + 4)).toBeNull();
    expect(findTypedComposerObjectLink(`${url} and `, url.length + 5)).toBeNull();
  });
});
