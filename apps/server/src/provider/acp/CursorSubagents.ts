/**
 * Cursor ACP subagents: maps Cursor's `subagent_spawned` / `subagent_state_update`
 * session updates and each child session's own updates onto `task.*` events,
 * so Cursor subagents fill the Agents panel like Claude's do.
 *
 * Cursor only sends these after the client opts in with
 * `clientCapabilities._meta.subagents`. Every child runs in its own ACP
 * session; its updates carry the child's session id, never the root's.
 */
import {
  RuntimeTaskId,
  type ProviderRuntimeTaskCompletedEvent,
  type ProviderRuntimeTaskProgressEvent,
  type ProviderRuntimeTaskStartedEvent,
  type TurnId,
} from "@t3tools/contracts";
import type * as EffectAcpSchema from "effect-acp/schema";

type TaskEvent =
  | Pick<ProviderRuntimeTaskStartedEvent, "type" | "payload" | "turnId">
  | Pick<ProviderRuntimeTaskProgressEvent, "type" | "payload" | "turnId">
  | Pick<ProviderRuntimeTaskCompletedEvent, "type" | "payload" | "turnId">;

interface CursorSubagentRun {
  payload: {
    readonly taskId: RuntimeTaskId;
    readonly taskType: "subagent";
    /** Short label, repeated on every row; never the full prompt. */
    description: string;
    title: string;
    readonly role?: string;
    readonly model?: string;
    readonly toolUseId?: string;
  };
  readonly turnId: TurnId | undefined;
  /** The child's latest reply segment; becomes the completion summary. */
  reply: string;
  /** Child tool calls not yet reported, with their latest title. */
  readonly pendingToolTitles: Map<string, string>;
}

export interface CursorSubagentTracker {
  /** Live runs keyed by child ACP session id. */
  readonly runs: Map<string, CursorSubagentRun>;
  /** Task tool descriptions seen before their run was spawned, by tool call id. */
  readonly earlyDescriptions: Map<string, string>;
}

export const makeCursorSubagentTracker = (): CursorSubagentTracker => ({
  runs: new Map(),
  earlyDescriptions: new Map(),
});

const MAX_REPLY_LENGTH = 2_000;
const MAX_EARLY_DESCRIPTIONS = 16;

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() || undefined : undefined;
}

function firstLine(value: string): string {
  return value.split("\n")[0]!.slice(0, 200);
}

function terminalStatus(state: string | undefined) {
  switch (state) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
    case "disconnected":
      return "stopped";
    default:
      return undefined;
  }
}

/** Only attribute to the turn that spawned the run while that turn is still active. */
function attribution(run: CursorSubagentRun, turnId: TurnId | undefined) {
  return run.turnId !== undefined && run.turnId === turnId ? { turnId } : {};
}

/**
 * Handles the Cursor-only `session/update` kinds, which effect-acp delivers
 * undecoded. Params are parsed defensively: a throw here would end the ACP
 * connection.
 */
export function cursorSubagentLifecycleEvents(input: {
  readonly tracker: CursorSubagentTracker;
  readonly params: unknown;
  readonly turnId: TurnId | undefined;
}): TaskEvent[] {
  const { tracker, turnId } = input;
  const update = record(record(input.params).update);
  const childSessionId = text(update.subagentSessionId);
  if (!childSessionId) return [];
  const meta = record(record(update._meta).cursor);

  if (update.sessionUpdate === "subagent_spawned") {
    if (tracker.runs.has(childSessionId)) return [];
    const task = text(update.task) ?? "Subagent task";
    const role = text(update.name);
    const model = text(meta.model);
    const toolUseId = text(meta.toolCallId);
    const label = (toolUseId && tracker.earlyDescriptions.get(toolUseId)) ?? firstLine(task);
    if (toolUseId) tracker.earlyDescriptions.delete(toolUseId);
    const run: CursorSubagentRun = {
      payload: {
        taskId: RuntimeTaskId.make(childSessionId),
        taskType: "subagent",
        description: label,
        title: label,
        ...(role ? { role } : {}),
        ...(model ? { model } : {}),
        ...(toolUseId ? { toolUseId } : {}),
      },
      turnId,
      reply: "",
      pendingToolTitles: new Map(),
    };
    tracker.runs.set(childSessionId, run);
    return [{ type: "task.started", payload: { ...run.payload }, ...attribution(run, turnId) }];
  }

  if (update.sessionUpdate === "subagent_state_update") {
    const run = tracker.runs.get(childSessionId);
    const status = terminalStatus(text(update.state));
    if (!run || !status) return [];
    tracker.runs.delete(childSessionId);
    const summary = text(run.reply);
    return [
      {
        type: "task.completed",
        payload: { ...run.payload, status, ...(summary ? { summary } : {}) },
        ...attribution(run, turnId),
      },
    ];
  }
  return [];
}

/** Names a run after the parent Task tool's short description once it arrives. */
export function cursorTaskToolEvents(input: {
  readonly tracker: CursorSubagentTracker;
  readonly toolCallId: string;
  readonly rawInput: unknown;
  readonly turnId: TurnId | undefined;
}): TaskEvent[] {
  const args = record(input.rawInput);
  const description = args._toolName === "task" ? text(args.description) : undefined;
  if (!description) return [];
  for (const run of input.tracker.runs.values()) {
    if (run.payload.toolUseId !== input.toolCallId) continue;
    if (run.payload.title === description) return [];
    run.payload.title = description;
    run.payload.description = description;
    return [
      { type: "task.progress", payload: { ...run.payload }, ...attribution(run, input.turnId) },
    ];
  }
  // The tool call can arrive before `subagent_spawned`; keep it for the spawn.
  const early = input.tracker.earlyDescriptions;
  early.set(input.toolCallId, description);
  if (early.size > MAX_EARLY_DESCRIPTIONS) early.delete(early.keys().next().value!);
  return [];
}

/**
 * Folds a child session's own updates into its run: each tool call becomes one
 * progress row once it starts, and the reply text is kept for the summary.
 */
export function cursorSubagentChildEvents(input: {
  readonly tracker: CursorSubagentTracker;
  readonly notification: EffectAcpSchema.SessionNotification;
  readonly turnId: TurnId | undefined;
}): TaskEvent[] {
  const run = input.tracker.runs.get(input.notification.sessionId);
  if (!run) return [];
  const update = input.notification.update;
  switch (update.sessionUpdate) {
    case "agent_message_chunk": {
      if (update.content.type === "text") {
        run.reply = (run.reply + update.content.text).slice(-MAX_REPLY_LENGTH);
      }
      return [];
    }
    case "tool_call":
    case "tool_call_update": {
      // A new tool call ends the reply segment before it; only the last one is the answer.
      if (update.sessionUpdate === "tool_call") run.reply = "";
      const title = text(update.title) ?? run.pendingToolTitles.get(update.toolCallId);
      if (update.sessionUpdate === "tool_call" || title) {
        run.pendingToolTitles.set(update.toolCallId, title ?? "Tool call");
      }
      const status = update.status;
      if (status !== "in_progress" && status !== "completed" && status !== "failed") return [];
      const lastToolName = run.pendingToolTitles.get(update.toolCallId);
      if (lastToolName === undefined) return [];
      run.pendingToolTitles.delete(update.toolCallId);
      return [
        {
          type: "task.progress",
          payload: { ...run.payload, lastToolName },
          ...attribution(run, input.turnId),
        },
      ];
    }
    default:
      return [];
  }
}
