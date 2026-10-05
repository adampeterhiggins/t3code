import { describe, expect, it } from "vite-plus/test";

import { claudeFileChangeDiff } from "./ClaudeAdapterV2.ts";

const fileName = "/repo/scratch/alpha.ts";
const record = (value: Record<string, unknown>) => ({ type: "record" as const, value });
// Claude's Edit result is a success message, not a patch.
const outputText = `The file ${fileName} has been updated successfully.`;

describe("claudeFileChangeDiff", () => {
  it("builds the diff and line counts from an Edit's input", () => {
    const result = claudeFileChangeDiff({
      fileName,
      toolInput: record({
        file_path: fileName,
        old_string: "export function sum(",
        new_string: "/**\n * Returns the sum of two numbers.\n */\nexport function sum(",
      }),
      failed: false,
      outputText,
    });
    // The old line survives as the last line, so only the comment is added.
    expect(result.additions).toBe(3);
    expect(result.deletions).toBe(0);
    expect(result.diffStr).toContain(`--- ${fileName}`);
    expect(result.diffStr).toContain("+ * Returns the sum of two numbers.");
    expect(result.diffStr).not.toContain("updated successfully");
  });

  it("combines a MultiEdit's edits and treats a Write as all additions", () => {
    const multi = claudeFileChangeDiff({
      fileName,
      toolInput: record({
        file_path: fileName,
        edits: [
          { old_string: "a", new_string: "b" },
          { old_string: "c", new_string: "d\ne" },
        ],
      }),
      failed: false,
      outputText,
    });
    expect(multi).toMatchObject({ additions: 3, deletions: 2 });
    const write = claudeFileChangeDiff({
      fileName,
      toolInput: record({ file_path: fileName, content: "one\ntwo\n" }),
      failed: false,
      outputText,
    });
    expect(write).toMatchObject({ additions: 2, deletions: 0 });
  });

  it("keeps the provider's error for a failed edit and omits the diff without input text", () => {
    expect(
      claudeFileChangeDiff({
        fileName,
        toolInput: record({ file_path: fileName, old_string: "x", new_string: "y" }),
        failed: true,
        outputText: "String to replace not found",
      }),
    ).toEqual({ diffStr: "String to replace not found" });
    expect(
      claudeFileChangeDiff({
        fileName,
        toolInput: record({ file_path: fileName }),
        failed: false,
        outputText,
      }),
    ).toEqual({});
  });
});
