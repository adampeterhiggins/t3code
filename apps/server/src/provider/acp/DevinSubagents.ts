/**
 * Devin ACP subagents: maps Devin's subagent markers onto `task.*` events so
 * Devin subagents fill the Agents panel like Claude's do.
 *
 * Unlike Cursor, Devin runs every subagent inside the root ACP session and
 * marks its traffic with `_meta` on ordinary tool call notifications:
 *
 * - the parent `run_subagent` tool call carries `rawInput.task`;
 * - a `tool_call_update` whose `toolCallId` is the agent id carries
 *   `cognition.ai/subagent_started` and later `cognition.ai/subagent_completed`;
 * - the child's own tool calls carry `cognition.ai/subagent_context.parentAgentId`.
 *
 * Child tool calls arrive as a single `tool_call` with no completion, so they
 * are closed when their agent completes. No client capability opt-in is needed.
 */
import {
  RuntimeItemId,
  RuntimeTaskId,
  SUBAGENT_PROMPT_CHAR_LIMIT,
  type ProviderRuntimeItemCompletedEvent,
  type ProviderRuntimeItemUpdatedEvent,
  type ProviderRuntimeTaskCompletedEvent,
  type ProviderRuntimeTaskProgressEvent,
  type ProviderRuntimeTaskStartedEvent,
  type TurnId,
} from "@t3tools/contracts";

import { boundSubagentPrompt } from "../subagentTranscript.ts";
import { type AcpToolCallState, canonicalItemTypeFromAcpToolKind } from "./AcpRuntimeModel.ts";

type TaskEvent =
  | Pick<ProviderRuntimeTaskStartedEvent, "type" | "payload" | "turnId">
  | Pick<ProviderRuntimeTaskProgressEvent, "type" | "payload" | "turnId">
  | Pick<ProviderRuntimeTaskCompletedEvent, "type" | "payload" | "turnId">;

type ItemEvent =
  | Pick<ProviderRuntimeItemUpdatedEvent, "type" | "payload" | "turnId" | "itemId" | "raw">
  | Pick<ProviderRuntimeItemCompletedEvent, "type" | "payload" | "turnId" | "itemId" | "raw">;

export type DevinSubagentEvent = TaskEvent | ItemEvent;

interface DevinChildToolCall {
  readonly state: AcpToolCallState;
  readonly rawPayload: unknown;
}

interface DevinSubagentRun {
  readonly payload: {
    readonly taskId: RuntimeTaskId;
    readonly taskType: "subagent";
    readonly description: string;
    readonly title: string;
    readonly role?: string;
    readonly model?: string;
    readonly toolUseId?: string;
    readonly parentAgentId?: string;
  };
  readonly turnId: TurnId | undefined;
  /** The child's unfinished tool calls by ACP tool call id. */
  readonly toolCalls: Map<string, DevinChildToolCall>;
}

export interface DevinSubagentTracker {
  /** Live runs keyed by Devin agent id. */
  readonly runs: Map<string, DevinSubagentRun>;
  /** `run_subagent` tool call ids by their task text, waiting for their run to start. */
  readonly launches: Map<string, string>;
}

export const makeDevinSubagentTracker = (): DevinSubagentTracker => ({
  runs: new Map(),
  launches: new Map(),
});

const MAX_LAUNCHES = 16;
const ROOT_AGENT_ID = "root";

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

/** Only attribute to the turn that spawned the run while that turn is still active. */
function attribution(run: DevinSubagentRun, turnId: TurnId | undefined) {
  return run.turnId !== undefined && run.turnId === turnId ? { turnId } : {};
}

function childItemEvent(input: {
  readonly run: DevinSubagentRun;
  readonly state: AcpToolCallState;
  readonly rawPayload: unknown;
  readonly status: "inProgress" | "completed" | "failed";
  readonly turnId: TurnId | undefined;
}): ItemEvent {
  const { state } = input;
  return {
    type: input.status === "inProgress" ? "item.updated" : "item.completed",
    itemId: RuntimeItemId.make(state.toolCallId),
    payload: {
      itemType: canonicalItemTypeFromAcpToolKind(state.kind),
      status: input.status,
      ...(state.title ? { title: state.title } : {}),
      ...(state.detail ? { detail: state.detail } : {}),
      ...(Object.keys(state.data).length > 0 ? { data: state.data } : {}),
      agentId: input.run.payload.taskId,
    },
    raw: { source: "acp.jsonrpc", method: "session/update", payload: input.rawPayload },
    ...attribution(input.run, input.turnId),
  };
}

