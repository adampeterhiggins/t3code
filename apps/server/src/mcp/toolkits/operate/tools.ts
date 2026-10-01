import {
  ProviderApprovalDecision,
  ProviderInteractionMode,
  RuntimeMode,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { McpSchema } from "effect/unstable/ai";
import * as Tool from "effect/unstable/ai/Tool";
import * as Toolkit from "effect/unstable/ai/Toolkit";

import * as McpActor from "../../McpActor.ts";

const dependencies = [McpActor.McpActor];

/** Something the agent can fix or route around; the reason says how. */
export class OperateToolError extends Schema.TaggedError<OperateToolError>()("OperateToolError", {
  reason: Schema.String,
}) {
  override get message(): string {
    return this.reason;
  }
}

const threadId = TrimmedNonEmptyString.annotate({
  description: "Thread id, from create_thread or the history tools' list_threads.",
});

const ModelInput = Schema.Struct({
  instanceId: TrimmedNonEmptyString.annotate({
    description: "Provider instance from list_models.",
  }),
  model: TrimmedNonEmptyString.annotate({ description: "Model slug from list_models." }),
});

export const CreateThreadInput = Schema.Struct({
  projectId: Schema.optional(
    TrimmedNonEmptyString.annotate({
      description: "Project to start the thread in. Defaults to this thread's project.",
    }),
  ),
  message: Schema.optional(
    TrimmedNonEmptyString.annotate({
      description:
        "The first message, which starts the agent working. Omit it to set the thread up and leave it waiting for the user.",
    }),
  ),
  title: Schema.optional(
    TrimmedNonEmptyString.annotate({
      description: "Sidebar title. Defaults to the start of the message.",
    }),
  ),
  model: Schema.optional(
    ModelInput.annotate({
      description: "Defaults to the project's default model, then this thread's model.",
    }),
  ),
  workspace: Schema.optional(
    Schema.Literals(["local", "worktree"]).annotate({
      description:
        "worktree gives the thread its own git worktree and branch, so it cannot collide with other work; local shares the project checkout. Defaults to the project's setting.",
    }),
  ),
  baseBranch: Schema.optional(
    TrimmedNonEmptyString.annotate({
      description:
        "Branch a new worktree starts from. Defaults to the branch the project checkout is on.",
    }),
  ),
  runtimeMode: Schema.optional(
    RuntimeMode.annotate({
      description:
        "How freely the agent may act. Defaults to, and cannot exceed, this thread's own mode.",
    }),
  ),
  interactionMode: Schema.optional(
    ProviderInteractionMode.annotate({
      description: "plan has the agent propose a plan before changing anything.",
    }),
  ),
});
export type CreateThreadInput = typeof CreateThreadInput.Type;

export const CreateThreadResult = Schema.Struct({
  threadId: Schema.String,
  projectId: Schema.String,
  title: Schema.String,
  status: Schema.Literals(["started", "preparing", "idle"]).annotate({
    description:
      "started: the agent is working. preparing: the worktree or setup script is still running and the agent starts after. idle: no message was sent.",
  }),
});
export type CreateThreadResult = typeof CreateThreadResult.Type;

export const SendMessageInput = Schema.Struct({
  threadId,
  message: TrimmedNonEmptyString.annotate({ description: "What to tell the thread's agent." }),
  interactionMode: Schema.optional(
    ProviderInteractionMode.annotate({
      description: "Defaults to the thread's current interaction mode.",
    }),
  ),
});
export type SendMessageInput = typeof SendMessageInput.Type;

export const SendMessageResult = Schema.Struct({
  threadId: Schema.String,
  messageId: Schema.String,
});

export const ThreadStatusInput = Schema.Struct({
  threadId,
  timeoutSeconds: Schema.optional(
    Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 300 })).annotate({
      description:
        "Longest to wait for the thread to stop working, 0 to 300. Defaults to 120. 0 returns the status at once.",
    }),
  ),
});
export type ThreadStatusInput = typeof ThreadStatusInput.Type;

