import { describe, expect, it } from "vite-plus/test";
import { TurnId } from "@t3tools/contracts";
import type * as EffectAcpSchema from "effect-acp/schema";

import { parseSessionUpdateEvent } from "./AcpRuntimeModel.ts";
import { devinSubagentToolCallEvents, makeDevinSubagentTracker } from "./DevinSubagents.ts";

// Shapes captured from a live `devin acp` run (3000.11.3, 2026.09.30).
const turnId = TurnId.make("turn-1");
const sessionId = "unexpected-creek";
const agentId = "1342dfc1";
const launchId = "call_c64d#c348";
const task = "Read the file a.txt and report back its exact contents.\nDo not modify anything.";

const notification = (update: Record<string, unknown>) =>
  ({ sessionId, update }) as unknown as EffectAcpSchema.SessionNotification;

const launch = notification({
  sessionUpdate: "tool_call",
  toolCallId: launchId,
  title: "Ran explore subagent Read a.txt",
  rawInput: { title: "Read a.txt", task, profile: "subagent_explore" },
  _meta: { "cognition.ai/inferenceToolName": "run_subagent" },
});
const started = notification({
  sessionUpdate: "tool_call_update",
  toolCallId: agentId,
  status: "in_progress",
  _meta: {
    "cognition.ai/subagent_started": {
      agentId,
      title: "Read a.txt",
      task,
      profile: "Explore",
      depth: 1,
      isBackground: false,
      model: "SWE-2 Max",
    },
  },
});
const childRead = notification({
  sessionUpdate: "tool_call",
  toolCallId: "call_1a00#5f94",
  title: "Read file",
  kind: "read",
  rawInput: { file_path: "a.txt" },
  _meta: {
    "cognition.ai/inferenceToolName": "read",
    "cognition.ai/subagent_context": { parentAgentId: agentId },
  },
});
const completed = (success: boolean) =>
  notification({
    sessionUpdate: "tool_call_update",
    toolCallId: agentId,
    status: "completed",
    _meta: {
      "cognition.ai/subagent_completed": { agentId, success, summary: "It says hello.", depth: 1 },
    },
  });

function harness() {
  const tracker = makeDevinSubagentTracker();
  return (params: EffectAcpSchema.SessionNotification, turn: TurnId | undefined = turnId) => {
    const parsed = parseSessionUpdateEvent(params).events.find(
      (event) => event._tag === "ToolCallUpdated",
    );
    if (!parsed) throw new Error("expected a tool call");
    return devinSubagentToolCallEvents({
      tracker,
      toolCall: parsed.toolCall,
      notification: params,
      rawPayload: params,
      turnId: turn,
    });
  };
}

const runPayload = {
  taskId: agentId,
  taskType: "subagent",
  description: "Read a.txt",
  title: "Read a.txt",
  role: "Explore",
  model: "SWE-2 Max",
  toolUseId: launchId,
};

describe("Devin subagents", () => {
  it("maps a subagent run onto task lifecycle events", () => {
    const map = harness();

    // The launch tool call stays a root timeline row.
    expect(map(launch)).toEqual({ handled: false, events: [] });

    expect(map(started)).toEqual({
      handled: true,
      events: [{ type: "task.started", turnId, payload: { ...runPayload, prompt: task } }],
    });

    const child = map(childRead);
    expect(child.handled).toBe(true);
    expect(child.events).toMatchObject([
      {
        type: "item.updated",
        itemId: "call_1a00#5f94",
        turnId,
        payload: { itemType: "dynamic_tool_call", status: "inProgress", agentId },
      },
      { type: "task.progress", turnId, payload: { ...runPayload, lastToolName: "Read file" } },
    ]);

    // Devin never completes child tool calls; the run's completion closes them.
    expect(map(completed(true)).events).toMatchObject([
      {
        type: "item.completed",
        itemId: "call_1a00#5f94",
        payload: { status: "completed", agentId },
      },
      {
        type: "task.completed",
        turnId,
        payload: { ...runPayload, status: "completed", summary: "It says hello." },
      },
    ]);
  });

  it("reports an unsuccessful run as failed", () => {
    const map = harness();
    map(started);
    expect(map(completed(false)).events).toMatchObject([
      { type: "task.completed", payload: { status: "failed", summary: "It says hello." } },
    ]);
  });

  it("leaves background completions from an earlier turn unattributed", () => {
    const map = harness();
    map(started);
    const [event] = map(completed(true), TurnId.make("turn-2")).events;
    expect(event).not.toHaveProperty("turnId");
  });

  it("leaves root tool calls alone", () => {
    const map = harness();
    const root = notification({
      sessionUpdate: "tool_call",
      toolCallId: "exec:0",
      title: "Ran ls",
      kind: "execute",
      _meta: {
        "cognition.ai/inferenceToolName": "exec",
        "cognition.ai/subagent_context": { parentAgentId: "root" },
      },
    });
    expect(map(root)).toEqual({ handled: false, events: [] });
  });
});
