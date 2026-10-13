import { describe, expect, it } from "vite-plus/test";

import {
  checkoutCandidates,
  checkoutDirectoriesForTurn,
  formatLinkedCheckoutPrompt,
  linkedCheckoutsAfter,
  looksLikeCheckoutPath,
  rankCheckoutCandidates,
  sameCheckoutRepository,
} from "./checkouts.ts";

describe("checkout candidates", () => {
  it("lists project roots and worktrees once per path, and only the current environment is selectable", () => {
    const candidates = checkoutCandidates({
      currentEnvironmentId: "local",
      projects: [
        { environmentId: "local", title: "forge", workspaceRoot: "/work/forge/" },
        { environmentId: "remote", title: "t3code", workspaceRoot: "/srv/t3code" },
      ],
      worktrees: [
        { environmentId: "local", worktreePath: "/work/forge" },
        { environmentId: "local", worktreePath: "/work/t3" },
        { environmentId: "remote", worktreePath: null },
      ],
      environmentLabel: (id) => id,
    });
    expect(candidates.map((candidate) => [candidate.path, candidate.selectable])).toEqual([
      ["/work/forge", true],
      ["/srv/t3code", false],
      ["/work/t3", true],
    ]);
  });

  it("treats a slash as a pasted path and ranks recent checkouts first", () => {
    expect(looksLikeCheckoutPath("forge")).toBe(false);
    expect(looksLikeCheckoutPath("~/work/forge")).toBe(true);
    const ranked = rankCheckoutCandidates(
      [
        { path: "/work/b", name: "b" },
        { path: "/work/a", name: "a" },
      ],
      "",
      new Map([["/work/b", 0]]),
    );
    expect(ranked.map((candidate) => candidate.name)).toEqual(["b", "a"]);
  });
});

describe("linked checkouts", () => {
  const linkedAt = "2026-10-13T12:00:00.000Z";

  it("links, refuses a duplicate, unlinks, and relocates onto a free path", () => {
    const linked = linkedCheckoutsAfter([], {
      type: "link",
      path: "/work/forge/",
      name: "forge",
      linkedAt,
    });
    expect(linked.links).toEqual([{ path: "/work/forge", name: "forge", linkedAt }]);
    expect(
      linkedCheckoutsAfter(linked.links, {
        type: "link",
        path: "/work/forge",
        name: "forge",
        linkedAt,
      }).changed,
    ).toBe(false);
    const moved = linkedCheckoutsAfter(linked.links, {
      type: "relocate",
      fromPath: "/work/forge",
      path: "/work/forge-new",
      name: "forge",
    });
    expect(moved.links[0]?.path).toBe("/work/forge-new");
    expect(
      linkedCheckoutsAfter(moved.links, { type: "unlink", path: "/work/forge-new" }).links,
    ).toEqual([]);
  });

  it("tells the agent about a linked checkout the message does not already reference", () => {
    expect(
      formatLinkedCheckoutPrompt(
        [{ name: "forge", path: "/work/forge" }],
        [{ kind: "checkout", path: "/work/forge" }],
        "read",
      ),
    ).toBe("");
    expect(
      formatLinkedCheckoutPrompt([{ name: "forge", path: "/work/forge" }], [], "path-only"),
    ).toContain("shared only");
    expect(
      checkoutDirectoriesForTurn({
        driver: "claudeAgent",
        linked: [{ path: "/work/forge" }],
        records: [{ kind: "checkout", path: "/work/other" }],
      }),
    ).toEqual(["/work/forge", "/work/other"]);
    expect(
      checkoutDirectoriesForTurn({
        driver: "codex",
        linked: [{ path: "/work/forge" }],
        records: [],
      }),
    ).toEqual([]);
  });
});

describe("sameCheckoutRepository", () => {
  const repo = { exists: true, isRepo: true, repositoryKey: "/work/forge/.git" };

  it("matches two paths that share a git directory", () => {
    expect(sameCheckoutRepository(repo, { ...repo })).toBe(true);
    expect(sameCheckoutRepository(repo, { ...repo, repositoryKey: "/other/.git" })).toBe(false);
    expect(
      sameCheckoutRepository(repo, { exists: false, isRepo: false, repositoryKey: null }),
    ).toBe(false);
  });
});
