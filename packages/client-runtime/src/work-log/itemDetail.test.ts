import { ThreadId, TurnItemId, type OrchestrationV2TurnItem } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  fileChangeDiffWithheld,
  fileChangePreviewText,
  toolReadRangeLabel,
  turnItemOutputImages,
  turnItemOutputText,
} from "./itemDetail.ts";

function fileChange(
  fields: Partial<Extract<OrchestrationV2TurnItem, { readonly type: "file_change" }>>,
): OrchestrationV2TurnItem {
  const at = DateTime.makeUnsafe("2026-10-05T10:00:00.000Z");
  return {
    id: TurnItemId.make("edit"),
    threadId: ThreadId.make("thread"),
    runId: null,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: 0,
    status: "completed",
    title: null,
    startedAt: at,
    completedAt: at,
    updatedAt: at,
    type: "file_change",
    fileName: "src/a.ts",
    ...fields,
  };
}

describe("file change previews", () => {
  it("knows when the timeline left a successful edit's diff out", () => {
    expect(fileChangeDiffWithheld(fileChange({}))).toBe(true);
    expect(fileChangeDiffWithheld(fileChange({ oldStr: "a", newStr: "b" }))).toBe(false);
    expect(fileChangeDiffWithheld(fileChange({ status: "failed" }))).toBe(false);
  });

  it("renders a bounded unified diff with line counts", () => {
    const preview = fileChangePreviewText(
      fileChange({ oldStr: "const a = 1;\n", newStr: "const a = 2;\nconst b = 3;\n" }),
    );
    expect(preview).toContain("+2, −1 lines");
    expect(preview).toContain("Diff\n");
    expect(preview).toContain("+const b = 3;");
  });

  it("prefers the provider's line counts and stays empty without a diff or for a failure", () => {
    expect(
      fileChangePreviewText(
        fileChange({ diffStr: "@@ -1 +1 @@\n-a\n+b\n", additions: 4, deletions: 2 }),
      ),
    ).toContain("+4, −2 lines");
    expect(fileChangePreviewText(fileChange({}))).toBeNull();
    expect(
      fileChangePreviewText(fileChange({ status: "failed", diffStr: "String not found" })),
    ).toBeNull();
  });
});

describe("toolReadRangeLabel", () => {
  it("names the lines a read covered", () => {
    expect(toolReadRangeLabel({ file_path: "a.ts", offset: 10, limit: 40 })).toBe("Lines 10–49");
    expect(toolReadRangeLabel({ path: "a.ts", start_line: 3, end_line: 9 })).toBe("Lines 3–9");
    expect(toolReadRangeLabel({ file_path: "a.ts", offset: 12 })).toBe("From line 12");
    expect(toolReadRangeLabel({ file_path: "a.ts", limit: 5 })).toBe("First 5 lines");
    expect(toolReadRangeLabel({ file_path: "a.ts" })).toBeNull();
    expect(toolReadRangeLabel("a.ts")).toBeNull();
  });
});

const screenshot = {
  id: TurnItemId.make("tool-screenshot"),
  type: "dynamic_tool" as const,
  threadId: ThreadId.make("thread-1"),
  runId: null,
  nodeId: null,
  providerThreadId: null,
  providerTurnId: null,
  nativeItemRef: null,
  parentItemId: null,
  ordinal: 1,
  status: "completed" as const,
  title: null,
  toolName: "mcp__t3-code__device_screenshot",
  input: { deviceId: "phone" },
  // What a detail read returns: the image's position without its bytes.
  output: {
    content: [
      { type: "text", text: "Captured the home screen." },
      { type: "image", mimeType: "image/png" },
    ],
  },
  startedAt: DateTime.makeUnsafe("2026-10-05T00:00:00.000Z"),
  completedAt: DateTime.makeUnsafe("2026-10-05T00:00:01.000Z"),
  updatedAt: DateTime.makeUnsafe("2026-10-05T00:00:01.000Z"),
};

describe("tool output images", () => {
  it("shows a screenshot as an image asset, not as text", () => {
    expect(turnItemOutputImages(screenshot)).toEqual([
      {
        _tag: "tool-output-image",
        threadId: screenshot.threadId,
        itemId: screenshot.id,
        index: 0,
      },
    ]);
    expect(turnItemOutputText(screenshot)).toBe("Captured the home screen.");
    expect(
      turnItemOutputText({ ...screenshot, output: { content: [screenshot.output.content[1]] } }),
    ).toBeNull();
  });

  it("keeps a placeholder for images it cannot show", () => {
    const output = { content: [{ type: "image", mimeType: "image/svg+xml" }] };
    expect(turnItemOutputImages({ ...screenshot, output })).toEqual([]);
    expect(turnItemOutputText({ ...screenshot, output })).toBe("[image]");
  });
});
