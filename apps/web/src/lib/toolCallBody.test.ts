import { describe, expect, it } from "vite-plus/test";
import { summarizeToolActivityInput } from "@t3tools/shared/toolActivity";
import { parseToolCallBody } from "./toolCallBody";

describe("parseToolCallBody", () => {
  it("renders generated replacements as unified diffs with unchanged context", () => {
    const summary = summarizeToolActivityInput({
      rawInput: {
        file_path: "test.py",
        old_string: "unchanged\nbefore\n",
        new_string: "unchanged\nafter\nextra\n",
      },
    })!;
    const blocks = parseToolCallBody(summary);
    const diff = blocks.find((block) => block.kind === "diff");
    expect(diff?.files[0]?.hunks[0]).toMatchObject({ additionLines: 2, deletionLines: 1 });
    expect(blocks.some((block) => block.kind === "text" && block.text.includes("Before\n"))).toBe(
      false,
    );
  });

  it("renders Codex file changes, which omit patch headers, as diffs", () => {
    const summary = summarizeToolActivityInput({
      item: {
        changes: [
          {
            path: "tests/test_a.py",
            kind: { type: "update", move_path: null },
            diff: "@@ -71,3 +71,3 @@\n @fixture\n-def client(\n+def a_client(\n     maker,\n",
          },
          { path: "src/new.py", kind: { type: "add" }, diff: "one\ntwo\n" },
          { path: "src/old.py", kind: { type: "delete" }, diff: "gone\n" },
        ],
      },
    })!;
    const diffs = parseToolCallBody(summary).flatMap((block) =>
      block.kind === "diff" ? block.files : [],
    );
    expect(diffs.map((file) => file.hunks[0])).toMatchObject([
      { additionLines: 1, deletionLines: 1 },
      { additionLines: 2, deletionLines: 0 },
      { additionLines: 0, deletionLines: 1 },
    ]);
    expect(summary).toContain("src/new.py\n\n+2, −0 lines");
  });

  it("keeps malformed provider patches readable", () => {
    expect(parseToolCallBody("Diff\nnot a patch")).toEqual([
      { kind: "text", text: "Diff\nnot a patch" },
    ]);
  });

  it("keys each patch by its content so worker highlights match their diff", () => {
    const key = (old_string: string, new_string: string) => {
      const summary = summarizeToolActivityInput({
        rawInput: { file_path: "src/a.ts", old_string, new_string },
      })!;
      const diff = parseToolCallBody(summary).find((block) => block.kind === "diff");
      return diff?.kind === "diff" ? diff.files[0]?.cacheKey : undefined;
    };
    expect(key("a", "b")).toBeDefined();
    expect(key("a", "b")).toBe(key("a", "b"));
    expect(key("a", "b")).not.toBe(key("a", "c"));
  });
});
