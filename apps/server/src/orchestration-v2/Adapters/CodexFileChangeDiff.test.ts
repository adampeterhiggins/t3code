import { describe, expect, it } from "vite-plus/test";

import { codexFileChangeDiff } from "./CodexAdapterV2.ts";

const path = "/tmp/exercise/activity.py";

describe("codexFileChangeDiff", () => {
  it("turns a new file's raw contents into an all-additions patch", () => {
    // Codex sends an added file as its contents, not a patch.
    const result = codexFileChangeDiff([
      { path, kind: { type: "add" }, diff: '"""Activity."""\nimport json\n\nSAMPLES = {}\n' },
    ]);
    expect(result).toMatchObject({ additions: 4, deletions: 0 });
    expect(result.diffStr).toContain("@@ -0,0 +1,4 @@");
    expect(result.diffStr).toContain('+"""Activity."""');
  });

  it("adds file headers to an update's bare hunks and counts its lines", () => {
    const result = codexFileChangeDiff([
      {
        path,
        kind: { type: "update", move_path: null },
        diff: "@@ -14,2 +14,3 @@\n def summarize(samples):\n+    check(samples)\n-    pass\n+    return 1\n",
      },
    ]);
    expect(result).toMatchObject({ additions: 2, deletions: 1 });
    expect(result.diffStr?.startsWith(`--- a/${path}\n+++ b/${path}\n@@ -14,2 +14,3 @@`)).toBe(
      true,
    );
  });

  it("includes every change, with a deleted file as all deletions", () => {
    const result = codexFileChangeDiff([
      { path: "/tmp/a.txt", kind: { type: "delete" }, diff: "one\ntwo\n" },
      { path: "/tmp/b.txt", kind: { type: "add" }, diff: "three" },
    ]);
    expect(result).toMatchObject({ additions: 1, deletions: 2 });
    expect(result.diffStr).toContain("/tmp/a.txt");
    expect(result.diffStr).toContain("/tmp/b.txt");
  });
});
