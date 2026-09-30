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
