import * as NodeCrypto from "node:crypto";

import {
  CommandId,
  MessageId,
  ApprovalRequestId,
  type ModelSelection,
  type OrchestrationThread,
  type OrchestrationThreadActivity,
  type OrchestrationThreadShell,
  ProjectId,
  ProviderInstanceId,
  type ThreadCreatedBy,
  ThreadId,
} from "@t3tools/contracts";
import { buildTemporaryWorktreeBranchName } from "@t3tools/shared/git";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { truncate } from "@t3tools/shared/String";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../../../config.ts";
import * as GitWorkflowService from "../../../git/GitWorkflowService.ts";
import { normalizeDispatchCommand } from "../../../orchestration/Normalizer.ts";
import * as ClientCommandDispatcher from "../../../orchestration/ClientCommandDispatcher.ts";
import * as OrchestrationEngine from "../../../orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { threadHasQueuedTurnStart } from "../../../orchestration/ThreadSettlementPolicy.ts";
import { openRequests } from "../../../orchestration/decider.ts";
import * as ProviderRegistry from "../../../provider/Services/ProviderRegistry.ts";
import * as ServerSettings from "../../../serverSettings.ts";
import * as WorkspacePaths from "../../../workspace/WorkspacePaths.ts";
import * as McpActor from "../../McpActor.ts";
import { resolveRuntimeMode, selfTargetRefusal, spawnRefusal } from "./policy.ts";
import {
  type CreateProjectInput,
  type CreateThreadInput,
  OperateToolError,
  OperateToolkit,
  type PendingRequest,
  type RespondToRequestInput,
  type SetThreadStateInput,
  type ThreadStatusResult,
  type UpdateProjectInput,
  type UpdateThreadInput,
} from "./tools.ts";

/**
 * How long create_thread waits for the thread to start before handing back
 * "preparing". Worktree checkout and setup scripts can run for minutes; the
 * bootstrap carries on without the caller either way.
 */
const CREATE_THREAD_WAIT = Duration.seconds(20);
const DEFAULT_WAIT_SECONDS = 120;
const MAX_ASSISTANT_MESSAGE_CHARS = 4_000;

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

const fail = (reason: string) => Effect.fail(new OperateToolError({ reason }));

/** Dispatch and read failures are server faults the agent can only report, so their text is enough. */
const asToolError = (cause: { readonly message: string }) =>
  new OperateToolError({ reason: cause.message });

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

/** An open approval or question as an agent answering it needs to see it. */
export function pendingRequestOf(activity: OrchestrationThreadActivity): PendingRequest | null {
  const payload = asRecord(activity.payload);
  if (typeof payload.requestId !== "string") return null;
  if (activity.kind === "approval.requested") {
    const options = Array.isArray(payload.options) ? payload.options.map(asRecord) : [];
    const decisions = options.flatMap((option) =>
      typeof option.decision === "string" ? [option.decision] : [],
    );
    return {
      requestId: payload.requestId,
      kind: "approval",
      summary: activity.summary,
      detail: typeof payload.detail === "string" ? payload.detail : null,
      decisions: decisions.length > 0 ? decisions : ["accept", "decline"],
      questions: [],
    };
  }
  const questions = Array.isArray(payload.questions) ? payload.questions.map(asRecord) : [];
  return {
    requestId: payload.requestId,
    kind: "question",
    summary: activity.summary,
    detail: null,
    decisions: [],
    questions: questions.flatMap((question) =>
      typeof question.id === "string" && typeof question.question === "string"
        ? [
            {
              id: question.id,
              question: question.question,
              options: (Array.isArray(question.options) ? question.options : [])
                .map(asRecord)
                .flatMap((option) =>
                  typeof option.value === "string"
                    ? [option.value]
                    : typeof option.label === "string"
                      ? [option.label]
                      : [],
                ),
              multiSelect: question.multiSelect === true,
            },
          ]
        : [],
    ),
  };
}

