/**
 * ClientCommandDispatcher - runs an orchestration command the way a client's
 * send does.
 *
 * `OrchestrationEngine.dispatch` only persists one command. A client send can
 * mean more: a bootstrap turn creates the thread, prepares its worktree, runs
 * the setup script and clones attached repositories before the turn starts,
 * and an archive also stops the thread's session and closes its terminals.
 * Every client-facing entry point (the WebSocket RPC, the HTTP dispatch
 * route) goes through here so they all behave the same.
 *
 * Callers normalize the command first and own anything tied to their
 * transport, such as uploaded attachment cleanup and analytics.
 *
 * @module ClientCommandDispatcher
 */
import { assistantCitationsToPlainText } from "@t3tools/shared/assistantCitations";
import { isTemporaryWorktreeBranch } from "@t3tools/shared/git";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import {
  CommandId,
  EventId,
  type OrchestrationClientOrigin,
  type OrchestrationCommand,
  OrchestrationDispatchCommandError,
  type OrchestrationMessageContext,
  type ProjectId,
  RepositoryContextRecord,
  type ThreadId,
  WORKTREE_SETUP_ACTIVITY_KIND,
  worktreeSetupActivityId,
  type WorktreeSetupSnapshot,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../config.ts";
import * as ContextRepositories from "../contextRepositories/ContextRepositories.ts";
import * as GitWorkflowService from "../git/GitWorkflowService.ts";
import { generateWorktreeBranchName } from "../git/worktreeBranchName.ts";
import * as ProjectCloneTracker from "../project/ProjectCloneTracker.ts";
import * as ProjectSetupScriptRunner from "../project/ProjectSetupScriptRunner.ts";
import * as WorktreeSetupTracker from "../project/WorktreeSetupTracker.ts";
import * as ProviderRegistry from "../provider/Services/ProviderRegistry.ts";
import * as ServerRuntimeStartup from "../serverRuntimeStartup.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TerminalManager from "../terminal/Manager.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as VcsStatusBroadcaster from "../vcs/VcsStatusBroadcaster.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import { normalizeDispatchCommand } from "./Normalizer.ts";
import * as OrchestrationEngine from "./Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "./Services/ProjectionSnapshotQuery.ts";
import { ThreadDeletionReactor } from "./Services/ThreadDeletionReactor.ts";

export interface ClientCommandDispatch {
  /**
   * Dispatches an already normalized command. Commands queue behind server
   * startup, and a bootstrap turn outlives the caller: a dropped connection
   * does not abandon a half-made worktree.
   */
  readonly dispatch: (
    command: OrchestrationCommand,
  ) => Effect.Effect<{ readonly sequence: number }, OrchestrationDispatchCommandError>;
}

export interface ClientCommandDispatcherShape {
  /**
   * Dispatch bound to one client. Every command it sends, including the
   * server-generated steps of a bootstrap, carries `origin`: the client's
   * request caused them.
   */
  readonly forOrigin: (origin: OrchestrationClientOrigin | undefined) => ClientCommandDispatch;
}

export class ClientCommandDispatcher extends Context.Service<
  ClientCommandDispatcher,
  ClientCommandDispatcherShape
>()("t3/orchestration/ClientCommandDispatcher") {}

const isOrchestrationDispatchCommandError = Schema.is(OrchestrationDispatchCommandError);
const isRepositoryContextRecord = Schema.is(RepositoryContextRecord);

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
// How long worktree bootstrap waits, past checkout, for a generated branch name.
const BOOTSTRAP_BRANCH_NAME_TIMEOUT = Duration.seconds(10);

/** One repository's outcome as a work log line. */
function describeContextRepositoryOutcome(record: RepositoryContextRecord): string {
  const outcome = record.outcome;
  if (!outcome) return "not checked";
  const git = outcome.git
    ? ` · ${outcome.git.branch ?? "detached"}${outcome.git.behind > 0 ? ` · ${outcome.git.behind} behind` : ""}${outcome.git.changedFiles > 0 ? ` · ${outcome.git.changedFiles} changed` : ""}`
    : "";
  switch (outcome.status) {
    case "cloned":
      return `cloned into ${outcome.path}${git}`;
    case "present":
      return `already in ${outcome.path}${git}`;
    case "conflict":
    case "failed":
      return outcome.detail ?? outcome.status;
  }
}

/** One line for the setup card: how the attached repositories came out. */
function summarizeContextRepositoryOutcomes(records: ReadonlyArray<RepositoryContextRecord>): {
  readonly ok: boolean;
  readonly detail: string;
} {
  const counts = { cloned: 0, present: 0, conflict: 0, failed: 0 };
  for (const record of records) if (record.outcome) counts[record.outcome.status] += 1;
  const parts = [
    ...(counts.cloned > 0 ? [`${counts.cloned} cloned`] : []),
    ...(counts.present > 0 ? [`${counts.present} already present`] : []),
    ...(counts.conflict > 0 ? [`${counts.conflict} blocked by an existing folder`] : []),
    ...(counts.failed > 0 ? [`${counts.failed} failed`] : []),
  ];
  return { ok: counts.conflict + counts.failed === 0, detail: parts.join(", ") };
}

function unexpectedCompatibilityError(error: never): never {
  throw new Error(`Unhandled compatibility error: ${String(error)}`);
}

/** Preserve the setup runner's broader pre-refactor message normalization. */
function legacySetupFailureDescription(cause: unknown): string {
  if (
    typeof cause === "object" &&
    cause !== null &&
    "message" in cause &&
    typeof cause.message === "string"
  ) {
    return cause.message;
  }
  return String(cause);
}

function projectSetupScriptCompatibilityDetail(
  error: ProjectSetupScriptRunner.ProjectSetupScriptRunnerError,
): string {
  switch (error._tag) {
    case "ProjectSetupScriptOperationError":
      return legacySetupFailureDescription(error.cause);
    case "ProjectSetupScriptProjectNotFoundError":
      return "Project was not found for setup script execution.";
    default:
      return unexpectedCompatibilityError(error);
  }
}

const toDispatchCommandError = (cause: unknown, fallbackMessage: string) =>
  isOrchestrationDispatchCommandError(cause)
    ? cause
    : new OrchestrationDispatchCommandError({
        message: cause instanceof Error ? cause.message : fallbackMessage,
        cause,
      });

const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const orchestrationEngine = yield* OrchestrationEngine.OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const threadDeletionReactor = yield* ThreadDeletionReactor;
  const startup = yield* ServerRuntimeStartup.ServerRuntimeStartup;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const gitWorkflow = yield* GitWorkflowService.GitWorkflowService;
  const vcsStatusBroadcaster = yield* VcsStatusBroadcaster.VcsStatusBroadcaster;
  const terminalManager = yield* TerminalManager.TerminalManager;
  const textGeneration = yield* TextGeneration.TextGeneration;
  const providerRegistry = yield* ProviderRegistry.ProviderRegistry;
  const projectSetupScriptRunner = yield* ProjectSetupScriptRunner.ProjectSetupScriptRunner;
  const worktreeSetupTracker = yield* WorktreeSetupTracker.WorktreeSetupTracker;
  const projectCloneTracker = yield* ProjectCloneTracker.ProjectCloneTracker;
  const contextRepositories = yield* ContextRepositories.ContextRepositories;
  const normalizerContext = yield* Effect.context<
    FileSystem.FileSystem | Path.Path | ServerConfig.ServerConfig | WorkspacePaths.WorkspacePaths
  >();

  const randomUUID = crypto.randomUUIDv4.pipe(
    Effect.mapError((cause) =>
      toDispatchCommandError(cause, "Failed to generate orchestration command identifier."),
    ),
  );
  const serverEventId = randomUUID.pipe(Effect.map(EventId.make));
  const serverCommandId = (tag: string) =>
    randomUUID.pipe(Effect.map((uuid) => CommandId.make(`server:${tag}:${uuid}`)));

  const refreshGitStatus = (cwd: string) =>
    vcsStatusBroadcaster
      .refreshStatus(cwd)
      .pipe(Effect.ignoreCause({ log: true }), Effect.forkDetach, Effect.asVoid);

  const forOrigin = (origin: OrchestrationClientOrigin | undefined): ClientCommandDispatch => {
    const hasClientOrigin =
      origin !== undefined && (origin.surface !== undefined || origin.appVersion !== undefined);
    const dispatchFromClient: OrchestrationEngine.OrchestrationEngineShape["dispatch"] = (
      command,
    ) => orchestrationEngine.dispatch(command, hasClientOrigin ? { origin } : undefined);

    const appendSetupScriptActivity = (input: {
      readonly threadId: ThreadId;
      readonly kind: "setup-script.requested" | "setup-script.started" | "setup-script.failed";
      readonly summary: string;
      readonly createdAt: string;
      readonly payload: Record<string, unknown>;
      readonly tone: "info" | "error";
    }) =>
      Effect.all({
        commandId: serverCommandId("setup-script-activity"),
        activityId: serverEventId,
      }).pipe(
        Effect.flatMap(({ commandId, activityId }) =>
          dispatchFromClient({
            type: "thread.activity.append",
            commandId,
            threadId: input.threadId,
            activity: {
              id: activityId,
              tone: input.tone,
              kind: input.kind,
              summary: input.summary,
              payload: input.payload,
              turnId: null,
              createdAt: input.createdAt,
            },
            createdAt: input.createdAt,
          }),
        ),
      );

    // The worktree setup's durable record: one activity per thread, upserted
    // by a fixed id when the setup starts and again when it settles. Live
    // progress keeps streaming from the tracker; this is what a reload or
    // another client reads. Best effort: the thread may already be gone
    // after a failed bootstrap.
    const recordWorktreeSetup = (snapshot: WorktreeSetupSnapshot) =>
      serverCommandId("worktree-setup-activity").pipe(
        Effect.flatMap((commandId) =>
          dispatchFromClient({
            type: "thread.activity.append",
            commandId,
            threadId: snapshot.threadId,
            activity: {
              id: EventId.make(worktreeSetupActivityId(snapshot.threadId)),
              tone:
                snapshot.phase === "failed" ||
                snapshot.stages.some((stage) => stage.status === "failed")
                  ? "error"
                  : "info",
              kind: WORKTREE_SETUP_ACTIVITY_KIND,
              summary:
                snapshot.phase === "running"
                  ? "Setting up worktree"
                  : snapshot.phase === "done"
                    ? "Worktree ready"
                    : snapshot.phase === "cancelled"
                      ? "Worktree setup cancelled"
                      : "Worktree setup failed",
              payload: snapshot,
              turnId: null,
              createdAt: snapshot.startedAt,
            },
            createdAt: snapshot.endedAt ?? snapshot.startedAt,
          }),
        ),
        Effect.ignoreCause({ log: true }),
      );

    const toBootstrapDispatchCommandCauseError = (cause: Cause.Cause<unknown>) => {
      const error = Cause.squash(cause);
      return isOrchestrationDispatchCommandError(error)
        ? error
        : new OrchestrationDispatchCommandError({
            message:
              error instanceof Error ? error.message : "Failed to bootstrap thread turn start.",
            cause,
          });
    };

    // The thread's project settings, or null when they fail to load. They
    // skip t3.json, so a null `worktreeSubmodules` lets the driver read the
    // freshly created checkout's own t3.json (the branch being checked out
    // may declare something the project root does not).
    const resolveBootstrapProjectSettings = Effect.fnUntraced(function* (input: {
      readonly threadId: ThreadId;
      readonly projectId: ProjectId | null;
    }) {
      const settings = yield* serverSettings.getSettings.pipe(Effect.orElseSucceed(() => null));
      if (!settings) return null;
      // A worktree can also be prepared for an existing thread, whose
      // project is only known through its shell.
      const resolvedProjectId =
        input.projectId ??
        (yield* projectionSnapshotQuery.getThreadShellById(input.threadId).pipe(
          Effect.map((thread) => Option.getOrNull(thread)?.projectId ?? null),
          Effect.orElseSucceed(() => null),
        ));
      const project =
        resolvedProjectId === null
          ? null
          : yield* projectionSnapshotQuery.getProjectShellById(resolvedProjectId).pipe(
              Effect.map(Option.getOrNull),
              Effect.orElseSucceed(() => null),
            );
      return resolveProjectSettings(settings, resolvedProjectId, project).settings;
    });

    /** The message's `repository` records: repositories to clone before its turn starts. */
    const messageRepositoryRecords = (context: OrchestrationMessageContext | undefined) =>
      (context?.records ?? []).filter(isRepositoryContextRecord);

    const contextRepositoryDirectory = serverSettings.getSettings.pipe(
      Effect.map((settings) => settings.contextRepositoryDirectory),
      Effect.orElseSucceed(() => ""),
    );

    /**
     * Clones the turn's attached repositories into `cwd` and returns the
     * command with each record's outcome filled in, so the persisted message
     * (and through it the chip and the agent's prompt) says what happened.
     * Never fails: a clone problem is a warning on its record.
     */
    const ensureTurnContextRepositories = (
      command: Extract<OrchestrationCommand, { type: "thread.turn.start" }>,
      cwd: string,
      onProgress?: (event: ContextRepositories.ContextRepositoryProgress) => Effect.Effect<void>,
    ) =>
      Effect.gen(function* () {
        const context = command.message.context;
        const records = messageRepositoryRecords(context);
        if (!context || records.length === 0) return { command, ensured: records };
        const ensured = yield* contextRepositories.ensure({
          cwd,
          directory: yield* contextRepositoryDirectory,
          repositories: records,
          ...(onProgress ? { onProgress } : {}),
        });
        const byId = new Map(ensured.map((record) => [record.contextId, record]));
        return {
          command: {
            ...command,
            message: {
              ...command.message,
              context: {
                ...context,
                records: context.records.map((record) => byId.get(record.contextId) ?? record),
              },
            },
          },
          ensured,
        };
      });

    /** A thread's workspace: its worktree, else its project's root. */
    const resolveThreadWorkspaceCwd = (threadId: ThreadId) =>
      Effect.gen(function* () {
        const thread = Option.getOrNull(
          yield* projectionSnapshotQuery
            .getThreadShellById(threadId)
            .pipe(Effect.orElseSucceed(() => Option.none())),
        );
        if (!thread) return null;
        if (thread.worktreePath) return thread.worktreePath;
        return yield* resolveProjectWorkspaceRoot(thread.projectId);
      });

    const resolveProjectWorkspaceRoot = (projectId: ProjectId) =>
      projectionSnapshotQuery.getProjectShellById(projectId).pipe(
        Effect.map((project) => Option.getOrNull(project)?.workspaceRoot ?? null),
        Effect.orElseSucceed(() => null),
      );

    const dispatchBootstrapTurnStart = (
      command: Extract<OrchestrationCommand, { type: "thread.turn.start" }>,
    ): Effect.Effect<{ readonly sequence: number }, OrchestrationDispatchCommandError> =>
      Effect.gen(function* () {
        const bootstrap = command.bootstrap;
        const { bootstrap: _bootstrap, ...bootstrapTurnStartCommand } = command;
        // Gains clone outcomes once the context repositories are ensured.
        let finalTurnStartCommand = bootstrapTurnStartCommand;
        const repositoryRecords = messageRepositoryRecords(command.message.context);
        let createdThread = false;
        let createdThreadSequence = 0;
        // Set up the thread and workspace only; the user's first send starts the turn.
        const deferTurn = bootstrap?.deferTurn === true;
        if (deferTurn && !bootstrap?.createThread) {
          return yield* new OrchestrationDispatchCommandError({
            message: "A deferred bootstrap turn must create its thread.",
          });
        }
        let targetProjectId = bootstrap?.createThread?.projectId;
        let targetProjectCwd = bootstrap?.prepareWorktree?.projectCwd;
        let targetWorktreePath = bootstrap?.createThread?.worktreePath ?? null;
        // The setup script's terminal, once started. Cancel closes only this
        // one so terminals the user opened meanwhile survive.
        let setupTerminalId: string | null = null;

        // Set once the checkout starts; see the session.set below.
        let preparingSessionSet = false;
        const markPreparingSessionFailed = (detail: string) =>
          Effect.gen(function* () {
            const failedAt = yield* nowIso;
            yield* dispatchFromClient({
              type: "thread.session.set",
              commandId: yield* serverCommandId("bootstrap-thread-preparing-failed"),
              threadId,
              session: {
                threadId,
                status: "error",
                providerName: null,
                providerInstanceId:
                  bootstrap?.createThread?.modelSelection.instanceId ??
                  command.modelSelection?.instanceId,
                runtimeMode: command.runtimeMode,
                activeTurnId: null,
                lastError: detail.trim().length > 0 ? detail : "Worktree setup failed.",
                updatedAt: failedAt,
              },
              createdAt: failedAt,
            });
          });
        const cleanupCreatedThread = () =>
          createdThread
            ? serverCommandId("bootstrap-thread-delete").pipe(
                Effect.flatMap((commandId) =>
                  dispatchFromClient({
                    type: "thread.delete",
                    commandId,
                    threadId: command.threadId,
                  }),
                ),
                Effect.as(true),
              )
            : Effect.succeed(false);

        const recordSetupScriptLaunchFailure = (input: {
          readonly error: ProjectSetupScriptRunner.ProjectSetupScriptRunnerError;
          readonly requestedAt: string;
          readonly worktreePath: string;
        }) => {
          const detail = projectSetupScriptCompatibilityDetail(input.error);
          return appendSetupScriptActivity({
            threadId: command.threadId,
            kind: "setup-script.failed",
            summary: "Setup script failed to start",
            createdAt: input.requestedAt,
            payload: {
              detail,
              worktreePath: input.worktreePath,
            },
            tone: "error",
          }).pipe(
            Effect.ignoreCause({ log: false }),
            Effect.flatMap(() =>
              Effect.logWarning("bootstrap turn start failed to launch setup script", {
                threadId: command.threadId,
                worktreePath: input.worktreePath,
                detail,
              }),
            ),
          );
        };

        const recordSetupScriptStarted = (input: {
          readonly requestedAt: string;
          readonly worktreePath: string;
          readonly scriptId: string;
          readonly scriptName: string;
          readonly terminalId: string;
        }) =>
          Effect.gen(function* () {
            const startedAt = yield* nowIso;
            const payload = {
              scriptId: input.scriptId,
              scriptName: input.scriptName,
              terminalId: input.terminalId,
              worktreePath: input.worktreePath,
            };
            yield* Effect.all([
              appendSetupScriptActivity({
                threadId: command.threadId,
                kind: "setup-script.requested",
                summary: "Starting setup script",
                createdAt: input.requestedAt,
                payload,
                tone: "info",
              }),
              appendSetupScriptActivity({
                threadId: command.threadId,
                kind: "setup-script.started",
                summary: "Setup script started",
                createdAt: startedAt,
                payload,
                tone: "info",
              }),
            ]).pipe(
              Effect.asVoid,
              Effect.catch((error) =>
                Effect.logWarning(
                  "bootstrap turn start launched setup script but failed to record setup activity",
                  {
                    threadId: command.threadId,
                    worktreePath: input.worktreePath,
                    scriptId: input.scriptId,
                    terminalId: input.terminalId,
                    detail: error.message,
                  },
                ),
              ),
            );
          });

        const tracked = bootstrap?.prepareWorktree !== undefined;
        const threadId = command.threadId;
        const track = (effect: Effect.Effect<void>) => (tracked ? effect : Effect.void);

        // Starts the setup script. For tracked bootstraps it returns the
        // effect that waits for the script to exit and records the outcome
        // on the card; whether the agent stage waits on it depends on the
        // script's `async` flag. Returns null when nothing is left to await.
        // Untracked callers keep the old fire-and-forget behavior.
        const runSetupProgram = () =>
          Effect.gen(function* () {
            if (!bootstrap?.runSetupScript || !targetWorktreePath) {
              yield* track(worktreeSetupTracker.stageStatus(threadId, "setup-script", "skipped"));
              return null;
            }
            const worktreePath = targetWorktreePath;
            const requestedAt = yield* nowIso;
            yield* track(worktreeSetupTracker.stageStatus(threadId, "setup-script", "running"));
            const setupResult = yield* projectSetupScriptRunner
              .runForThread({
                threadId,
                ...(targetProjectId ? { projectId: targetProjectId } : {}),
                ...(targetProjectCwd ? { projectCwd: targetProjectCwd } : {}),
                worktreePath,
                ...(tracked
                  ? {
                      observeCompletion: {
                        onOutputLine: (line) =>
                          worktreeSetupTracker.appendTail(threadId, "setup-script", line),
                      },
                    }
                  : {}),
              })
              .pipe(
                Effect.matchEffect({
                  onFailure: (error) =>
                    recordSetupScriptLaunchFailure({
                      error,
                      requestedAt,
                      worktreePath,
                    }).pipe(
                      Effect.andThen(
                        track(
                          worktreeSetupTracker.stageStatus(
                            threadId,
                            "setup-script",
                            "failed",
                            "failed to start",
                          ),
                        ),
                      ),
                      Effect.as(null),
                    ),
                  onSuccess: (setupResult) => {
                    if (setupResult.status !== "started") {
                      return track(
                        worktreeSetupTracker.stageStatus(
                          threadId,
                          "setup-script",
                          "skipped",
                          "no setup script",
                        ),
                      ).pipe(Effect.as(null));
                    }
                    setupTerminalId = setupResult.terminalId;
                    return recordSetupScriptStarted({
                      requestedAt,
                      worktreePath,
                      scriptId: setupResult.scriptId,
                      scriptName: setupResult.scriptName,
                      terminalId: setupResult.terminalId,
                    }).pipe(
                      Effect.andThen(
                        track(
                          worktreeSetupTracker.update(threadId, (snapshot) => ({
                            ...snapshot,
                            setupScript: {
                              name: setupResult.scriptName,
                              command: setupResult.scriptCommand,
                              terminalId: setupResult.terminalId,
                            },
                          })),
                        ),
                      ),
                      Effect.as(setupResult),
                    );
                  },
                }),
              );
            if (!tracked || !setupResult?.completion) {
              return null;
            }
            // The setup script is best effort, like the untracked path: a
            // failed install must not throw away the worktree the user just
            // waited for. The card keeps the failed stage and its terminal.
            // Forked right away so the terminal listener behind `completion`
            // is always consumed, even when the turn dispatch fails before
            // anyone would otherwise wait on it. The tracker update is a
            // no-op once the snapshot has been dropped.
            const completionFiber = yield* setupResult.completion.pipe(
              Effect.flatMap((completion) => {
                if (completion.exitCode === 0) {
                  return worktreeSetupTracker.stageStatus(threadId, "setup-script", "done");
                }
                const detail =
                  completion.exitCode === null
                    ? "terminal closed before the script finished"
                    : `exit ${completion.exitCode}`;
                return worktreeSetupTracker.stageStatus(threadId, "setup-script", "failed", detail);
              }),
              Effect.forkDetach,
            );
            if (!setupResult.async) {
              yield* Fiber.join(completionFiber);
              return null;
            }
            return completionFiber;
          });

        const bootstrapProgram = Effect.gen(function* () {
          const prepareWorktree = bootstrap?.prepareWorktree;
          let shouldPrepareWorktree = prepareWorktree
            ? yield* gitWorkflow.isRepository(prepareWorktree.projectCwd)
            : false;
          // Name the branch from the message while the fetch and checkout
          // run, so the agent and setup script start on the final branch
          // instead of watching the temporary one get renamed under them.
          // A deferred turn has no message yet; the first turn renames the branch instead.
          const branchNameFiber =
            !deferTurn &&
            prepareWorktree?.branch !== undefined &&
            shouldPrepareWorktree &&
            isTemporaryWorktreeBranch(prepareWorktree.branch)
              ? yield* resolveBootstrapProjectSettings({
                  threadId,
                  projectId: targetProjectId ?? null,
                }).pipe(
                  Effect.flatMap((settings) =>
                    settings
                      ? generateWorktreeBranchName(
                          { textGeneration, providerRegistry },
                          {
                            cwd: prepareWorktree.projectCwd,
                            messageText: assistantCitationsToPlainText(command.message.text),
                            attachments: command.message.attachments,
                            settings,
                          },
                        )
                      : Effect.succeed(null),
                  ),
                  Effect.catchCause((cause) =>
                    Effect.logWarning("worktree bootstrap failed to generate a branch name", {
                      threadId,
                      cause: Cause.pretty(cause),
                    }).pipe(Effect.as(null)),
                  ),
                  Effect.forkChild,
                )
              : null;
          let worktreeBaseRef = prepareWorktree?.baseBranch ?? null;

          if (prepareWorktree && shouldPrepareWorktree) {
            // "Start from origin" is a stored default; repos without the
            // requested remote branch fall back to the local base branch.
            const startFromOrigin =
              prepareWorktree.startFromOrigin === true &&
              (yield* gitWorkflow.remoteExists({
                cwd: prepareWorktree.projectCwd,
                remoteName: "origin",
              }));
            if (startFromOrigin) {
              yield* track(worktreeSetupTracker.stageStatus(threadId, "fetch", "running"));
              yield* gitWorkflow.fetchRemote({
                cwd: prepareWorktree.projectCwd,
                remoteName: "origin",
                refName: prepareWorktree.baseBranch,
              });
              const remoteBaseExists = yield* gitWorkflow.remoteBranchExists({
                cwd: prepareWorktree.projectCwd,
                refName: prepareWorktree.baseBranch,
                remoteName: "origin",
              });
              if (remoteBaseExists) {
                const resolvedRemoteBase = yield* gitWorkflow.resolveRemoteTrackingCommit({
                  cwd: prepareWorktree.projectCwd,
                  refName: prepareWorktree.baseBranch,
                  fallbackRemoteName: "origin",
                });
                worktreeBaseRef = resolvedRemoteBase.commitSha;
                yield* track(
                  worktreeSetupTracker.stageStatus(
                    threadId,
                    "fetch",
                    "done",
                    `origin/${prepareWorktree.baseBranch} at ${resolvedRemoteBase.commitSha.slice(0, 7)}`,
                  ),
                );
              } else {
                yield* track(
                  worktreeSetupTracker.stageStatus(
                    threadId,
                    "fetch",
                    "warning",
                    `origin/${prepareWorktree.baseBranch} not found, using local branch`,
                  ),
                );
              }
            } else {
              yield* track(worktreeSetupTracker.stageStatus(threadId, "fetch", "skipped"));
            }

            const resolvedWorktreeBaseRef = worktreeBaseRef ?? prepareWorktree.baseBranch;
            shouldPrepareWorktree = yield* gitWorkflow.hasCommit({
              cwd: prepareWorktree.projectCwd,
              refName: resolvedWorktreeBaseRef,
            });
            worktreeBaseRef = resolvedWorktreeBaseRef;
            yield* track(
              worktreeSetupTracker.update(threadId, (snapshot) => ({
                ...snapshot,
                baseRef: resolvedWorktreeBaseRef,
              })),
            );
          }

          if (prepareWorktree && !shouldPrepareWorktree) {
            if (prepareWorktree.requireWorktree) {
              return yield* new OrchestrationDispatchCommandError({
                message:
                  "A separate worktree requires a Git repository and a base branch with a commit.",
              });
            }
            // Not a git repo, or the base has no commit: the thread runs in
            // the project checkout instead. The card says so and moves on.
            yield* track(
              worktreeSetupTracker.update(threadId, (snapshot) => ({
                ...snapshot,
                stages: snapshot.stages.map((stage) =>
                  stage.id === "fetch" || stage.id === "checkout" || stage.id === "submodules"
                    ? { ...stage, status: "skipped", detail: "using project checkout" }
                    : stage,
                ),
              })),
            );
          }

          if (bootstrap?.createThread) {
            const created = yield* dispatchFromClient({
              type: "thread.create",
              commandId: yield* serverCommandId("bootstrap-thread-create"),
              threadId: command.threadId,
              projectId: bootstrap.createThread.projectId,
              title: bootstrap.createThread.title,
              modelSelection: bootstrap.createThread.modelSelection,
              runtimeMode: bootstrap.createThread.runtimeMode,
              interactionMode: bootstrap.createThread.interactionMode,
              branch: bootstrap.createThread.branch,
              worktreePath: bootstrap.createThread.worktreePath,
              createdAt: bootstrap.createThread.createdAt,
              ...(bootstrap.createThread.createdBy !== undefined
                ? { createdBy: bootstrap.createThread.createdBy }
                : {}),
            });
            // The successful create is a fence in the engine command queue:
            // every delete for the prior incarnation committed before it.
            // Drain through that event before setup or turn start can own
            // terminals and provider sessions under the reused thread id.
            createdThread = true;
            createdThreadSequence = created.sequence;
            yield* threadDeletionReactor.drainThrough(created.sequence);
            // Persist the send now rather than with the turn: the thread is
            // real from here on, so any client (or a reload) sees the message
            // while the worktree is still being prepared. The turn start
            // later references this id instead of re-sending the text.
            if (!deferTurn) {
              yield* dispatchFromClient({
                type: "thread.message.user.append",
                commandId: yield* serverCommandId("bootstrap-thread-message"),
                threadId: command.threadId,
                message: {
                  messageId: command.message.messageId,
                  text: command.message.text,
                  attachments: command.message.attachments,
                  ...(command.message.context !== undefined
                    ? { context: command.message.context }
                    : {}),
                },
                createdAt: command.createdAt,
              });
            }
            if (tracked) {
              const running = yield* worktreeSetupTracker.get(threadId);
              if (running) yield* recordWorktreeSetup(running);
            }
          }

          if (prepareWorktree && shouldPrepareWorktree && worktreeBaseRef) {
            // A deferred turn leaves no session behind: a placeholder would
            // outlive the setup and read as a started conversation.
            if (bootstrap?.createThread && createdThread && !deferTurn) {
              // The checkout and setup script can run for minutes before the
              // turn starts, and the created thread carries no message or
              // turn until then. Project a starting session now so every
              // client lists the thread as working and a reopened thread
              // knows to follow the setup stream. A failed or cancelled setup
              // deletes the thread, so nothing lingers.
              const preparingAt = yield* nowIso;
              yield* dispatchFromClient({
                type: "thread.session.set",
                commandId: yield* serverCommandId("bootstrap-thread-preparing"),
                threadId,
                session: {
                  threadId,
                  status: "starting",
                  providerName: null,
                  providerInstanceId: bootstrap.createThread.modelSelection.instanceId,
                  runtimeMode: command.runtimeMode,
                  activeTurnId: null,
                  lastError: null,
                  updatedAt: preparingAt,
                },
                createdAt: preparingAt,
              });
              preparingSessionSet = true;
            }
            yield* worktreeSetupTracker.stageStatus(threadId, "checkout", "running");
            let checkoutTotal: number | null = null;
            const submodules =
              (yield* resolveBootstrapProjectSettings({
                threadId,
                projectId: targetProjectId ?? null,
              }))?.worktreeSubmodules ?? null;
            const worktree = yield* gitWorkflow.createWorktree(
              {
                cwd: prepareWorktree.projectCwd,
                refName: worktreeBaseRef,
                newRefName: prepareWorktree.branch,
                baseRefName: prepareWorktree.baseBranch,
                path: null,
              },
              {
                submodules,
                progress: {
                  // Git has registered the directory at this point, so a
                  // cancel during the submodule step can still remove it.
                  onWorktreeClaimed: (path) =>
                    Effect.sync(() => {
                      targetWorktreePath = path;
                    }),
                  onCheckoutProgress: ({ percent, completed, total }) => {
                    checkoutTotal = total;
                    return worktreeSetupTracker.stage(threadId, "checkout", {
                      percent,
                      detail: `${completed.toLocaleString("en-US")} / ${total.toLocaleString("en-US")} files`,
                    });
                  },
                  onSubmodulesStarted: () =>
                    worktreeSetupTracker
                      .stageStatus(
                        threadId,
                        "checkout",
                        "done",
                        checkoutTotal === null
                          ? null
                          : `${checkoutTotal.toLocaleString("en-US")} files`,
                      )
                      .pipe(
                        Effect.andThen(
                          worktreeSetupTracker.stageStatus(threadId, "submodules", "running"),
                        ),
                      ),
                  onSubmodulesDisabled: ({ source }) =>
                    worktreeSetupTracker.stageStatus(
                      threadId,
                      "submodules",
                      "skipped",
                      `disabled in ${source}`,
                    ),
                  onSubmoduleLine: (line) => {
                    const submodulePath = /Submodule path '([^']+)'/.exec(line)?.[1];
                    return submodulePath === undefined
                      ? Effect.void
                      : worktreeSetupTracker.stage(threadId, "submodules", {
                          detail: submodulePath,
                        });
                  },
                  onSubmodulesFinished: ({ ok, detail }) =>
                    worktreeSetupTracker.stageStatus(
                      threadId,
                      "submodules",
                      ok ? "done" : "warning",
                      ok ? undefined : (detail ?? "submodule checkout failed"),
                    ),
                },
              },
            );
            const checkoutEndedAt = yield* nowIso;
            yield* worktreeSetupTracker.update(threadId, (snapshot) => ({
              ...snapshot,
              worktreePath: worktree.worktree.path,
              stages: snapshot.stages.map((stage) => {
                if (stage.id === "checkout" && stage.status === "running") {
                  return {
                    ...stage,
                    status: "done",
                    percent: 100,
                    endedAt: checkoutEndedAt,
                    detail:
                      checkoutTotal === null
                        ? stage.detail
                        : `${checkoutTotal.toLocaleString("en-US")} files`,
                  };
                }
                if (stage.id === "submodules" && stage.status === "pending") {
                  return { ...stage, status: "skipped", detail: "none" };
                }
                return stage;
              }),
            }));
            targetWorktreePath = worktree.worktree.path;
            // A slow or failed name keeps the temporary branch; the provider
            // command reactor then renames it once the turn is under way.
            const generatedBranch = branchNameFiber
              ? Option.flatten(
                  yield* Fiber.join(branchNameFiber).pipe(
                    Effect.map(Option.fromNullishOr),
                    Effect.timeoutOption(BOOTSTRAP_BRANCH_NAME_TIMEOUT),
                  ),
                )
              : Option.none();
            const branch = Option.isSome(generatedBranch)
              ? yield* gitWorkflow
                  .renameBranch({
                    cwd: targetWorktreePath,
                    oldBranch: worktree.worktree.refName,
                    newBranch: generatedBranch.value,
                  })
                  .pipe(
                    Effect.map((renamed) => renamed.branch),
                    Effect.catchCause((cause) =>
                      Effect.logWarning("worktree bootstrap failed to rename branch", {
                        threadId,
                        cause: Cause.pretty(cause),
                      }).pipe(Effect.as(worktree.worktree.refName)),
                    ),
                  )
              : worktree.worktree.refName;
            yield* dispatchFromClient({
              type: "thread.meta.update",
              commandId: yield* serverCommandId("bootstrap-thread-meta-update"),
              threadId,
              branch,
              worktreePath: targetWorktreePath,
            });
            yield* refreshGitStatus(targetWorktreePath);
          }

          // Attached repositories go in before the setup script, so the
          // script (and then the agent) can rely on them being there.
          if (repositoryRecords.length > 0 && !deferTurn) {
            const workspaceCwd =
              targetWorktreePath ??
              targetProjectCwd ??
              (targetProjectId ? yield* resolveProjectWorkspaceRoot(targetProjectId) : null);
            if (workspaceCwd) {
              const total = repositoryRecords.length;
              let finished = 0;
              const lastPercent = new Map<string, number>();
              yield* track(
                worktreeSetupTracker.stageStatus(
                  threadId,
                  "context-repositories",
                  "running",
                  `0 of ${total}`,
                ),
              );
              const ensured = yield* ensureTurnContextRepositories(
                finalTurnStartCommand,
                workspaceCwd,
                (event) => {
                  switch (event.type) {
                    case "started":
                      return Effect.void;
                    case "clone-progress": {
                      // Git redraws its counters many times a second; only
                      // whole steps of 10% reach the card.
                      const percent = event.line.percent ?? 0;
                      const key = `${event.record.contextId}:${event.line.stage}`;
                      const step = Math.floor(percent / 10);
                      if (lastPercent.get(key) === step) return Effect.void;
                      lastPercent.set(key, step);
                      return track(
                        worktreeSetupTracker.stage(threadId, "context-repositories", {
                          detail: `${finished} of ${total} · ${event.record.nameWithOwner} ${event.line.stage} ${percent}%`,
                        }),
                      );
                    }
                    case "finished": {
                      finished += 1;
                      const { outcome, record } = event;
                      const progress = worktreeSetupTracker.stage(
                        threadId,
                        "context-repositories",
                        { detail: `${finished} of ${total}` },
                      );
                      // Only problems reach the tail; the card shows it under a warning.
                      const problem =
                        outcome.status === "failed" || outcome.status === "conflict"
                          ? worktreeSetupTracker.appendTail(
                              threadId,
                              "context-repositories",
                              `${record.nameWithOwner}: ${outcome.detail ?? outcome.status}`,
                            )
                          : Effect.void;
                      return track(progress.pipe(Effect.andThen(problem)));
                    }
                  }
                },
              );
              finalTurnStartCommand = ensured.command;
              const summary = summarizeContextRepositoryOutcomes(ensured.ensured);
              yield* track(
                worktreeSetupTracker.stageStatus(
                  threadId,
                  "context-repositories",
                  summary.ok ? "done" : "warning",
                  summary.detail,
                ),
              );
            } else {
              yield* track(
                worktreeSetupTracker.stageStatus(
                  threadId,
                  "context-repositories",
                  "skipped",
                  "no workspace",
                ),
              );
            }
          }

          const pendingSetupScript = yield* runSetupProgram();

          let started: { readonly sequence: number };
          if (deferTurn) {
            // The workspace is ready; a cancel now would only roll back a finished setup.
            yield* track(worktreeSetupTracker.markUncancellable(threadId));
            // No agent will run beside an async script (often a dev server that never
            // exits), so starting it is where setup ends; it keeps running in its terminal.
            if (pendingSetupScript) {
              yield* track(
                worktreeSetupTracker.stageStatus(
                  threadId,
                  "setup-script",
                  "done",
                  "running in its terminal",
                ),
              );
            }
            started = { sequence: createdThreadSequence };
          } else {
            yield* track(worktreeSetupTracker.stageStatus(threadId, "agent", "running"));
            // Past this point a cancel would roll back a thread whose turn has
            // started. Drop the cancel handle and make the handoff atomic.
            yield* track(worktreeSetupTracker.markUncancellable(threadId));
            started = yield* Effect.uninterruptible(dispatchFromClient(finalTurnStartCommand));
            yield* track(worktreeSetupTracker.stageStatus(threadId, "agent", "done"));
          }
          // An async setup script outlives the handoff: the snapshot stays
          // running so the client keeps its row next to the agent's work,
          // and settles when the script exits. The turn already started, so
          // the wait cannot fail the dispatch.
          const settle = tracked
            ? worktreeSetupTracker
                .finish(threadId, "done")
                .pipe(
                  Effect.flatMap((snapshot) =>
                    snapshot ? recordWorktreeSetup(snapshot) : Effect.void,
                  ),
                )
            : Effect.void;
          if (pendingSetupScript && !deferTurn) {
            yield* Fiber.join(pendingSetupScript).pipe(
              Effect.ignoreCause({ log: true }),
              Effect.andThen(settle),
              Effect.forkDetach,
            );
          } else {
            yield* settle;
          }
          return started;
        });

        const cleanupAndFail = (
          cause: Cause.Cause<unknown>,
          dispatchError: OrchestrationDispatchCommandError,
        ) =>
          Effect.uninterruptible(cleanupCreatedThread()).pipe(
            Effect.matchCauseEffect({
              onFailure: (cleanupCause) =>
                Effect.logWarning("bootstrap thread cleanup failed", {
                  threadId,
                  detail: Cause.pretty(cleanupCause),
                }).pipe(
                  // The thread outlived its setup. Its preparing session
                  // must not read as working forever, so record the failure
                  // on it instead.
                  Effect.andThen(
                    preparingSessionSet
                      ? markPreparingSessionFailed(dispatchError.message).pipe(
                          Effect.ignoreCause({ log: true }),
                        )
                      : Effect.void,
                  ),
                  Effect.flatMap(() => Effect.fail(dispatchError)),
                ),
              onSuccess: (threadDeleted) =>
                Effect.fail(
                  threadDeleted ||
                    (bootstrap?.createThread &&
                      bootstrap.prepareWorktree?.requireWorktree === true &&
                      !createdThread)
                    ? new OrchestrationDispatchCommandError({
                        message: dispatchError.message,
                        ...(dispatchError.cause !== undefined
                          ? { cause: dispatchError.cause }
                          : {}),
                        bootstrapThreadDisposition: threadDeleted ? "deleted" : "not-created",
                      })
                    : dispatchError,
                ),
            }),
          );

        const settledBootstrapProgram = bootstrapProgram.pipe(
          Effect.interruptible,
          Effect.catchCause((cause) => {
            const dispatchError = toBootstrapDispatchCommandCauseError(cause);
            if (Cause.hasInterruptsOnly(cause)) {
              // A user cancel interrupts the forked bootstrap fiber. The
              // created thread is rolled back like any other failure so the
              // draft returns to the composer. The setup terminal is closed
              // first so a still-running script cannot hold files open in
              // the worktree while git removes it. Closing kills the
              // process asynchronously, so the removal retries briefly.
              const closeSetupTerminal = setupTerminalId
                ? terminalManager.close({
                    threadId,
                    terminalId: setupTerminalId,
                    deleteHistory: true,
                  })
                : Effect.void;
              const removeCreatedWorktree =
                tracked && targetWorktreePath && bootstrap?.prepareWorktree
                  ? closeSetupTerminal.pipe(
                      Effect.ignoreCause({ log: true }),
                      Effect.andThen(
                        gitWorkflow
                          .removeWorktree({
                            cwd: bootstrap.prepareWorktree.projectCwd,
                            path: targetWorktreePath,
                            force: true,
                          })
                          .pipe(
                            Effect.retry({ times: 4, schedule: Schedule.spaced("500 millis") }),
                          ),
                      ),
                      Effect.ignoreCause({ log: true }),
                      Effect.uninterruptible,
                    )
                  : Effect.void;
              return track(
                worktreeSetupTracker
                  .finish(threadId, "cancelled")
                  .pipe(
                    Effect.flatMap((snapshot) =>
                      snapshot ? recordWorktreeSetup(snapshot) : Effect.void,
                    ),
                  ),
              ).pipe(
                Effect.andThen(removeCreatedWorktree),
                Effect.andThen(
                  tracked
                    ? cleanupAndFail(
                        cause,
                        new OrchestrationDispatchCommandError({
                          message: "Worktree setup cancelled.",
                        }),
                      )
                    : Effect.fail(dispatchError),
                ),
              );
            }
            return track(
              worktreeSetupTracker
                .finish(threadId, "failed", dispatchError.message)
                .pipe(
                  Effect.flatMap((snapshot) =>
                    snapshot ? recordWorktreeSetup(snapshot) : Effect.void,
                  ),
                ),
            ).pipe(Effect.andThen(cleanupAndFail(cause, dispatchError)));
          }),
          // Cancellation must finish recording and rollback after the bootstrap is interrupted.
          Effect.uninterruptible,
        );

        // The bootstrap outlives the connection that asked for it: a reload
        // or a dropped socket must not abandon a half-made worktree, and
        // the thread it created is already visible to every client. The
        // RPC only waits on the detached fiber; a user cancel interrupts it
        // through the tracker.
        const runBootstrap = tracked
          ? Effect.gen(function* () {
              // Fork and register as one step: a detached fiber keeps going
              // if the caller is interrupted, so it must never exist without
              // the tracker entry that cancel and the stage updates key on.
              const fiber = yield* Effect.uninterruptible(
                Effect.gen(function* () {
                  const fiber = yield* Effect.forkDetach(settledBootstrapProgram);
                  yield* worktreeSetupTracker.begin({
                    threadId,
                    branch: bootstrap?.prepareWorktree?.branch ?? null,
                    baseRef: bootstrap?.prepareWorktree?.baseBranch ?? null,
                    stages: deferTurn
                      ? ["fetch", "checkout", "submodules", "setup-script"]
                      : [
                          "fetch",
                          "checkout",
                          "submodules",
                          ...(repositoryRecords.length > 0
                            ? (["context-repositories"] as const)
                            : []),
                          "setup-script",
                          "agent",
                        ],
                    fiber,
                  });
                  return fiber;
                }),
              );
              return yield* Fiber.join(fiber);
            })
          : settledBootstrapProgram;

        return yield* runBootstrap;
      });

    // A follow-up (or a first send into an existing workspace) clones before
    // the turn is recorded, so the message lands with its outcomes.
    const dispatchTurnStartWithContextRepositories = (
      command: Extract<OrchestrationCommand, { type: "thread.turn.start" }>,
    ) =>
      Effect.gen(function* () {
        const cwd = yield* resolveThreadWorkspaceCwd(command.threadId);
        if (!cwd) return yield* dispatchFromClient(command);
        const records = messageRepositoryRecords(command.message.context);
        const total = records.length;
        const startedAt = yield* nowIso;
        let finished = 0;
        let current: string | null = null;
        const lastStep = new Map<string, number>();
        // With no setup card here, the work log carries the progress: one
        // row per message, upserted by a fixed id, like the setup record.
        const recordProgress = (input: {
          readonly summary: string;
          readonly detail: string;
          readonly tone: "info" | "error";
        }) =>
          Effect.gen(function* () {
            yield* dispatchFromClient({
              type: "thread.activity.append",
              commandId: yield* serverCommandId("context-repositories-activity"),
              threadId: command.threadId,
              activity: {
                id: EventId.make(`context-repositories:${command.message.messageId}`),
                tone: input.tone,
                kind: "context-repositories",
                summary: input.summary,
                payload: { detail: input.detail },
                turnId: null,
                createdAt: startedAt,
              },
              createdAt: yield* nowIso,
            });
          }).pipe(Effect.ignoreCause({ log: true }));
        const running = (detail: string) =>
          recordProgress({ summary: "Cloning context repositories", detail, tone: "info" });

        yield* running(`0 of ${total}`);
        const ensured = yield* ensureTurnContextRepositories(command, cwd, (event) => {
          switch (event.type) {
            case "started":
              current = event.record.nameWithOwner;
              return running(`${finished} of ${total} · ${current}`);
            case "clone-progress": {
              // Each update is a persisted event, so only quarter steps of
              // the transfer are recorded.
              if (event.line.stage !== "receiving" || event.line.percent === null) {
                return Effect.void;
              }
              const step = Math.floor(event.line.percent / 25);
              if (lastStep.get(event.record.contextId) === step) return Effect.void;
              lastStep.set(event.record.contextId, step);
              return running(
                `${finished} of ${total} · ${event.record.nameWithOwner} ${event.line.percent}%`,
              );
            }
            case "finished":
              finished += 1;
              return running(`${finished} of ${total}`);
          }
        });
        const summary = summarizeContextRepositoryOutcomes(ensured.ensured);
        yield* recordProgress({
          summary: summary.ok
            ? "Context repositories ready"
            : "Some context repositories are not available",
          detail: ensured.ensured
            .map((record) => `${record.nameWithOwner}: ${describeContextRepositoryOutcome(record)}`)
            .join("\n"),
          tone: summary.ok ? "info" : "error",
        });
        return yield* dispatchFromClient(ensured.command);
      }).pipe(
        Effect.mapError((cause) =>
          toDispatchCommandError(cause, "Failed to dispatch orchestration command"),
        ),
      );

    const dispatchNormalizedCommand = (
      normalizedCommand: OrchestrationCommand,
    ): Effect.Effect<{ readonly sequence: number }, OrchestrationDispatchCommandError> => {
      const dispatchEffect =
        normalizedCommand.type === "thread.turn.start" && normalizedCommand.bootstrap
          ? dispatchBootstrapTurnStart(normalizedCommand)
          : normalizedCommand.type === "thread.turn.start" &&
              messageRepositoryRecords(normalizedCommand.message.context).length > 0
            ? dispatchTurnStartWithContextRepositories(normalizedCommand)
            : dispatchFromClient(normalizedCommand).pipe(
                Effect.tap(({ sequence }) =>
                  // Returning from thread.create is the handoff point at which
                  // clients may start resources for the new incarnation. Use
                  // its event sequence as the exact deletion-cleanup fence.
                  normalizedCommand.type === "thread.create"
                    ? threadDeletionReactor.drainThrough(sequence)
                    : Effect.void,
                ),
                Effect.mapError((cause) =>
                  toDispatchCommandError(cause, "Failed to dispatch orchestration command"),
                ),
              );

      return startup
        .enqueueCommand(dispatchEffect)
        .pipe(
          Effect.mapError((cause) =>
            toDispatchCommandError(cause, "Failed to dispatch orchestration command"),
          ),
        );
    };

    const dispatch: ClientCommandDispatch["dispatch"] = (normalizedCommand) =>
      Effect.gen(function* () {
        yield* ProjectCloneTracker.rejectCommandsDuringClone(
          projectCloneTracker,
          normalizedCommand,
        );
        // Archive removes the thread from every client, so its session and
        // terminals close after the command lands. Settlement cleanup is
        // driven by thread.settled events in the provider reactor, including
        // settlements that have no client.
        const archiveCommand =
          normalizedCommand.type === "thread.archive" ? normalizedCommand : undefined;
        // Best-effort on purpose: the user's archive must not
        // fail because this cleanup read blipped, so a failed read
        // logs and skips the stop instead of propagating.
        const shouldStopSessionAfterCommand = archiveCommand
          ? yield* projectionSnapshotQuery.getThreadShellById(archiveCommand.threadId).pipe(
              Effect.map(
                Option.match({
                  onNone: () => false,
                  onSome: (thread) =>
                    thread.session !== null && thread.session.status !== "stopped",
                }),
              ),
              Effect.catchCause((cause) =>
                Effect.logWarning("failed to read thread session state before session-stop check", {
                  threadId: archiveCommand.threadId,
                  cause,
                }).pipe(Effect.as(false)),
              ),
            )
          : false;
        const result = yield* dispatchNormalizedCommand(normalizedCommand);
        yield* ProjectCloneTracker.discardCloneForDeletedProject(
          projectCloneTracker,
          normalizedCommand,
        );
        if (archiveCommand) {
          if (shouldStopSessionAfterCommand) {
            yield* Effect.gen(function* () {
              const stopCommand = yield* normalizeDispatchCommand({
                type: "thread.session.stop",
                commandId: CommandId.make(`session-stop-for-archive:${archiveCommand.commandId}`),
                threadId: archiveCommand.threadId,
                createdAt: yield* nowIso,
              });

              yield* dispatchNormalizedCommand(stopCommand);
            }).pipe(
              Effect.provideContext(normalizerContext),
              Effect.catchCause((cause) =>
                Effect.logWarning("failed to stop provider session during archive", {
                  threadId: archiveCommand.threadId,
                  cause,
                }),
              ),
            );
          }

          // Archive removes the thread from view, so its user-opened
          // terminal panes close with it.
          yield* terminalManager.close({ threadId: archiveCommand.threadId }).pipe(
            Effect.catch((error) =>
              Effect.logWarning("failed to close thread terminals after archive", {
                threadId: archiveCommand.threadId,
                error: error.message,
              }),
            ),
          );
        }
        return result;
      });

    return { dispatch };
  };

  return ClientCommandDispatcher.of({ forOrigin });
});

export const layer = Layer.effect(ClientCommandDispatcher, make);
