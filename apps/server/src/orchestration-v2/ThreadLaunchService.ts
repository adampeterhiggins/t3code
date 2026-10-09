import * as WorktreeSetupTracker from "../project/WorktreeSetupTracker.ts";
import * as ProjectCloneTracker from "../project/ProjectCloneTracker.ts";
import * as TerminalManager from "../terminal/Manager.ts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import {
  CommandId,
  type ChatAttachment,
  type MessageId,
  type ModelSelection,
  type OrchestrationMessageContext,
  type OrchestrationV2Actor,
  type OrchestrationV2CreationSource,
  type OrchestrationV2ThreadStartedBy,
  type OrchestrationV2ProviderThreadNativeMetadata,
  type OrchestrationV2ThreadProjection,
  type ProviderDriverKind,
  type ProviderInteractionMode,
  ProjectId,
  type RunId,
  type RuntimeMode,
  type ScheduledTaskId,
  ThreadId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import {
  buildTemporaryWorktreeBranchName,
  flattenTemporaryWorktreeBranchName,
  isTemporaryWorktreeBranch,
  WORKTREE_BRANCH_PREFIX,
} from "@t3tools/shared/git";

import * as ContextRepositories from "../contextRepositories/ContextRepositories.ts";
import {
  ensureMessageContextRepositories,
  messageRepositoryRecords,
} from "../contextRepositories/messageContextRepositories.ts";
import * as GitWorkflow from "../git/GitWorkflowService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProjectSetupScriptRunner from "../project/ProjectSetupScriptRunner.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as CommandReceiptStore from "./CommandReceiptStore.ts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import type * as Orchestrator from "./Orchestrator.ts";
import { makeProviderFailure } from "@t3tools/provider-core/server/failure";
import { randomUuidV4 } from "@t3tools/provider-core/server/randomUuid";
import * as ThreadManagement from "./ThreadManagementService.ts";

export type ThreadLaunchWorkspaceStrategy =
  | { readonly type: "root"; readonly branch?: string | undefined }
  | {
      readonly type: "existing_worktree";
      readonly worktreePath: string;
      readonly branch?: string | undefined;
    }
  | {
      readonly type: "worktree";
      readonly baseRef: string;
      readonly branch?: string | undefined;
      readonly startFromOrigin?: boolean | undefined;
    };

export interface ThreadLaunchInitialMessage {
  readonly messageId?: MessageId;
  readonly scheduledTaskId?: ScheduledTaskId;
  readonly senderThreadId?: ThreadId;
  readonly text: string;
  readonly attachments: ReadonlyArray<ChatAttachment>;
  readonly context?: OrchestrationMessageContext | undefined;
}

export interface ThreadLaunchInput {
  readonly commandId: CommandId;
  readonly threadId?: ThreadId;
  readonly reuseExistingThread?: boolean;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly generateTitle?: boolean;
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  readonly workspaceStrategy: ThreadLaunchWorkspaceStrategy;
  readonly initialMessage?: ThreadLaunchInitialMessage;
  readonly importedNativeThread?: {
    readonly ref: {
      readonly driver: ProviderDriverKind;
      readonly nativeId: string;
      readonly strength: "strong";
    };
    readonly metadata?: OrchestrationV2ProviderThreadNativeMetadata;
  };
  readonly createdBy: OrchestrationV2Actor;
  readonly creationSource: OrchestrationV2CreationSource;
  /** Who started the thread when an agent launched it over MCP. */
  readonly startedBy?: OrchestrationV2ThreadStartedBy;
}

/** What workspace preparation reads from a launch; a retry rebuilds it from the run. */
type PreparationInput = Pick<
  ThreadLaunchInput,
  "commandId" | "projectId" | "workspaceStrategy" | "initialMessage"
> & {
  /**
   * Set when a retry reuses the worktree its failed attempt created and
   * recorded. Its setup is tracked like a new one, but the thread already
   * records the workspace, and a branch rename may still be running.
   */
  readonly reusedWorktree?: { readonly baseRef: string };
};

export interface ThreadLaunchRetryInput {
  readonly commandId: CommandId;
  readonly threadId: ThreadId;
  readonly runId: RunId;
}

export interface ThreadLaunchResult {
  readonly threadId: ThreadId;
  readonly projection: OrchestrationV2ThreadProjection;
  readonly resumed: boolean;
}

