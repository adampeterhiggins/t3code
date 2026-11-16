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
  type OrchestrationV2ThreadLaunchPullRequestWorkspaceStrategy,
  type OrchestrationV2DelegatedFrom,
  type OrchestrationV2LinkOrigin,
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
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import {
  buildTemporaryWorktreeBranchName,
  flattenTemporaryWorktreeBranchName,
  formatGeneratedBranchName,
  isTemporaryWorktreeBranch,
} from "@t3tools/shared/git";

import * as ContextRepositories from "../contextRepositories/ContextRepositories.ts";
import {
  ensureMessageContextRepositories,
  messageRepositoryRecords,
} from "../contextRepositories/messageContextRepositories.ts";
import * as GitWorkflow from "../git/GitWorkflowService.ts";
import { parseGitCloneProgressLine } from "../project/gitCloneProgress.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProjectSetupScriptRunner from "../project/ProjectSetupScriptRunner.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as CommandReceiptStore from "./CommandReceiptStore.ts";
import * as EventSink from "./EventSink.ts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import type * as Orchestrator from "./Orchestrator.ts";
import { makeProviderFailure } from "@t3tools/provider-core/server/failure";
import { randomUuidV4 } from "@t3tools/provider-core/server/randomUuid";
import { DispatchModeLimit } from "./DispatchModeLimit.ts";
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

/** Resolved by `launch` into the checkout the pull request lands on. */
export type ThreadLaunchPullRequestWorkspaceStrategy =
  OrchestrationV2ThreadLaunchPullRequestWorkspaceStrategy;

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
  readonly workspaceStrategy:
    | ThreadLaunchWorkspaceStrategy
    | ThreadLaunchPullRequestWorkspaceStrategy;
  readonly groupName?: string;
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
  /** The linked environment this launch is for, if one asked for it. */
  readonly linkOrigin?: OrchestrationV2LinkOrigin;
  /** The parent there, when that environment's agent delegated this as a task. */
  readonly delegatedFrom?: OrchestrationV2DelegatedFrom;
}

/** What workspace preparation reads from a launch; a retry rebuilds it from the run. */
type PreparationInput = Pick<ThreadLaunchInput, "commandId" | "projectId" | "initialMessage"> & {
  readonly workspaceStrategy: ThreadLaunchWorkspaceStrategy;
  /**
   * Set when a retry reuses the worktree its failed attempt created and
   * recorded. Its setup is tracked like a new one, but the thread already
   * records the workspace, and a branch rename may still be running.
   */
  readonly reusedWorktree?: { readonly baseRef: string };
};

export interface ThreadLaunchPreparationInput {
  readonly commandId: CommandId;
  readonly threadId: ThreadId;
  readonly runId: RunId;
}

