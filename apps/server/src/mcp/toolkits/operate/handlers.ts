import * as NodeCrypto from "node:crypto";

import {
  CommandId,
  MessageId,
  type ModelSelection,
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
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import * as GitWorkflowService from "../../../git/GitWorkflowService.ts";
import * as ClientCommandDispatcher from "../../../orchestration/ClientCommandDispatcher.ts";
import * as OrchestrationEngine from "../../../orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { threadHasQueuedTurnStart } from "../../../orchestration/ThreadSettlementPolicy.ts";
import * as ProviderRegistry from "../../../provider/Services/ProviderRegistry.ts";
import * as ServerSettings from "../../../serverSettings.ts";
import * as McpActor from "../../McpActor.ts";
import { resolveRuntimeMode, selfTargetRefusal, spawnRefusal } from "./policy.ts";
import {
  type CreateThreadInput,
  OperateToolError,
  OperateToolkit,
  type ThreadStatusResult,
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

  const lastAssistantMessage = (threadId: ThreadId) =>
    snapshots.getThreadDetailSnapshot(threadId, { turnLimit: 1 }).pipe(
      Effect.map(
        Option.flatMap(({ thread }) =>
          Option.fromNullishOr(
            thread.messages.findLast((message) => message.role === "assistant")?.text,
          ),
        ),
      ),
      Effect.map(
        Option.match({
          onNone: () => null,
          onSome: (text) =>
            text.length > MAX_ASSISTANT_MESSAGE_CHARS
              ? `${text.slice(0, MAX_ASSISTANT_MESSAGE_CHARS)}…`
              : text,
        }),
      ),
      Effect.orElseSucceed(() => null),
    );

  const statusResult = (thread: OrchestrationThreadShell, status: ThreadStatusResult["status"]) =>
    lastAssistantMessage(thread.id).pipe(
      Effect.map((text): ThreadStatusResult => ({
        threadId: thread.id,
        title: thread.title,
        status,
        latestTurn:
          thread.latestTurn === null
            ? null
            : { state: thread.latestTurn.state, completedAt: thread.latestTurn.completedAt },
        lastAssistantMessage: text,
        lastError: thread.session?.lastError ?? null,
        branch: thread.branch,
        worktreePath: thread.worktreePath,
      })),
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
  });
});

export const OperateToolkitHandlersLive = OperateToolkit.toLayer(make);
