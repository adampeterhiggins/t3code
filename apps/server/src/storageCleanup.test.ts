import { describe, expect, it } from "@effect/vitest";

import { ignoredPathsBlockWorktreeRemoval } from "./storageCleanup.ts";

describe("ignoredPathsBlockWorktreeRemoval", () => {
  it("allows dependency installs and regenerable caches", () => {
    const stdout = [
      "node_modules/",
      "apps/web/node_modules/",
      ".venv/",
      "services/api/venv/",
      "src/pkg/__pycache__/",
      "src/pkg/__pycache__/mod.pyc",
      "loose.pyc",
      "loose.pyo",
      "tsconfig.tsbuildinfo",
      "pkg.egg-info/",
      ".pytest_cache/",
      ".mypy_cache/",
      ".ruff_cache/",
      ".next/",
      ".turbo/",
      ".DS_Store",
      "nested/.DS_Store",
      "",
    ].join("\0");

    expect(ignoredPathsBlockWorktreeRemoval(stdout, false)).toBe(false);
  });

  it("blocks secrets, local data, and truncated listings", () => {
    expect(ignoredPathsBlockWorktreeRemoval(".env\0", false)).toBe(true);
    expect(ignoredPathsBlockWorktreeRemoval(".cache/\0", false)).toBe(true);
    expect(ignoredPathsBlockWorktreeRemoval("data/local.csv\0", false)).toBe(true);
    expect(ignoredPathsBlockWorktreeRemoval("dist/\0", false)).toBe(true);
    expect(ignoredPathsBlockWorktreeRemoval("target/\0", false)).toBe(true);
    expect(ignoredPathsBlockWorktreeRemoval("node_modules/\0.env\0", false)).toBe(true);
    expect(ignoredPathsBlockWorktreeRemoval("__pycache__/\0", true)).toBe(true);
  });

  it("allows extra names from settings for files and directories", () => {
    const extra = new Set(["target", "dist"]);
    expect(ignoredPathsBlockWorktreeRemoval("target/\0src/dist\0", false, extra)).toBe(false);
    expect(ignoredPathsBlockWorktreeRemoval("target/\0.env\0", false, extra)).toBe(true);
  });
});
