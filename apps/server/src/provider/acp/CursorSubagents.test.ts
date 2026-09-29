import { describe, expect, it } from "vite-plus/test";
import { TurnId } from "@t3tools/contracts";
import type * as EffectAcpSchema from "effect-acp/schema";

import {
  cursorSubagentChildEvents,
  cursorSubagentLifecycleEvents,
  cursorTaskToolEvents,
  makeCursorSubagentTracker,
} from "./CursorSubagents.ts";

// Shapes captured from a live `cursor-agent acp` run (2026.09.26) with
// `clientCapabilities._meta.subagents` set.
const turnId = TurnId.make("turn-1");
const root = "root-session";
const childId = "child-session";
const taskToolCallId = "call-task\nfc_1";
const prompt = "Read the file README.md in the workspace root.\nReturn the exact text.";

const spawned = {
  sessionId: root,
  update: {
    sessionUpdate: "subagent_spawned",
    subagentSessionId: childId,
    name: "generalPurpose",
    task: prompt,
    capabilities: {},
    _meta: {
      cursor: { toolCallId: taskToolCallId, agentId: childId, model: "grok-4.7-high-fast" },
    },
  },
};
const stateUpdate = (state: string) => ({
  sessionId: root,
  update: {
    sessionUpdate: "subagent_state_update",
    subagentSessionId: childId,
    state,
    _meta: { cursor: { toolCallId: taskToolCallId, agentId: childId } },
  },
});
const childUpdate = (
  update: EffectAcpSchema.SessionNotification["update"],
): EffectAcpSchema.SessionNotification => ({ sessionId: childId, update });

function harness() {
  const tracker = makeCursorSubagentTracker();
  return {
    tracker,
    lifecycle: (params: unknown, turn: TurnId | undefined = turnId) =>
      cursorSubagentLifecycleEvents({ tracker, params, turnId: turn }),
    child: (update: EffectAcpSchema.SessionNotification["update"]) =>
      cursorSubagentChildEvents({ tracker, notification: childUpdate(update), turnId }),
  };
}

describe("Cursor subagents", () => {
  it("maps a spawned subagent's run onto task lifecycle events", () => {
    const { lifecycle, child, tracker } = harness();

    expect(lifecycle(spawned)).toEqual([
      {
        type: "task.started",
        turnId,
        payload: {
          taskId: childId,
          taskType: "subagent",
          description: "Read the file README.md in the workspace root.",
          title: "Read the file README.md in the workspace root.",
          role: "generalPurpose",
          model: "grok-4.7-high-fast",
          toolUseId: taskToolCallId,
        },
      },
    ]);

    // The parent Task tool call names the run with its short description.
    const renamed = cursorTaskToolEvents({
      tracker,
      toolCallId: taskToolCallId,
      rawInput: { _toolName: "task", description: "Read README.md contents", prompt },
      turnId,
    });
    expect(renamed.map((event) => [event.type, event.payload.title])).toEqual([
      ["task.progress", "Read README.md contents"],
    ]);

    // Each child tool call reports once, under its most specific title.
    expect(
      child({
        sessionUpdate: "tool_call",
        toolCallId: "read-1",
        title: "Read File",
        kind: "read",
        status: "pending",
      }),
    ).toEqual([]);
    expect(
      child({ sessionUpdate: "tool_call_update", toolCallId: "read-1", title: "Read README.md" }),
    ).toEqual([]);
    const progress = child({
      sessionUpdate: "tool_call_update",
      toolCallId: "read-1",
      status: "in_progress",
    });
    expect(progress.map((event) => event.payload)).toMatchObject([
      { taskId: childId, lastToolName: "Read README.md" },
    ]);
    expect(
      child({ sessionUpdate: "tool_call_update", toolCallId: "read-1", status: "completed" }),
    ).toEqual([]);

    child({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hel" } });
    child({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "lo" } });

    expect(lifecycle(stateUpdate("completed"))).toMatchObject([
      {
        type: "task.completed",
        turnId,
        payload: {
          taskId: childId,
          status: "completed",
          summary: "hello",
          title: "Read README.md contents",
        },
      },
    ]);
    expect(tracker.runs.size).toBe(0);
  });

  it("names the run when the Task tool call arrives before the spawn", () => {
    const { lifecycle, tracker } = harness();
    expect(
      cursorTaskToolEvents({
        tracker,
        toolCallId: taskToolCallId,
        rawInput: { _toolName: "task", description: "Read README.md contents" },
        turnId,
      }),
    ).toEqual([]);

    expect(lifecycle(spawned)[0]?.payload).toMatchObject({
      title: "Read README.md contents",
      description: "Read README.md contents",
    });
    expect(tracker.earlyDescriptions.size).toBe(0);
  });

  it("summarizes only the reply after the child's last tool call", () => {
    const { lifecycle, child } = harness();
    lifecycle(spawned);
    child({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Checking." } });
    child({ sessionUpdate: "tool_call", toolCallId: "t", title: "Grep", status: "in_progress" });
    child({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Found it." } });

    expect(lifecycle(stateUpdate("completed"))[0]?.payload).toMatchObject({
      summary: "Found it.",
    });
  });

  it.each([
    ["failed", "failed"],
    ["cancelled", "stopped"],
    ["disconnected", "stopped"],
  ])("maps a %s run to %s", (state, status) => {
    const { lifecycle } = harness();
    lifecycle(spawned);
    expect(lifecycle(stateUpdate(state))[0]?.payload).toMatchObject({ status });
  });

  it("drops the turn once the spawning turn is over", () => {
    const { lifecycle } = harness();
    lifecycle(spawned);
    const [completed] = lifecycle(stateUpdate("completed"), TurnId.make("turn-2"));
    expect(completed).not.toHaveProperty("turnId");
  });

  it("ignores malformed, unknown, and untracked updates", () => {
    const { lifecycle, child } = harness();
    expect(lifecycle(null)).toEqual([]);
    expect(lifecycle({ update: { sessionUpdate: "subagent_spawned" } })).toEqual([]);
    expect(
      lifecycle({ update: { sessionUpdate: "something_new", subagentSessionId: childId } }),
    ).toEqual([]);
    expect(lifecycle(stateUpdate("completed"))).toEqual([]);
    expect(
      child({ sessionUpdate: "tool_call", toolCallId: "t", title: "Grep", status: "in_progress" }),
    ).toEqual([]);
  });
});
