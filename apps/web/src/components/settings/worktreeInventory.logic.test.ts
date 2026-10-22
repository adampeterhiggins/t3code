import type { ManagedWorktree } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  ALL_WORKTREE_FILTERS,
  countWorktreeFacet,
  filterWorktrees,
  formatWorktreeDate,
  sortWorktrees,
  worktreeCheckout,
} from "./worktreeInventory.logic";

const worktree = (overrides: Partial<ManagedWorktree> & { path: string }): ManagedWorktree =>
  ({
    repositoryName: "t3code",
    projectId: null,
    branch: overrides.path,
    dirty: false,
    state: "settled",
    threads: [],
    pullRequest: null,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  }) as ManagedWorktree;

const at = (iso: string) => DateTime.makeUnsafe(iso);

describe("worktreeCheckout", () => {
  it("puts running work ahead of local changes, so neither reads as removable", () => {
    const running = worktree({
      path: "a",
      dirty: true,
      threads: [{ threadId: "t" as never, title: "T", state: "active", running: true }],
    });
    expect(worktreeCheckout(running)).toBe("running");
    expect(worktreeCheckout(worktree({ path: "b", dirty: true }))).toBe("dirty");
    expect(worktreeCheckout(worktree({ path: "c", dirty: null }))).toBe("unknown");
    expect(worktreeCheckout(worktree({ path: "d" }))).toBe("clean");
  });
});

describe("filterWorktrees", () => {
  const entries = [
    worktree({ path: "/w/t3code/a", branch: "feature/search", state: "active" }),
    worktree({ path: "/w/forge/b", repositoryName: "forge", dirty: true }),
    worktree({
      path: "/w/t3code/c",
      pullRequest: { number: 7, url: "https://example.test/7", state: "merged" },
    }),
  ];

  it("combines filters with search over branches, paths and thread titles", () => {
    expect(
      filterWorktrees(entries, { ...ALL_WORKTREE_FILTERS, project: "t3code" }, "").map(
        (e) => e.path,
      ),
    ).toEqual(["/w/t3code/a", "/w/t3code/c"]);
    expect(
      filterWorktrees(entries, { ...ALL_WORKTREE_FILTERS, pullRequest: "merged" }, "").map(
        (e) => e.path,
      ),
    ).toEqual(["/w/t3code/c"]);
    expect(filterWorktrees(entries, ALL_WORKTREE_FILTERS, "SEARCH").map((e) => e.path)).toEqual([
      "/w/t3code/a",
    ]);
  });

  it("counts every value of a filter so the menu agrees with what it shows", () => {
    expect(countWorktreeFacet(entries, "checkout")).toEqual({ all: 3, clean: 2, dirty: 1 });
    expect(countWorktreeFacet(entries, "pullRequest")).toEqual({ all: 3, none: 2, merged: 1 });
  });
});

describe("sortWorktrees", () => {
  const entries = [
    worktree({ path: "old", updatedAt: at("2026-10-01T00:00:00Z") }),
    worktree({ path: "unknown" }),
    worktree({ path: "new", updatedAt: at("2026-10-20T00:00:00Z") }),
  ];

  it("keeps rows without a value last in both directions", () => {
    const updated = (direction: "asc" | "desc") =>
      sortWorktrees(entries, { column: "updated", direction }, {}).map((e) => e.path);
    expect(updated("desc")).toEqual(["new", "old", "unknown"]);
    expect(updated("asc")).toEqual(["old", "new", "unknown"]);

    const sizes = { old: 10, new: 30 };
    expect(
      sortWorktrees(entries, { column: "size", direction: "asc" }, sizes).map((e) => e.path),
    ).toEqual(["old", "new", "unknown"]);
  });
});

describe("formatWorktreeDate", () => {
  const nowMs = Date.parse("2026-10-22T12:00:00Z");
  const value = at("2026-10-19T12:00:00Z");

  it("shows the chosen format, and a dash when the server sent no date", () => {
    expect(formatWorktreeDate(value, "relative", "24-hour", nowMs)).toBe("3d ago");
    expect(formatWorktreeDate(value, "date", "24-hour", nowMs)).toMatch(/2026/);
    expect(formatWorktreeDate(value, "datetime", "24-hour", nowMs)).toMatch(/2026.*\d{2}:\d{2}/);
    expect(formatWorktreeDate(null, "relative", "24-hour", nowMs)).toBe("—");
    expect(formatWorktreeDate(undefined, "date", "24-hour", nowMs)).toBe("—");
  });
});
