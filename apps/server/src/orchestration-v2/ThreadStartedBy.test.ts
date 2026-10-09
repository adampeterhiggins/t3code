import { assert, it } from "@effect/vitest";
import {
  CommandId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2Command,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import type { ProviderAdapterV2Shape } from "@t3tools/provider-core/server/ProviderAdapter";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import { withCreationProvenance } from "./ThreadManagementService.ts";
import * as ProviderReplayHarness from "./testkit/ProviderReplayHarness.ts";

const instanceId = ProviderInstanceId.make("codex");
const modelSelection = { instanceId, model: "gpt-5.1-codex" };
const adapter = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("No provider process needed for thread metadata"),
} as ProviderAdapterV2Shape;
const layerDatabase = SqlitePersistence.layerMemory;
const layerTest = Layer.mergeAll(
  layerDatabase,
  ProjectionStore.layer.pipe(Layer.provide(layerDatabase)),
  ProviderReplayHarness.layerWithRegistry(
    { name: "thread-started-by" },
    ProviderAdapterRegistry.layerFromAdapters([adapter]),
    { databaseLayer: layerDatabase, runEffectWorker: false },
  ),
);

const createCommand = (
  threadId: ThreadId,
  startedBy: Extract<OrchestrationV2Command, { type: "thread.create" }>["startedBy"],
): Extract<OrchestrationV2Command, { type: "thread.create" }> => ({
  type: "thread.create",
  commandId: CommandId.make(`create:${threadId}`),
  threadId,
  projectId: ProjectId.make("project:started-by"),
  title: "Started by an agent",
  modelSelection,
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  createdBy: "agent",
  creationSource: "mcp",
  ...(startedBy === undefined ? {} : { startedBy }),
});

it.effect("keeps who started a thread on its shell through later thread changes", () =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const parentId = ThreadId.make("thread:parent");
    const childId = ThreadId.make("thread:child");
    const tokenChildId = ThreadId.make("thread:token-child");
    yield* orchestrator.dispatch(createCommand(childId, { kind: "thread", threadId: parentId }));
    yield* orchestrator.dispatch(
      createCommand(tokenChildId, { kind: "agent-access", label: "EOD brief" }),
    );
    yield* orchestrator.dispatch({
      type: "thread.metadata.update",
      commandId: CommandId.make("rename-child"),
      threadId: childId,
      title: "Renamed",
    });
    yield* orchestrator.dispatch({
      type: "thread.archive",
      commandId: CommandId.make("archive-child"),
      threadId: childId,
    });

    const child = yield* projections.getThreadShell(childId);
    assert.deepStrictEqual(child?.startedBy, { kind: "thread", threadId: parentId });
    const snapshot = yield* projections.getShellSnapshot();
    const tokenChild = [...snapshot.threads, ...snapshot.archivedThreads].find(
      (thread) => thread.id === tokenChildId,
    );
    assert.deepStrictEqual(tokenChild?.startedBy, { kind: "agent-access", label: "EOD brief" });
  }).pipe(Effect.provide(layerTest)),
);

it("drops a client's claim to have been started by an agent", () => {
  const command = createCommand(ThreadId.make("thread:client"), {
    kind: "agent-access",
    label: "Spoofed",
  });
  const fromClient = withCreationProvenance(command, { createdBy: "user", creationSource: "web" });
  assert.strictEqual("startedBy" in fromClient, false);
  const fromServer = withCreationProvenance(command, { createdBy: "agent", creationSource: "mcp" });
  assert.deepStrictEqual(fromServer.type === "thread.create" ? fromServer.startedBy : undefined, {
    kind: "agent-access",
    label: "Spoofed",
  });
});
