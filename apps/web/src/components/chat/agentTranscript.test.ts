import {
  MessageId,
  NodeId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2ProjectedTurnItem,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  deriveTimelineEntriesFromVisibleTurnItems,
  deriveTimelineEntriesFromVisibleTurnItemsWithState,
} from "../../session-logic";
import { subagentWorkspaceRoot } from "@t3tools/client-runtime/state/agent-list-view";

import {
  agentTranscriptToolRowIndex,
  applyAgentTranscriptView,
  deriveAgentTranscriptRows,
} from "./agentTranscript";

const timestamp = DateTime.makeUnsafe("2026-10-05T12:00:00.000Z");
const childThreadId = ThreadId.make("child-thread");
const root = "/repo";
const prompt = "Find where sessions expire";

let ordinal = 0;
/** A child-thread turn item; `fields` are the type's own fields, `overrides` the shared ones. */
function item(
  type: OrchestrationV2TurnItem["type"],
  fields: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
): OrchestrationV2TurnItem {
  ordinal += 1;
  return {
    ...base,
    id: TurnItemId.make(`item-${ordinal}`),
    ordinal,
    ...overrides,
    type,
    ...fields,
  } as OrchestrationV2TurnItem;
}
const base = {
  id: TurnItemId.make("item"),
  threadId: childThreadId,
  runId: RunId.make("child-run"),
  nodeId: null,
  providerThreadId: null,
  providerTurnId: null,
  nativeItemRef: null,
  parentItemId: null,
  ordinal: 0,
  status: "completed" as OrchestrationV2TurnItem["status"],
  title: null as string | null,
  startedAt: timestamp,
  completedAt: timestamp,
  updatedAt: timestamp,
};
const visible = (turnItem: OrchestrationV2TurnItem): OrchestrationV2ProjectedTurnItem => ({
  position: 0,
  visibility: "local",
  sourceThreadId: turnItem.threadId,
  sourceItemId: turnItem.id,
  item: turnItem,
});

function transcript(items: ReadonlyArray<OrchestrationV2TurnItem>) {
  const entries = deriveTimelineEntriesFromVisibleTurnItems({
    visibleTurnItems: items.map(visible),
    optimisticMessages: [],
  });
  return deriveAgentTranscriptRows(entries, { prompt, workspaceRoot: root });
}

const userPrompt = item("user_message", {
  messageId: MessageId.make("prompt"),
  inputIntent: "turn_start",
  text: `${prompt}\n`,
  createdBy: "user",
  creationSource: "server",
  attachments: [],
});
const thinking = item("reasoning", { text: "Sessions are probably in auth.", streaming: false });
const emptyThinking = item("reasoning", { text: "", streaming: false });
const grep = item(
  "command_execution",
  { input: "rg -n expires /repo/src/auth" },
  { status: "running", completedAt: null },
);
const edit = item(
  "file_change",
  { fileName: "/repo/src/auth/session.ts", additions: 2, deletions: 1 },
  { status: "failed" },
);
const helper = item("subagent", {
  subagentId: NodeId.make("helper-node"),
  origin: "provider_native",
  driver: "claudeAgent",
  providerInstanceId: ProviderInstanceId.make("claude"),
  childThreadId: ThreadId.make("helper-thread"),
  prompt: "Read the session tests\nand summarise",
  result: null,
});
const answer = item("assistant_message", {
  messageId: MessageId.make("answer"),
  text: "Sessions expire in session.ts.",
  streaming: false,
});