export interface ThreadLaunchResult {
  readonly threadId: ThreadId;
  readonly projection: OrchestrationV2ThreadProjection;
  /** The launch's last write (the initial message, else the thread claim) was accepted before this call. */
  readonly resumed: boolean;
  readonly sequence?: number;
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

export class ThreadLaunchBaseRefError extends Schema.TaggedError<ThreadLaunchBaseRefError>()(
  "ThreadLaunchBaseRefError",
  {
    projectId: ProjectId,
    projectTitle: Schema.String,
    workspaceRoot: Schema.String,
    baseRef: Schema.String,
  },
) {
  override get message(): string {
    return `Base ref "${this.baseRef}" does not resolve to a commit in project "${this.projectTitle}" (${this.workspaceRoot}).`;
  }
}

/** A new worktree was asked to create a branch the repository already has. */
export class ThreadLaunchBranchExistsError extends Schema.TaggedError<ThreadLaunchBranchExistsError>()(
  "ThreadLaunchBranchExistsError",
  {
    projectId: ProjectId,
    projectTitle: Schema.String,
    branch: Schema.String,
    /** The worktree the branch is checked out in, when it is. */
    worktreePath: Schema.NullOr(Schema.String),
  },
) {
  override get message(): string {
    return this.worktreePath === null
      ? `Branch "${this.branch}" already exists in project "${this.projectTitle}".`
      : `Branch "${this.branch}" already exists in project "${this.projectTitle}" and is checked out at ${this.worktreePath}.`;
  }
}

/** A pull request launch could not check the pull request out; no thread was created. */
export class ThreadLaunchPullRequestError extends Schema.TaggedError<ThreadLaunchPullRequestError>()(
  "ThreadLaunchPullRequestError",
  {
    projectId: ProjectId,
    reference: Schema.String,
    detail: Schema.String,
  },
) {
  override get message(): string {
    return `Could not start from pull request "${this.reference}": ${this.detail}`;
  }
}

export class ThreadLaunchBranchConflictError extends Schema.TaggedError<ThreadLaunchBranchConflictError>()(
  "ThreadLaunchBranchConflictError",
  {
    projectId: ProjectId,
    projectTitle: Schema.String,
    branch: Schema.String,
    conflictingBranch: Schema.String,
  },
) {
  override get message(): string {
    return `Branch "${this.branch}" cannot be created in project "${this.projectTitle}": branch "${this.conflictingBranch}" exists.`;
  }
}

export class ThreadLaunchNotRepositoryError extends Schema.TaggedError<ThreadLaunchNotRepositoryError>()(
  "ThreadLaunchNotRepositoryError",
  {
    projectId: ProjectId,
    projectTitle: Schema.String,
    workspaceRoot: Schema.String,
  },
) {
  override get message(): string {
    return `Project "${this.projectTitle}" (${this.workspaceRoot}) is not a Git repository.`;
  }
}

export class ThreadLaunchService extends Context.Service<
  ThreadLaunchService,
  {
    readonly launch: (
      input: ThreadLaunchInput,
    ) => Effect.Effect<
      ThreadLaunchResult,
      | ThreadLaunchError
      | ThreadLaunchPullRequestError
      | ThreadManagement.ThreadManagementProviderInstanceDisabledError
    >;
    /** Check a new worktree's base ref and branch name before creation for early errors; launch otherwise accepts and reports these failures inside the thread. */
    readonly checkNewWorktree: (
      input: Pick<ThreadLaunchInput, "projectId" | "workspaceStrategy"> & {
        /** Skips the check when this launch was already accepted, so its retry replays. */
        readonly commandId?: CommandId;
      },
    ) => Effect.Effect<
      void,
      | ThreadLaunchBaseRefError
      | ThreadLaunchBranchExistsError
      | ThreadLaunchBranchConflictError
      | ThreadLaunchNotRepositoryError
    >;
    readonly retryPreparation: (
      input: ThreadLaunchPreparationInput,
    ) => Effect.Effect<
      Orchestrator.OrchestratorV2DispatchResult,
      | Orchestrator.OrchestratorV2Error
      | ThreadManagement.ThreadManagementProviderInstanceDisabledError
    >;
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
    readonly prepareRun: (input: ThreadLaunchPreparationInput) => Effect.Effect<void>;
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
  const eventSink = yield* EventSink.EventSinkV2;
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
  // A project-folder launch that names no branch records the folder's checkout, as the composer does.
  const launchBranch = (strategy: ThreadLaunchWorkspaceStrategy, workspaceRoot: string) =>
    strategy.type === "root" && strategy.branch === undefined
      ? git.currentBranch(workspaceRoot).pipe(Effect.orElseSucceed(() => null))
      : Effect.succeed(strategy.branch ?? null);
  const preparationScope = yield* Scope.make("sequential");
  const scheduledLaunches = yield* Ref.make<ReadonlySet<CommandId>>(new Set());
  // Message-less launches still preparing their workspace; a first message waits on them.
  const messageLessPreparations = yield* Ref.make<ReadonlyMap<ThreadId, Deferred.Deferred<void>>>(
    new Map(),
  );
  yield* Effect.addFinalizer(() => Scope.close(preparationScope, Exit.void));

  const mapError =
    (
      input: Pick<ThreadLaunchInput, "commandId" | "projectId">,
      operation: ThreadLaunchError["operation"],
      threadId?: ThreadId,
    ) =>
    (cause: unknown) =>
      new ThreadLaunchError({
        operation,
        commandId: input.commandId,
        projectId: input.projectId,
        ...(threadId === undefined ? {} : { threadId }),
        cause,
      });

  const recordBranchRenameFailure = Effect.fn("ThreadLaunchService.recordBranchRenameFailure")(
    function* (threadId: ThreadId, runId: RunId, branch: string, cause: Cause.Cause<unknown>) {
      const error = Cause.squash(cause);
      const now = yield* DateTime.now;
      yield* eventSink.write({
        events: [
          {
            id: yield* ids.allocate.event({ threadId }),
            type: "turn-item.updated",
            threadId,
            runId,
            occurredAt: now,
            payload: {
              id: ids.derive.runSignalTurnItem({ runId, signal: "branch-rename" }),
              threadId,
              runId,
              nodeId: null,
              providerThreadId: null,
              providerTurnId: null,
              nativeItemRef: null,
              parentItemId: null,
              // EventSink allocates the real position, after the run's existing items.
              ordinal: 0,
              status: "completed",
              title: "Branch not renamed",
              startedAt: now,
              completedAt: now,
              updatedAt: now,
              type: "system_notice",
              message: `Could not rename the worktree branch, so it stays ${branch}. ${error instanceof Error ? error.message : String(error)}`,
            },
          },
        ],
      });
    },
    Effect.catchCause((cause) =>
      Effect.logWarning("Could not record the branch rename failure", { cause }),
    ),
  );

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

  const generateBranchNameFor = Effect.fn("ThreadLaunchService.generateBranchNameFor")(function* (
    projectId: ProjectId,
    cwd: string,
    message: ThreadLaunchInitialMessage,
  ) {
    const settings = resolveProjectSettings(yield* serverSettings.getSettings, projectId).settings;
    const modelSelection =
      settings.sourceControlWriterModelSelection === null
        ? settings.textGenerationModelSelection
        : ServerSettings.resolveSourceControlWriterModelSelection(
            settings,
            yield* providerRegistry.getProviders,
            projectId,
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
        projectId,
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
    readonly onRenamed?: (branch: string) => void;
    readonly runId?: RunId | null;
    readonly generated: Effect.Effect<{ readonly branch: string; readonly exactName: boolean }, E>;
  }) =>
    input.generated.pipe(
      Effect.flatMap(({ branch: newBranch, exactName }) =>
        git
          .renameBranch({
            cwd: input.worktreePath,
            oldBranch: input.oldBranch,
            newBranch,
            ...(exactName ? { exactName: true } : {}),
          })
          .pipe(
            Effect.tap((renamed) => Effect.sync(() => input.onRenamed?.(renamed.branch))),
            Effect.uninterruptible,
          ),
      ),
      Effect.flatMap((renamed) =>
        Effect.gen(function* () {
          yield* threads
            .dispatch({
              type: "thread.metadata.update",
              commandId: CommandId.make(`${input.commandId}:branch-rename`),
              threadId: input.threadId,
              branch: renamed.branch,
              worktreePath: input.worktreePath,
              expectedBranch: input.oldBranch,
              expectedWorktreePath: input.worktreePath,
            })
            .pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning("Parent thread worktree branch update failed", {
                  threadId: input.threadId,
                  cause,
                }),
              ),
            );
          const visited = new Set([input.threadId]);
          while (true) {
            const snapshot = yield* threads.getShellSnapshot({ worktreePath: input.worktreePath });
            const sharing = [...snapshot.threads, ...snapshot.archivedThreads].filter(
              (thread) => !visited.has(thread.id) && thread.branch === input.oldBranch,
            );
            if (sharing.length === 0) break;
            for (const thread of sharing) {
              visited.add(thread.id);
              yield* threads
                .dispatch({
                  type: "thread.metadata.update",
                  commandId: CommandId.make(`${input.commandId}:branch-rename:${thread.id}`),
                  threadId: thread.id,
                  branch: renamed.branch,
                  expectedBranch: input.oldBranch,
                  expectedWorktreePath: input.worktreePath,
                })
                .pipe(
                  Effect.catchCause((cause) =>
                    Effect.logWarning("Shared thread worktree branch update failed", {
                      threadId: thread.id,
                      cause,
                    }),
                  ),
                );
            }
          }
        }),
      ),
      Effect.catchCause((cause) =>
        Effect.logWarning("Thread worktree branch rename failed", {
          commandId: input.commandId,
          threadId: input.threadId,
          oldBranch: input.oldBranch,
          cause,
        }).pipe(
          Effect.andThen(
            input.runId == null || Cause.hasInterruptsOnly(cause)
              ? Effect.void
              : recordBranchRenameFailure(input.threadId, input.runId, input.oldBranch, cause),
          ),
        ),
      ),
    );

