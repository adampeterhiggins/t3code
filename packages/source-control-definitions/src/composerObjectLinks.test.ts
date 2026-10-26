import { describe, expect, it } from "vite-plus/test";

import {
  findComposerObjectLinks,
  findPastedComposerObjectLinks,
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
  });

  it("reads Linear project, document, and initiative links by their slug id", () => {
    expect(
      parseComposerObjectLink(
        "https://linear.app/focaldata/project/structured-discussion-guide-bc857ff37b9f/issues?layout=list&ordering=priority",
      ),
    ).toMatchObject({
      kind: "linear-object",
      objectType: "project",
      slugId: "bc857ff37b9f",
      name: "Structured discussion guide",
    });
    expect(
      parseComposerObjectLink("https://linear.app/acme/document/launch-plan-0123456789AB"),
    ).toMatchObject({ kind: "linear-object", objectType: "document", slugId: "0123456789ab" });
    expect(
      parseComposerObjectLink("https://linear.app/acme/initiative/0123456789ab/overview"),
    ).toMatchObject({ kind: "linear-object", objectType: "initiative", name: null });
    // Without a slug id there is nothing Linear can look up.
    expect(parseComposerObjectLink("https://linear.app/acme/project/roadmap-abc")).toBeNull();
    expect(parseComposerObjectLink("https://linear.app/acme/view/my-view-0123456789ab")).toBeNull();
    expect(parseComposerObjectLink("https://linear.app/acme/projects/all")).toBeNull();
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

  it("reads releases, branches or tags, and commits as GitHub refs", () => {
    expect(
      parseComposerObjectLink("https://github.com/focaldata/fd-common/releases/tag/v0.8.0"),
    ).toMatchObject({
      kind: "github-ref",
      repository: "focaldata/fd-common",
      linkType: "release",
      ref: "v0.8.0",
    });
    expect(
      parseComposerObjectLink("https://github.com/acme/api/tree/feature%2Fretry"),
    ).toMatchObject({ kind: "github-ref", linkType: "tree", ref: "feature/retry" });
    expect(parseComposerObjectLink("https://github.com/acme/api/commit/AD4EEEA")).toMatchObject({
      kind: "github-ref",
      linkType: "commit",
      ref: "ad4eeea",
    });
    // Release lists, commit lists, and enterprise hosts stay links.
    expect(parseComposerObjectLink("https://github.com/acme/api/releases")).toBeNull();
    expect(parseComposerObjectLink("https://github.com/acme/api/commits/main")).toBeNull();
    expect(parseComposerObjectLink("https://github.com/acme/api/commit/not-a-sha")).toBeNull();
    expect(parseComposerObjectLink("https://github.acme.com/acme/api/tree/main")).toBeNull();
  });

  it("reads a T3 Code prompt link as the prompt it opens with", () => {
    const url =
      "https://app.t3.codes/new?prompt=what+happened+here%3F+%0A%0Ahttps%3A%2F%2Fgithub.com%2Facme%2Fapi%2Factions%2Fruns%2F1&repo=acme/api";
    expect(parseComposerObjectLink(url)).toEqual({
      kind: "prompt-link",
      url,
      prompt: "what happened here? \n\nhttps://github.com/acme/api/actions/runs/1",
      target: "acme/api",
    });
    expect(
      parseComposerObjectLink("https://app.t3.codes/new?pr=acme/api/7&prompt=review"),
    ).toMatchObject({ kind: "prompt-link", prompt: "review", target: "acme/api#7" });
    expect(
      parseComposerObjectLink("https://app.t3.codes/env-1/thread-1?prompt=continue"),
    ).toMatchObject({ kind: "prompt-link", prompt: "continue", target: null });
    // Links that would not open stay links: no prompt, or only hidden characters.
    expect(parseComposerObjectLink("https://app.t3.codes/new")).toBeNull();
    expect(parseComposerObjectLink("https://app.t3.codes/new?prompt=%E2%80%8B")).toBeNull();
    expect(parseComposerObjectLink("https://app.t3.codes/env-1/thread-1")).toBeNull();
  });

  it("finds a pasted prompt link without swallowing the sentence around it", () => {
    const url = "https://app.t3.codes/new?prompt=fix+it";
    expect(findComposerObjectLinks(`see ${url}.`)).toEqual([
      { link: { kind: "prompt-link", url, prompt: "fix it", target: null }, index: 4 },
    ]);
    expect(objectLinkLabel(url)).toBeNull();
  });

  it("reads a Slack message permalink, with its thread when it is a reply", () => {
    expect(
      parseComposerObjectLink("https://acme.slack.com/archives/C04ABCD12/p1727779620000100"),
    ).toMatchObject({
      kind: "slack-message",
      workspace: "acme",
      channelId: "C04ABCD12",
      ts: "1727779620.000100",
      threadTs: null,
    });
    expect(
      parseComposerObjectLink(
        "https://acme.enterprise.slack.com/archives/C04ABCD12/p1727779620000100?thread_ts=1727773920.000200&cid=C04ABCD12",
      ),
    ).toMatchObject({ kind: "slack-message", threadTs: "1727773920.000200" });
    // A channel, not a message.
    expect(parseComposerObjectLink("https://acme.slack.com/archives/C04ABCD12")).toBeNull();
    expect(parseComposerObjectLink("https://app.slack.com/client/T1/C04ABCD12")).toBeNull();
  });

  it("reads a Discord message link, but not a channel or a direct message", () => {
    expect(
      parseComposerObjectLink(
        "https://canary.discord.com/channels/100000000000000001/100000000000000002/100000000000000003",
      ),
    ).toEqual({
      kind: "discord-message",
      url: "https://canary.discord.com/channels/100000000000000001/100000000000000002/100000000000000003",
      guildId: "100000000000000001",
      channelId: "100000000000000002",
      messageId: "100000000000000003",
    });
    expect(
      parseComposerObjectLink("https://discord.com/channels/100000000000000001/100000000000000002"),
    ).toBeNull();
    expect(
      parseComposerObjectLink(
        "https://discord.com/channels/@me/100000000000000002/100000000000000003",
      ),
    ).toBeNull();
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
    expect(
      objectLinkLabel(`https://github.com/acme/api/pull/7/changes#diff-${"a".repeat(64)}L4-L14`),
    ).toBe("acme/api#7 L4-L14");
    expect(objectLinkLabel("https://github.com/acme/api/issues/12")).toBe("acme/api#12");
    expect(objectLinkLabel("https://github.com/acme/api/pull/7#issuecomment-42")).toBe(
      "acme/api#7issuecomment-42",
    );
    expect(objectLinkLabel("https://github.com/acme/api/pull/7#discussion_r42")).toBe(
      "acme/api#7discussion_r42",
    );
    expect(objectLinkLabel("https://github.com/acme/api/pull/7#pullrequestreview-42")).toBe(
      "acme/api#7pullrequestreview-42",
    );
    expect(objectLinkLabel("https://github.com/acme/api/issues/12#issuecomment-42")).toBe(
      "acme/api#12issuecomment-42",
    );
    expect(objectLinkLabel("https://linear.app/acme/issue/eng-123/fix-the-thing")).toBe("ENG-123");
    expect(
      objectLinkLabel("https://linear.app/acme/project/q3-roadmap-0123456789ab/overview"),
    ).toBe("Q3 roadmap");
    expect(objectLinkLabel("https://linear.app/acme/initiative/0123456789ab")).toBe(
      "Linear initiative",
    );
    expect(objectLinkLabel("https://github.com/acme/api.git")).toBe("acme/api");
  });

  it("names GitHub refs owner/repo@ref, and leaves a tree link that may be a folder alone", () => {
    expect(objectLinkLabel("https://github.com/focaldata/fd-common/releases/tag/v0.8.0")).toBe(
      "focaldata/fd-common@v0.8.0",
    );
    expect(objectLinkLabel("https://github.com/acme/api/tree/main")).toBe("acme/api@main");
    expect(
      objectLinkLabel(
        "https://github.com/acme/api/commit/ad4eeea9da2ad42884d1974c67e555aedd5350b3",
      ),
    ).toBe("acme/api@ad4eeea");
    expect(objectLinkLabel("https://github.com/acme/api/tree/main/src")).toBeNull();
  });

  it("has no label for ordinary links", () => {
    expect(objectLinkLabel("https://github.com/acme/api/blob/main/README.md")).toBeNull();
    expect(objectLinkLabel("https://example.com/acme/api")).toBeNull();
  });

  it("leaves Slack message links as links", () => {
    expect(
      objectLinkLabel("https://acme.slack.com/archives/C04ABCD12/p1727779620000100"),
    ).toBeNull();
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

  it("skips links in code spans and fences, including an unclosed fence", () => {
    const url = "https://github.com/acme/api/pull/7";
    expect(findComposerObjectLinks(`Run \`curl ${url}\` then ${url}`)).toEqual([
      { link: { kind: "pull-request", url }, index: 17 + url.length },
    ]);
    expect(findComposerObjectLinks(`\`\`\`\n${url}\n\`\`\`\n`)).toEqual([]);
    expect(findComposerObjectLinks(`~~~sh\ncurl ${url}`)).toEqual([]);
  });
});

describe("findPastedComposerObjectLinks", () => {
  const url = "https://github.com/acme/api/pull/7";

  it("places pasted links in the prompt", () => {
    expect(findPastedComposerObjectLinks(`See ${url}`, url, 4)).toEqual([
      { link: { kind: "pull-request", url }, index: 4 },
    ]);
  });

  it("skips a link pasted into existing code", () => {
    expect(findPastedComposerObjectLinks(`Run \`${url}\``, url, 5)).toEqual([]);
    expect(findPastedComposerObjectLinks(`\`\`\`\n${url}\n\`\`\``, url, 4)).toEqual([]);
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

  it("ignores occurrences moved into code", () => {
    expect(locateComposerObjectLink(`\`${url}\``, url, 1)).toBeNull();
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

  it("leaves links typed in code alone", () => {
    const span = `\`${url} `;
    expect(findTypedComposerObjectLink(span, span.length)).toBeNull();
    const fence = `\`\`\`\n${url} `;
    expect(findTypedComposerObjectLink(fence, fence.length)).toBeNull();
  });
});

it("recognizes Notion page links in pasted prose", () => {
  const url = "https://www.notion.so/acme/Design-914a8531daa84753aacdf01274df8ec5";
  expect(parseComposerObjectLink(url)).toMatchObject({
    kind: "notion-page",
    pageId: "914a8531-daa8-4753-aacd-f01274df8ec5",
  });
  expect(objectLinkLabel(url)).toBe("Notion page");
  expect(findComposerObjectLinks(`Read ${url}.`)).toHaveLength(1);
});

it("recognizes Granola note links in pasted prose", () => {
  const url = "https://notes.granola.ai/d/ABD3F11C-1FF0-4E2C-AD7D-078D1FFCF27F";
  expect(parseComposerObjectLink(url)).toMatchObject({
    kind: "granola-note",
    noteId: "abd3f11c-1ff0-4e2c-ad7d-078d1ffcf27f",
  });
  expect(objectLinkLabel(url)).toBe("Granola note");
  expect(findComposerObjectLinks(`Notes: ${url}.`)).toHaveLength(1);
  expect(
    parseComposerObjectLink(
      "https://notes.granola.ai/t/8a5ddce1-1ff0-4e2c-ad7d-078d1ffcf27f-008umkv4",
    ),
  ).toMatchObject({ kind: "granola-note", noteId: "8a5ddce1-1ff0-4e2c-ad7d-078d1ffcf27f" });
  expect(parseComposerObjectLink("https://www.granola.ai/pricing")).toBeNull();
  expect(
    parseComposerObjectLink("http://notes.granola.ai/d/abd3f11c-1ff0-4e2c-ad7d-078d1ffcf27f"),
  ).toBeNull();
});

it("parses Google document and sheet citations through all link intake paths", () => {
  for (const url of [
    "https://mail.google.com/mail/#all/18abcdef12345678",
    "https://docs.google.com/document/d/doc_1/edit#heading=h.pricing",
    "https://docs.google.com/spreadsheets/d/sheet_1/edit#gid=42&range=B4:D6",
  ]) {
    expect(parseComposerObjectLink(url)).toMatchObject({ kind: "google-file", url });
    expect(findComposerObjectLinks(`Read ${url}.`)).toHaveLength(1);
    expect(findPastedComposerObjectLinks(url, url, 0)).toHaveLength(1);
  }
});