describe("deriveAgentTranscriptRows", () => {
  it("lists the child thread's work in order, without the repeated launch prompt", () => {
    const rows = transcript([userPrompt, thinking, emptyThinking, grep, edit, helper, answer]);
    expect(rows.map((row) => row.kind)).toEqual(["reasoning", "tool", "tool", "notice", "message"]);
    expect(rows[0]).toMatchObject({ text: "Sessions are probably in auth." });
    expect(rows[1]).toMatchObject({ toolKind: "command", status: "running" });
    // Commands and paths read relative to the agent's workspace.
    expect(rows[1]?.kind === "tool" && rows[1].label).toBe("rg -n expires src/auth");
    expect(rows[2]).toMatchObject({ toolKind: "edit", status: "failed" });
    expect(rows[3]).toMatchObject({
      label: "Started agent: Read the session tests",
      childThreadId: ThreadId.make("helper-thread"),
    });
    expect(rows[4]).toMatchObject({ role: "assistant", text: "Sessions expire in session.ts." });
  });

  it("keeps unchanged rows while an answer streams", () => {
    const streaming = item("assistant_message", {
      messageId: MessageId.make("streaming"),
      text: "Looking",
      streaming: true,
    });
    const before = [userPrompt, grep, streaming].map(visible);
    const cache = new WeakMap();
    const options = { prompt, workspaceRoot: root };
    const first = deriveTimelineEntriesFromVisibleTurnItemsWithState({
      visibleTurnItems: before,
      optimisticMessages: [],
    });
    const firstRows = deriveAgentTranscriptRows(first.entries, options, cache);
    const grown = { ...streaming, text: "Looking at auth" } as OrchestrationV2TurnItem;
    const next = deriveTimelineEntriesFromVisibleTurnItemsWithState(
      { visibleTurnItems: [before[0]!, before[1]!, visible(grown)], optimisticMessages: [] },
      first,
    );
    const nextRows = deriveAgentTranscriptRows(next.entries, options, cache);
    expect(nextRows[0]).toBe(firstRows[0]);
    expect(nextRows[1]).toMatchObject({ kind: "message", text: "Looking at auth" });
  });

  it("stamps every row with its time and finds a tool call's row", () => {
    const rows = transcript([userPrompt, thinking, grep, edit, answer]);
    expect(new Set(rows.map((row) => row.createdAt))).toEqual(
      new Set([DateTime.formatIso(timestamp)]),
    );
    expect(agentTranscriptToolRowIndex(rows, edit.id)).toBe(2);
    expect(agentTranscriptToolRowIndex(rows, answer.id)).toBe(-1);
  });

  it("reads paths relative to the agent's own worktree", () => {
    const worktree = "/repo/.claude/worktrees/agent-a1b2";
    const test = item("command_execution", { input: `bun test ${worktree}/src/auth` });
    const items = [userPrompt, test];
    const entries = deriveTimelineEntriesFromVisibleTurnItems({
      visibleTurnItems: items.map(visible),
      optimisticMessages: [],
    });
    const rows = deriveAgentTranscriptRows(entries, {
      prompt,
      workspaceRoot: subagentWorkspaceRoot(items, root) ?? undefined,
    });
    expect(rows[0]?.kind === "tool" && rows[0].label).toBe("bun test src/auth");
  });

  it("keeps a follow-up that only resembles the prompt, and later repeats of it", () => {
    const followUp = item("user_message", {
      messageId: MessageId.make("follow-up"),
      inputIntent: "turn_start",
      text: prompt,
      createdBy: "user",
      creationSource: "server",
      attachments: [],
    });
    const rows = transcript([userPrompt, answer, followUp]);
    expect(rows.map((row) => (row.kind === "message" ? row.role : row.kind))).toEqual([
      "assistant",
      "user",
    ]);
  });
});

describe("applyAgentTranscriptView", () => {
  const rows = transcript([userPrompt, thinking, grep, edit, helper, answer]);

  it("narrows by kind and search without reordering", () => {
    expect(applyAgentTranscriptView(rows, { query: "", kinds: [] })).toBe(rows);
    expect(
      applyAgentTranscriptView(rows, { query: "", kinds: ["tool"] }).map((row) => row.id),
    ).toEqual([grep.id, edit.id]);
    expect(
      applyAgentTranscriptView(rows, { query: "", kinds: ["message", "reasoning"] }).map(
        (row) => row.kind,
      ),
    ).toEqual(["reasoning", "notice", "message"]);
    expect(
      applyAgentTranscriptView(rows, { query: "SESSION", kinds: [] }).map((row) => row.id),
    ).toEqual([thinking.id, edit.id, helper.id, "answer"]);
  });
});