export const PendingRequest = Schema.Struct({
  requestId: Schema.String,
  kind: Schema.Literals(["approval", "question"]),
  summary: Schema.String,
  detail: Schema.NullOr(Schema.String).annotate({
    description: "What the agent wants to do, such as the command it would run.",
  }),
  decisions: Schema.Array(Schema.String).annotate({
    description: "For an approval, the decisions respond_to_request accepts.",
  }),
  questions: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      question: Schema.String,
      options: Schema.Array(Schema.String),
      multiSelect: Schema.Boolean,
    }),
  ),
});
export type PendingRequest = typeof PendingRequest.Type;

export const ThreadStatusResult = Schema.Struct({
  threadId: Schema.String,
  title: Schema.String,
  status: Schema.Literals(["working", "needs-attention", "idle", "error"]).annotate({
    description:
      "working: still busy, call again to keep waiting. needs-attention: blocked on an approval or a question for the user. idle: finished its turn. error: the session failed.",
  }),
  latestTurn: Schema.NullOr(
    Schema.Struct({
      state: Schema.String,
      completedAt: Schema.NullOr(Schema.String),
    }),
  ),
  lastAssistantMessage: Schema.NullOr(Schema.String).annotate({
    description: "The agent's latest reply, cut to 4000 characters.",
  }),
  lastError: Schema.NullOr(Schema.String),
  pendingRequests: Schema.Array(PendingRequest).annotate({
    description: "Approvals and questions waiting on the user, when status is needs-attention.",
  }),
  branch: Schema.NullOr(Schema.String),
  worktreePath: Schema.NullOr(Schema.String),
});
export type ThreadStatusResult = typeof ThreadStatusResult.Type;

export const UpdateThreadInput = Schema.Struct({
  threadId,
  title: Schema.optional(TrimmedNonEmptyString),
  model: Schema.optional(ModelInput.annotate({ description: "Used from the thread's next turn." })),
  runtimeMode: Schema.optional(
    RuntimeMode.annotate({ description: "Cannot exceed this thread's own mode." }),
  ),
  interactionMode: Schema.optional(ProviderInteractionMode),
});
export type UpdateThreadInput = typeof UpdateThreadInput.Type;

export const ThreadStateAction = Schema.Literals([
  "archive",
  "unarchive",
  "settle",
  "unsettle",
  "pin",
  "unpin",
  "snooze",
  "unsnooze",
  "stop",
]);
export type ThreadStateAction = typeof ThreadStateAction.Type;

export const SetThreadStateInput = Schema.Struct({
  threadId,
  action: ThreadStateAction.annotate({
    description:
      "archive hides the thread and stops its agent; unarchive brings it back. settle moves finished work out of the active list; unsettle returns it. pin and unpin keep it at the top. snooze hides it until snoozeUntil; unsnooze ends that early. stop ends the agent's session.",
  }),
  snoozeUntil: Schema.optional(
    TrimmedNonEmptyString.annotate({ description: "ISO time; required for snooze." }),
  ),
});
export type SetThreadStateInput = typeof SetThreadStateInput.Type;

export const RespondToRequestInput = Schema.Struct({
  threadId,
  requestId: TrimmedNonEmptyString.annotate({
    description: "From wait_for_thread's pendingRequests.",
  }),
  decision: Schema.optional(ProviderApprovalDecision.annotate({ description: "For an approval." })),
  answers: Schema.optional(
    Schema.Record(
      Schema.String,
      Schema.Union([Schema.String, Schema.Array(Schema.String)]),
    ).annotate({
      description:
        "For a question: each question id mapped to the chosen option, several for multiSelect, or your own text where allowed.",
    }),
  ),
});
export type RespondToRequestInput = typeof RespondToRequestInput.Type;

export const ThreadActionResult = Schema.Struct({ threadId: Schema.String });

export const InterruptTurnResult = Schema.Struct({
  threadId: Schema.String,
  interrupted: Schema.Boolean.annotate({ description: "False when nothing was running." }),
});

export const ListModelsInput = Schema.Struct({
  // An empty struct serializes as `anyOf [object, array]`, which some
  // providers reject and then drop every tool on the server with it.
  includeDisabled: Schema.optional(
    Schema.Boolean.annotate({ description: "Also list providers the user turned off." }),
  ),
});

