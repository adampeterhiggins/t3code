import {
  RuntimeTaskId,
  SUBAGENT_PROMPT_CHAR_LIMIT,
  type ProviderRuntimeTaskStartedEvent,
  type ProviderRuntimeTaskProgressEvent,
  type ProviderRuntimeTaskCompletedEvent,
  type TurnId,
} from "@t3tools/contracts";

function boundSubagentPrompt(value: unknown, limit: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.length <= limit ? trimmed : `${trimmed.slice(0, limit - 1)}…`;
}

type TaskEvent =
  | Pick<ProviderRuntimeTaskStartedEvent, "type" | "payload" | "turnId">
  | Pick<ProviderRuntimeTaskProgressEvent, "type" | "payload" | "turnId">
  | Pick<ProviderRuntimeTaskCompletedEvent, "type" | "payload" | "turnId">;

export interface GrokBackgroundTaskRecord {
  readonly payload: {
    readonly taskId: RuntimeTaskId;
    readonly taskType: GrokTaskType;
    readonly description: string;
    readonly title: string;
    /** Subagent type (e.g. `explore`), for subagents only. */
    readonly role?: string;
    readonly toolUseId?: string;
  };
  readonly turnId: TurnId | undefined;
}

type GrokTaskType = "monitor" | "shell" | "subagent";

const MAX_SUBAGENT_SUMMARY_LENGTH = 2_000;

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() || undefined : undefined;
}

function lifecycle(status: unknown, exitCode: unknown) {
  switch (text(status)?.toLowerCase()) {
    case "pending":
    case "queued":
    case "initializing":
    case "running":
      return "running";
    case "completed":
    case "success":
    case "succeeded":
      return "completed";
    case "failed":
    case "error":
      return "failed";
    case "stopped":
    case "killed":
    case "cancelled":
      return "stopped";
    default:
      return typeof exitCode === "number" && Number.isFinite(exitCode)
        ? exitCode === 0
          ? "completed"
          : "failed"
        : undefined;
  }
}

function firstLine(value: string | undefined) {
  return value
    ?.split("\n")
    .find((line) => line.trim())
    ?.trim();
}

/** `key: value` lines, as in the spawn tool's `subagent_id: …\ndescription: …` text. */
function textField(value: string, key: string) {
  return text(new RegExp(`^${key}:[ \\t]*(.*)$`, "m").exec(value)?.[1]);
}

/** A subagent's reply without Grok's resume/meta footer. */
function subagentReply(value: unknown) {
  const reply = text(
    (text(value) ?? "")
      .replace(/<\/?subagent_result>/g, "")
      .replace(/<subagent_meta>[\s\S]*?(?:<\/subagent_meta>|$)/gm, "")
      .split("\n")
      .filter(
        (line) =>
          !/^(subagent_id:|To continue this subagent|The subagent used persona=)/.test(line.trim()),
      )
      .join("\n"),
  );
  return reply && reply.length > MAX_SUBAGENT_SUMMARY_LENGTH
    ? `${reply.slice(0, MAX_SUBAGENT_SUMMARY_LENGTH - 1)}…`
    : reply;
}