export class ThreadLaunchError extends Schema.TaggedError<ThreadLaunchError>()(
  "ThreadLaunchError",
  {
    operation: Schema.Literals([
      "resolve-project",
      "read-receipt",
      "generate-metadata",
      "provision-worktree",
      "run-setup-script",
      "create-thread",
      "update-thread",
      "dispatch-message",
      "release-run",
      "fail-run",
    ]),
    commandId: CommandId,
    projectId: ProjectId,
    threadId: Schema.optional(ThreadId),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Thread launch ${this.commandId} failed during ${this.operation}.`;
  }
}

export class ThreadLaunchService extends Context.Service<
  ThreadLaunchService,
  {
    readonly launch: (
      input: ThreadLaunchInput,
    ) => Effect.Effect<ThreadLaunchResult, ThreadLaunchError>;
    /** Dispatches prepared-run.retry and prepares the run's workspace again. */
    readonly retryPreparation: (
      input: ThreadLaunchRetryInput,
    ) => Effect.Effect<Orchestrator.OrchestratorV2DispatchResult, Orchestrator.OrchestratorV2Error>;
    /**
     * Prepares the workspace a preparing run recorded (its
     * `workspacePreparation`) in the background, binds it to the thread, and
     * releases the run, exactly as a launch does. A delegated task with its own
     * worktree uses this for its child's first run. Preparation failures fail
     * the run; a replay of a run already past preparation does nothing.
     */
    readonly prepareDeferredRun: (input: ThreadLaunchRetryInput) => Effect.Effect<void>;
    /**
     * Readies an existing thread's workspace for a message about to be
     * dispatched: waits for a message-less launch that is still preparing it,
     * then clones the message's attached repositories into it. Returns the
     * context with each repository's outcome filled in. Never fails.
     */
    readonly prepareMessageWorkspace: (input: {
      readonly threadId: ThreadId;
      readonly context: OrchestrationMessageContext | undefined;
    }) => Effect.Effect<OrchestrationMessageContext | undefined>;
    /**
     * Renames a thread's temporary `t3/<hash>` worktree branch from its
     * first message, in the background. A message-less launch leaves the
     * temporary name until that message arrives. Never fails.
     */
    readonly nameTemporaryBranch: (input: {
      readonly commandId: CommandId;
      readonly threadId: ThreadId;
      readonly message: ThreadLaunchInitialMessage;
    }) => Effect.Effect<void>;
  }
>()("t3/orchestration-v2/ThreadLaunchService") {}

const isThreadLaunchError = Schema.is(ThreadLaunchError);

/**
 * How long preparation waits, past checkout, for a generated branch name before
 * the setup script and first turn start on the temporary one.
 */
const BRANCH_NAME_WAIT = Duration.seconds(10);

function failureDetail(error: unknown): string {
  if (isThreadLaunchError(error)) {
    const cause = error.cause;
    const detail = cause instanceof Error ? cause.message : String(cause);
    return `Workspace preparation failed during ${error.operation.replaceAll("-", " ")}: ${detail}`;
  }
  return `Workspace preparation failed: ${error instanceof Error ? error.message : String(error)}`;
}

const make = Effect.gen(function* () {
  const projects = yield* ProjectService.ProjectService;
  const setupTracker = yield* WorktreeSetupTracker.WorktreeSetupTracker;
  const cloneTracker = yield* ProjectCloneTracker.ProjectCloneTracker;
  const terminals = yield* TerminalManager.TerminalManager;
  const git = yield* GitWorkflow.GitWorkflowService;
  const setupScripts = yield* ProjectSetupScriptRunner.ProjectSetupScriptRunner;
  const providerRegistry = yield* ProviderRegistry.ProviderRegistry;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const textGeneration = yield* TextGeneration.TextGeneration;
  const receipts = yield* CommandReceiptStore.CommandReceiptStoreV2;
  const ids = yield* IdAllocator.IdAllocatorV2;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const managedFolders = yield* ManagedProjectFolders.ManagedProjectFolders;
  const contextRepositories = yield* ContextRepositories.ContextRepositories;
  const ensureContextRepositories = (
    input: Parameters<typeof ensureMessageContextRepositories>[0],
  ) =>
    ensureMessageContextRepositories(input).pipe(
      Effect.provideService(ContextRepositories.ContextRepositories, contextRepositories),
      Effect.provideService(WorktreeSetupTracker.WorktreeSetupTracker, setupTracker),
      Effect.provideService(ServerSettings.ServerSettingsService, serverSettings),
    );
  const preparationScope = yield* Scope.make("sequential");
  const scheduledLaunches = yield* Ref.make<ReadonlySet<CommandId>>(new Set());
  // Message-less launches still preparing their workspace; a first message waits on them.
  const messageLessPreparations = yield* Ref.make<ReadonlyMap<ThreadId, Deferred.Deferred<void>>>(
    new Map(),
  );
  yield* Effect.addFinalizer(() => Scope.close(preparationScope, Exit.void));

  const mapError =
    (input: PreparationInput, operation: ThreadLaunchError["operation"], threadId?: ThreadId) =>
    (cause: unknown) =>
      new ThreadLaunchError({
        operation,
        commandId: input.commandId,
        projectId: input.projectId,
        ...(threadId === undefined ? {} : { threadId }),
        cause,
      });

  const readReceipt = (input: ThreadLaunchInput, commandId: CommandId) =>
    receipts
      .getByCommandId(commandId)
      .pipe(Effect.mapError(mapError(input, "read-receipt", input.threadId)));

  const validateReusableThread = Effect.fn("ThreadLaunchService.validateReusableThread")(function* (
    input: ThreadLaunchInput,
    threadId: ThreadId,
  ) {
    const projection = yield* threads
      .getThreadRecords(threadId, ["runs"])
      .pipe(Effect.mapError(mapError(input, "update-thread", threadId)));
    if (
      projection.thread.projectId !== input.projectId ||
      projection.thread.archivedAt !== null ||
      projection.thread.deletedAt !== null ||
      (yield* threads
        .getMessageCount(threadId)
        .pipe(Effect.mapError(mapError(input, "update-thread", threadId)))) > 0 ||
      projection.runs.length > 0
    ) {
      return yield* mapError(
        input,
        "update-thread",
        threadId,
      )("Only an empty active thread in the target project can change workspace during launch.");
    }
  });

  const generateBranchNameFor = (
    projectId: ProjectId,
    cwd: string,
    message: ThreadLaunchInitialMessage,
  ) =>
    Effect.gen(function* () {
      const settings = resolveProjectSettings(
        yield* serverSettings.getSettings,
        projectId,
      ).settings;
      const modelSelection =
        settings.sourceControlWriterModelSelection === null
          ? settings.textGenerationModelSelection
          : ServerSettings.resolveSourceControlWriterModelSelection(
              settings,
              yield* providerRegistry.getProviders,
            );
      return yield* textGeneration
        .generateBranchName({
          naming: {
            mode: settings.branchNamingMode,
            prefix: settings.branchNamePrefix,
            instructions: settings.branchNameInstructions,
          },
          cwd,
          message: message.text,
          attachments: message.attachments,
          ...(message.context ? { context: message.context } : {}),
          modelSelection,
        })
        .pipe(
          Effect.map((result) => ({
            branch: result.branch,
            exactName: settings.branchNamingMode === "custom",
          })),
        );
    });

  /** Renames the thread's temporary branch to a generated name and records it. */
  const renameTemporaryBranch = <E>(input: {
    readonly commandId: CommandId;
    readonly threadId: ThreadId;
    readonly worktreePath: string;
    readonly oldBranch: string;
    readonly generated: Effect.Effect<{ readonly branch: string; readonly exactName: boolean }, E>;
  }) =>
    input.generated.pipe(
      Effect.flatMap(({ branch: newBranch, exactName }) =>
        git.renameBranch({
          cwd: input.worktreePath,
          oldBranch: input.oldBranch,
          newBranch,
          ...(exactName ? { exactName: true } : {}),
        }),
      ),
      Effect.flatMap((renamed) =>
        threads.dispatch({
          type: "thread.metadata.update",
          commandId: CommandId.make(`${input.commandId}:branch-rename`),
          threadId: input.threadId,
          branch: renamed.branch,
          worktreePath: input.worktreePath,
        }),
      ),
      Effect.catchCause((cause) =>
        Effect.logWarning("Thread worktree branch rename failed", {
          commandId: input.commandId,
          threadId: input.threadId,
          oldBranch: input.oldBranch,
          cause,
        }),
      ),
    );

  const prepareInBackground = Effect.fn("ThreadLaunchService.prepareInBackground")(function* (
    input: PreparationInput,
    threadId: ThreadId,
    runId: RunId | null,
  ) {
    const project = yield* projects.getById(input.projectId).pipe(
      Effect.mapError(mapError(input, "resolve-project", threadId)),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(mapError(input, "resolve-project", threadId)("Project no longer exists.")),
          onSome: Effect.succeed,
        }),
      ),
    );

    const reused = input.reusedWorktree;
    const tracked = input.workspaceStrategy.type === "worktree" || reused !== undefined;
    // A launch without a message only prepares the workspace; no agent starts.
    const messageLess = runId === null;
    const repositoryRecords = messageLess
      ? []
      : messageRepositoryRecords(input.initialMessage?.context);
    const contextStage = repositoryRecords.length > 0 ? (["context-repositories"] as const) : [];
    const agentStage = messageLess ? [] : (["agent"] as const);
    let branchNameFiber: Fiber.Fiber<
      Option.Option<{ readonly branch: string; readonly exactName: boolean }>
    > | null = null;
    let createdWorktreePath: string | null = null;
    let setupTerminalId: string | null = null;
    let workspaceRecorded = false;
    if (input.workspaceStrategy.type === "worktree") {
      yield* setupTracker.begin({
        threadId,
        branch: input.workspaceStrategy.branch ?? null,
        baseRef: input.workspaceStrategy.baseRef,
        stages: ["fetch", "checkout", ...contextStage, "setup-script", ...agentStage],
        fiber: yield* Effect.fiber,
      });
    } else if (reused !== undefined) {
      yield* setupTracker.begin({
        threadId,
        branch: input.workspaceStrategy.branch ?? null,
        baseRef: reused.baseRef,
        stages: [...contextStage, "setup-script", ...agentStage],
        fiber: yield* Effect.fiber,
      });
    }
    yield* Effect.gen(function* () {
      const initialMessage = input.initialMessage;
      // The server owns worktree naming: without an explicit branch, provision
      // under a temporary `t3/<hash>` name so the worktree never waits on
      // name generation, then rename in the background below.
      const requestedBranch = input.workspaceStrategy.branch;
      let branch: string | null;
      if (input.workspaceStrategy.type === "worktree" && requestedBranch === undefined) {
        const uuid = yield* randomUuidV4;
        branch = buildTemporaryWorktreeBranchName(() => uuid.replaceAll("-", ""));
      } else {
        branch = requestedBranch ?? null;
      }
      let worktreePath =
        input.workspaceStrategy.type === "existing_worktree"
          ? input.workspaceStrategy.worktreePath
          : null;

      // Name a temporary branch from the message while the fetch and checkout
      // run, so the setup script and agent start on the final branch instead
      // of watching the temporary one get renamed under them. A retry's
      // reused worktree keeps whatever its first attempt recorded.
      if (
        reused === undefined &&
        initialMessage !== undefined &&
        branch !== null &&
        isTemporaryWorktreeBranch(branch) &&
        input.workspaceStrategy.type !== "root"
      ) {
        branchNameFiber = yield* generateBranchNameFor(
          input.projectId,
          worktreePath ?? project.workspaceRoot,
          initialMessage,
        ).pipe(
          Effect.map(Option.some),
          Effect.catchCause((cause) =>
            Effect.logWarning("Thread worktree branch name generation failed", {
              commandId: input.commandId,
              threadId,
              cause,
            }).pipe(Effect.as(Option.none())),
          ),
          Effect.forkIn(preparationScope),
        );
      }
      if (input.workspaceStrategy.type === "worktree") {
        if (runId !== null) {
          yield* threads
            .dispatch({
              type: "prepared-run.progress",
              commandId: CommandId.make(`${input.commandId}:progress:worktree`),
              threadId,
              runId,
              phase: "worktree",
            })
            .pipe(Effect.mapError(mapError(input, "update-thread", threadId)));
        }
        let startRef = input.workspaceStrategy.baseRef;
        // "Start from origin" is a stored default; repos without the requested
        // remote branch fall back to the local base branch.
        const startFromOrigin =
          input.workspaceStrategy.startFromOrigin === true &&
          (yield* git
            .remoteExists({ cwd: project.workspaceRoot, remoteName: "origin" })
            .pipe(Effect.mapError(mapError(input, "provision-worktree", threadId))));
        yield* setupTracker.stageStatus(threadId, "fetch", startFromOrigin ? "running" : "skipped");
        if (startFromOrigin) {
          yield* git
            .fetchRemote({
              cwd: project.workspaceRoot,
              remoteName: "origin",
              refName: input.workspaceStrategy.baseRef,
            })
            .pipe(Effect.mapError(mapError(input, "provision-worktree", threadId)));
          const remoteBaseExists = yield* git
            .remoteBranchExists({
              cwd: project.workspaceRoot,
              refName: input.workspaceStrategy.baseRef,
              remoteName: "origin",
            })
            .pipe(Effect.mapError(mapError(input, "provision-worktree", threadId)));
          if (remoteBaseExists) {
            startRef = yield* git
              .resolveRemoteTrackingCommit({
                cwd: project.workspaceRoot,
                refName: input.workspaceStrategy.baseRef,
                fallbackRemoteName: "origin",
              })
              .pipe(
                Effect.map((resolved) => resolved.commitSha),
                Effect.mapError(mapError(input, "provision-worktree", threadId)),
              );
          }
        }
        if (startFromOrigin) yield* setupTracker.stageStatus(threadId, "fetch", "done");
        if (
          branch !== null &&
          isTemporaryWorktreeBranch(branch) &&
          (yield* git
            .hasCommit({
              cwd: project.workspaceRoot,
              refName: `refs/heads/${WORKTREE_BRANCH_PREFIX}`,
            })
            .pipe(Effect.mapError(mapError(input, "provision-worktree", threadId))))
        ) {
          branch = flattenTemporaryWorktreeBranchName(branch);
        }
        yield* setupTracker.stageStatus(threadId, "checkout", "running");
        const worktree = yield* git
          .createWorktree(
            {
              cwd: project.workspaceRoot,
              refName: startRef,
              newRefName: branch!,
              baseRefName: input.workspaceStrategy.baseRef,
              path: null,
            },
            {
              progress: {
                onWorktreeClaimed: (path) =>
                  Effect.sync(() => {
                    createdWorktreePath = path;
                  }),
                onCheckoutProgress: (progress) =>
                  setupTracker.stage(threadId, "checkout", { percent: progress.percent }),
              },
            },
          )
          .pipe(Effect.mapError(mapError(input, "provision-worktree", threadId)));
        worktreePath = worktree.worktree.path;
        branch = worktree.worktree.refName;
        createdWorktreePath = worktreePath;
        yield* setupTracker.update(threadId, (snapshot) => ({ ...snapshot, worktreePath, branch }));
        yield* setupTracker.stageStatus(threadId, "checkout", "done");
      }

      // A name that arrives within the wait is applied before anything runs in
      // the worktree; a slower one is applied in the background below.
      let lateBranchName: typeof branchNameFiber = null;
      if (branchNameFiber !== null && worktreePath !== null && branch !== null) {
        const named = yield* Fiber.join(branchNameFiber).pipe(
          Effect.timeoutOption(BRANCH_NAME_WAIT),
        );
        if (Option.isNone(named)) {
          lateBranchName = branchNameFiber;
        } else if (Option.isSome(named.value)) {
          const generated = named.value.value;
          const temporaryBranch = branch;
          const renameCwd = worktreePath;
          branch = yield* git
            .renameBranch({
              cwd: renameCwd,
              oldBranch: temporaryBranch,
              newBranch: generated.branch,
              ...(generated.exactName ? { exactName: true } : {}),
            })
            .pipe(
              Effect.map((renamed) => renamed.branch),
              Effect.catchCause((cause) =>
                Effect.logWarning("Thread worktree branch rename failed", {
                  commandId: input.commandId,
                  threadId,
                  oldBranch: temporaryBranch,
                  cause,
                }).pipe(Effect.as(temporaryBranch)),
              ),
            );
          const namedBranch = branch;
          yield* setupTracker.update(threadId, (snapshot) => ({
            ...snapshot,
            branch: namedBranch,
          }));
        }
      }

      // A reused worktree is already recorded, and rewriting it could undo
      // the first attempt's branch rename.
      if (reused === undefined) {
        yield* threads
          .dispatch({
            type: "thread.metadata.update",
            commandId: CommandId.make(`${input.commandId}:workspace`),
            threadId,
            branch,
            worktreePath,
          })
          .pipe(Effect.mapError(mapError(input, "update-thread", threadId)));
      }
      workspaceRecorded = true;

      // Naming outlasted the wait: the temporary name stands until the
      // generated one arrives, then the branch is renamed in the background.
      // The temporary name simply sticks if generation or the rename fails.
      if (lateBranchName !== null && worktreePath !== null && branch !== null) {
        yield* renameTemporaryBranch({
          commandId: input.commandId,
          threadId,
          worktreePath,
          oldBranch: branch,
          generated: Fiber.join(lateBranchName).pipe(
            Effect.flatMap(
              Option.match({
                onNone: () => Effect.fail(new Cause.NoSuchElementError()),
                onSome: Effect.succeed,
              }),
            ),
          ),
        }).pipe(Effect.forkIn(preparationScope));
      }

      const cwd = worktreePath ?? project.workspaceRoot;
      // Attached repositories go in before the setup script, so the script
      // (and then the agent) can rely on them being there. Their outcomes
      // reach the committed message when the run is released.
      const initialContext = initialMessage?.context;
      const releaseContext =
        repositoryRecords.length > 0 && initialContext !== undefined
          ? yield* ensureContextRepositories({ threadId, cwd, context: initialContext })
          : undefined;
      if (runId !== null) {
        yield* threads
          .dispatch({
            type: "prepared-run.progress",
            commandId: CommandId.make(`${input.commandId}:progress:setup`),
            threadId,
            runId,
            phase: "setup",
          })
          .pipe(Effect.mapError(mapError(input, "update-thread", threadId)));
      }
      yield* setupTracker.stageStatus(threadId, "setup-script", "running");
      const setup = yield* setupScripts
        .runForThread({
          threadId,
          projectId: input.projectId,
          projectCwd: project.workspaceRoot,
          worktreePath: cwd,
          ...(tracked
            ? {
                observeCompletion: {
                  onOutputLine: (line: string) =>
                    setupTracker.appendTail(threadId, "setup-script", line),
                },
              }
            : {}),
          project: {
            id: project.id,
            workspaceRoot: project.workspaceRoot,
            scripts: project.scripts,
          },
        })
        .pipe(Effect.mapError(mapError(input, "run-setup-script", threadId)));

      let awaitAsyncSetup = Effect.void;
      if (setup.status === "started") {
        setupTerminalId = setup.terminalId;
        yield* setupTracker.update(threadId, (snapshot) => ({
          ...snapshot,
          setupScript: {
            name: setup.scriptName,
            command: setup.scriptCommand,
            terminalId: setup.terminalId,
          },
        }));
        if (setup.completion) {
          const awaitCompletion = Effect.gen(function* () {
            const completion = yield* setup.completion!;
            yield* setupTracker.stage(threadId, "setup-script", {
              status: completion.exitCode === 0 ? "done" : "failed",
              detail: `exited with ${completion.exitCode ?? "no exit code"}`,
            });
            if (completion.exitCode !== 0 && !setup.async)
              return yield* mapError(
                input,
                "run-setup-script",
                threadId,
              )(`Setup script exited with ${completion.exitCode ?? "no exit code"}.`);
          });
          if (setup.async && messageLess) {
            // No agent runs beside an async script (often a dev server that
            // never exits), so starting it is where a message-less setup ends.
            yield* setupTracker.stage(threadId, "setup-script", {
              status: "done",
              detail: "running in its terminal",
            });
          } else if (setup.async) {
            awaitAsyncSetup = awaitCompletion.pipe(
              Effect.catchCause((cause) =>
                setupTracker.stage(threadId, "setup-script", {
                  status: "failed",
                  detail: failureDetail(Cause.squash(cause)),
                }),
              ),
            );
          } else {
            yield* awaitCompletion;
          }
        } else {
          yield* setupTracker.stageStatus(threadId, "setup-script", "done");
        }
      } else {
        yield* setupTracker.stageStatus(threadId, "setup-script", "skipped");
      }
      yield* setupTracker.markUncancellable(threadId);
      yield* setupTracker.stageStatus(threadId, "agent", "running");
      if (runId !== null) {
        yield* threads
          .dispatch({
            type: "prepared-run.release",
            commandId: CommandId.make(`${input.commandId}:release`),
            threadId,
            runId,
            ...(releaseContext === undefined ? {} : { context: releaseContext }),
          })
          .pipe(Effect.mapError(mapError(input, "release-run", threadId)));
      }
      yield* setupTracker.stageStatus(threadId, "agent", "done");
      yield* awaitAsyncSetup;
      yield* setupTracker.finish(threadId, "done");
    }).pipe(
      Effect.onError((cause) =>
        Effect.gen(function* () {
          // A recorded worktree outlives a failed setup, so its pending rename still lands.
          if (branchNameFiber !== null && !workspaceRecorded) {
            yield* Fiber.interrupt(branchNameFiber);
          }
          const cancelled = Cause.hasInterruptsOnly(cause);
          yield* setupTracker.finish(
            threadId,
            cancelled ? "cancelled" : "failed",
            cancelled ? null : failureDetail(Cause.squash(cause)),
          );
          // A cancelled setup leaves nothing behind. A failed one keeps a worktree
          // the thread recorded, so a retry reuses it, and removes one it never
          // recorded, which a retry would otherwise duplicate.
          if (tracked && createdWorktreePath && (cancelled || !workspaceRecorded)) {
            if (setupTerminalId)
              yield* terminals
                .close({ threadId, terminalId: setupTerminalId, deleteHistory: true })
                .pipe(Effect.ignore);
            const removedPath = createdWorktreePath;
            // The thread forgets the worktree only once it is gone; a failed
            // removal leaves the directory for the user to clean up rather than
            // reusing a checkout that may be half written.
            yield* git
              .removeWorktree({ cwd: project.workspaceRoot, path: removedPath, force: true })
              .pipe(
                Effect.andThen(
                  threads
                    .dispatch({
                      type: "thread.metadata.update",
                      commandId: CommandId.make(`${input.commandId}:cancel-workspace`),
                      threadId,
                      worktreePath: null,
                      branch: null,
                    })
                    .pipe(Effect.ignore),
                ),
                Effect.catchCause((removeCause) =>
                  Effect.logWarning("Failed to remove an abandoned thread worktree", {
                    commandId: input.commandId,
                    threadId,
                    path: removedPath,
                    cause: removeCause,
                  }),
                ),
              );
          }
        }),
      ),
    );
  });

  const failPreparedRun = (
    input: Pick<PreparationInput, "commandId">,
    threadId: ThreadId,
    runId: RunId | null,
    cause: unknown,
  ) =>
    runId === null
      ? Effect.logWarning("Thread workspace preparation failed", {
          commandId: input.commandId,
          threadId,
          cause,
        })
      : threads
          .dispatch({
            type: "prepared-run.fail",
            commandId: CommandId.make(`${input.commandId}:fail`),
            threadId,
            runId,
            failure: makeProviderFailure({
              cause,
              message: failureDetail(cause),
              class: "validation_error",
              retryable: false,
            }),
          })
          .pipe(
            Effect.catchCause((persistCause) =>
              Effect.logWarning("Failed to persist thread workspace preparation failure", {
                commandId: input.commandId,
                threadId,
                cause,
                persistCause,
              }),
            ),
          );

  const reservePreparation = (commandId: CommandId) =>
    Ref.modify(scheduledLaunches, (scheduled) => {
      if (scheduled.has(commandId)) return [false, scheduled] as const;
      const next = new Set(scheduled);
      next.add(commandId);
      return [true, next] as const;
    });

  const releasePreparation = (commandId: CommandId) =>
    Ref.update(scheduledLaunches, (scheduled) => {
      const next = new Set(scheduled);
      next.delete(commandId);
      return next;
    });

  const schedulePreparation = Effect.fn("ThreadLaunchService.schedulePreparation")(function* (
    input: PreparationInput,
    threadId: ThreadId,
    runId: RunId | null,
  ) {
    const preparing = runId === null ? yield* Deferred.make<void>() : null;
    if (preparing !== null) {
      yield* Ref.update(messageLessPreparations, (current) =>
        new Map(current).set(threadId, preparing),
      );
    }
    const settleMessageLess =
      preparing === null
        ? Effect.void
        : Ref.update(messageLessPreparations, (current) => {
            if (current.get(threadId) !== preparing) return current;
            const next = new Map(current);
            next.delete(threadId);
            return next;
          }).pipe(Effect.andThen(Deferred.succeed(preparing, undefined)));
    yield* prepareInBackground(input, threadId, runId).pipe(
      Effect.onError((cause) =>
        failPreparedRun(
          input,
          threadId,
          runId,
          Cause.hasInterruptsOnly(cause) ? "Worktree setup cancelled." : Cause.squash(cause),
        ),
      ),
      Effect.ignoreCause,
      Effect.ensuring(releasePreparation(input.commandId)),
      Effect.ensuring(settleMessageLess),
      Effect.forkIn(preparationScope),
    );
  });

  const launch: ThreadLaunchService["Service"]["launch"] = Effect.fn("ThreadLaunchService.launch")(
    function* (input) {
      yield* ProjectCloneTracker.rejectCommandsDuringClone(cloneTracker, {
        type: "thread.create",
        projectId: input.projectId,
      }).pipe(Effect.mapError(mapError(input, "resolve-project")));
      const project = yield* projects.getById(input.projectId).pipe(
        Effect.mapError(mapError(input, "resolve-project")),
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.fail(mapError(input, "resolve-project")("Project not found.")),
            onSome: Effect.succeed,
          }),
        ),
      );
      if (input.reuseExistingThread === true && input.threadId === undefined) {
        return yield* mapError(
          input,
          "update-thread",
        )("Reusing an existing thread requires a thread id.");
      }

      const launchReceipt = yield* readReceipt(input, input.commandId);
      return yield* Effect.gen(function* () {
        // A retried launch has no client-supplied id to replay against, so
        // recover the thread id its accepted create was recorded under before
        // allocating another one; a fresh id would only collide with the
        // recorded receipt.
        const reusableLaunchReceipt =
          input.threadId === undefined &&
          Option.isSome(launchReceipt) &&
          launchReceipt.value.status === "accepted" &&
          launchReceipt.value.commandType === "thread.create"
            ? launchReceipt.value
            : undefined;
        const candidateThreadId =
          input.threadId ??
          reusableLaunchReceipt?.threadId ??
          (yield* ids.allocate
            .thread({ projectId: input.projectId })
            .pipe(Effect.mapError(mapError(input, "create-thread"))));

        if (reusableLaunchReceipt !== undefined) {
          const shell = yield* threads
            .getThreadShell(candidateThreadId)
            .pipe(Effect.mapError(mapError(input, "create-thread", candidateThreadId)));
          if (shell === null) {
            return yield* mapError(input, "create-thread", candidateThreadId)("Thread not found.");
          }
          if (shell.projectId !== input.projectId) {
            return yield* mapError(
              input,
              "resolve-project",
              candidateThreadId,
            )("Project identity changed.");
          }
        }

        if (input.reuseExistingThread === true && Option.isNone(launchReceipt)) {
          yield* validateReusableThread(input, candidateThreadId);
        }

        // A Scratch thread launched at the project root runs in a folder of its
        // own. Only the first attempt claims one; a retry replays its create.
        const workspaceStrategy: ThreadLaunchWorkspaceStrategy =
          input.workspaceStrategy.type === "root" && Option.isNone(launchReceipt)
            ? Option.match(
                yield* managedFolders
                  .folderForThread({
                    projectId: input.projectId,
                    threadId: candidateThreadId,
                    text: input.initialMessage?.text ?? input.title,
                  })
                  .pipe(Effect.mapError(mapError(input, "provision-worktree", candidateThreadId))),
                {
                  onNone: () => input.workspaceStrategy,
                  onSome: (worktreePath) => ({ type: "existing_worktree", worktreePath }),
                },
              )
            : input.workspaceStrategy;
        const initialBranch = workspaceStrategy.branch ?? null;
        const initialWorktreePath =
          workspaceStrategy.type === "existing_worktree" ? workspaceStrategy.worktreePath : null;
        const claimDispatch =
          input.reuseExistingThread === true
            ? threads.dispatch({
                type: "thread.metadata.update",
                commandId: input.commandId,
                threadId: candidateThreadId,
                expectedEmpty: true,
              })
            : threads.dispatch({
                type: "thread.create",
                commandId: input.commandId,
                threadId: candidateThreadId,
                projectId: input.projectId,
                title: input.title,
                modelSelection: input.modelSelection,
                runtimeMode: input.runtimeMode,
                interactionMode: input.interactionMode,
                branch: initialBranch,
                worktreePath: initialWorktreePath,
                ...(input.importedNativeThread === undefined
                  ? {}
                  : { importedNativeThread: input.importedNativeThread }),
                createdBy: input.createdBy,
                creationSource: input.creationSource,
                ...(input.startedBy === undefined ? {} : { startedBy: input.startedBy }),
              });
        const claimed = yield* claimDispatch.pipe(
          Effect.mapError(
            mapError(
              input,
              input.reuseExistingThread === true ? "update-thread" : "create-thread",
              candidateThreadId,
            ),
          ),
        );
        const threadId =
          claimed.storedEvents.find((stored) => stored.event.type.startsWith("thread."))?.event
            .threadId ?? candidateThreadId;
        if (project.id !== input.projectId) {
          return yield* mapError(input, "resolve-project", threadId)("Project identity changed.");
        }

        let runId: RunId | null = null;
        let messageWasAlreadyAccepted = false;
        if (input.initialMessage !== undefined) {
          const messageCommandId = CommandId.make(`${input.commandId}:initial-message`);
          const messageReceipt = yield* readReceipt(input, messageCommandId);
          messageWasAlreadyAccepted = Option.isSome(messageReceipt);
          const messageId =
            input.initialMessage.messageId ??
            (yield* ids.allocate
              .message({ threadId, ordinal: 1 })
              .pipe(Effect.mapError(mapError(input, "dispatch-message", threadId))));
          const dispatched = yield* threads
            .dispatch({
              type: "message.dispatch",
              commandId: messageCommandId,
              threadId,
              messageId,
              text: input.initialMessage.text,
              ...(input.initialMessage.scheduledTaskId === undefined
                ? {}
                : { scheduledTaskId: input.initialMessage.scheduledTaskId }),
              ...(input.initialMessage.senderThreadId === undefined
                ? {}
                : { senderThreadId: input.initialMessage.senderThreadId }),
              attachments: input.initialMessage.attachments,
              ...(input.initialMessage.context ? { context: input.initialMessage.context } : {}),
              ...(input.generateTitle === true ? { titleSeed: input.title } : {}),
              modelSelection: input.modelSelection,
              dispatchMode: { type: "defer_start", workspaceStrategy },
              createdBy: input.createdBy,
              creationSource: input.creationSource,
            })
            .pipe(Effect.mapError(mapError(input, "dispatch-message", threadId)));
          const runCreated = dispatched.storedEvents.find(
            (stored) => stored.event.type === "run.created",
          );
          runId = runCreated?.event.type === "run.created" ? runCreated.event.payload.id : null;
          if (runId === null) {
            return yield* mapError(
              input,
              "dispatch-message",
              threadId,
            )("Initial message was accepted without a durable run.");
          }
        }

        const projection = yield* threads
          .getThreadProjection(threadId)
          .pipe(Effect.mapError(mapError(input, "create-thread", threadId)));
        const runIsPreparing =
          runId !== null &&
          projection.runs.some((run) => run.id === runId && run.status === "preparing");
        const shouldSchedule = runId === null ? Option.isNone(launchReceipt) : runIsPreparing;
        // A retried root launch prepares the folder its first attempt bound, so
        // a Scratch thread keeps its own. Other root launches bind no folder.
        const boundWorktreePath = projection.thread.worktreePath;
        const preparationStrategy: ThreadLaunchWorkspaceStrategy =
          Option.isSome(launchReceipt) &&
          workspaceStrategy.type === "root" &&
          boundWorktreePath !== null
            ? {
                type: "existing_worktree",
                worktreePath: boundWorktreePath,
                branch: workspaceStrategy.branch,
              }
            : workspaceStrategy;
        if (shouldSchedule) {
          const ownsPreparation = yield* reservePreparation(input.commandId);
          if (ownsPreparation) {
            yield* Effect.gen(function* () {
              const preparationStillRequired =
                runId === null
                  ? true
                  : yield* threads.getThreadRecords(threadId, ["runs"], { runIds: [runId] }).pipe(
                      Effect.map((current) =>
                        current.runs.some((run) => run.id === runId && run.status === "preparing"),
                      ),
                      Effect.mapError(mapError(input, "update-thread", threadId)),
                    );
              if (preparationStillRequired) {
                yield* schedulePreparation(
                  { ...input, workspaceStrategy: preparationStrategy },
                  threadId,
                  runId,
                );
              } else {
                yield* releasePreparation(input.commandId);
              }
            }).pipe(Effect.onError(() => releasePreparation(input.commandId)));
          }
        }

        return {
          threadId,
          projection,
          resumed: Option.isSome(launchReceipt) || messageWasAlreadyAccepted,
        };
      });
    },
  );

  const retryPreparation: ThreadLaunchService["Service"]["retryPreparation"] = Effect.fn(
    "ThreadLaunchService.retryPreparation",
  )(function* (input) {
    const dispatched = yield* threads.dispatch({
      type: "prepared-run.retry",
      commandId: input.commandId,
      threadId: input.threadId,
      runId: input.runId,
    });
    yield* prepareRecordedRun(input);
    return dispatched;
  });

  const prepareRecordedRun = (input: ThreadLaunchRetryInput) =>
    Effect.gen(function* () {
      // A replay finds the run already past preparation, or prepared by the
      // attempt that first reserved this command.
      // While the run is preparing, anything that stops preparation from being
      // scheduled must fail it, or it would wait in preparing forever.
      const scheduled = yield* Effect.gen(function* () {
        const projection = yield* threads.getThreadProjection(input.threadId);
        const run = projection.runs.find((candidate) => candidate.id === input.runId);
        const workspacePreparation = run?.workspacePreparation;
        if (run?.status !== "preparing" || workspacePreparation === undefined) return;
        if (!(yield* reservePreparation(input.commandId))) return;
        yield* scheduleRecordedPreparation(input, projection, run, workspacePreparation).pipe(
          Effect.onError(() => releasePreparation(input.commandId)),
        );
      }).pipe(Effect.exit);
      if (Exit.isFailure(scheduled)) {
        yield* failPreparedRun(input, input.threadId, input.runId, Cause.squash(scheduled.cause));
      }
    });

  const scheduleRecordedPreparation = (
    input: ThreadLaunchRetryInput,
    projection: OrchestrationV2ThreadProjection,
    run: OrchestrationV2ThreadProjection["runs"][number],
    workspacePreparation: ThreadLaunchWorkspaceStrategy,
  ) => {
    const message = projection.messages.find((candidate) => candidate.id === run.userMessageId);
    // A worktree the failed attempt already created is reused, not created again.
    const reuse =
      workspacePreparation.type === "worktree" &&
      projection.thread.worktreePath !== null &&
      projection.thread.branch !== null
        ? {
            strategy: {
              type: "existing_worktree" as const,
              worktreePath: projection.thread.worktreePath,
              branch: projection.thread.branch,
            },
            reusedWorktree: { baseRef: workspacePreparation.baseRef },
          }
        : null;
    return schedulePreparation(
      {
        commandId: input.commandId,
        projectId: projection.thread.projectId,
        workspaceStrategy: reuse?.strategy ?? workspacePreparation,
        ...(reuse === null ? {} : { reusedWorktree: reuse.reusedWorktree }),
        ...(message === undefined
          ? {}
          : {
              initialMessage: {
                text: message.text,
                attachments: message.attachments,
                ...(message.context ? { context: message.context } : {}),
              },
            }),
      },
      input.threadId,
      run.id,
    );
  };

  const prepareMessageWorkspace: ThreadLaunchService["Service"]["prepareMessageWorkspace"] = (
    input,
  ) =>
    Effect.gen(function* () {
      const pending = (yield* Ref.get(messageLessPreparations)).get(input.threadId);
      if (pending !== undefined) yield* Deferred.await(pending);
      const context = input.context;
      if (context === undefined || messageRepositoryRecords(context).length === 0) return context;
      const shell = yield* threads.getThreadShell(input.threadId);
      if (shell === null) return context;
      const cwd =
        shell.worktreePath ??
        Option.getOrNull(
          Option.map(yield* projects.getById(shell.projectId), (project) => project.workspaceRoot),
        );
      if (cwd === null) return context;
      // With no worktree setup under way, the clone gets a setup card of its own.
      const running = yield* setupTracker.get(input.threadId);
      const ownsCard = running === null || running.phase !== "running";
      if (ownsCard) {
        yield* setupTracker.begin({
          threadId: input.threadId,
          branch: shell.branch,
          baseRef: null,
          stages: ["context-repositories"],
          fiber: null,
        });
      }
      return yield* ensureContextRepositories({
        threadId: input.threadId,
        cwd,
        context,
      }).pipe(
        Effect.ensuring(ownsCard ? setupTracker.finish(input.threadId, "done") : Effect.void),
      );
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Failed to prepare context repositories for a message", {
          threadId: input.threadId,
          cause,
        }).pipe(Effect.as(input.context)),
      ),
    );

  const nameTemporaryBranch: ThreadLaunchService["Service"]["nameTemporaryBranch"] = (input) =>
    Effect.gen(function* () {
      const shell = yield* threads.getThreadShell(input.threadId);
      if (
        shell === null ||
        shell.worktreePath === null ||
        shell.branch === null ||
        !isTemporaryWorktreeBranch(shell.branch) ||
        (yield* threads.getMessageCount(input.threadId)) !== 1
      ) {
        return;
      }
      yield* renameTemporaryBranch({
        commandId: input.commandId,
        threadId: input.threadId,
        worktreePath: shell.worktreePath,
        oldBranch: shell.branch,
        generated: generateBranchNameFor(shell.projectId, shell.worktreePath, input.message),
      }).pipe(Effect.forkIn(preparationScope));
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Failed to schedule a thread worktree branch rename", {
          commandId: input.commandId,
          threadId: input.threadId,
          cause,
        }),
      ),
    );

  return ThreadLaunchService.of({
    launch,
    retryPreparation,
    prepareDeferredRun: prepareRecordedRun,
    prepareMessageWorkspace,
    nameTemporaryBranch,
  });
});

export const layer = Layer.effect(ThreadLaunchService, make);
