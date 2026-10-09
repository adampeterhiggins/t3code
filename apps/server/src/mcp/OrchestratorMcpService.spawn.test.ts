import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  EnvironmentId,
  NodeId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type OrchestrationV2Command,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import type { ProviderAdapterV2Shape } from "@t3tools/provider-core/server/ProviderAdapter";
import * as ProviderAdapterRegistry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ScheduledTaskService from "../scheduledTasks/ScheduledTaskService.ts";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as SecretRequests from "../secrets/SecretRequests.ts";
import type { McpInvocationScope } from "./McpInvocationContext.ts";
import * as OrchestratorMcpService from "./OrchestratorMcpService.ts";
import { MAX_LIVE_CHILDREN } from "./spawnPolicy.ts";

const parentThreadId = ThreadId.make("thread:spawn-parent");
const projectId = ProjectId.make("project:spawn");
const codexInstanceId = ProviderInstanceId.make("codex");
const modelSelection = { instanceId: codexInstanceId, model: "gpt-5.4" };

const scope: McpInvocationScope = {
  environmentId: EnvironmentId.make("environment:spawn"),
  requestNamespace: "provider-session:spawn",
  thread: {
    threadId: parentThreadId,
    providerSessionId: "provider-session:spawn",
    providerInstanceId: codexInstanceId,
  },
  client: undefined,
  capabilities: new Set(["orchestration"]),
  issuedAt: 1,
};

const parentProjection = {
  thread: {
    id: parentThreadId,
    projectId,
    title: "Spawn parent",
    createdBy: "user",
    creationSource: "web",
    modelSelection,
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    archivedAt: null,
  },
  runs: [
    {
      id: RunId.make("run:spawn-parent"),
      ordinal: 1,
      status: "running",
      rootNodeId: NodeId.make("node:spawn-parent"),
      providerInstanceId: codexInstanceId,
      modelSelection,
    },
  ],
  contextTransfers: [],
  subagents: [],
} as unknown as OrchestrationV2ThreadProjection;

const shell = (id: ThreadId, startedByParent: boolean) =>
  ({
    id,
    creationSource: startedByParent ? "mcp" : "web",
    ...(startedByParent ? { startedBy: { kind: "thread", threadId: parentThreadId } } : {}),
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: id },
    archivedAt: null,
    settledOverride: null,
    deletedAt: null,
    activeRunId: null,
  }) as unknown as OrchestrationV2ThreadShell;

const run = <A, E>(
  liveChildren: number,
  body: (
    service: OrchestratorMcpService.OrchestratorMcpService["Service"],
    dispatched: Ref.Ref<ReadonlyArray<OrchestrationV2Command>>,
  ) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    const dispatched = yield* Ref.make<ReadonlyArray<OrchestrationV2Command>>([]);
    const children = Array.from({ length: liveChildren }, (_, index) =>
      shell(ThreadId.make(`thread:spawn-child-${index}`), true),
    );
    const dependencies = Layer.mergeAll(
      NodeServices.layer,
      Layer.mock(ThreadManagementService.ThreadManagementService)({
        getThreadShell: (threadId) =>
          Effect.succeed(threadId === parentThreadId ? shell(parentThreadId, false) : null),
        getShellSnapshot: () =>
          Effect.succeed({
            schemaVersion: 1,
            snapshotSequence: 0,
            threads: [shell(parentThreadId, false), ...children],
            archivedThreads: [],
          }),
        getThreadRecords: (threadId) =>
          Effect.succeed(
            threadId === parentThreadId
              ? parentProjection
              : ({
                  thread: { id: threadId, title: "Child" },
                  runs: [],
                } as unknown as OrchestrationV2ThreadProjection),
          ),
        dispatch: (command) =>
          Ref.update(dispatched, (commands) => [
            ...commands,
            command as OrchestrationV2Command,
          ]).pipe(Effect.as({ sequence: 1, storedEvents: [] } as never)),
      }),
      Layer.mock(ProviderRegistry.ProviderRegistry)({
        getProviders: Effect.succeed([
          {
            instanceId: codexInstanceId,
            driver: ProviderDriverKind.make("codex"),
            enabled: true,
            installed: true,
            version: "test",
            status: "ready",
            auth: { status: "authenticated" },
            checkedAt: "2026-10-05T00:00:00.000Z",
            models: [{ slug: "gpt-5.4", name: "gpt-5.4", isCustom: false, capabilities: null }],
            slashCommands: [],
            skills: [],
          },
        ]),
      }),
      Layer.succeed(
        ProviderAdapterRegistry.ProviderAdapterRegistryV2,
        ProviderAdapterRegistry.ProviderAdapterRegistryV2.of({
          list: () => Effect.succeed([codexInstanceId]),
          get: (instanceId) => Effect.succeed({ instanceId } as unknown as ProviderAdapterV2Shape),
        }),
      ),
      Layer.mock(ProjectService.ProjectService)({}),
      Layer.mock(ScheduledTaskService.ScheduledTaskService)({}),
      Layer.mock(ThreadLaunchService.ThreadLaunchService)({}),
      Layer.mock(SecretRequests.SecretRequests)({}),
    );
    return yield* Effect.gen(function* () {
      const service = yield* OrchestratorMcpService.OrchestratorMcpService;
      return yield* body(service, dispatched);
    }).pipe(Effect.provide(OrchestratorMcpService.layer.pipe(Layer.provide(dependencies))));
  });

it.effect("records the calling thread on the threads create_threads starts", () =>
  run(0, (service, dispatched) =>
    Effect.gen(function* () {
      yield* service.createThreads(scope, {
        threads: [{ title: "Split work" }],
        clientRequestId: "spawn-create-1",
      });
      const created = (yield* Ref.get(dispatched)).find(
        (command) => command.type === "thread.create",
      );
      assert.deepEqual(created?.type === "thread.create" ? created.startedBy : undefined, {
        kind: "thread",
        threadId: parentThreadId,
      });
    }),
  ),
);

it.effect("refuses create_threads and delegate_task past five live started threads", () =>
  run(MAX_LIVE_CHILDREN, (service, dispatched) =>
    Effect.gen(function* () {
      const created = yield* service
        .createThreads(scope, { threads: [{ title: "One more" }], clientRequestId: "spawn-full" })
        .pipe(Effect.flip);
      assert.equal(created.code, "capability_denied");
      const delegated = yield* service
        .delegateTask(scope, { task: "One more", mode: "async", clientRequestId: "spawn-full" })
        .pipe(Effect.flip);
      assert.equal(delegated.code, "capability_denied");
      assert.deepEqual(yield* Ref.get(dispatched), []);
    }),
  ),
);

it.effect("refuses sending to, waiting on, or interrupting the caller's own thread", () =>
  run(0, (service, dispatched) =>
    Effect.gen(function* () {
      const sent = yield* service
        .sendToThread(scope, { threadId: parentThreadId, message: "Hello me" })
        .pipe(Effect.flip);
      assert.equal(sent.code, "invalid_request");
      const waited = yield* service
        .waitForThread(scope, { threadId: parentThreadId })
        .pipe(Effect.flip);
      assert.equal(waited.code, "invalid_request");
      const interrupted = yield* service
        .interruptThread(scope, { threadId: parentThreadId })
        .pipe(Effect.flip);
      assert.equal(interrupted.code, "invalid_request");
      assert.deepEqual(yield* Ref.get(dispatched), []);
    }),
  ),
);