export const ListModelsResult = Schema.Struct({
  providers: Schema.Array(
    Schema.Struct({
      instanceId: Schema.String,
      driver: Schema.String,
      displayName: Schema.NullOr(Schema.String),
      enabled: Schema.Boolean,
      status: Schema.String,
      models: Schema.Array(
        Schema.Struct({
          model: Schema.String,
          name: Schema.String,
          isDefault: Schema.Boolean,
        }),
      ),
    }),
  ),
});
export type ListModelsResult = typeof ListModelsResult.Type;

const CreateThreadTool = Tool.make("create_thread", {
  description:
    "Start a new T3 Code thread, which the user sees in their sidebar. Pass message to put an agent to work on it; follow it with wait_for_thread. Each thread is a separate agent with its own context, so say everything it needs in the message.",
  parameters: CreateThreadInput,
  success: CreateThreadResult,
  failure: OperateToolError,
  dependencies,
})
  .annotate(Tool.Title, "Start a thread")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false)
  .annotate(McpSchema.EnabledWhen, McpActor.operateToolsVisible);

const SendMessageTool = Tool.make("send_message", {
  description:
    "Send a message to another thread's agent, as the user would from its composer. If the agent is mid-turn, the message waits for the turn to end.",
  parameters: SendMessageInput,
  success: SendMessageResult,
  failure: OperateToolError,
  dependencies,
})
  .annotate(Tool.Title, "Message a thread")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false)
  .annotate(McpSchema.EnabledWhen, McpActor.operateToolsVisible);

const WaitForThreadTool = Tool.make("wait_for_thread", {
  description:
    "Wait until a thread's agent stops working, then return its status and latest reply. Returns early when the thread needs the user, and with status working when the wait runs out; call again to keep waiting.",
  parameters: ThreadStatusInput,
  success: ThreadStatusResult,
  failure: OperateToolError,
  dependencies,
})
  .annotate(Tool.Title, "Wait for a thread")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false)
  .annotate(McpSchema.EnabledWhen, McpActor.operateToolsVisible);

const InterruptTurnTool = Tool.make("interrupt_turn", {
  description: "Stop the turn a thread's agent is running, like the user pressing stop.",
  parameters: Schema.Struct({ threadId }),
  success: InterruptTurnResult,
  failure: OperateToolError,
  dependencies,
})
  .annotate(Tool.Title, "Stop a thread's turn")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false)
  .annotate(McpSchema.EnabledWhen, McpActor.operateToolsVisible);

const ListModelsTool = Tool.make("list_models", {
  description:
    "List the providers and models this T3 Code environment can run, for create_thread's model.",
  parameters: ListModelsInput,
  success: ListModelsResult,
  failure: OperateToolError,
  dependencies,
})
  .annotate(Tool.Title, "List models")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false)
  .annotate(McpSchema.EnabledWhen, McpActor.operateToolsVisible);

const UpdateThreadTool = Tool.make("update_thread", {
  description: "Rename another thread, or change the model and modes its next turn uses.",
  parameters: UpdateThreadInput,
  success: ThreadActionResult,
  failure: OperateToolError,
  dependencies,
})
  .annotate(Tool.Title, "Update a thread")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false)
  .annotate(McpSchema.EnabledWhen, McpActor.operateToolsVisible);

const SetThreadStateTool = Tool.make("set_thread_state", {
  description:
    "Archive, settle, pin, snooze, or stop another thread, or undo any of those, as the user can from the sidebar.",
  parameters: SetThreadStateInput,
  success: ThreadActionResult,
  failure: OperateToolError,
  dependencies,
})
  .annotate(Tool.Title, "Change a thread's state")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false)
  .annotate(McpSchema.EnabledWhen, McpActor.operateToolsVisible);

const RespondToRequestTool = Tool.make("respond_to_request", {
  description:
    "Answer an approval or question a thread's agent is waiting on, as the user would. Pass decision for an approval, answers for a question.",
  parameters: RespondToRequestInput,
  success: ThreadActionResult,
  failure: OperateToolError,
  dependencies,
})
  .annotate(Tool.Title, "Answer a thread's request")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false)
  .annotate(McpSchema.EnabledWhen, McpActor.tokenToolsVisible);

export const OperateToolkit = Toolkit.make(
  CreateThreadTool,
  SendMessageTool,
  WaitForThreadTool,
  InterruptTurnTool,
  ListModelsTool,
  UpdateThreadTool,
  SetThreadStateTool,
  RespondToRequestTool,
);
