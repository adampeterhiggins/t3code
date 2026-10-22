import { EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import { serializeAssistantCitation } from "@t3tools/shared/assistantCitations";
import { describe, expect, it } from "vite-plus/test";
import type { TimelineEntry, WorkLogEntry } from "../../session-logic";
import type { MessagesTimelineRow } from "./MessagesTimeline.logic";
import { buildTranscriptCitation, citationRowIndex } from "./transcriptCitation.logic";

const at = "2026-10-22T09:00:00Z";
const threadRef = {
  environmentId: EnvironmentId.make("environment"),
  threadId: ThreadId.make("thread"),
};

function message(id: string, role: "user" | "assistant" | "system", text: string): TimelineEntry {
  return {
    kind: "message",
    id,
    createdAt: at,
    message: {
      id: MessageId.make(id),
      role,
      text,
      runId: null,
      streaming: false,
      createdAt: at,
      updatedAt: at,
    },
  };
}

function work(id: string, entry: Partial<WorkLogEntry>): TimelineEntry {
  return {
    kind: "work",
    id,
    createdAt: at,
    entry: { id, createdAt: at, label: id, tone: "tool", ...entry },
  };
}

const quotedEarlier = serializeAssistantCitation({
  version: 1,
  ...threadRef,
  messageId: MessageId.make("earlier"),
  text: "earlier answer",
  start: 0,
  end: 14,
  prefix: "",
  suffix: "",
});

const entries: TimelineEntry[] = [
  message("user-1", "user", `Why does ${quotedEarlier} fail?`),
  work("thought", { tone: "thinking", itemType: "reasoning", detail: "Considering" }),
  work("test-run", {
    toolTitle: "Command",
    command: "vp test run foo.test.ts",
    detail: "1 failed",
    toolLifecycleStatus: "failed",
  }),
  message("system-1", "system", "Context compacted"),
  message("assistant-1", "assistant", "The **fixture** is stale.\n\nRegenerate it."),
  work("read", {
    toolTitle: "Web search",
    itemType: "web_search",
    label: "Searched for fixture docs",
    toolLifecycleStatus: "completed",
  }),
];

describe("buildTranscriptCitation", () => {
  it("quotes messages and tool calls in timeline order, leaving out reasoning", () => {
    const citation = buildTranscriptCitation({
      threadRef,
      entries,
      from: { itemId: "read" },
      to: { itemId: "user-1" },
      workspaceRoot: undefined,
    });

    expect(citation?.segments).toStrictEqual([
      { kind: "user", id: "user-1" },
      { kind: "tool", id: "test-run" },
      { kind: "assistant", id: "assistant-1" },
      { kind: "tool", id: "read" },
    ]);
    expect(citation?.messageId).toBe("user-1");
    expect(citation?.text).toBe(
      [
        "User:\nWhy does earlier answer fail?",
        "Tool call · Command · failed: vp test run foo.test.ts\n1 failed",
        "Assistant:\nThe **fixture** is stale.\n\nRegenerate it.",
        "Tool call · Web search: Searched for fixture docs",
      ].join("\n\n"),
    );
    expect(citation?.markdown).toContain(
      "**Tool call · Command · failed**\n\n```text\nvp test run foo.test.ts\n```\n\n```text\n1 failed\n```",
    );
    expect(citation?.markdown).toContain("> Assistant quote:\n> earlier answer");
    expect(citation?.end).toBe(citation?.text.length);
  });

  it("keeps only the selected part of a message at either end", () => {
    const citation = buildTranscriptCitation({
      threadRef,
      entries,
      from: {
        itemId: "assistant-1",
        quote: { text: "Regenerate it.", markdown: "Regenerate it." },
      },
      to: { itemId: "test-run" },
      workspaceRoot: undefined,
    });

    expect(citation?.segments?.map((segment) => segment.id)).toStrictEqual([
      "test-run",
      "assistant-1",
    ]);
    expect(citation?.text.endsWith("Assistant:\nRegenerate it.")).toBe(true);
  });

  it("drops a message end whose selected part is blank, and rejects unknown items", () => {
    expect(
      buildTranscriptCitation({
        threadRef,
        entries,
        from: { itemId: "test-run" },
        to: { itemId: "assistant-1", quote: { text: "  ", markdown: "" } },
        workspaceRoot: undefined,
      })?.segments,
    ).toStrictEqual([{ kind: "tool", id: "test-run" }]);
    expect(
      buildTranscriptCitation({
        threadRef,
        entries,
        from: { itemId: "missing" },
        to: { itemId: "read" },
        workspaceRoot: undefined,
      }),
    ).toBeNull();
  });
});

describe("citationRowIndex", () => {
  it("lands on the first cited item that has a row", () => {
    const rows = [
      { kind: "message", id: "row-user", message: { id: "user-1" } },
      {
        kind: "work",
        id: "row-tools",
        groupedEntries: [{ id: "read" }],
      },
    ] as unknown as MessagesTimelineRow[];
    const citation = buildTranscriptCitation({
      threadRef,
      entries,
      from: { itemId: "test-run" },
      to: { itemId: "read" },
      workspaceRoot: undefined,
    })!;

    expect(citationRowIndex(rows, citation)).toBe(1);
    expect(
      citationRowIndex(rows, {
        ...citation,
        segments: undefined,
        messageId: MessageId.make("user-1"),
      }),
    ).toBe(0);
  });
});