/** Map Grok's discriminated tool results, including notifications after the turn ends. */
export function buildGrokBackgroundTaskEvents(input: {
  readonly tasks: Map<string, GrokBackgroundTaskRecord>;
  readonly toolCallId: string;
  readonly rawInput: unknown;
  readonly rawOutput: unknown;
  readonly toolCallStatus: string | undefined;
  readonly turnId?: TurnId | undefined;
}): TaskEvent[] {
  const { tasks, toolCallId, toolCallStatus, turnId } = input;
  const output = record(input.rawOutput);
  const events: TaskEvent[] = [];
  if (
    toolCallStatus !== "completed" &&
    toolCallStatus !== "failed" &&
    output.type !== "BackgroundTaskStarted"
  ) {
    return events;
  }
  const attribution = (task: GrokBackgroundTaskRecord) =>
    task.turnId !== undefined && task.turnId === turnId ? { turnId } : {};
  const start = (
    id: string,
    taskType: GrokTaskType,
    description: string,
    toolUseId?: string,
    subagent?: { readonly role?: string | undefined; readonly prompt?: string | undefined },
  ) => {
    const known = tasks.get(id);
    if (known) return known;
    const task: GrokBackgroundTaskRecord = {
      payload: {
        taskId: RuntimeTaskId.make(id),
        taskType,
        description,
        title: description,
        ...(subagent?.role ? { role: subagent.role } : {}),
        ...(toolUseId ? { toolUseId } : {}),
      },
      // Polls can rediscover older tasks without establishing their originating turn.
      turnId: toolUseId ? turnId : undefined,
    };
    tasks.set(id, task);
    events.push({
      type: "task.started",
      payload: { ...task.payload, ...(subagent?.prompt ? { prompt: subagent.prompt } : {}) },
      ...attribution(task),
    });
    return task;
  };
  const complete = (
    task: GrokBackgroundTaskRecord,
    status: "completed" | "failed" | "stopped",
    summary?: string,
  ) => {
    tasks.delete(task.payload.taskId);
    events.push({
      type: "task.completed",
      payload: { ...task.payload, status, ...(summary ? { summary } : {}) },
      ...attribution(task),
    });
  };

  const spawnText = output.type === "Text" ? text(output.text) : undefined;
  const spawnId = spawnText && textField(spawnText, "subagent_id");
  const spawnInput = record(input.rawInput);
  // spawn_subagent answers in prose; its required `prompt` tells it apart from
  // other tools whose text mentions a subagent id.
  if (spawnText && spawnId && toolCallStatus === "completed" && text(spawnInput.prompt)) {
    const task = start(
      spawnId,
      "subagent",
      text(spawnInput.description) ?? textField(spawnText, "description") ?? "Subagent",
      toolCallId,
      {
        role: text(spawnInput.subagent_type) ?? textField(spawnText, "type"),
        prompt: boundSubagentPrompt(spawnInput.prompt, SUBAGENT_PROMPT_CHAR_LIMIT),
      },
    );
    // A foreground spawn returns once the child is done.
    if (spawnText.includes("<subagent_result>")) {
      complete(task, "completed", subagentReply(spawnText));
    } else if (spawnText.startsWith("Subagent was cancelled")) {
      complete(task, "stopped");
    }
  } else if (output.type === "Monitor" && toolCallStatus === "completed") {
    const id = text(output.taskId);
    if (id) start(id, "monitor", text(record(input.rawInput).description) ?? "Monitor", toolCallId);
  } else if (output.type === "BackgroundTaskStarted") {
    const id = text(output.task_id) ?? text(output.taskId);
    const command = text(output.command);
    if (id && command) start(id, "shell", command.split("\n")[0]!.slice(0, 200), toolCallId);
  } else if (output.type === "TaskOutput" || output.type === "KillTask") {
    const results = record(output.MultiResult).results;
    for (const value of Array.isArray(results) ? results : [output.Result]) {
      const result = record(value);
      const id = text(result.task_id);
      if (!id) continue;
      if (output.type === "KillTask") {
        const task = tasks.get(id);
        if (task && toolCallStatus === "completed" && result.outcome === "killed")
          complete(task, "stopped");
        continue;
      }
      const command = text(result.command);
      const status = lifecycle(result.status, result.exit_code);
      if (!command || !status) continue;
      // Subagent polls read `[subagent:<type>] <description>`.
      const subagent = /^\[subagent:([^\]]*)\]\s*(.*)$/s.exec(command);
      const task = subagent
        ? start(id, "subagent", text(subagent[2]) ?? "Subagent", undefined, {
            role: text(subagent[1]),
          })
        : start(id, /^\[monitor[:\]]/.test(command) ? "monitor" : "shell", command);
      const outputText = text(result.output);
      const summary =
        task.payload.taskType !== "subagent"
          ? firstLine(outputText)
          : status === "running"
            ? (text(/^Progress:.*$/m.exec(outputText ?? "")?.[0]) ?? firstLine(outputText))
            : subagentReply(outputText);
      if (status === "running") {
        events.push({
          type: "task.progress",
          payload: { ...task.payload, ...(summary ? { summary } : {}) },
          ...attribution(task),
        });
      } else {
        complete(task, status, summary);
      }
    }
  }
  return events;
}