/** What a thread is doing, as an agent waiting on it needs to know. */
export function threadStatusOf(
  thread: OrchestrationThreadShell,
  now: string,
): ThreadStatusResult["status"] {
  if (thread.hasPendingApprovals || thread.hasPendingUserInput) return "needs-attention";
  if (
    thread.session?.status === "starting" ||
    thread.session?.status === "running" ||
    thread.latestTurn?.state === "running" ||
    thread.backgroundLiveness === "working" ||
    threadHasQueuedTurnStart(thread, now)
  ) {
    return "working";
  }
  if (thread.session?.status === "error") return "error";
  return "idle";
}

const make = Effect.gen(function* () {
  const dispatcher = (yield* ClientCommandDispatcher.ClientCommandDispatcher).forOrigin(undefined);
  const engine = yield* OrchestrationEngine.OrchestrationEngineService;
  const snapshots = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const providers = yield* ProviderRegistry.ProviderRegistry;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const gitWorkflow = yield* GitWorkflowService.GitWorkflowService;
  const crypto = yield* Crypto.Crypto;
  const path = yield* Path.Path;
  // Project roots are resolved and checked the same way a client's are.
  const normalizerContext = yield* Effect.context<
    FileSystem.FileSystem | Path.Path | ServerConfig.ServerConfig | WorkspacePaths.WorkspacePaths
  >();

  const uuid = crypto.randomUUIDv4.pipe(Effect.orDie);
  const commandId = (tag: string) =>
    uuid.pipe(Effect.map((id) => CommandId.make(`server:mcp-${tag}:${id}`)));

  /** The caller, refused unless it may drive threads. */
  const requireOperator = Effect.gen(function* () {
    const actor = yield* McpActor.McpActor;
    if (!McpActor.canOperate(actor)) {
      return yield* fail(
        "Thread control is off for this thread. The user can turn it on in Settings.",
      );
    }
    return actor;
  });

  const threadShell = (threadId: string) =>
    snapshots.getThreadShellById(ThreadId.make(threadId)).pipe(
      Effect.mapError(asToolError),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            fail(`No thread ${threadId} was found. It may have been archived or deleted.`),
          onSome: Effect.succeed,
        }),
      ),
    );

  const callerShell = (actor: McpActor.McpActorValue) =>
    actor.kind === "thread" ? threadShell(actor.threadId).pipe(Effect.asSome) : Effect.succeedNone;

  /** A thread the caller may act on: any other thread. */
  const targetShell = Effect.fn("OperateToolkit.targetShell")(function* (
    actor: McpActor.McpActorValue,
    threadId: string,
  ) {
    const refusal = selfTargetRefusal(
      actor.kind === "thread" ? actor.threadId : null,
      ThreadId.make(threadId),
    );
    if (refusal !== null) return yield* fail(refusal);
    return yield* threadShell(threadId);
  });

  const createdByOf = (actor: McpActor.McpActorValue): ThreadCreatedBy =>
    actor.kind === "thread"
      ? { kind: "thread", threadId: actor.threadId }
      : { kind: "agent-access", label: actor.label };

  const createThread = Effect.fn("OperateToolkit.createThread")(function* (
    input: CreateThreadInput,
  ) {
    const actor = yield* requireOperator;
    const caller = Option.getOrUndefined(yield* callerShell(actor));
    if (caller !== undefined) {
      const shells = yield* snapshots.getShellSnapshot().pipe(Effect.mapError(asToolError));
      const refusal = spawnRefusal(caller, shells.threads);
      if (refusal !== null) return yield* fail(refusal);
    }

    const projectId = input.projectId ?? caller?.projectId;
    if (projectId === undefined) {
      return yield* fail("Pass projectId. The history tools' list_projects lists them.");
    }
    const project = yield* snapshots.getProjectShellById(ProjectId.make(projectId)).pipe(
      Effect.mapError(asToolError),
      Effect.flatMap(
        Option.match({
          onNone: () => fail(`No project ${projectId} was found.`),
          onSome: Effect.succeed,
        }),
      ),
    );
    const settings = yield* serverSettings.getSettings.pipe(Effect.mapError(asToolError));
    const resolved = resolveProjectSettings(settings, project.id, project).settings;

    const modelSelection: ModelSelection | null = input.model
      ? { instanceId: ProviderInstanceId.make(input.model.instanceId), model: input.model.model }
      : (project.defaultModelSelection ?? caller?.modelSelection ?? null);
    if (modelSelection === null) {
      return yield* fail("This project has no default model. Pass model; list_models lists them.");
    }

    const runtime = resolveRuntimeMode(
      input.runtimeMode,
      caller?.runtimeMode ?? resolved.defaultRuntimeMode,
    );
    if ("refused" in runtime) return yield* fail(runtime.refused);

    const workspace = input.workspace ?? resolved.defaultThreadEnvMode ?? "local";
    const checkoutBranch = yield* gitWorkflow.localStatus({ cwd: project.workspaceRoot }).pipe(
      Effect.map((status) => (status.isRepo ? status.refName : null)),
      Effect.orElseSucceed(() => null),
    );
    const baseBranch = input.baseBranch ?? checkoutBranch;
    if (workspace === "worktree" && baseBranch === null) {
      return yield* fail(
        "A worktree needs a base branch, and the project checkout is not on one. Pass baseBranch, or use workspace local.",
      );
    }

    const message = input.message;
    const title =
      input.title ?? (message ? truncate(message.split("\n")[0] ?? message) : "New thread");
    const threadId = ThreadId.make(yield* uuid);
    const createdAt = yield* nowIso;
    const command = {
      type: "thread.turn.start" as const,
      commandId: yield* commandId("create-thread"),
      threadId,
      message: {
        messageId: MessageId.make(yield* uuid),
        role: "user" as const,
        text: message ?? "",
        attachments: [],
      },
      modelSelection,
      titleSeed: title,
      runtimeMode: runtime.mode,
      interactionMode: input.interactionMode ?? "default",
      bootstrap: {
        createThread: {
          projectId: project.id,
          title,
          modelSelection,
          runtimeMode: runtime.mode,
          interactionMode: input.interactionMode ?? "default",
          branch: workspace === "worktree" ? baseBranch : checkoutBranch,
          worktreePath: null,
          createdAt,
          createdBy: createdByOf(actor),
        },
        ...(workspace === "worktree" && baseBranch !== null
          ? {
              prepareWorktree: {
                projectCwd: project.workspaceRoot,
                baseBranch,
                branch: buildTemporaryWorktreeBranchName((bytes) =>
                  NodeCrypto.randomBytes(bytes).toString("hex"),
                ),
                ...(resolved.newWorktreesStartFromOrigin ? { startFromOrigin: true } : {}),
              },
              runSetupScript: true,
            }
          : {}),
        ...(message === undefined ? { deferTurn: true } : {}),
      },
      createdAt,
    };

    // The bootstrap outlives this call, so a slow checkout does not hold the agent up.
    const fiber = yield* Effect.forkDetach(dispatcher.dispatch(command));
    const exit = yield* Fiber.await(fiber).pipe(Effect.timeoutOption(CREATE_THREAD_WAIT));
    if (Option.isSome(exit) && Exit.isFailure(exit.value)) {
      const failure = Exit.findErrorOption(exit.value);
      return yield* fail(
        Option.isSome(failure) ? failure.value.message : "The thread could not be started.",
      );
    }
    return {
      threadId,
      projectId: project.id,
      title,
      status: message === undefined ? "idle" : Option.isSome(exit) ? "started" : "preparing",
    } as const;
  });

  const sendMessage = Effect.fn("OperateToolkit.sendMessage")(function* (input: {
    readonly threadId: string;
    readonly message: string;
    readonly interactionMode?: "default" | "plan" | undefined;
  }) {
    const actor = yield* requireOperator;
    const thread = yield* targetShell(actor, input.threadId);
    const messageId = MessageId.make(yield* uuid);
    yield* dispatcher
      .dispatch({
        type: "thread.turn.start",
        commandId: yield* commandId("send-message"),
        threadId: thread.id,
        message: { messageId, role: "user", text: input.message, attachments: [] },
        runtimeMode: thread.runtimeMode,
        interactionMode: input.interactionMode ?? thread.interactionMode,
        createdAt: yield* nowIso,
      })
      .pipe(Effect.mapError(asToolError));
    return { threadId: thread.id, messageId };
  });

  /** The latest reply and open requests, read from the thread's newest turn. */
  const recentDetail = (threadId: ThreadId) =>
    snapshots.getThreadDetailSnapshot(threadId, { turnLimit: 1 }).pipe(
      Effect.map(Option.map(({ thread }) => thread)),
      Effect.map(Option.getOrNull),
      Effect.orElseSucceed((): OrchestrationThread | null => null),
    );

  const statusResult = (thread: OrchestrationThreadShell, status: ThreadStatusResult["status"]) =>
    recentDetail(thread.id).pipe(
      Effect.map((detail): ThreadStatusResult => {
        const text =
          detail?.messages.findLast((message) => message.role === "assistant")?.text ?? null;
        return {
          threadId: thread.id,
          title: thread.title,
          status,
          latestTurn:
            thread.latestTurn === null
              ? null
              : { state: thread.latestTurn.state, completedAt: thread.latestTurn.completedAt },
          lastAssistantMessage:
            text !== null && text.length > MAX_ASSISTANT_MESSAGE_CHARS
              ? `${text.slice(0, MAX_ASSISTANT_MESSAGE_CHARS)}…`
              : text,
          lastError: thread.session?.lastError ?? null,
          pendingRequests:
            detail === null
              ? []
              : [...openRequests(detail).values()].flatMap((activity) => {
                  const request = pendingRequestOf(activity);
                  return request === null ? [] : [request];
                }),
          branch: thread.branch,
          worktreePath: thread.worktreePath,
        };
      }),
    );

  const waitForThread = Effect.fn("OperateToolkit.waitForThread")(function* (input: {
    readonly threadId: string;
    readonly timeoutSeconds?: number | undefined;
  }) {
    const actor = yield* requireOperator;
    const target = yield* targetShell(actor, input.threadId);
    const timeout = Duration.seconds(input.timeoutSeconds ?? DEFAULT_WAIT_SECONDS);
    return yield* Effect.scoped(
      Effect.gen(function* () {
        // Subscribe before reading, so an event between the read and the wait still wakes us.
        const events = yield* engine.subscribeDomainEvents;
        const current = yield* threadShell(target.id);
        const status = threadStatusOf(current, yield* nowIso);
        if (status !== "working" || Duration.isZero(timeout)) {
          return yield* statusResult(current, status);
        }
        const settled = yield* events.pipe(
          Stream.filter(
            (event) => event.aggregateKind === "thread" && event.aggregateId === target.id,
          ),
          Stream.mapEffect(() =>
            Effect.all([threadShell(target.id), nowIso]).pipe(
              Effect.map(([thread, now]) => ({ thread, status: threadStatusOf(thread, now) })),
            ),
          ),
          Stream.filter(({ status }) => status !== "working"),
          Stream.runHead,
          Effect.timeoutOption(timeout),
          Effect.map(Option.flatten),
        );
        if (Option.isSome(settled)) {
          return yield* statusResult(settled.value.thread, settled.value.status);
        }
        const latest = yield* threadShell(target.id);
        return yield* statusResult(latest, threadStatusOf(latest, yield* nowIso));
      }),
    );
  });

  const interruptTurn = Effect.fn("OperateToolkit.interruptTurn")(function* (input: {
    readonly threadId: string;
  }) {
    const actor = yield* requireOperator;
    const thread = yield* targetShell(actor, input.threadId);
    const running = thread.latestTurn?.state === "running";
    if (!running) return { threadId: thread.id, interrupted: false };
    yield* dispatcher
      .dispatch({
        type: "thread.turn.interrupt",
        commandId: yield* commandId("interrupt-turn"),
        threadId: thread.id,
        ...(thread.latestTurn ? { turnId: thread.latestTurn.turnId } : {}),
        createdAt: yield* nowIso,
      })
      .pipe(Effect.mapError(asToolError));
    return { threadId: thread.id, interrupted: true };
  });

  const updateThread = Effect.fn("OperateToolkit.updateThread")(function* (
    input: UpdateThreadInput,
  ) {
    const actor = yield* requireOperator;
    const thread = yield* targetShell(actor, input.threadId);
    const createdAt = yield* nowIso;
    if (input.runtimeMode !== undefined) {
      const caller = Option.getOrUndefined(yield* callerShell(actor));
      const runtime = resolveRuntimeMode(input.runtimeMode, caller?.runtimeMode ?? "full-access");
      if ("refused" in runtime) return yield* fail(runtime.refused);
    }
    if (input.title !== undefined || input.model !== undefined) {
      yield* dispatcher
        .dispatch({
          type: "thread.meta.update",
          commandId: yield* commandId("update-thread"),
          threadId: thread.id,
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.model !== undefined
            ? {
                modelSelection: {
                  instanceId: ProviderInstanceId.make(input.model.instanceId),
                  model: input.model.model,
                },
              }
            : {}),
        })
        .pipe(Effect.mapError(asToolError));
    }
    if (input.runtimeMode !== undefined) {
      yield* dispatcher
        .dispatch({
          type: "thread.runtime-mode.set",
          commandId: yield* commandId("runtime-mode"),
          threadId: thread.id,
          runtimeMode: input.runtimeMode,
          createdAt,
        })
        .pipe(Effect.mapError(asToolError));
    }
    if (input.interactionMode !== undefined) {
      yield* dispatcher
        .dispatch({
          type: "thread.interaction-mode.set",
          commandId: yield* commandId("interaction-mode"),
          threadId: thread.id,
          interactionMode: input.interactionMode,
          createdAt,
        })
        .pipe(Effect.mapError(asToolError));
    }
    return { threadId: thread.id };
  });

  const setThreadState = Effect.fn("OperateToolkit.setThreadState")(function* (
    input: SetThreadStateInput,
  ) {
    const actor = yield* requireOperator;
    const threadId = ThreadId.make(input.threadId);
    const refusal = selfTargetRefusal(actor.kind === "thread" ? actor.threadId : null, threadId);
    if (refusal !== null) return yield* fail(refusal);
    // Archived threads have no active shell, so unarchive goes straight to the decider.
    if (input.action !== "unarchive") yield* threadShell(input.threadId);
    const id = yield* commandId(`thread-${input.action}`);
    const command = yield* Effect.gen(function* () {
      switch (input.action) {
        case "archive":
          return { type: "thread.archive" as const, commandId: id, threadId };
        case "unarchive":
          return { type: "thread.unarchive" as const, commandId: id, threadId };
        case "settle":
          return { type: "thread.settle" as const, commandId: id, threadId };
        case "unsettle":
          return {
            type: "thread.unsettle" as const,
            commandId: id,
            threadId,
            reason: "user" as const,
          };
        case "pin":
          return { type: "thread.pin" as const, commandId: id, threadId };
        case "unpin":
          return { type: "thread.unpin" as const, commandId: id, threadId };
        case "unsnooze":
          return {
            type: "thread.unsnooze" as const,
            commandId: id,
            threadId,
            reason: "user" as const,
          };
        case "stop":
          return {
            type: "thread.session.stop" as const,
            commandId: id,
            threadId,
            createdAt: yield* nowIso,
          };
        case "snooze": {
          const until =
            input.snoozeUntil === undefined ? undefined : DateTime.make(input.snoozeUntil);
          if (until === undefined || Option.isNone(until)) {
            return yield* fail("Pass snoozeUntil as an ISO time to snooze.");
          }
          return {
            type: "thread.snooze" as const,
            commandId: id,
            threadId,
            snoozedUntil: DateTime.formatIso(until.value),
          };
        }
      }
    });
    yield* dispatcher.dispatch(command).pipe(Effect.mapError(asToolError));
    return { threadId };
  });

  const respondToRequest = Effect.fn("OperateToolkit.respondToRequest")(function* (
    input: RespondToRequestInput,
  ) {
    const actor = yield* requireOperator;
    // Answering approves on the user's behalf, which only the user's own token may do.
    if (actor.kind !== "token") {
      return yield* fail("Only the user can answer another thread's approvals and questions.");
    }
    const thread = yield* threadShell(input.threadId);
    const createdAt = yield* nowIso;
    const requestId = ApprovalRequestId.make(input.requestId);
    if (input.decision !== undefined) {
      yield* dispatcher
        .dispatch({
          type: "thread.approval.respond",
          commandId: yield* commandId("approval-respond"),
          threadId: thread.id,
          requestId,
          decision: input.decision,
          createdAt,
        })
        .pipe(Effect.mapError(asToolError));
    } else if (input.answers !== undefined) {
      yield* dispatcher
        .dispatch({
          type: "thread.user-input.respond",
          commandId: yield* commandId("user-input-respond"),
          threadId: thread.id,
          requestId,
          answers: input.answers,
          createdAt,
        })
        .pipe(Effect.mapError(asToolError));
    } else {
      return yield* fail("Pass decision for an approval, or answers for a question.");
    }
    return { threadId: thread.id };
  });

  const createProject = Effect.fn("OperateToolkit.createProject")(function* (
    input: CreateProjectInput,
  ) {
    yield* requireOperator;
    const command = yield* normalizeDispatchCommand({
      type: "project.create",
      commandId: yield* commandId("create-project"),
      projectId: ProjectId.make(yield* uuid),
      title: input.title ?? (path.basename(input.workspaceRoot) || input.workspaceRoot),
      workspaceRoot: input.workspaceRoot,
      createWorkspaceRootIfMissing: input.createIfMissing === true,
      createdAt: yield* nowIso,
    }).pipe(Effect.provideContext(normalizerContext), Effect.mapError(asToolError));
    if (command.type !== "project.create") return yield* fail("The project could not be added.");
    yield* dispatcher.dispatch(command).pipe(Effect.mapError(asToolError));
    return {
      projectId: command.projectId,
      title: command.title,
      workspaceRoot: command.workspaceRoot,
    };
  });

  const updateProject = Effect.fn("OperateToolkit.updateProject")(function* (
    input: UpdateProjectInput,
  ) {
    yield* requireOperator;
    const projectId = ProjectId.make(input.projectId);
    yield* dispatcher
      .dispatch({
        type: "project.meta.update",
        commandId: yield* commandId("update-project"),
        projectId,
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.defaultModel !== undefined
          ? {
              defaultModelSelection:
                input.defaultModel === null
                  ? null
                  : {
                      instanceId: ProviderInstanceId.make(input.defaultModel.instanceId),
                      model: input.defaultModel.model,
                    },
            }
          : {}),
        ...(input.defaultWorkspace !== undefined
          ? { defaultThreadEnvMode: input.defaultWorkspace }
          : {}),
      })
      .pipe(Effect.mapError(asToolError));
    return { projectId };
  });

  const listModels = Effect.fn("OperateToolkit.listModels")(function* (input: {
    readonly includeDisabled?: boolean | undefined;
  }) {
    yield* requireOperator;
    const all = yield* providers.getProviders;
    return {
      providers: all
        .filter((provider) => input.includeDisabled === true || provider.enabled)
        .map((provider) => ({
          instanceId: provider.instanceId,
          driver: provider.driver,
          displayName: provider.displayName ?? null,
          enabled: provider.enabled,
          status: provider.status,
          models: provider.models
            .filter((model) => model.isLegacy !== true)
            .map((model) => ({
              model: model.slug,
              name: model.name,
              isDefault: model.isDefault === true,
            })),
        })),
    };
  });

  return OperateToolkit.of({
    create_thread: createThread,
    send_message: sendMessage,
    wait_for_thread: waitForThread,
    interrupt_turn: interruptTurn,
    list_models: listModels,
    update_thread: updateThread,
    set_thread_state: setThreadState,
    respond_to_request: respondToRequest,
    create_project: createProject,
    update_project: updateProject,
  });
});

export const OperateToolkitHandlersLive = OperateToolkit.toLayer(make);
