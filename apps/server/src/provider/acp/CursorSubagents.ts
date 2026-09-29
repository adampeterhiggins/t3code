/**
 * Cursor ACP subagents: maps Cursor's `subagent_spawned` / `subagent_state_update`
 * session updates and each child session's own updates onto `task.*` events,
 * so Cursor subagents fill the Agents panel like Claude's do. A child's tool
 * calls become `item.*` rows tagged with `agentId`, which clients show in that
 * agent's detail view instead of the main timeline.
 *
 * Cursor only sends these after the client opts in with
 * `clientCapabilities._meta.subagents`. Every child runs in its own ACP
 * session; its updates carry the child's session id, never the root's.
 */
import {
  RuntimeItemId,
  RuntimeTaskId,
  SUBAGENT_PROMPT_CHAR_LIMIT,
  type ProviderRuntimeItemCompletedEvent,
  type ProviderRuntimeItemStartedEvent,
  type ProviderRuntimeItemUpdatedEvent,
  type ProviderRuntimeTaskCompletedEvent,
  type ProviderRuntimeTaskProgressEvent,
  type ProviderRuntimeTaskStartedEvent,
  type TurnId,
} from "@t3tools/contracts";
import type * as EffectAcpSchema from "effect-acp/schema";

import { boundSubagentPrompt } from "../subagentTranscript.ts";
import {
  type AcpToolCallState,
  canonicalItemTypeFromAcpToolKind,
  decideToolCallUpdateEmission,
  mergeToolCallState,
  parseSessionUpdateEvent,
  toolCallProgressLength,
} from "./AcpRuntimeModel.ts";

type TaskEvent =
  | Pick<ProviderRuntimeTaskStartedEvent, "type" | "payload" | "turnId">
  | Pick<ProviderRuntimeTaskProgressEvent, "type" | "payload" | "turnId">
  | Pick<ProviderRuntimeTaskCompletedEvent, "type" | "payload" | "turnId">;

type ItemEvent =
  | Pick<ProviderRuntimeItemStartedEvent, "type" | "payload" | "turnId" | "itemId" | "raw">
  | Pick<ProviderRuntimeItemUpdatedEvent, "type" | "payload" | "turnId" | "itemId" | "raw">
  | Pick<ProviderRuntimeItemCompletedEvent, "type" | "payload" | "turnId" | "itemId" | "raw">;

/** Merged state of one child tool call, with the same coalescing as root calls. */
interface CursorChildToolCall {
  readonly state: AcpToolCallState;
  readonly lastEmittedDetailLength: number | undefined;
  readonly skippedSinceEmit: number;
  /** Cursor's own latest title, more specific than the rendered row title. */
  readonly name: string | undefined;
  /** Whether its `lastToolName` progress row went out. */
  readonly reported: boolean;
}

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
  /** The child's unfinished tool calls by ACP tool call id. */
  readonly toolCalls: Map<string, CursorChildToolCall>;
  /** Title of the child's latest failed tool call, the only failure text Cursor sends. */
  lastFailedTool: string | undefined;
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
    const prompt = boundSubagentPrompt(update.task, SUBAGENT_PROMPT_CHAR_LIMIT);
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
      toolCalls: new Map(),
      lastFailedTool: undefined,
    };
    tracker.runs.set(childSessionId, run);
    return [
      {
        type: "task.started",
        payload: { ...run.payload, ...(prompt ? { prompt } : {}) },
        ...attribution(run, turnId),
      },
    ];
  }

  if (update.sessionUpdate === "subagent_state_update") {
    const run = tracker.runs.get(childSessionId);
    const status = terminalStatus(text(update.state));
    if (!run || !status) return [];
    tracker.runs.delete(childSessionId);
    // Cursor's state update carries no error text: a failed run is explained by
    // its last reply, else by the tool call that failed.
    const summary =
      text(run.reply) ??
      (status === "failed" && run.lastFailedTool ? `${run.lastFailedTool} failed` : undefined);
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

/** Child item ids are namespaced by session so they never collide with root items. */
function childItemId(childSessionId: string, toolCallId: string) {
  return RuntimeItemId.make(`cursor-subagent:${childSessionId}:${toolCallId}`);
}

function childItemStatus(status: AcpToolCallState["status"]) {
  switch (status) {
    case "pending":
    case "inProgress":
      return "inProgress";
    case "completed":
    case "failed":
      return status;
    default:
      return undefined;
  }
}

/**
 * Folds a child session's own updates into its run: each tool call becomes an
 * agent-owned item row plus one progress row once it starts, and the reply
 * text is kept for the summary.
 */
export function cursorSubagentChildEvents(input: {
  readonly tracker: CursorSubagentTracker;
  readonly notification: EffectAcpSchema.SessionNotification;
  readonly turnId: TurnId | undefined;
}): Array<TaskEvent | ItemEvent> {
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
      const parsed = parseSessionUpdateEvent(input.notification).events.find(
        (event) => event._tag === "ToolCallUpdated",
      );
      if (!parsed) return [];
      const tracked = run.toolCalls.get(update.toolCallId);
      const state = mergeToolCallState(tracked?.state, parsed.toolCall);
      const decision = decideToolCallUpdateEmission({
        previous: tracked?.state,
        next: state,
        lastEmittedDetailLength: tracked?.lastEmittedDetailLength,
        skippedSinceEmit: tracked?.skippedSinceEmit ?? 0,
      });
      const name = text(update.title) ?? tracked?.name;
      const terminal = state.status === "completed" || state.status === "failed";
      const report =
        !tracked?.reported &&
        (state.status === "inProgress" || terminal) &&
        (tracked !== undefined || update.sessionUpdate === "tool_call" || name !== undefined);
      if (terminal) {
        run.toolCalls.delete(update.toolCallId);
        if (state.status === "failed") run.lastFailedTool = name ?? "Tool call";
      } else {
        run.toolCalls.set(update.toolCallId, {
          state,
          lastEmittedDetailLength: decision.emit
            ? toolCallProgressLength(state)
            : tracked?.lastEmittedDetailLength,
          skippedSinceEmit: decision.skippedSinceEmit,
          name,
          reported: tracked?.reported === true || report,
        });
      }
      const events: Array<TaskEvent | ItemEvent> = [];
      if (decision.emit) {
        const status = childItemStatus(state.status);
        events.push({
          type: terminal ? "item.completed" : tracked ? "item.updated" : "item.started",
          itemId: childItemId(input.notification.sessionId, state.toolCallId),
          payload: {
            itemType: canonicalItemTypeFromAcpToolKind(state.kind),
            ...(status ? { status } : {}),
            ...(state.title ? { title: state.title } : {}),
            ...(state.detail ? { detail: state.detail } : {}),
            ...(Object.keys(state.data).length > 0 ? { data: state.data } : {}),
            agentId: run.payload.taskId,
          },
          raw: { source: "acp.jsonrpc", method: "session/update", payload: parsed.rawPayload },
          ...attribution(run, input.turnId),
        });
      }
      if (report) {
        events.push({
          type: "task.progress",
          payload: { ...run.payload, lastToolName: name ?? "Tool call" },
          ...attribution(run, input.turnId),
        });
      }
      return events;
    }
    default:
      return [];
  }
}
