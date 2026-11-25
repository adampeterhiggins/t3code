import * as Path from "effect/Path";
import {
  CommandId,
  type GitCommandError,
  type TaskFolderError,
  MessageId,
  type ProjectId,
  WorktreeMcpFailure,
  type WorktreeMcpContinuationStatus,
  type WorktreeMcpHandoffInput,
  type WorktreeMcpHandoffResult,
  type WorktreeMcpSetupScriptStatus,
  type WorktreeMcpStatusResult,
  type VcsListRefsInput,
  type VcsListRefsResult,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as PlatformError from "effect/PlatformError";

import * as GitWorkflowService from "../git/GitWorkflowService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProjectSetupScriptRunner from "../project/ProjectSetupScriptRunner.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as VcsStatusBroadcaster from "../vcs/VcsStatusBroadcaster.ts";
import * as TaskFolders from "../workspace/TaskFolders.ts";
import type { McpInvocationScope, McpThreadInvocationScope } from "./McpInvocationContext.ts";

export class WorktreeMcpService extends Context.Service<
  WorktreeMcpService,
  {
    readonly handoff: (
      scope: McpInvocationScope,
      input: WorktreeMcpHandoffInput,
    ) => Effect.Effect<WorktreeMcpHandoffResult, WorktreeMcpFailure>;
    readonly status: (
      scope: McpInvocationScope,
    ) => Effect.Effect<WorktreeMcpStatusResult, WorktreeMcpFailure>;
    readonly listRefs: (
      input: Omit<VcsListRefsInput, "cwd"> & {
        readonly worktreePath: string | null;
        readonly workspaceRoot: string;
      },
    ) => Effect.Effect<VcsListRefsResult, GitCommandError | PlatformError.PlatformError>;
  }
>()("t3/mcp/WorktreeMcpService") {}

function failure(code: WorktreeMcpFailure["code"], message: string): WorktreeMcpFailure {
  return new WorktreeMcpFailure({ code, message });
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

const asOperationFailed = (prefix: string) =>
  Effect.mapError((error: unknown) =>
    failure("operation_failed", `${prefix}: ${errorMessage(error)}`),
  );

const make = Effect.gen(function* () {
  const path = yield* Path.Path;
  const random = yield* SecureRandom.SecureRandom;
  const fileSystem = yield* FileSystem.FileSystem;
  const threadManagement = yield* ThreadManagementService.ThreadManagementService;
  const projects = yield* ProjectService.ProjectService;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const gitWorkflow = yield* GitWorkflowService.GitWorkflowService;
  const setupScriptRunner = yield* ProjectSetupScriptRunner.ProjectSetupScriptRunner;
  const vcsStatusBroadcaster = yield* VcsStatusBroadcaster.VcsStatusBroadcaster;
  const taskFolders = yield* TaskFolders.TaskFolders;
  // The administrator's limit, fixed for the server's life as it is where turns start.
  const maxRuntimeMode = serverSettings.managedPolicy?.limits?.maxRuntimeMode;

  // Serialize handoffs per thread to avoid creating two worktrees and orphaning one.
  const handoffThreadsInFlight = new Set<string>();

  const requireThreadScope = (scope: McpInvocationScope) =>
    scope.thread === undefined
      ? Effect.fail(
          failure(
            "thread_credential_required",
            "Worktree handoff and status act as the calling T3 thread, so they need an agent running inside T3 Code.",
          ),
        )
      : Effect.succeed(scope as McpThreadInvocationScope);

  const requireCapability = (scope: McpInvocationScope) =>
    scope.capabilities.has("worktree")
      ? Effect.void
      : Effect.fail(
          failure("capability_denied", "This MCP credential does not grant worktree capabilities."),
        );

  const loadThread = (scope: McpThreadInvocationScope) =>
    threadManagement.getThreadRecords(scope.thread.threadId, []).pipe(
      Effect.mapError((error) =>
        error._tag === "OrchestratorProjectionError"
          ? failure("thread_not_found", `Thread '${scope.thread.threadId}' was not found.`)
          : failure(
              "operation_failed",
              `Unable to read thread ${scope.thread.threadId}: ${errorMessage(error)}`,
            ),
      ),
      Effect.filterOrFail(
        (projection) => projection.thread.deletedAt === null,
        () => failure("thread_not_found", `Thread '${scope.thread.threadId}' was not found.`),
      ),
    );

  const loadProject = (scope: McpThreadInvocationScope, projectId: ProjectId) =>
    projects.getById(projectId).pipe(
      asOperationFailed(`Unable to read project ${projectId}`),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(
              failure(
                "project_not_found",
                `Project '${projectId}' was not found for thread '${scope.thread.threadId}'.`,
              ),
            ),
          onSome: Effect.succeed,
        }),
      ),
    );

  const readDefaultStartFromOrigin = (projectId: ProjectId) =>
    serverSettings.getSettings.pipe(
      Effect.map(
        (settings) =>
          resolveProjectSettings(settings, projectId).settings.newWorktreesStartFromOrigin,
      ),
      asOperationFailed("Unable to read server settings"),
    );

  const handoffIds = (scope: McpThreadInvocationScope) =>
    random.uuidV4().pipe(
      Effect.map((uuid) => {
        const part = (kind: string, operation: string) =>
          [kind, "mcp", encodeURIComponent(scope.thread.providerSessionId), operation, uuid].join(
            ":",
          );
        return {
          commandId: CommandId.make(part("command", "worktree-handoff")),
          continuationMessageId: MessageId.make(part("message", "worktree-continuation")),
        };
      }),
      Effect.orDie,
    );

  // Where a new worktree's branch starts: baseRef (default: the project
  // checkout's branch), or its remote-tracking commit when starting from origin.
  const resolveNewWorktreeBase = Effect.fn("WorktreeMcpService.resolveNewWorktreeBase")(function* (
    input: WorktreeMcpHandoffInput,
    projectCwd: string,
    projectBranch: string | null,
    projectId: ProjectId,
    projectIsRepository: boolean,
  ) {
    const baseRef = input.baseRef ?? (projectIsRepository ? projectBranch : "HEAD");
    if (baseRef === null) {
      return yield* failure(
        "invalid_request",
        "Could not determine the current branch of the project workspace (detached HEAD?). Pass baseRef explicitly.",
      );
    }
    const startFromOrigin = input.startFromOrigin ?? (yield* readDefaultStartFromOrigin(projectId));
    const resolvedRemoteBase =
      startFromOrigin && projectIsRepository
        ? yield* gitWorkflow
            .fetchWorktreeBaseCommit({ cwd: projectCwd, refName: baseRef })
            .pipe(asOperationFailed(`Unable to fetch the remote base of '${baseRef}'`))
        : null;
    return resolvedRemoteBase === null
      ? { baseRef, startRef: baseRef, startFromOrigin, projectStartedFromOrigin: false }
      : {
          baseRef: `refs/remotes/${resolvedRemoteBase.remoteRefName}`,
          startRef: resolvedRemoteBase.commitSha,
          startFromOrigin,
          projectStartedFromOrigin: true,
        };
  });

  const performHandoff = Effect.fn("WorktreeMcpService.performHandoff")(function* (
    scope: McpThreadInvocationScope,
    input: WorktreeMcpHandoffInput,
  ) {
    const projection = yield* loadThread(scope);
    // The binding the handoff replaces: null for the project checkout, or the
    // worktree the thread is in now, which stays on disk after the move.
    const previousWorktreePath = projection.thread.worktreePath;
    if (projection.thread.archivedAt !== null) {
      return yield* failure(
        "invalid_request",
        `Thread '${scope.thread.threadId}' is archived and cannot be handed off to a worktree.`,
      );
    }

    const project = yield* loadProject(scope, projection.thread.projectId);
    const projectCwd = project.workspaceRoot;
    // The agent asks, so its thread's modes decide what of the project's own code runs for it:
    // as they are when each piece is about to run, since the fetch in between can take a while.
    const projectCommandsNow = loadThread(scope).pipe(
      Effect.map(({ thread }) =>
        TaskFolders.projectCommandsForAgent(thread.linkOrigin, thread, maxRuntimeMode),
      ),
      // A thread that cannot be read might be below Full access.
      Effect.orElseSucceed((): TaskFolders.ProjectCommands => "agent-below-full-access"),
    );

    // A project that tracks repositories moves into a task folder: its own folder, which need
    // not be a repository, and a worktree of each tracked one.
    const taskPlan = yield* taskFolders
      .plan({ projectId: project.id })
      .pipe(asOperationFailed("Unable to read the project's repositories"));
    const projectIsRepository = taskPlan === null || taskPlan.projectIsRepository;
    const localStatus = yield* gitWorkflow
      .localStatus({ cwd: projectCwd })
      .pipe(asOperationFailed("Unable to read git status"));
    if (projectIsRepository && !localStatus.isRepo) {
      return yield* failure(
        "invalid_request",
        `Project workspace '${projectCwd}' is not a git repository.`,
      );
    }

    const samePath = (left: string, right: string) => path.resolve(left) === path.resolve(right);

    // Reject existing branches explicitly: the git driver's errors omit stderr.
    // Check the complete local branch list for an exact match; substring search
    // only locates a checkout the caller can select with `path`.
    let existingWorktreePath: string | null = null;
    const localBranchNames = projectIsRepository
      ? yield* gitWorkflow
          .listLocalBranchNames(projectCwd)
          .pipe(asOperationFailed("Unable to list branches"))
      : [];
    if (localBranchNames.includes(input.branch)) {
      const existingRef = yield* gitWorkflow
        .listRefs({ cwd: projectCwd, query: input.branch, refKind: "local" })
        .pipe(
          Effect.map((result) =>
            result.refs.find((ref) => ref.name === input.branch && ref.isRemote !== true),
          ),
          Effect.orElseSucceed(() => undefined),
        );
      const checkoutPath = existingRef?.worktreePath ?? null;
      const isLinkedWorktree = checkoutPath !== null && !samePath(checkoutPath, projectCwd);
      if (isLinkedWorktree && input.path !== undefined && samePath(checkoutPath, input.path)) {
        existingWorktreePath = checkoutPath;
      } else {
        return yield* failure(
          "invalid_request",
          `Branch '${input.branch}' already exists${
            checkoutPath === null ? "" : ` and is checked out at '${checkoutPath}'`
          }. ${
            isLinkedWorktree
              ? `Pass path '${checkoutPath}' to move this thread into that worktree, or choose a different branch name.`
              : "Choose a different branch name, or delete the existing branch first."
          }`,
        );
      }
    }
    if (
      existingWorktreePath !== null &&
      previousWorktreePath !== null &&
      samePath(existingWorktreePath, previousWorktreePath)
    ) {
      return yield* failure(
        "already_in_worktree",
        `Thread '${scope.thread.threadId}' is already attached to worktree '${previousWorktreePath}'.`,
      );
    }

    // A new worktree's branch starts from baseRef; an existing one keeps its own.
    const target =
      existingWorktreePath === null
        ? {
            created: true as const,
            base: yield* resolveNewWorktreeBase(
              input,
              projectCwd,
              localStatus.refName,
              project.id,
              projectIsRepository,
            ),
          }
        : { created: false as const, path: existingWorktreePath };

    const ids = yield* handoffIds(scope);

    // Mask interruption after worktree creation through setup; binding can detach and interrupt the caller.
    return yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const { created } = target;
        const worktree = target.created
          ? yield* restore(
              Effect.suspend(
                (): Effect.Effect<
                  {
                    readonly path: string;
                    readonly refName: string;
                    readonly taskFolder: string | null;
                    readonly startedFromOrigin: boolean;
                  },
                  GitCommandError | TaskFolderError
                > =>
                  taskPlan === null
                    ? gitWorkflow
                        .createWorktree({
                          cwd: projectCwd,
                          refName: target.base.startRef,
                          newRefName: input.branch,
                          baseRefName: target.base.baseRef,
                          path: null,
                        })
                        .pipe(
                          Effect.map(({ worktree }) => ({
                            ...worktree,
                            taskFolder: null,
                            startedFromOrigin: target.base.projectStartedFromOrigin,
                          })),
                        )
                    : taskFolders
                        .create({
                          plan: taskPlan,
                          branch: input.branch,
                          projectStart: {
                            refName: target.base.startRef,
                            baseRefName: target.base.baseRef,
                          },
                          baseBranch: input.baseRef,
                          startFromOrigin: target.base.startFromOrigin,
                          projectCommands: projectCommandsNow,
                        })
                        .pipe(
                          Effect.map((created) => ({
                            path: created.taskFolder.projectPath,
                            refName: created.branch,
                            taskFolder: created.taskFolder.root,
                            // A layout command is handed the branch name, not the fetched commit.
                            startedFromOrigin:
                              !created.laidOutByProject &&
                              (target.base.projectStartedFromOrigin ||
                                created.repositoriesStartedFromOrigin),
                          })),
                        ),
              ).pipe(asOperationFailed("Unable to create the worktree")),
            )
          : {
              path: target.path,
              refName: input.branch,
              taskFolder: null,
              startedFromOrigin: false,
            };
        const worktreePath = worktree.path;

        const reportFailed = (logMessage: string) =>
          Effect.catchCause((cause: Cause.Cause<unknown>) => {
            const detail = errorMessage(Cause.squash(cause));
            return Effect.logWarning(logMessage, {
              threadId: scope.thread.threadId,
              worktreePath,
              detail,
            }).pipe(Effect.as({ status: "failed", detail } as const));
          });

        const createdTaskFolder = worktree.taskFolder;
        const removeCreatedWorktree = Effect.suspend(
          (): Effect.Effect<unknown, GitCommandError | TaskFolderError> =>
            createdTaskFolder === null
              ? gitWorkflow
                  .removeWorktree({ cwd: projectCwd, path: worktreePath, force: true })
                  .pipe(
                    Effect.andThen(
                      Effect.suspend(() =>
                        gitWorkflow.deleteLocalBranch({
                          cwd: projectCwd,
                          refName: worktree.refName,
                          force: true,
                        }),
                      ),
                    ),
                  )
              : taskFolders.remove({
                  root: createdTaskFolder,
                  force: true,
                  forget: true,
                  projectCommands: projectCommandsNow,
                  deleteBranch: worktree.refName,
                }),
        ).pipe(Effect.ignoreCause({ log: true }));

        const recheckAndBind = Effect.gen(function* () {
          // A concurrent UI binding may have landed during git work; do not orphan a second worktree.
          const recheck = yield* loadThread(scope);
          if (recheck.thread.worktreePath !== previousWorktreePath) {
            return yield* failure(
              "already_in_worktree",
              `Thread '${scope.thread.threadId}' moved to '${recheck.thread.worktreePath ?? projectCwd}' during the handoff; the handoff was rolled back.`,
            );
          }
          if (recheck.thread.archivedAt !== null) {
            return yield* failure(
              "invalid_request",
              `Thread '${scope.thread.threadId}' was archived while the worktree was being created; the handoff was rolled back.`,
            );
          }
          return yield* threadManagement
            .dispatch({
              type: "thread.metadata.update",
              commandId: ids.commandId,
              threadId: scope.thread.threadId,
              branch: worktree.refName,
              worktreePath,
              expectedWorktreePath: previousWorktreePath,
              // Binding detaches the session and ends the caller; a later send could lose the race.
              ...(input.continuationPrompt === undefined
                ? {}
                : {
                    continuation: {
                      messageId: ids.continuationMessageId,
                      text: input.continuationPrompt,
                    },
                  }),
            })
            .pipe(
              Effect.catchCause((cause) =>
                Cause.hasInterruptsOnly(cause)
                  ? Effect.failCause(cause as Cause.Cause<never>)
                  : Effect.fail(
                      failure(
                        "operation_failed",
                        `Unable to re-point the thread at the worktree: ${errorMessage(Cause.squash(cause))}`,
                      ),
                    ),
              ),
            );
        }).pipe(
          // Do not remove on interruption alone; the thread binding may already have committed.
          Effect.onError((cause) =>
            !created || Cause.hasInterruptsOnly(cause) ? Effect.void : removeCreatedWorktree,
          ),
        );

        const bound = yield* recheckAndBind;
        const continuation: WorktreeMcpContinuationStatus =
          input.continuationPrompt === undefined
            ? { status: "skipped" }
            : {
                status: "scheduled",
                delivery: bound.storedEvents.some(
                  ({ event }) => event.type === "run.created" && event.payload.status !== "queued",
                )
                  ? "started"
                  : "queued",
              };

        yield* vcsStatusBroadcaster
          .refreshStatus(worktreePath)
          .pipe(Effect.ignoreCause({ log: true }), Effect.forkDetach);

        let setupScript: WorktreeMcpSetupScriptStatus = { status: "skipped" };
        const shouldRunSetup = input.runSetupScript ?? created;
        // The saved setup script is the project's code too: below Full access it waits for a person.
        const setupWaitsForFullAccess =
          shouldRunSetup && (yield* projectCommandsNow) === "agent-below-full-access";
        if (shouldRunSetup && !setupWaitsForFullAccess) {
          setupScript = yield* setupScriptRunner
            .runForThread({
              threadId: scope.thread.threadId,
              projectId: projection.thread.projectId,
              projectCwd,
              worktreePath,
              project: {
                id: project.id,
                workspaceRoot: project.workspaceRoot,
                scripts: project.scripts,
              },
            })
            .pipe(
              Effect.map((result): WorktreeMcpSetupScriptStatus =>
                result.status === "started"
                  ? {
                      status: "started",
                      scriptName: result.scriptName,
                      terminalId: result.terminalId,
                    }
                  : result.status === "skipped-for-link"
                    ? { status: "skipped" }
                    : { status: "no-script" },
              ),
              reportFailed("worktree handoff setup script failed"),
            );
        }

        const result: WorktreeMcpHandoffResult = {
          worktreePath,
          branch: worktree.refName,
          created,
          baseRef: target.created ? target.base.baseRef : null,
          startedFromOrigin: worktree.startedFromOrigin,
          setupScript,
          continuation,
          note:
            (continuation.status === "scheduled"
              ? "Handoff recorded. Changing the workspace detaches this provider session, so the current turn ends shortly after this call; the queued continuation prompt then starts the next turn inside the worktree with the conversation preserved. The worktree is not removed automatically when the thread is deleted."
              : "Handoff recorded. Changing the workspace detaches this provider session, so the current turn ends shortly after this call; the conversation continues inside the worktree when the thread receives its next message. Pass continuationPrompt to resume automatically. The worktree is not removed automatically when the thread is deleted.") +
            (previousWorktreePath === null
              ? ""
              : ` The previous worktree '${previousWorktreePath}' stays on disk.`) +
            (setupWaitsForFullAccess
              ? " Project setup scripts do not run for a handoff from a thread below Full access."
              : ""),
        };
        return result;
      }),
    );
  });

  const handoff: WorktreeMcpService["Service"]["handoff"] = Effect.fn("WorktreeMcpService.handoff")(
    function* (callerScope, input) {
      yield* requireCapability(callerScope);
      const scope = yield* requireThreadScope(callerScope);
      // Acquire and register cleanup atomically so cancellation cannot strand the guard until restart.
      return yield* Effect.uninterruptibleMask((restore) =>
        Effect.suspend(() => {
          if (handoffThreadsInFlight.has(scope.thread.threadId)) {
            return Effect.fail(
              failure(
                "handoff_in_progress",
                `A worktree handoff is already in progress for thread '${scope.thread.threadId}'.`,
              ),
            );
          }
          handoffThreadsInFlight.add(scope.thread.threadId);
          return restore(performHandoff(scope, input)).pipe(
            Effect.ensuring(
              Effect.sync(() => handoffThreadsInFlight.delete(scope.thread.threadId)),
            ),
          );
        }),
      );
    },
  );

  const status: WorktreeMcpService["Service"]["status"] = Effect.fn("WorktreeMcpService.status")(
    function* (callerScope) {
      yield* requireCapability(callerScope);
      const scope = yield* requireThreadScope(callerScope);
      const projection = yield* loadThread(scope);
      const project = yield* loadProject(scope, projection.thread.projectId);

      const defaultStartFromOrigin = yield* readDefaultStartFromOrigin(project.id);

      const result: WorktreeMcpStatusResult = {
        attached: projection.thread.worktreePath !== null,
        worktreePath: projection.thread.worktreePath,
        branch: projection.thread.branch,
        projectWorkspaceRoot: project.workspaceRoot,
        defaultStartFromOrigin,
      };
      return result;
    },
  );

  const listRefs: WorktreeMcpService["Service"]["listRefs"] = Effect.fn(
    "WorktreeMcpService.listRefs",
  )(function* ({ worktreePath, workspaceRoot, ...refs }) {
    // Storage cleanup removes a worktree but keeps its path on the thread.
    const cwd =
      worktreePath !== null && (yield* fileSystem.exists(worktreePath))
        ? worktreePath
        : workspaceRoot;
    return yield* gitWorkflow.listRefs({ ...refs, cwd });
  });

  return WorktreeMcpService.of({ handoff, status, listRefs });
});

export const layer: Layer.Layer<
  WorktreeMcpService,
  never,
  | SecureRandom.SecureRandom
  | Path.Path
  | FileSystem.FileSystem
  | ThreadManagementService.ThreadManagementService
  | ProjectService.ProjectService
  | ServerSettings.ServerSettingsService
  | GitWorkflowService.GitWorkflowService
  | ProjectSetupScriptRunner.ProjectSetupScriptRunner
  | VcsStatusBroadcaster.VcsStatusBroadcaster
  | TaskFolders.TaskFolders
> = Layer.effect(WorktreeMcpService, make);