/**
 * Maps one merged Devin tool call notification. `handled` means the
 * notification belongs to a subagent and must not become a root timeline row.
 * Markers are read from the unsanitized `notification`; `rawPayload` is what
 * child item rows carry. Parsed defensively: Devin's `_meta` is untyped.
 */
export function devinSubagentToolCallEvents(input: {
  readonly tracker: DevinSubagentTracker;
  readonly toolCall: AcpToolCallState;
  readonly notification: unknown;
  readonly rawPayload: unknown;
  readonly turnId: TurnId | undefined;
}): { readonly handled: boolean; readonly events: ReadonlyArray<DevinSubagentEvent> } {
  const { tracker, toolCall, turnId } = input;
  const update = record(record(input.notification).update);
  const meta = record(update._meta);

  const started = record(meta["cognition.ai/subagent_started"]);
  const startedId = text(started.agentId);
  if (startedId) {
    if (tracker.runs.has(startedId)) return { handled: true, events: [] };
    const task = text(started.task);
    const label = text(started.title) ?? (task ? firstLine(task) : "Subagent task");
    const role = text(started.profile);
    const model = text(started.model);
    const toolUseId = task ? tracker.launches.get(task) : undefined;
    if (task) tracker.launches.delete(task);
    const parentAgentId = text(record(meta["cognition.ai/subagent_context"]).parentAgentId);
    const run: DevinSubagentRun = {
      payload: {
        taskId: RuntimeTaskId.make(startedId),
        taskType: "subagent",
        description: label,
        title: label,
        ...(role ? { role } : {}),
        ...(model ? { model } : {}),
        ...(toolUseId ? { toolUseId } : {}),
        ...(parentAgentId && parentAgentId !== ROOT_AGENT_ID ? { parentAgentId } : {}),
      },
      turnId,
      toolCalls: new Map(),
    };
    tracker.runs.set(startedId, run);
    const prompt = boundSubagentPrompt(started.task, SUBAGENT_PROMPT_CHAR_LIMIT);
    return {
      handled: true,
      events: [
        {
          type: "task.started",
          payload: { ...run.payload, ...(prompt ? { prompt } : {}) },
          ...attribution(run, turnId),
        },
      ],
    };
  }

  const completed = record(meta["cognition.ai/subagent_completed"]);
  const completedId = text(completed.agentId);
  if (completedId) {
    const run = tracker.runs.get(completedId);
    if (!run) return { handled: true, events: [] };
    tracker.runs.delete(completedId);
    const status = completed.success === false ? "failed" : "completed";
    const summary = text(completed.summary) ?? text(completed.error);
    const events: DevinSubagentEvent[] = [];
    for (const child of run.toolCalls.values()) {
      events.push(
        childItemEvent({
          run,
          ...child,
          status: status === "failed" ? "failed" : "completed",
          turnId,
        }),
      );
    }
    events.push({
      type: "task.completed",
      payload: { ...run.payload, status, ...(summary ? { summary } : {}) },
      ...attribution(run, turnId),
    });
    return { handled: true, events };
  }

  const parentAgentId = text(record(meta["cognition.ai/subagent_context"]).parentAgentId);
  const run = parentAgentId ? tracker.runs.get(parentAgentId) : undefined;
  if (run) {
    const isNew = !run.toolCalls.has(toolCall.toolCallId);
    const terminal = toolCall.status === "completed" || toolCall.status === "failed";
    if (terminal) {
      run.toolCalls.delete(toolCall.toolCallId);
    } else {
      run.toolCalls.set(toolCall.toolCallId, { state: toolCall, rawPayload: input.rawPayload });
    }
    const status = terminal ? (toolCall.status as "completed" | "failed") : "inProgress";
    const events: DevinSubagentEvent[] = [
      childItemEvent({ run, state: toolCall, rawPayload: input.rawPayload, status, turnId }),
    ];
    if (isNew) {
      events.push({
        type: "task.progress",
        payload: { ...run.payload, lastToolName: toolCall.title ?? "Tool call" },
        ...attribution(run, turnId),
      });
    }
    return { handled: true, events };
  }

  // Remember the launching tool call so its run can point back at it.
  if (meta["cognition.ai/inferenceToolName"] === "run_subagent") {
    const task = text(record(update.rawInput).task);
    if (task && !tracker.launches.has(task)) {
      tracker.launches.set(task, toolCall.toolCallId);
      if (tracker.launches.size > MAX_LAUNCHES) {
        tracker.launches.delete(tracker.launches.keys().next().value!);
      }
    }
  }
  return { handled: false, events: [] };
}
