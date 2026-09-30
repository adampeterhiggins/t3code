import { describe, expect, it } from "vite-plus/test";
import { summarizeToolActivityInput } from "./toolActivityPreview";

describe("summarizeToolActivityInput", () => {
  it("shows Claude and ACP edit replacements without sending full file bodies", () => {
    for (const input of [
      { file_path: "src/a.ts", old_string: "before", new_string: "after" },
      { path: "src/a.ts", oldText: "before", newText: "after" },
    ]) {
      expect(summarizeToolActivityInput({ rawInput: input })).toBe(
        "src/a.ts\n\nBefore\nbefore\n\nAfter\nafter",
      );
    }
    expect(
      summarizeToolActivityInput({
        input: { old_string: "a".repeat(100000), new_string: "b".repeat(100000) },
      })!.length,
    ).toBeLessThanOrEqual(2400);
  });

  it("counts Codex diff lines without counting file headers", () => {
    expect(
      summarizeToolActivityInput({
        item: {
          changes: [
            {
              path: "src/a.ts",
              diff: "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-before\n+after",
            },
            { path: "src/b.ts", linesAdded: 3, linesRemoved: 1 },
          ],
        },
      }),
    ).toContain("src/a.ts\n\n+1, −1 lines\n\nDiff\n");
    expect(
      summarizeToolActivityInput({
        item: { changes: [{ path: "src/b.ts", linesAdded: 3, linesRemoved: 1 }] },
      }),
    ).toBe("src/b.ts\n\n+3, −1 lines");
  });

  it("keeps read ranges, search arguments and command failures", () => {
    expect(
      summarizeToolActivityInput({ input: { file_path: "a.ts", offset: 20, limit: 10 } }),
    ).toBe("a.ts\n\nStart line: 20\n\nLimit: 10");
    expect(
      summarizeToolActivityInput({
        rawInput: { pattern: "TODO", glob: "*.ts", cwd: "/repo" },
        rawOutput: { exitCode: 2, error: "failed" },
      }),
    ).toBe(
      "Pattern: TODO\n\nGlob: *.ts\n\nWorking directory: /repo\n\nExit code: 2\n\nError: failed",
    );
    expect(
      summarizeToolActivityInput({ unknown: "secret", content: "full output" }),
    ).toBeUndefined();
  });
});
