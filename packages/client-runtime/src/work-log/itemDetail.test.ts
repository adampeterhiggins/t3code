import { ThreadId, TurnItemId, type OrchestrationV2TurnItem } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  fileChangeDiffWithheld,
  fileChangePreviewText,
  toolReadRangeLabel,
  turnItemOutputImages,
  turnItemOutputText,
  turnItemReadFile,
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

describe("JSON text results", () => {
  const textResult = (text: string) => ({
    ...screenshot,
    output: { content: [{ type: "text", text }] },
  });

  it("shows a lone text field as its text, not an escaped string", () => {
    expect(turnItemOutputText(textResult(JSON.stringify({ fileContent: "# Notes\n\nBody" })))).toBe(
      "# Notes\n\nBody",
    );
  });

  it("indents any other document", () => {
    expect(turnItemOutputText(textResult('{"id":"a","name":"b"}'))).toBe(
      '{\n  "id": "a",\n  "name": "b"\n}',
    );
  });
});

describe("file reads", () => {
  const read = (toolName: string, input: unknown, output: unknown) => ({
    ...screenshot,
    toolName,
    input,
    output,
  });

  it("shows the file, not the JSON a provider reported it in", () => {
    const claude = read(
      "Read",
      { file_path: "/repo/a.ts", offset: 40, limit: 2 },
      {
        type: "text",
        file: { filePath: "/repo/a.ts", content: "const a = 1;\nconst b = 2;\n", startLine: 40 },
      },
    );
    expect(turnItemReadFile(claude)).toEqual({
      path: "/repo/a.ts",
      text: "const a = 1;\nconst b = 2;",
      startLine: 40,
    });
    expect(turnItemOutputText(claude)).toBe("const a = 1;\nconst b = 2;");

    const cursor = read(
      "Read",
      { path: "/repo/README.md" },
      { content: "# Title\n\nBody", totalLines: 3, fileSize: 15 },
    );
    expect(turnItemReadFile(cursor)).toEqual({
      path: "/repo/README.md",
      text: "# Title\n\nBody",
      startLine: 1,
    });
  });

  it("strips the line numbers and wrappers providers add to text results", () => {
    expect(
      turnItemReadFile(read("Read", { file_path: "a.ts" }, "    12\tfoo\n    13\t\n    14\tbar\n")),
    ).toEqual({ path: "a.ts", text: "foo\n\nbar", startLine: 12 });
    const opencode = [
      "<path>/repo/a.ts</path>",
      "<type>file</type>",
      "<content>",
      "1: foo",
      "2: ",
      "3: bar",
      "",
      "(End of file - total 3 lines)",
      "</content>",
    ].join("\n");
    expect(turnItemReadFile(read("read", { filePath: "/repo/a.ts" }, opencode))).toEqual({
      path: "/repo/a.ts",
      text: "foo\n\nbar",
      startLine: 1,
    });
    expect(
      turnItemReadFile(
        read("read", { filePath: "a.ts" }, "<file>\n00007| foo\n00008| bar\n</file>"),
      ),
    ).toMatchObject({ text: "foo\nbar", startLine: 7 });
  });

  it("keeps text that only looks numbered in places", () => {
    const text = "2024: a year\nnot numbered";
    expect(turnItemReadFile(read("read", { path: "notes.md", offset: 5 }, text))).toEqual({
      path: "notes.md",
      text,
      startLine: 5,
    });
  });

  it("leaves other tools, image reads and withheld output alone", () => {
    expect(turnItemReadFile(screenshot)).toBeNull();
    expect(
      turnItemReadFile(read("Read", { file_path: "a.png" }, { type: "image", file: {} })),
    ).toBeNull();
    expect(
      turnItemReadFile({ ...read("Read", { file_path: "a.ts" }, undefined), outputOmitted: true }),
    ).toBeNull();
  });
});
