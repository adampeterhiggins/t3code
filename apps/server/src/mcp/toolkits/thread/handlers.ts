import {
  CommandId,
  type RuntimeRequestId,
  ThreadId,
  type OrchestrationV2ThreadProjection,
  type RunId,
  OrchestratorMcpFailure,
  type OrchestrationV2Command,
  type OrchestrationV2ThreadMoveWorkspaceStrategy,
  type ProjectId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import { modelSelectionCommandType } from "@t3tools/shared/model";
import { formatThreadLink } from "@t3tools/shared/threadLinks";

import * as McpToolAccess from "../../McpToolAccess.ts";
import {
  dispatchFailure,
  newCommandId,
  readCaller,
  readThread,
  unavailable,
} from "../../threadAccess.ts";
import * as Option from "effect/Option";
import * as ThreadTabs from "../../../threadTabs/ThreadTabs.ts";
import * as GitWorkflow from "../../../git/GitWorkflowService.ts";
import * as Project from "../../../project/ProjectService.ts";
import * as ProjectSetupScriptRunner from "../../../project/ProjectSetupScriptRunner.ts";
import * as GitVcsDriver from "../../../vcs/GitVcsDriver.ts";
import { assertProjectWorktree } from "../project/handlers.ts";
import * as ThreadSearch from "../../../orchestration-v2/ThreadSearch.ts";
import * as ScheduledTasks from "../../../scheduledTasks/ScheduledTaskService.ts";
import { queuedRunsInDeliveryOrder } from "../../../orchestration-v2/QueuedRunOrder.ts";
import { ThreadToolkit } from "./tools.ts";

function queueEntry(
  projection: Pick<OrchestrationV2ThreadProjection, "runs" | "messages">,
  runId: RunId,
  limit: number,
) {
  const run = projection.runs.find((run) => run.id === runId && run.status === "queued");
  const message = projection.messages.find((message) => message.id === run?.userMessageId);
  if (run === undefined || message === undefined) return undefined;
  const characters = Array.from(message.text);
  return {
    queuedRunId: run.id,
    text: characters.slice(0, limit).join(""),
    truncated: characters.length > limit,
  };
}
const dispatch = Effect.fn("mcp.dispatchThreadCommand")(function* (
  threadId: ThreadId | undefined,
  command: (common: { commandId: CommandId; threadId: ThreadId }) => OrchestrationV2Command,
) {
  const { threads, projection } = yield* readThread(threadId);
  const result = yield* threads
    .dispatch(command({ commandId: yield* newCommandId(), threadId: projection.thread.id }))
    .pipe(Effect.mapError(dispatchFailure));
  return { sequence: result.sequence };
});

const readQuestion = Effect.fn("mcp.readQuestion")(function* (input: {
  threadId?: ThreadId | undefined;
  requestId: RuntimeRequestId;
}) {
  const context = yield* readThread(input.threadId, ["runtimeRequests", "turnItems"]);
  const request = context.projection.runtimeRequests.find(
    (request) => request.id === input.requestId && request.kind === "user_input",
  );
  const item = context.projection.turnItems.find(
    (item) => item.type === "user_input_request" && item.requestId === input.requestId,
  );
  if (request === undefined || item?.type !== "user_input_request")
    return yield* new OrchestratorMcpFailure({
      code: "invalid_request",
      message: "The pending user-input request was not found.",
    });
  if (request.status !== "pending")
    return yield* new OrchestratorMcpFailure({
      code: "invalid_request",
      message:
        request.status === "resolved"
          ? "The user-input request was already answered."
          : `The user-input request is no longer pending (${request.status}).`,
    });
  return { ...context, request, item };
});
/** A field the chosen action needs. `null` counts as given, as in `beforeRunId: null`. */
const required = <A>(value: A | undefined, name: string) =>
  value === undefined
    ? Effect.fail(
        new OrchestratorMcpFailure({
          code: "invalid_request",
          message: `This action needs \`${name}\`.`,
        }),
      )
    : Effect.succeed(value);
const writesThread = <P extends { readonly threadId?: ThreadId | undefined }, A, E, R>(
  handle: (params: P) => Effect.Effect<A, E, R>,
) => McpToolAccess.writesThreads((params: P) => [params.threadId], handle);

/** Chat tabs are fork-owned and served only where their service is provided. */
const threadTabs = Effect.serviceOption(ThreadTabs.ThreadTabs).pipe(
  Effect.flatMap(
    Effect.fromOption(
      () =>
        new OrchestratorMcpFailure({
          code: "capability_denied",
          message: "Chat-tab groups are unavailable.",
        }),
    ),
  ),
);

const invalidMove = (message: string) =>
  new OrchestratorMcpFailure({ code: "invalid_request", message });

/**
 * The checkout a moving thread lands in. A pull request is checked out before
 * the move, as a launch does, so a move that cannot reach it changes nothing;
 * repeating it reuses the checkout. `created` marks a worktree this call added.
 */
const resolveMoveCheckout = Effect.fn("mcp.resolveMoveCheckout")(function* (
  projectId: ProjectId,
  strategy: OrchestrationV2ThreadMoveWorkspaceStrategy,
) {
  const project = yield* Project.ProjectService.pipe(
    Effect.flatMap((projects) => projects.getById(projectId)),
    Effect.mapError(unavailable),
    Effect.map(Option.getOrUndefined),
  );
  if (project === undefined) return yield* invalidMove("The destination project was not found.");
  const git = yield* GitWorkflow.GitWorkflowService;
  if (strategy.type === "existing_worktree") {
    yield* assertProjectWorktree(project.workspaceRoot, strategy.worktreePath);
    const branch =
      strategy.branch ??
      (yield* git.localStatus({ cwd: strategy.worktreePath }).pipe(
        Effect.map((status) => status.refName),
        Effect.orElseSucceed(() => null),
      ));
    return { project, worktreePath: strategy.worktreePath, branch, created: false };
  }
  const driver = yield* GitVcsDriver.GitVcsDriver;
  const worktreesBefore = yield* driver
    .listWorktreePaths(project.workspaceRoot)
    .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
  const prepared = yield* git
    .preparePullRequestThread({
      cwd: project.workspaceRoot,
      reference: strategy.reference,
      mode: strategy.mode ?? "worktree",
    })
    .pipe(
      Effect.mapError((cause) =>
        invalidMove(
          `Could not check out pull request ${strategy.reference}: ${cause.message} The thread was not moved.`,
        ),
      ),
    );
  return {
    project,
    worktreePath: prepared.worktreePath,
    branch: prepared.branch,
    created: prepared.worktreePath !== null && !worktreesBefore.includes(prepared.worktreePath),
  };
});

/** The service's own refusals are for the agent to read; anything else stays opaque. */
const tabsFailure = (error: ThreadTabs.ThreadTabsError) =>
  error.reason === "thread_not_found" || error.reason === "invalid_request"
    ? new OrchestratorMcpFailure({ code: error.reason, message: error.detail })
    : unavailable();

export const layer = McpToolAccess.toLayer(ThreadToolkit, {
  t3_thread_move: McpToolAccess.writesEnvironment((input) =>
    Effect.gen(function* () {
      const { threads, projection, scope } = yield* readThread(input.threadId);
      const requestId = input.clientRequestId ?? (yield* newCommandId());
      const checkout =
        input.workspaceStrategy === undefined
          ? undefined
          : yield* resolveMoveCheckout(input.projectId, input.workspaceStrategy);
      const worktreePath = checkout?.worktreePath ?? null;
      const branch = checkout?.branch ?? null;
      // Moving the calling thread detaches its session, which can interrupt
      // this request; the setup script for the new worktree must still start.
      const result = yield* Effect.uninterruptible(
        Effect.gen(function* () {
          const moved = yield* threads
            .dispatch({
              type: "thread.project.move",
              commandId: CommandId.make(
                `mcp:${encodeURIComponent(scope.requestNamespace)}:thread-move:${encodeURIComponent(projection.thread.id)}:${encodeURIComponent(input.projectId)}:${encodeURIComponent(requestId)}`,
              ),
              threadId: projection.thread.id,
              projectId: input.projectId,
              ...(worktreePath === null ? {} : { worktreePath }),
              ...(branch === null ? {} : { branch }),
              ...(input.continuationPrompt === undefined
                ? {}
                : { continuationPrompt: input.continuationPrompt }),
            })
            .pipe(Effect.mapError(dispatchFailure));
          if (checkout?.created === true && worktreePath !== null) {
            const setupScripts = yield* ProjectSetupScriptRunner.ProjectSetupScriptRunner;
            yield* setupScripts
              .runForThread({
                threadId: projection.thread.id,
                projectId: input.projectId,
                projectCwd: checkout.project.workspaceRoot,
                worktreePath,
                project: {
                  id: checkout.project.id,
                  workspaceRoot: checkout.project.workspaceRoot,
                  scripts: checkout.project.scripts,
                },
              })
              .pipe(
                Effect.catchCause((cause) =>
                  Effect.logWarning("thread move setup script failed", {
                    threadId: projection.thread.id,
                    worktreePath,
                    cause,
                  }),
                ),
              );
          }
          return moved;
        }),
      );
      return {
        sequence: result.sequence,
        threadId: projection.thread.id,
        projectId: input.projectId,
        worktreePath,
        branch,
        continuationScheduled: input.continuationPrompt !== undefined,
      };
    }),
  ),
  t3_thread_group_name: writesThread((input) =>
    Effect.gen(function* () {
      const { projection } = yield* readThread(input.threadId);
      const tabs = yield* threadTabs;
      return yield* tabs
        .setName(projection.thread.id, input.name)
        .pipe(Effect.mapError(unavailable));
    }),
  ),
  t3_thread_tabs: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      const { projection } = yield* readThread(input.threadId);
      const tabs = yield* threadTabs;
      return yield* tabs.group(projection.thread.id).pipe(Effect.mapError(tabsFailure));
    }),
  ),
  // The new tab inherits its group's modes, or its fork source's, so both must sit within the
  // caller's limits; the orchestrator checks the fork source again when it copies them.
  t3_thread_tab_open: McpToolAccess.writesThreads(
    (input) => [input.threadId, input.fork?.sourceThreadId],
    (input) =>
      Effect.gen(function* () {
        const { projection, caller, scope } = yield* readThread(input.threadId);
        const tabs = yield* threadTabs;
        const threadId = ThreadId.make(yield* newCommandId());
        const opened = yield* tabs
          .open(projection.thread.id, {
            threadId,
            modelSelection: input.modelSelection,
            ...(input.fork === undefined
              ? {}
              : {
                  fork: {
                    sourceThreadId: input.fork.sourceThreadId ?? projection.thread.id,
                    runId: input.fork.runId,
                  },
                }),
            title: input.title,
            message: input.message,
            startedBy:
              caller !== undefined
                ? { kind: "thread", threadId: caller.id }
                : scope.client !== undefined
                  ? { kind: "agent-access", label: scope.client.label }
                  : undefined,
          })
          .pipe(Effect.mapError(tabsFailure));
        return { threadId, ...opened };
      }),
  ),
  run_scheduled_task_now: McpToolAccess.writesEnvironment((input) =>
    Effect.gen(function* () {
      const scheduler = yield* ScheduledTasks.ScheduledTaskService;
      const { tasks } = yield* scheduler.list().pipe(Effect.mapError(unavailable));
      if (!tasks.some((task) => task.id === input.taskId))
        return yield* new OrchestratorMcpFailure({
          code: "invalid_request",
          message: "The scheduled task was not found.",
        });
      const { task, threadId } = yield* scheduler
        .runNow({ id: input.taskId })
        .pipe(Effect.mapError(unavailable));
      return {
        taskId: task.id,
        threadId,
        lastRunStatus: task.lastRunStatus,
        runCount: task.runCount,
        nextRunAt: task.nextRunAt,
      };
    }),
  ),
  t3_thread_search: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      const { caller } = yield* readCaller();
      const threadSearch = yield* ThreadSearch.ThreadSearch;
      const { matches } = yield* threadSearch
        .searchThreads({ ...input, projectId: input.projectId ?? caller?.projectId })
        .pipe(Effect.mapError(unavailable));
      return {
        matches: matches.map((match) => ({
          ...match,
          link: formatThreadLink(match.threadId, match.title),
        })),
      };
    }),
  ),
  t3_thread_transfer: McpToolAccess.either(
    (input) => input.action === "status",
    McpToolAccess.reads((input) =>
      Effect.gen(function* () {
        const { projection } = yield* readThread(input.threadId, ["contextTransfers"]);
        return {
          transfers: projection.contextTransfers.map(
            ({ id, sourceThreadId, targetThreadId, status }) => ({
              id,
              sourceThreadId,
              targetThreadId,
              status,
            }),
          ),
        };
      }),
    ),
    McpToolAccess.writesThreads(
      (input) => [input.threadId, input.targetThreadId],
      (input) =>
        Effect.gen(function* () {
          const sourcePoint = input.sourcePoint ?? { type: "latest_stable" as const };
          const { threads, projection } = yield* readThread(input.threadId);
          const commandId = yield* newCommandId();
          if (input.action === "merge_back") {
            const targetThreadId = yield* required(input.targetThreadId, "targetThreadId");
            yield* readThread(targetThreadId);
            const result = yield* threads
              .dispatch({
                type: "thread.merge_back",
                commandId,
                sourceThreadId: projection.thread.id,
                targetThreadId,
                sourcePoint,
                createdBy: "agent",
                creationSource: "mcp",
              })
              .pipe(Effect.mapError(dispatchFailure));
            return { sequence: result.sequence, targetThreadId };
          }
          const targetThreadId = ThreadId.make(`${commandId}:fork`);
          const result = yield* threads
            .dispatch({
              type: "thread.fork",
              commandId,
              sourceThreadId: projection.thread.id,
              targetThreadId,
              sourcePoint,
              ...(input.title === undefined ? {} : { title: input.title }),
              createdBy: "agent",
              creationSource: "mcp",
            })
            .pipe(Effect.mapError(dispatchFailure));
          return { sequence: result.sequence, targetThreadId };
        }),
    ),
  ),
  t3_thread_configure: McpToolAccess.either(
    (input) => input.modelSelection === undefined,
    McpToolAccess.reads((input) =>
      Effect.gen(function* () {
        const {
          projection: { thread },
        } = yield* readThread(input.threadId);
        return {
          threadId: thread.id,
          modelSelection: thread.modelSelection,
          runtimeMode: thread.runtimeMode,
          interactionMode: thread.interactionMode,
        };
      }),
    ),
    writesThread((input) =>
      Effect.gen(function* () {
        const modelSelection = yield* required(input.modelSelection, "modelSelection");
        const {
          threads,
          projection: { thread },
        } = yield* readThread(input.threadId);
        const type = modelSelectionCommandType(thread.providerInstanceId, modelSelection);
        const result = yield* threads
          .dispatch({ type, threadId: thread.id, commandId: yield* newCommandId(), modelSelection })
          .pipe(Effect.mapError(dispatchFailure));
        return { sequence: result.sequence };
      }),
    ),
  ),
  t3_pending_request: McpToolAccess.either(
    (input) => input.action !== "respond",
    McpToolAccess.reads((input) =>
      Effect.gen(function* () {
        if (input.action === "list") {
          const { projection } = yield* readThread(input.threadId, ["runtimeRequests"]);
          return {
            requestIds: projection.runtimeRequests
              .filter((request) => request.kind === "user_input" && request.status === "pending")
              .map((request) => request.id),
          };
        }
        const requestId = yield* required(input.requestId, "requestId");
        const { item } = yield* readQuestion({ threadId: input.threadId, requestId });
        return { requestId, questions: item.questions };
      }),
    ),
    writesThread((input) =>
      Effect.gen(function* () {
        const requestId = yield* required(input.requestId, "requestId");
        const answers = yield* required(input.answers, "answers");
        const { threads, projection } = yield* readQuestion({
          threadId: input.threadId,
          requestId,
        });
        const result = yield* threads
          .dispatch({
            type: "runtime-request.respond",
            threadId: projection.thread.id,
            commandId: yield* newCommandId(),
            requestId,
            answers,
          })
          .pipe(Effect.mapError(dispatchFailure));
        return { sequence: result.sequence };
      }),
    ),
  ),
  t3_queue: McpToolAccess.either(
    (input) => input.action === "list" || input.action === "read",
    McpToolAccess.reads((input) =>
      Effect.gen(function* () {
        const { projection } = yield* readThread(input.threadId, ["runs", "messages"]);
        if (input.action === "list") {
          const runs = queuedRunsInDeliveryOrder(projection);
          const cursor = input.cursor ?? 0;
          const end = cursor + (input.limit ?? 20);
          return {
            items: runs.slice(cursor, end).flatMap((run) => {
              const entry = queueEntry(projection, run.id, 1000);
              return entry === undefined ? [] : [entry];
            }),
            nextCursor: end < runs.length ? end : null,
          };
        }
        const queuedRunId = yield* required(input.queuedRunId, "queuedRunId");
        return (
          queueEntry(projection, queuedRunId, 16000) ??
          (yield* new OrchestratorMcpFailure({
            code: "invalid_request",
            message: "The queued message was not found.",
          }))
        );
      }),
    ),
    writesThread((input) =>
      Effect.gen(function* () {
        const runId = yield* required(input.queuedRunId, "queuedRunId");
        switch (input.action) {
          case "edit": {
            const text = yield* required(input.text, "text");
            return yield* dispatch(input.threadId, (common) => ({
              ...common,
              type: "queued-run.edit",
              runId,
              text,
            }));
          }
          case "reorder": {
            const beforeRunId = yield* required(input.beforeRunId, "beforeRunId");
            return yield* dispatch(input.threadId, (common) => ({
              ...common,
              type: "queued-run.reorder",
              runId,
              beforeRunId,
            }));
          }
          case "promote_to_steer": {
            const targetRunId = yield* required(input.targetRunId, "targetRunId");
            return yield* dispatch(input.threadId, (common) => ({
              ...common,
              type: "queued-message.promote-to-steer",
              queuedRunId: runId,
              targetRunId,
            }));
          }
          default:
            return yield* dispatch(input.threadId, (common) => ({
              ...common,
              type: "queued-run.cancel",
              runId,
            }));
        }
      }),
    ),
  ),
  t3_thread_organize: writesThread((input) =>
    Effect.gen(function* () {
      const { threads, projection, caller } = yield* readThread(input.threadId);
      const common = { commandId: yield* newCommandId(), threadId: projection.thread.id };
      if (input.action === "settle") {
        return yield* threads
          .settleThread({ ...common, byOwnAgent: caller?.id === projection.thread.id })
          .pipe(Effect.mapError(dispatchFailure));
      }
      let command: OrchestrationV2Command;
      switch (input.action) {
        case "snooze":
          if (input.snoozedUntil === undefined) {
            return yield* new OrchestratorMcpFailure({
              code: "invalid_request",
              message: "snooze requires snoozedUntil.",
            });
          }
          command = { ...common, type: "thread.snooze", snoozedUntil: input.snoozedUntil };
          break;
        case "unsnooze":
        case "unsettle":
          command = { ...common, type: `thread.${input.action}`, reason: "user" };
          break;
        case "mark_read":
          // Like opening the thread in the app: everything up to its latest update is seen.
          command = {
            ...common,
            type: "thread.visit",
            visitedAt: DateTime.formatIso(projection.thread.updatedAt),
          };
          break;
        case "mark_unread":
          command = { ...common, type: "thread.mark-unread" };
          break;
        case "move_to_group":
          if (input.groupName === undefined) {
            return yield* new OrchestratorMcpFailure({
              code: "invalid_request",
              message: "move_to_group requires groupName.",
            });
          }
          command = { ...common, type: "thread.group.set", groupName: input.groupName };
          break;
        case "remove_from_group":
          command = { ...common, type: "thread.group.set", groupName: null };
          break;
        case "hide":
        case "unhide":
          command = { ...common, type: "thread.hidden.set", hidden: input.action === "hide" };
          break;
        default:
          command = { ...common, type: `thread.${input.action}` };
      }
      const result = yield* threads.dispatch(command).pipe(Effect.mapError(dispatchFailure));
      return { sequence: result.sequence };
    }),
  ),
});
