import { assert, it } from "@effect/vitest";
import {
  CommandId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import * as Orchestrator from "./Orchestrator.ts";
import type { ProviderAdapterV2Shape } from "./ProviderAdapter.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import * as ThreadManagementService from "./ThreadManagementService.ts";
import * as ProviderReplayHarness from "./testkit/ProviderReplayHarness.ts";
import { pauseRunningThreadsForUpdate } from "./UpdateThreadPause.ts";

const instanceId = ProviderInstanceId.make("codex");
const modelSelection = { instanceId, model: "gpt-5.1-codex" };
const adapter = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("Runs here never reach a provider"),
} as ProviderAdapterV2Shape;
const layerDatabase = SqlitePersistence.layerMemory;
const layerTest = ThreadManagementService.layer.pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      layerDatabase,
      ProviderReplayHarness.layerWithRegistry(
        { name: "update-thread-pause" },
        ProviderAdapterRegistry.layerFromAdapters([adapter]),
        { databaseLayer: layerDatabase, runEffectWorker: false },
      ),
    ),
  ),
);

const createThread = (threadId: ThreadId) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    yield* orchestrator.dispatch({
      type: "thread.create",
      commandId: CommandId.make(`create:${threadId}`),
      threadId,
      projectId: ProjectId.make("project:update-pause"),
      title: threadId,
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      createdBy: "user",
      creationSource: "web",
    });
  });

it.effect("pauses a running thread and leaves an idle thread alone", () =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const runningId = ThreadId.make("thread:update-pause-running");
    const idleId = ThreadId.make("thread:update-pause-idle");
    yield* createThread(runningId);
    yield* createThread(idleId);
    yield* orchestrator.dispatch({
      type: "message.dispatch",
      commandId: CommandId.make("send:update-pause"),
      threadId: runningId,
      messageId: MessageId.make("message:update-pause"),
      text: "keep going",
      attachments: [],
      dispatchMode: { type: "start_immediately" },
      createdBy: "user",
      creationSource: "web",
    });

    const paused = yield* pauseRunningThreadsForUpdate();
    const running = yield* orchestrator.getThreadProjection(runningId);
    const idle = yield* orchestrator.getThreadProjection(idleId);

    assert.deepEqual(paused, [runningId]);
    assert.equal(running.runs.at(-1)?.status, "interrupted");
    assert.deepEqual(idle.runs, []);
  }).pipe(Effect.provide(layerTest)),
);
