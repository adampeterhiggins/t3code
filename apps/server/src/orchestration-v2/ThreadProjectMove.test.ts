import { assert, it } from "@effect/vitest";
import {
  CommandId,
  EventId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import * as EventSink from "./EventSink.ts";
import * as Orchestrator from "./Orchestrator.ts";
import { planProjectCommand } from "./ProjectCommands.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import * as ProviderReplayHarness from "./testkit/ProviderReplayHarness.ts";

const instanceId = ProviderInstanceId.make("codex");
const source = ProjectId.make("project:source");
const destination = ProjectId.make("project:destination");
const threadId = ThreadId.make("thread:move");
const database = SqlitePersistence.layerMemory;
const layer = Layer.mergeAll(
  database,
  ProviderReplayHarness.layerWithRegistry(
    { name: "thread-project-move" },
    ProviderAdapterRegistry.layerFromAdapters([
      {
        instanceId,
        driver: ProviderDriverKind.make("codex"),
        getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
        planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
        openSession: () => Effect.die("Idle moves must not start a provider"),
      },
    ]),
    { databaseLayer: database, runEffectWorker: false },
  ),
);
const prepare = Effect.gen(function* () {
  const sink = yield* EventSink.EventSinkV2;
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const now = yield* DateTime.now;
  for (const projectId of [source, destination]) {
    const command = {
      type: "project.create" as const,
      commandId: CommandId.make(`create:${projectId}`),
      projectId,
      title: projectId,
      workspaceRoot: `/tmp/${projectId}`,
    };
    yield* sink.commitProjectCommand({
      ...command,
      commandType: command.type,
      acceptedAt: now,
      event: Result.getOrThrow(
        planProjectCommand({
          command,
          state: { project: undefined, workspaceOwner: undefined },
          eventId: EventId.make(`created:${projectId}`),
          now,
        }),
      ),
    });
  }
  yield* orchestrator.dispatch({
    type: "thread.create",
    commandId: CommandId.make("create-thread"),
    threadId,
    projectId: source,
    title: "Keep my history",
    modelSelection: { instanceId, model: "test" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: "old-branch",
    worktreePath: "/old-checkout",
    createdBy: "user",
    creationSource: "web",
  });
  yield* orchestrator.dispatch({
    type: "thread.group.set",
    commandId: CommandId.make("old-group"),
    threadId,
    groupName: "Source group",
  });
  return orchestrator;
});

it.effect("moves an idle thread to the destination checkout and can move it back", () =>
  Effect.gen(function* () {
    const orchestrator = yield* prepare;
    yield* orchestrator.dispatch({
      type: "thread.metadata.update",
      commandId: CommandId.make("old-pr"),
      threadId,
      linkedPullRequest: {
        projectId: source,
        repository: "owner/source",
        number: 1,
        url: "https://github.com/owner/source/pull/1",
      },
    });
    yield* orchestrator.dispatch({
      type: "thread.project.move",
      commandId: CommandId.make("move"),
      threadId,
      projectId: destination,
    });
    const after = yield* orchestrator.getThreadProjection(threadId);
    assert.equal(after.thread.title, "Keep my history");
    assert.equal(after.thread.projectId, destination);
    assert.isNull(after.thread.worktreePath);
    assert.isNull(after.thread.branch);
    assert.isNull(after.thread.groupName);
    assert.isNull(after.thread.linkedPullRequest);
    assert.deepEqual(after.thread.pullRequests, []);
    assert.isEmpty(after.runs);
    yield* orchestrator.dispatch({
      type: "thread.project.move",
      commandId: CommandId.make("move-back"),
      threadId,
      projectId: source,
    });
    assert.equal((yield* orchestrator.getThreadShell(threadId))?.projectId, source);
  }).pipe(Effect.provide(layer)),
);

it.effect.each(["missing-project", "same-project", "archived", "tabs", "scheduled-task"] as const)(
  "refuses %s without moving the thread",
  (refusal) =>
    Effect.gen(function* () {
      const orchestrator = yield* prepare;
      const sql = yield* SqlClient.SqlClient;
      if (refusal === "archived")
        yield* orchestrator.dispatch({
          type: "thread.archive",
          commandId: CommandId.make("archive"),
          threadId,
        });
      if (refusal === "tabs") {
        yield* orchestrator.dispatch({
          type: "thread.create",
          commandId: CommandId.make("create-sibling"),
          threadId: ThreadId.make("sibling"),
          projectId: source,
          title: "Sibling",
          modelSelection: { instanceId, model: "test" },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdBy: "user",
          creationSource: "web",
        });
        yield* sql`INSERT INTO fork_thread_tabs (thread_id, group_id, position, created_at) VALUES (${threadId}, ${threadId}, 0, '2026-01-01'), ('sibling', ${threadId}, 1, '2026-01-01')`;
      }
      if (refusal === "scheduled-task")
        yield* sql`INSERT INTO scheduled_tasks (task_id, title, prompt, enabled, schedule_json, project_id, thread_id, workspace_strategy_json, model_selection_json, runtime_mode, interaction_mode, created_by, creation_source, created_at, updated_at, last_run_status, run_count) VALUES ('task', 'Task', 'Work', 1, '{}', ${source}, ${threadId}, '{}', '{}', 'full-access', 'default', 'user', 'web', '2026-01-01', '2026-01-01', 'idle', 0)`;
      const result = yield* orchestrator
        .dispatch({
          type: "thread.project.move",
          commandId: CommandId.make("refused-move"),
          threadId,
          projectId:
            refusal === "missing-project"
              ? ProjectId.make("missing")
              : refusal === "same-project"
                ? source
                : destination,
        })
        .pipe(Effect.result);
      assert.isTrue(Result.isFailure(result));
      assert.equal((yield* orchestrator.getThreadProjection(threadId)).thread.projectId, source);
    }).pipe(Effect.provide(layer)),
);
