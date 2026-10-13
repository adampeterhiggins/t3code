import { describe, expect, it } from "vite-plus/test";

import type { WorkLogEntry } from "../session-logic";
import {
  toolCallPreviewHeading,
  toolCallPreviewReadContent,
  toolCallPreviewRepeatsFilePath,
  toolCallPreviewStatus,
  workEntryHasToolCallPreview,
} from "./toolCallPreview";

function entry(fields: Partial<WorkLogEntry> = {}): WorkLogEntry {
  return {
    id: "entry-1",
    createdAt: "2026-10-05T12:00:00.000Z",
    label: "Ran command",
    tone: "tool",
    ...fields,
  };
}

describe("workEntryHasToolCallPreview", () => {
  it("previews collapsible tool calls", () => {
    expect(workEntryHasToolCallPreview(entry({ itemType: "command_execution" }), true)).toBe(true);
  });

  it("skips rows with nothing to expand", () => {
    expect(workEntryHasToolCallPreview(entry(), false)).toBe(false);
  });

  it("skips thoughts, answered questions, and non-tool rows", () => {
    expect(
      workEntryHasToolCallPreview(entry({ tone: "thinking", itemType: "reasoning" }), true),
    ).toBe(false);
    expect(
      workEntryHasToolCallPreview(
        entry({
          itemType: "user_input_request",
          questionAnswer: { requestId: "request-1", answers: {}, attachmentsByQuestionId: {} },
        }),
        true,
      ),
    ).toBe(false);
    expect(workEntryHasToolCallPreview(entry({ tone: "info" }), true)).toBe(false);
  });
});

describe("toolCallPreviewHeading", () => {
  it("shows a command relative to the workspace under the tool's title", () => {
    expect(
      toolCallPreviewHeading(
        entry({ command: "sed -n 1,20p /repo/src/index.ts", toolTitle: "Command" }),
        "/repo",
        "sed -n 1,20p src/index.ts",
      ),
    ).toEqual({ title: "Command", command: "sed -n 1,20p src/index.ts", text: null });
  });

  it("names an untitled command", () => {
    expect(toolCallPreviewHeading(entry({ command: "ls" }), undefined, "ls").title).toBe("Command");
  });

  it("adds the full row label when it says more than the title", () => {
    expect(
      toolCallPreviewHeading(entry({ toolTitle: "Search" }), "/repo", "Searched for TODO in src"),
    ).toEqual({ title: "Search", command: null, text: "Searched for TODO in src" });
    expect(toolCallPreviewHeading(entry(), "/repo", "Edited a.ts")).toEqual({
      title: "Edited a.ts",
      command: null,
      text: null,
    });
  });
});

describe("toolCallPreviewRepeatsFilePath", () => {
  const fileName = "/repo/historic-cint-band/tests/integration/repositories/test_catalogue.py";

  it("matches the absolute path and the workspace-relative label", () => {
    expect(toolCallPreviewRepeatsFilePath(fileName, fileName, "/repo/historic-cint-band")).toBe(
      true,
    );
    expect(
      toolCallPreviewRepeatsFilePath(
        "historic-cint-band/tests/integration/repositories/test_catalogue.py",
        fileName,
        "/repo/historic-cint-band",
      ),
    ).toBe(true);
  });

  it("keeps a heading that says more than the file path", () => {
    expect(toolCallPreviewRepeatsFilePath("Changed 1 file", fileName, "/repo")).toBe(false);
    expect(
      toolCallPreviewRepeatsFilePath(
        "historic-cint-band/tests/integration/repositories/test_catalogue.py +2 more",
        fileName,
        "/repo/historic-cint-band",
      ),
    ).toBe(false);
    expect(toolCallPreviewRepeatsFilePath(null, fileName, "/repo")).toBe(false);
  });
});

describe("toolCallPreviewReadContent", () => {
  const workspace = "/repo/t3-cca18fd4";
  const absolute = `${workspace}/packages/contracts/src/contextRepositories.ts`;
  const display = "t3-cca18fd4/packages/contracts/src/contextRepositories.ts";
  const other = `${workspace}/packages/contracts/src/settings.ts`;

  it("keeps one spelling of a read path and the line range", () => {
    expect(
      toolCallPreviewReadContent({
        title: `Read ${absolute}`,
        text: `Read ${display}`,
        body: `${absolute}\nLines 1–16`,
        paths: [absolute],
        workspaceRoot: workspace,
      }),
    ).toEqual({ text: null, body: "Lines 1–16" });
  });

  it("treats a relative path, the checkout spelling, and the absolute path as one file", () => {
    const relative = "packages/contracts/src/contextRepositories.ts";
    expect(
      toolCallPreviewReadContent({
        title: `Read ${relative}`,
        text: `Read ${display}`,
        body: `${workspace}/${relative}`,
        paths: [relative],
        workspaceRoot: workspace,
      }),
    ).toEqual({ text: null, body: null });
  });

  it("drops a body that is only the path the heading already shows", () => {
    expect(
      toolCallPreviewReadContent({
        title: `Read ${absolute}`,
        text: null,
        body: absolute,
        paths: [absolute],
        workspaceRoot: workspace,
      }),
    ).toEqual({ text: null, body: null });
  });

  it("keeps the row label when the title does not name the file", () => {
    expect(
      toolCallPreviewReadContent({
        title: "Read",
        text: `Read ${display}`,
        body: absolute,
        paths: [absolute],
        workspaceRoot: workspace,
      }),
    ).toEqual({ text: `Read ${display}`, body: null });
  });

  it("keeps a label that names more files than the title", () => {
    expect(
      toolCallPreviewReadContent({
        title: `Read ${absolute}`,
        text: `Read ${display} +1 more`,
        body: `${absolute}\n${other}`,
        paths: [absolute, other],
        workspaceRoot: workspace,
      }),
    ).toEqual({ text: `Read ${display} +1 more`, body: null });
  });

  it("leaves a preview alone when the read names no path", () => {
    expect(
      toolCallPreviewReadContent({
        title: "Read",
        text: "Read file",
        body: "Read file",
        paths: [],
        workspaceRoot: workspace,
      }),
    ).toEqual({ text: "Read file", body: "Read file" });
  });
});

describe("toolCallPreviewStatus", () => {
  it("describes the tool's lifecycle", () => {
    expect(toolCallPreviewStatus(entry({ toolLifecycleStatus: "inProgress" }))).toBe("running");
    expect(toolCallPreviewStatus(entry({ toolLifecycleStatus: "failed" }))).toBe("failed");
    expect(toolCallPreviewStatus(entry({ toolLifecycleStatus: "idle" }))).toBeNull();
    expect(toolCallPreviewStatus(entry())).toBeNull();
  });
});