  const checkNewWorktree: ThreadLaunchService["Service"]["checkNewWorktree"] = Effect.fn(
    "ThreadLaunchService.checkNewWorktree",
  )(function* (input) {
    const strategy = input.workspaceStrategy;
    if (strategy.type !== "worktree") return;
    const commandId = input.commandId;
    const [isScratch, receipt, projectOption] = yield* Effect.all(
      [
        managedFolders.isScratchProject(input.projectId),
        commandId === undefined
          ? Effect.succeedNone
          : receipts.getByCommandId(commandId).pipe(Effect.orElseSucceed(() => Option.none())),
        projects.getById(input.projectId).pipe(Effect.orElseSucceed(() => Option.none())),
      ],
      { concurrency: "unbounded" },
    );
    // launch() turns a Scratch worktree request into a root launch.
    if (isScratch) return;
    if (Option.isSome(receipt) && receipt.value.status === "accepted") return;
    const project = Option.getOrUndefined(projectOption);
    if (project === undefined) return;
    const cwd = project.workspaceRoot;
    const { baseRef, branch } = strategy;
    const checksBranch = branch !== undefined && !isTemporaryWorktreeBranch(branch);
    // Errors keep their order below: missing repository, then base ref, then branch conflict.
    const [repositoryRoot, hasBaseCommit, localBranches] = yield* Effect.all(
      [
        git.repositoryRoot(cwd).pipe(Effect.orElseSucceed(() => undefined)),
        // `:/text` is a commit search, which cannot be asked for a commit type.
        baseRef.startsWith(":")
          ? Effect.succeed(true)
          : // `git worktree add` reads `-` as the previous checkout.
            git
              .hasCommit({ cwd, refName: baseRef === "-" ? "@{-1}" : baseRef })
              .pipe(Effect.orElseSucceed(() => true)),
        checksBranch
          ? git
              .listLocalBranchNames(cwd)
              .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []))
          : Effect.succeed<ReadonlyArray<string>>([]),
      ],
      { concurrency: "unbounded" },
    );
    if (repositoryRoot === null)
      return yield* new ThreadLaunchNotRepositoryError({
        projectId: project.id,
        projectTitle: project.title,
        workspaceRoot: cwd,
      });
    // `git worktree add -b` refuses a branch that exists. Checking it out
    // instead would quietly ignore baseRef and startFromOrigin, so the caller
    // picks another name or a strategy that binds the existing branch.
    if (branch !== undefined) {
      const existing = yield* Effect.gen(function* () {
        if (!(yield* git.hasCommit({ cwd, refName: `refs/heads/${branch}` }))) return undefined;
        const refs = yield* git.listRefs({ cwd, query: branch, refKind: "local" }).pipe(
          Effect.map((result) => result.refs),
          Effect.orElseSucceed(() => []),
        );
        return {
          worktreePath:
            refs.find((ref) => ref.isRemote !== true && ref.name === branch)?.worktreePath ?? null,
        };
      }).pipe(Effect.orElseSucceed(() => undefined));
      if (existing !== undefined)
        return yield* new ThreadLaunchBranchExistsError({
          projectId: project.id,
          projectTitle: project.title,
          branch,
          worktreePath: existing.worktreePath,
        });
    }
    const baseResolves =
      hasBaseCommit ||
      (yield* Effect.gen(function* () {
        if (strategy.startFromOrigin === true) {
          const remote = yield* git.resolveWorktreeBaseRemote({ cwd, refName: baseRef });
          // The remote may have deleted the branch; ask it rather than trusting the name.
          if (
            remote !== null &&
            (yield* git.fetchWorktreeBaseCommit({ cwd, refName: baseRef, remote })) !== null
          )
            return true;
        }
        // git worktree add accepts remote-tracking branches; let Git decide when any matching ref exists.
        if (yield* git.hasRefNamed({ cwd, refName: baseRef })) return true;
        return !(yield* git.hasCommit({ cwd, refName: "HEAD" }));
      }).pipe(Effect.orElseSucceed(() => true)));
    if (!baseResolves)
      return yield* new ThreadLaunchBaseRefError({
        projectId: project.id,
        projectTitle: project.title,
        workspaceRoot: project.workspaceRoot,
        baseRef,
      });
    // Provisioning flattens temporary names that collide, so only explicit names are refused.
    if (!checksBranch) return;
    const conflictingBranch = localBranches.find(
      (existing) => existing.startsWith(`${branch}/`) || branch.startsWith(`${existing}/`),
    );
    if (conflictingBranch !== undefined)
      return yield* new ThreadLaunchBranchConflictError({
        projectId: project.id,
        projectTitle: project.title,
        branch,
        conflictingBranch,
      });
  });

  /**
   * Checks a pull request out as the composer does and returns the checkout
   * it landed on, so the launch binds it like any existing one.
   */
  const checkOutPullRequest = (
    projectId: ProjectId,
    cwd: string,
    strategy: ThreadLaunchPullRequestWorkspaceStrategy,
  ) =>
    git
      .preparePullRequestThread({
        cwd,
        reference: strategy.reference,
        mode: strategy.mode ?? "worktree",
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new ThreadLaunchPullRequestError({
              projectId,
              reference: strategy.reference,
              detail: cause.message,
            }),
        ),
        Effect.map((prepared): ThreadLaunchWorkspaceStrategy =>
          prepared.worktreePath === null
            ? { type: "root", branch: prepared.branch }
            : {
                type: "existing_worktree",
                worktreePath: prepared.worktreePath,
                branch: prepared.branch,
              },
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
    let createdBranch: string | null = null;
    let setupTerminalId: string | null = null;
    let workspaceRecorded = false;
    let runReleased = false;
    // Stop background renames before forgetting worktrees; completed renames record them again.
    let branchRename: Fiber.Fiber<unknown> | null = null;
    if (input.workspaceStrategy.type === "worktree") {
      yield* setupTracker.begin({
        threadId,
        branch: input.workspaceStrategy.branch ?? null,
        baseRef: input.workspaceStrategy.baseRef,
        stages: ["fetch", "checkout", "submodules", ...contextStage, "setup-script", ...agentStage],
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
      const requestedBranch = input.workspaceStrategy.branch;
      const generatedTemporaryBranch =
        input.workspaceStrategy.type === "worktree" && requestedBranch === undefined;
      let branch: string | null;
      if (generatedTemporaryBranch) {
        const uuid = yield* randomUuidV4;
        branch = buildTemporaryWorktreeBranchName(() => uuid.replaceAll("-", ""));
        const settings = yield* serverSettings.getSettings.pipe(
          Effect.map((settings) => resolveProjectSettings(settings, input.projectId).settings),
          Effect.orElseSucceed(() => null),
        );
        if (settings?.branchNamingMode === "static") {
          branch = formatGeneratedBranchName(branch.slice(-8), {
            mode: "static",
            prefix: settings.branchNamePrefix,
            instructions: "",
          });
        }
      } else {
        branch = yield* launchBranch(input.workspaceStrategy, project.workspaceRoot);
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
        const namingBranch = branch;
        branchNameFiber = yield* generateBranchNameFor(
          input.projectId,
          worktreePath ?? project.workspaceRoot,
          initialMessage,
        ).pipe(
          Effect.asSome,
          Effect.catchCause((cause) =>
            Effect.logWarning("Thread worktree branch name generation failed", {
              commandId: input.commandId,
              threadId,
              cause,
            }).pipe(
              Effect.andThen(
                runId === null || Cause.hasInterruptsOnly(cause)
                  ? Effect.void
                  : recordBranchRenameFailure(threadId, runId, namingBranch, cause),
              ),
              Effect.as(Option.none()),
            ),
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
        let baseRefName = input.workspaceStrategy.baseRef;
        const remote =
          input.workspaceStrategy.startFromOrigin === true
            ? yield* git
                .resolveWorktreeBaseRemote({
                  cwd: project.workspaceRoot,
                  refName: input.workspaceStrategy.baseRef,
                })
                .pipe(Effect.mapError(mapError(input, "provision-worktree", threadId)))
            : null;
        const shouldFetch = remote !== null;
        yield* setupTracker.stageStatus(threadId, "fetch", shouldFetch ? "running" : "skipped");
        if (remote !== null) {
          const remoteBase = yield* git
            .fetchWorktreeBaseCommit({
              cwd: project.workspaceRoot,
              refName: input.workspaceStrategy.baseRef,
              remote,
            })
            .pipe(Effect.mapError(mapError(input, "provision-worktree", threadId)));
          if (remoteBase !== null) {
            startRef = remoteBase.commitSha;
            baseRefName = `refs/remotes/${remoteBase.remoteRefName}`;
          }
        }
        if (shouldFetch) yield* setupTracker.stageStatus(threadId, "fetch", "done");
        if (branch !== null && (generatedTemporaryBranch || isTemporaryWorktreeBranch(branch))) {
          const parts = branch.split("/");
          for (let depth = 1; depth < parts.length; depth++) {
            if (
              yield* git
                .hasCommit({
                  cwd: project.workspaceRoot,
                  refName: `refs/heads/${parts.slice(0, depth).join("/")}`,
                })
                .pipe(Effect.mapError(mapError(input, "provision-worktree", threadId)))
            ) {
              branch = generatedTemporaryBranch
                ? branch.replaceAll("/", "-")
                : flattenTemporaryWorktreeBranchName(branch);
              break;
            }
          }
        }
        yield* setupTracker.stageStatus(threadId, "checkout", "running");
        let submoduleProgressReportedAt = Number.NEGATIVE_INFINITY;
        const worktree = yield* git
          .createWorktree(
            {
              cwd: project.workspaceRoot,
              refName: startRef,
              newRefName: branch!,
              baseRefName,
              path: null,
            },
            {
              progress: {
                onWorktreeClaimed: (path) =>
                  Effect.sync(() => {
                    createdWorktreePath = path;
                    createdBranch = branch;
                  }),
                onCheckoutProgress: (progress) =>
                  setupTracker.stage(threadId, "checkout", { percent: progress.percent }),
                onSubmodulesStarted: () =>
                  setupTracker
                    .stageStatus(threadId, "checkout", "done")
                    .pipe(
                      Effect.andThen(setupTracker.stageStatus(threadId, "submodules", "running")),
                    ),
                onSubmodulesDisabled: ({ source }) =>
                  setupTracker.stageStatus(
                    threadId,
                    "submodules",
                    "skipped",
                    `disabled in ${source}`,
                  ),
                onSubmoduleLine: (line) => {
                  // Paths may contain quotes; git closes the path with "': ".
                  const submodulePath = /^\s*Submodule path '(.+)': /.exec(line)?.[1];
                  if (submodulePath !== undefined) {
                    return setupTracker.stage(threadId, "submodules", { detail: submodulePath });
                  }
                  if (parseGitCloneProgressLine(line) === null) return Effect.void;
                  // Git redraws on every percent; hold the websocket to one update a second.
                  return Effect.flatMap(Clock.currentTimeMillis, (now) => {
                    if (now - submoduleProgressReportedAt < 1000) return Effect.void;
                    submoduleProgressReportedAt = now;
                    return setupTracker.stage(threadId, "submodules", {
                      detail: line.trim().replace(/\s+/g, " "),
                    });
                  });
                },
                onSubmodulesFinished: ({ ok, detail }) =>
                  setupTracker.stageStatus(
                    threadId,
                    "submodules",
                    ok ? "done" : "warning",
                    ok ? undefined : (detail ?? "submodule checkout failed"),
                  ),
              },
            },
          )
          .pipe(Effect.mapError(mapError(input, "provision-worktree", threadId)));
        worktreePath = worktree.worktree.path;
        branch = worktree.worktree.refName;
        createdWorktreePath = worktreePath;
        createdBranch = branch;
        yield* setupTracker.update(threadId, (snapshot) => ({
          ...snapshot,
          worktreePath,
          branch,
          stages: snapshot.stages.map((stage) =>
            stage.id === "submodules" && stage.status === "pending"
              ? { ...stage, status: "skipped", detail: "none" }
              : stage,
          ),
        }));
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
              Effect.tap((renamed) =>
                Effect.sync(() => {
                  createdBranch = renamed.branch;
                }),
              ),
              Effect.uninterruptible,
              Effect.map((renamed) => renamed.branch),
              Effect.catchCause((cause) =>
                Effect.logWarning("Thread worktree branch rename failed", {
                  commandId: input.commandId,
                  threadId,
                  oldBranch: temporaryBranch,
                  cause,
                }).pipe(
                  Effect.andThen(
                    runId === null || Cause.hasInterruptsOnly(cause)
                      ? Effect.void
                      : recordBranchRenameFailure(threadId, runId, temporaryBranch, cause),
                  ),
                  Effect.as(temporaryBranch),
                ),
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
        branchRename = yield* renameTemporaryBranch({
          commandId: input.commandId,
          threadId,
          worktreePath,
          oldBranch: branch,
          runId,
          onRenamed: (renamed) => {
            createdBranch = renamed;
          },
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
      if (runId !== null && worktreePath !== null) {
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
      const setup =
        worktreePath === null
          ? ({ status: "no-script" } as const)
          : yield* setupScripts
              .runForThread({
                threadId,
                projectId: input.projectId,
                projectCwd: project.workspaceRoot,
                worktreePath,
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
          .pipe(
            Effect.mapError(mapError(input, "release-run", threadId)),
            Effect.tap(() =>
              Effect.sync(() => {
                runReleased = true;
              }),
            ),
            Effect.uninterruptible,
          );
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
          if (cancelled && setupTerminalId)
            yield* terminals
              .close({ threadId, terminalId: setupTerminalId, deleteHistory: true })
              .pipe(Effect.ignore);
          if (
            tracked &&
            createdWorktreePath &&
            ((cancelled && !runReleased) || !workspaceRecorded)
          ) {
            if (branchRename !== null) yield* Fiber.interrupt(branchRename);
            if (branchNameFiber !== null) yield* Fiber.interrupt(branchNameFiber);
            const removedPath = createdWorktreePath;
            const removedBranch = createdBranch;
            // Forget worktrees only after removal succeeds; failed removals must not reuse partially written checkouts.
            yield* git
              .removeWorktree({ cwd: project.workspaceRoot, path: removedPath, force: true })
              .pipe(
                Effect.andThen(
                  removedBranch === null
                    ? Effect.void
                    : git
                        .deleteLocalBranch({
                          cwd: project.workspaceRoot,
                          refName: removedBranch,
                          force: true,
                        })
                        .pipe(Effect.ignoreCause({ log: true })),
                ),
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
    const preparation = Effect.gen(function* () {
      const prepare = prepareInBackground(input, threadId, runId);
      if (
        runId === null ||
        (input.workspaceStrategy.type !== "worktree" && input.reusedWorktree === undefined)
      ) {
        return yield* prepare;
      }
      const afterSequence = yield* threads.getThreadEventSequence(threadId);
      const projection = yield* threads.getThreadRecords(threadId, ["runs"], { runIds: [runId] });
      if (projection.runs.find((run) => run.id === runId)?.status !== "preparing") return;
      const interruption = threads
        .streamStoredEventsFrom({ threadId, afterSequence, eventType: "run.updated" })
        .pipe(
          Stream.filter(
            (stored) =>
              stored.event.type === "run.updated" &&
              stored.event.payload.id === runId &&
              (stored.event.payload.status === "interrupted" ||
                stored.event.payload.status === "cancelled"),
          ),
          Stream.runHead,
          Effect.flatMap((event) => (Option.isSome(event) ? Effect.interrupt : Effect.never)),
        );
      yield* Effect.raceFirst(prepare, interruption);
    });
    yield* preparation.pipe(
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
    function* (request) {
      // Scratch has no Git repository. Normalize before folder allocation so
      // durable preparation and retries use the thread's own Scratch folder.
      const input: ThreadLaunchInput =
        request.workspaceStrategy.type === "worktree" &&
        (yield* managedFolders.isScratchProject(request.projectId))
          ? { ...request, workspaceStrategy: { type: "root" } }
          : request;
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
      yield* threads.assertProviderInstanceEnabled({
        projectId: input.projectId,
        commandId: input.commandId,
        instanceId: input.modelSelection.instanceId,
      });
      // A pull request is checked out before the thread exists, so a launch
      // that cannot reach it creates nothing. Repeating it reuses the checkout.
      const requestedStrategy: ThreadLaunchWorkspaceStrategy =
        input.workspaceStrategy.type === "pull_request"
          ? yield* checkOutPullRequest(
              input.projectId,
              project.workspaceRoot,
              input.workspaceStrategy,
            )
          : input.workspaceStrategy;
      return yield* Effect.gen(function* () {
        // Recover ids from accepted launch receipts before allocating; retries have no client id and new ids collide with receipts.
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

        const workspaceStrategy: ThreadLaunchWorkspaceStrategy =
          requestedStrategy.type === "root" && Option.isNone(launchReceipt)
            ? Option.match(
                yield* managedFolders
                  .folderForThread({
                    projectId: input.projectId,
                    threadId: candidateThreadId,
                    text: input.initialMessage?.text ?? input.title,
                  })
                  .pipe(Effect.mapError(mapError(input, "provision-worktree", candidateThreadId))),
                {
                  onNone: () => requestedStrategy,
                  onSome: (worktreePath) => ({ type: "existing_worktree", worktreePath }),
                },
              )
            : requestedStrategy;
        const initialBranch = yield* launchBranch(workspaceStrategy, project.workspaceRoot);
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
                ...(input.groupName === undefined ? {} : { groupName: input.groupName }),
                ...(input.importedNativeThread === undefined
                  ? {}
                  : { importedNativeThread: input.importedNativeThread }),
                ...(input.linkOrigin === undefined ? {} : { linkOrigin: input.linkOrigin }),
                ...(input.delegatedFrom === undefined
                  ? {}
                  : { delegatedFrom: input.delegatedFrom }),
                createdBy: input.createdBy,
                creationSource: input.creationSource,
                ...(input.startedBy === undefined ? {} : { startedBy: input.startedBy }),
                ...(input.initialMessage?.scheduledTaskId === undefined
                  ? {}
                  : { scheduledTaskId: input.initialMessage.scheduledTaskId }),
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
        let messageSequence: number | undefined;
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
            .pipe(
              // An agent's launch can land on a thread that a replay, or a concurrent
              // launch with the same key, created with broader modes. The orchestrator
              // refuses the message under the thread's lock; the user's own clients
              // launch into their own drafts, whatever modes those hold.
              input.createdBy === "agent"
                ? Effect.provideService(DispatchModeLimit, {
                    runtimeMode: input.runtimeMode,
                    interactionMode: input.interactionMode,
                  })
                : (effect) => effect,
              Effect.mapError(mapError(input, "dispatch-message", threadId)),
            );
          // A concurrent retry can read no receipt and still replay the dispatch.
          messageWasAlreadyAccepted ||= dispatched.replayed === true;
          messageSequence = dispatched.sequence;
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

        // Fork preparation before the full projection read; it is only part of the reply.
        const shouldSchedule = runId === null ? Option.isNone(launchReceipt) : true;
        if (shouldSchedule && (yield* reservePreparation(input.commandId))) {
          yield* Effect.gen(function* () {
            const current =
              runId === null
                ? null
                : yield* threads
                    .getThreadRecords(threadId, ["runs"], { runIds: [runId] })
                    .pipe(Effect.mapError(mapError(input, "update-thread", threadId)));
            if (
              current !== null &&
              !current.runs.some((run) => run.id === runId && run.status === "preparing")
            ) {
              return yield* releasePreparation(input.commandId);
            }
            const boundWorktreePath = current?.thread.worktreePath ?? null;
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
            yield* schedulePreparation(
              { ...input, workspaceStrategy: preparationStrategy },
              threadId,
              runId,
            );
          }).pipe(Effect.onError(() => releasePreparation(input.commandId)));
        }
        const projection = yield* threads
          .getThreadProjection(threadId)
          .pipe(Effect.mapError(mapError(input, "create-thread", threadId)));

        return {
          threadId,
          projection,
          // An attempt that failed after claiming the thread recorded nothing, so
          // only a repeat of the final write counts as resumed.
          resumed:
            input.initialMessage === undefined
              ? Option.isSome(launchReceipt) || claimed.replayed === true
              : messageWasAlreadyAccepted,
          ...(messageSequence === undefined ? {} : { sequence: messageSequence }),
        };
      });
    },
  );

  const prepareRun: ThreadLaunchService["Service"]["prepareRun"] = Effect.fn(
    "ThreadLaunchService.prepareRun",
  )(function* (input) {
    const scheduled = yield* Effect.gen(function* () {
      const { thread, runs } = yield* threads.getThreadRecords(input.threadId, ["runs"], {
        runIds: [input.runId],
      });
      const run = runs.find((candidate) => candidate.id === input.runId);
      const workspacePreparation = run?.workspacePreparation;
      if (run?.status !== "preparing" || workspacePreparation === undefined) return;
      if (!(yield* reservePreparation(input.commandId))) return;
      yield* scheduleRunPreparation(input, thread, run, workspacePreparation).pipe(
        Effect.onError(() => releasePreparation(input.commandId)),
      );
    }).pipe(Effect.exit);
    if (Exit.isFailure(scheduled)) {
      yield* failPreparedRun(input, input.threadId, input.runId, Cause.squash(scheduled.cause));
    }
  });

  const retryPreparation: ThreadLaunchService["Service"]["retryPreparation"] = Effect.fn(
    "ThreadLaunchService.retryPreparation",
  )(function* (input) {
    const dispatched = yield* threads.dispatch({
      type: "prepared-run.retry",
      commandId: input.commandId,
      threadId: input.threadId,
      runId: input.runId,
    });
    yield* prepareRun(input);
    return dispatched;
  });

  const scheduleRunPreparation = Effect.fn("ThreadLaunchService.scheduleRunPreparation")(function* (
    input: ThreadLaunchPreparationInput,
    thread: OrchestrationV2ThreadProjection["thread"],
    run: OrchestrationV2ThreadProjection["runs"][number],
    workspacePreparation: ThreadLaunchWorkspaceStrategy,
  ) {
    const { messages } = yield* threads.getThreadRecords(input.threadId, ["messages"], {
      messageIds: [run.userMessageId],
    });
    const message = messages.find((candidate) => candidate.id === run.userMessageId);
    const reuse =
      workspacePreparation.type === "worktree" &&
      thread.worktreePath !== null &&
      thread.branch !== null
        ? {
            strategy: {
              type: "existing_worktree" as const,
              worktreePath: thread.worktreePath,
              branch: thread.branch,
            },
            reusedWorktree: { baseRef: workspacePreparation.baseRef },
          }
        : null;
    return yield* schedulePreparation(
      {
        commandId: input.commandId,
        projectId: thread.projectId,
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
  });

  const prepareMessageWorkspace: ThreadLaunchService["Service"]["prepareMessageWorkspace"] =
    Effect.fn("ThreadLaunchService.prepareMessageWorkspace")(
      function* (input) {
        const pending = (yield* Ref.get(messageLessPreparations)).get(input.threadId);
        if (pending !== undefined) yield* Deferred.await(pending);
        const context = input.context;
        if (context === undefined || messageRepositoryRecords(context).length === 0) return context;
        const shell = yield* threads.getThreadShell(input.threadId);
        if (shell === null) return context;
        const cwd =
          shell.worktreePath ??
          Option.getOrNull(
            Option.map(
              yield* projects.getById(shell.projectId),
              (project) => project.workspaceRoot,
            ),
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
      },
      (effect, input) =>
        effect.pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("Failed to prepare context repositories for a message", {
              threadId: input.threadId,
              cause,
            }).pipe(Effect.as(input.context)),
          ),
        ),
    );

  const nameTemporaryBranch: ThreadLaunchService["Service"]["nameTemporaryBranch"] = Effect.fn(
    "ThreadLaunchService.nameTemporaryBranch",
  )(
    function* (input) {
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
    },
    (effect, input) =>
      effect.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Failed to schedule a thread worktree branch rename", {
            commandId: input.commandId,
            threadId: input.threadId,
            cause,
          }),
        ),
      ),
  );

  return ThreadLaunchService.of({
    launch,
    checkNewWorktree,
    retryPreparation,
    prepareRun,
    prepareMessageWorkspace,
    nameTemporaryBranch,
  });
});

export const layer = Layer.effect(ThreadLaunchService, make);
