import { describe, expect, it } from "vite-plus/test";

import type { WorkLogEntry } from "../session-logic";
import {
  toolCallPreviewHeading,
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

describe("toolCallPreviewStatus", () => {
  it("describes the tool's lifecycle", () => {
    expect(toolCallPreviewStatus(entry({ toolLifecycleStatus: "inProgress" }))).toBe("running");
    expect(toolCallPreviewStatus(entry({ toolLifecycleStatus: "failed" }))).toBe("failed");
    expect(toolCallPreviewStatus(entry({ toolLifecycleStatus: "idle" }))).toBeNull();
    expect(toolCallPreviewStatus(entry())).toBeNull();
  });
});
