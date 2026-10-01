import { ProviderInteractionMode, RuntimeMode, TrimmedNonEmptyString } from "@t3tools/contracts";
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
  branch: Schema.NullOr(Schema.String),
  worktreePath: Schema.NullOr(Schema.String),
});
export type ThreadStatusResult = typeof ThreadStatusResult.Type;

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

export const OperateToolkit = Toolkit.make(
  CreateThreadTool,
  SendMessageTool,
  WaitForThreadTool,
  InterruptTurnTool,
  ListModelsTool,
);
