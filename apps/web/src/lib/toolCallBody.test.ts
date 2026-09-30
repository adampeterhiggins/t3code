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
});
