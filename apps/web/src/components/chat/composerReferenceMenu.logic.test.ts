import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  type ComposerReferenceItem,
  type ComposerReferenceTab,
  orderComposerReferenceItems,
  predictComposerReferenceTab,
} from "./composerReferenceMenu.logic";

function linearIssue(identifier: string, title = "Issue"): ComposerReferenceItem {
  return {
    id: `linear-issue:${identifier}`,
    type: "linear-issue",
    issueId: identifier,
    label: identifier,
    description: title,
    assigneeName: null,
    stateName: "Todo",
  };
}

function githubIssue(number: number, title = "Issue"): ComposerReferenceItem {
  return {
    id: `github-issue:${number}`,
    type: "github-issue",
    url: `https://github.com/acme/app/issues/${number}`,
    label: `#${number}`,
    description: title,
    authorLogin: null,
    state: "open",
  };
}

function checkout(name: string): ComposerReferenceItem {
  return {
    id: `checkout:${name}`,
    type: "checkout",
    environmentId: EnvironmentId.make("env"),
    path: `/work/${name}`,
    branch: "main",
    headSha: null,
    changedFiles: 0,
    ahead: 0,
    selectable: true,
    label: name,
    description: `/work/${name}`,
  };
}

function repository(nameWithOwner: string): ComposerReferenceItem {
  return {
    id: `repository:${nameWithOwner}`,
    type: "repository",
    nameWithOwner,
    remoteUrl: `https://github.com/${nameWithOwner}`,
    label: nameWithOwner,
    description: "",
  };
}

const ALL_TABS = new Set<ComposerReferenceTab>([
  "pull-requests",
  "github-issues",
  "linear-issues",
  "slack-messages",
  "notion-pages",
  "repositories",
]);

function predict(
  query: string,
  overrides: Partial<Parameters<typeof predictComposerReferenceTab>[0]> = {},
) {
  return predictComposerReferenceTab({
    query,
    available: ALL_TABS,
    hasDefaultRepositoryOwner: false,
    recents: [],
    preloaded: {},
    ...overrides,
  });
}

describe("predictComposerReferenceTab", () => {
  it("opens checkouts when the query matches a local folder or a path", () => {
    const available = new Set<ComposerReferenceTab>([...ALL_TABS, "checkouts"]);
    expect(
      predict("forge", {
        available,
        hasDefaultRepositoryOwner: true,
        preloaded: { checkouts: [checkout("forge")] },
      }),
    ).toBe("checkouts");
    expect(predict("/work/forge", { available })).toBe("checkouts");
    expect(predict("acme/app", { available })).toBe("repositories");
  });

  it("reads the query's shape first", () => {
    expect(predict("ENG-123")).toBe("linear-issues");
    expect(predict("acme/")).toBe("repositories");
    expect(predict("cin-questionnaire", { hasDefaultRepositoryOwner: true })).toBe("repositories");
    expect(predict("cin-questionnaire")).toBe("pull-requests");
    expect(predict("123")).toBe("pull-requests");
    expect(predict("")).toBe("pull-requests");
  });

  it("ignores Linear shapes when Linear is not connected", () => {
    const available = new Set<ComposerReferenceTab>(["pull-requests", "repositories"]);
    expect(predict("ENG-123", { available })).toBe("pull-requests");
  });

  it("recognises a Linear team key the user has seen", () => {
    expect(predict("ENG")).toBe("pull-requests");
    expect(predict("eng", { preloaded: { "linear-issues": [linearIssue("ENG-7")] } })).toBe(
      "linear-issues",
    );
    expect(predict("ENG-", { recents: [linearIssue("ENG-7")] })).toBe("linear-issues");
  });

  it("opens an empty `#` on the tab the user inserts from most", () => {
    const recents = [githubIssue(1), linearIssue("ENG-1"), linearIssue("ENG-2")];
    expect(predict("", { recents })).toBe("linear-issues");
  });

  it("follows a recent insert that matches the query", () => {
    expect(predict("setgist", { recents: [repository("adam/setgist")] })).toBe("repositories");
    expect(predict("12", { recents: [githubIssue(12)] })).toBe("github-issues");
    expect(predict("12", { recents: [githubIssue(123)] })).toBe("pull-requests");
  });

  it("moves to a tab whose preloaded rows match when the preferred tab's do not", () => {
    const preloaded = {
      "pull-requests": [],
      "linear-issues": [linearIssue("ENG-4", "Hash insertion is slow")],
    };
    expect(predict("hash insertion", { preloaded })).toBe("linear-issues");
    expect(predict("unrelated", { preloaded })).toBe("pull-requests");
  });
});

describe("orderComposerReferenceItems", () => {
  it("puts an exact match first, then matching recents, then search order", () => {
    const items = [githubIssue(123), githubIssue(12), githubIssue(5, "twelve")];
    const recents = [githubIssue(912, "stale copy")];
    expect(
      orderComposerReferenceItems({ items, recents, query: "12", limit: 10 }).map(
        (item) => item.label,
      ),
    ).toEqual(["#12", "#912", "#123", "#5"]);
  });

  it("prefers the search's copy of a recent item", () => {
    const fresh = githubIssue(7, "Fresh title");
    const [first] = orderComposerReferenceItems({
      items: [githubIssue(1), fresh],
      recents: [githubIssue(7, "Old title")],
      query: "",
      limit: 10,
    });
    expect(first).toBe(fresh);
  });
});
