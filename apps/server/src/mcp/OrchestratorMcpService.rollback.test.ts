import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  CheckpointId,
  CheckpointScopeId,
  CommandId,
  EnvironmentId,
  type OrchestrationV2Command,
  type OrchestrationV2ThreadProjection,
  ProviderInstanceId,
  RunId,
  type RuntimeMode,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import * as ProviderAdapterRegistry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ScheduledTaskService from "../scheduledTasks/ScheduledTaskService.ts";
import * as SecretRequests from "../secrets/SecretRequests.ts";
import type { McpInvocationScope } from "./McpInvocationContext.ts";
import { liveThreadShell } from "./McpToolAccess.testkit.ts";
import * as OrchestratorMcpService from "./OrchestratorMcpService.ts";

const callerId = ThreadId.make("thread:rollback-caller");
const targetId = ThreadId.make("thread:rollback-target");
const scopeId = CheckpointScopeId.make("scope:rollback-target");
const baseCheckpoint = CheckpointId.make("checkpoint:rollback-base");
const firstRunCheckpoint = CheckpointId.make("checkpoint:rollback-run-1");

const threadCaller: McpInvocationScope = {
  environmentId: EnvironmentId.make("environment:rollback"),
  requestNamespace: "provider-session:rollback",
  thread: {
    threadId: callerId,
    providerSessionId: "provider-session:rollback",
    providerInstanceId: ProviderInstanceId.make("codex"),
  },
  client: undefined,
  capabilities: new Set(["orchestration"]),
  issuedAt: 1,
};

const run = (ordinal: number, status: string) => ({
  id: RunId.make(`run:rollback-${ordinal}`),
  ordinal,
  status,
  providerInstanceId: ProviderInstanceId.make("codex"),
});

const projection = (
  threadId: ThreadId,
  input: {
    readonly runs: ReadonlyArray<ReturnType<typeof run>>;
    readonly runtimeMode?: RuntimeMode;
    readonly checkpointStatus?: string;
  },
) =>
  ({
    thread: {
      ...liveThreadShell(threadId),
      runtimeMode: input.runtimeMode ?? "full-access",
      interactionMode: "default",
    },
    runs: input.runs,
    messages: [],
    subagents: [],
    providerThreads: [],
    providerTurns: [],
    runtimeRequests: [],
    contextTransfers: [],
    turnItems: [],
    checkpoints: [
      {
        id: baseCheckpoint,
        scopeId,
        ordinalWithinScope: 0,
        appRunOrdinal: null,
        status: "ready",
      },
      {
        id: firstRunCheckpoint,
        scopeId,
        ordinalWithinScope: 1,
        appRunOrdinal: 1,
        status: input.checkpointStatus ?? "ready",
      },
    ],
  }) as unknown as OrchestrationV2ThreadProjection;

const harness = (input: {
  readonly caller?: OrchestrationV2ThreadProjection;
  readonly target?: OrchestrationV2ThreadProjection;
}) =>
  Effect.gen(function* () {
    const dispatched = yield* Ref.make<ReadonlyArray<OrchestrationV2Command>>([]);
    const caller =
      input.caller ?? projection(callerId, { runs: [run(1, "running")] /* its live turn */ });
    const target = input.target ?? projection(targetId, { runs: [run(1, "completed")] });
    const byId = (threadId: ThreadId) => (threadId === callerId ? caller : target);
    const layer = OrchestratorMcpService.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          NodeServices.layer,
          Layer.mock(ThreadManagementService.ThreadManagementService)({
            getTimelinePage: () => Effect.succeed({ items: [], totalItems: 0, hasMore: false }),
            getThreadRecords: (threadId) => Effect.succeed(byId(threadId)) as never,
            getProjectThreadRecords: ({ threadId }) => Effect.succeed(byId(threadId)) as never,
            getThreadShell: (threadId) => Effect.succeed(liveThreadShell(threadId)),
            dispatch: (command) =>
              Ref.update(dispatched, (commands) => [...commands, command as never]).pipe(
                Effect.as({ sequence: 1 } as never),
              ),
          }),
          Layer.mock(ProviderRegistry.ProviderRegistry)({ getProviders: Effect.succeed([]) }),
          Layer.mock(ProviderAdapterRegistry.ProviderAdapterRegistryV2)({
            list: () => Effect.succeed([]),
          }),
          Layer.mock(ProjectService.ProjectService)({}),
          Layer.mock(SecretRequests.SecretRequests)({}),
          Layer.mock(ThreadLaunchService.ThreadLaunchService)({}),
          Layer.mock(ScheduledTaskService.ScheduledTaskService)({}),
        ),
      ),
    );
    const service = yield* OrchestratorMcpService.OrchestratorMcpService.pipe(
      Effect.provide(layer),
    );
    return { service, dispatched };
  });

describe("OrchestratorMcpService.rollbackThread", () => {
  it.effect("dispatches the app's rollback for the checkpoint after the chosen run", () =>
    Effect.gen(function* () {
      const { service, dispatched } = yield* harness({});
      const result = yield* service.rollbackThread(threadCaller, {
        threadId: targetId,
        runOrdinal: 1,
      });
      assert.deepStrictEqual(result, {
        status: "rollback_requested",
        commandId: result.commandId,
        threadId: targetId,
        runOrdinal: 1,
        checkpointId: firstRunCheckpoint,
        restoreFiles: true,
      });
      const [command] = yield* Ref.get(dispatched);
      assert.equal(command?.type, "checkpoint.rollback");
      assert.equal(command?.commandId, result.commandId);
      assert.include(command, {
        threadId: targetId,
        scopeId,
        checkpointId: firstRunCheckpoint,
        restoreFiles: true,
      });
    }),
  );

  it.effect("rolls back past every run to the base checkpoint, keeping files when asked", () =>
    Effect.gen(function* () {
      const { service, dispatched } = yield* harness({});
      const result = yield* service.rollbackThread(threadCaller, {
        threadId: targetId,
        runOrdinal: 0,
        restoreFiles: false,
      });
      assert.equal(result.checkpointId, baseCheckpoint);
      const [command] = yield* Ref.get(dispatched);
      assert.include(command, { checkpointId: baseCheckpoint, restoreFiles: false });
    }),
  );

  it.effect("uses the same command identity for retries and accepts an operate token", () =>
    Effect.gen(function* () {
      const { service, dispatched } = yield* harness({});
      const tokenCaller: McpInvocationScope = {
        ...threadCaller,
        requestNamespace: "client:rollback-token",
        thread: undefined,
        client: { sessionId: "rollback-token", label: "test", access: "full-access" },
      };
      const input = { threadId: targetId, runOrdinal: 1, clientRequestId: "rollback-retry" };
      const first = yield* service.rollbackThread(tokenCaller, input);
      const retry = yield* service.rollbackThread(tokenCaller, input);
      assert.deepStrictEqual(retry, first);
      const commands = yield* Ref.get(dispatched);
      assert.equal(commands[0]?.commandId, commands[1]?.commandId);
    }),
  );

  it.effect("exposes the accepted rollback and terminal failure through thread read", () =>
    Effect.gen(function* () {
      const requestId = CommandId.make("rollback-failed");
      const target = projection(targetId, { runs: [] });
      const rollbackFailure = { requestId, message: "Provider restoration failed." };
      const { service } = yield* harness({
        target: {
          ...target,
          thread: { ...target.thread, rollbackRequestId: requestId, rollbackFailure },
        },
      });
      const result = yield* service.readThread(threadCaller, { threadId: targetId });
      assert.equal(result.thread.rollbackRequestId, requestId);
      assert.deepStrictEqual(result.thread.rollbackFailure, rollbackFailure);
    }),
  );

  it.effect("refuses the caller's own thread", () =>
    Effect.gen(function* () {
      const { service, dispatched } = yield* harness({});
      const error = yield* service
        .rollbackThread(threadCaller, { threadId: callerId, runOrdinal: 0 })
        .pipe(Effect.flip);
      assert.equal(error.code, "invalid_request");
      assert.lengthOf(yield* Ref.get(dispatched), 0);
    }),
  );

  it.effect("refuses a thread with a turn running", () =>
    Effect.gen(function* () {
      const { service, dispatched } = yield* harness({
        target: projection(targetId, { runs: [run(1, "completed"), run(2, "running")] }),
      });
      const error = yield* service
        .rollbackThread(threadCaller, { threadId: targetId, runOrdinal: 1 })
        .pipe(Effect.flip);
      assert.equal(error.code, "invalid_request");
      assert.include(error.message, "turn running");
      assert.lengthOf(yield* Ref.get(dispatched), 0);
    }),
  );

  it.effect("refuses a thread running above the caller's modes", () =>
    Effect.gen(function* () {
      const { service, dispatched } = yield* harness({
        caller: projection(callerId, {
          runs: [run(1, "running")],
          runtimeMode: "approval-required",
        }),
      });
      const error = yield* service
        .rollbackThread(threadCaller, { threadId: targetId, runOrdinal: 1 })
        .pipe(Effect.flip);
      assert.equal(error.code, "runtime_mode_escalation_denied");
      assert.lengthOf(yield* Ref.get(dispatched), 0);
    }),
  );

  it.effect("refuses a caller whose own turn has ended", () =>
    Effect.gen(function* () {
      const { service, dispatched } = yield* harness({
        caller: projection(callerId, { runs: [run(1, "completed")] }),
      });
      const error = yield* service
        .rollbackThread(threadCaller, { threadId: targetId, runOrdinal: 1 })
        .pipe(Effect.flip);
      assert.equal(error.code, "parent_not_active");
      assert.lengthOf(yield* Ref.get(dispatched), 0);
    }),
  );

  it.effect("refuses a run whose checkpoint cannot be restored", () =>
    Effect.gen(function* () {
      const { service, dispatched } = yield* harness({
        target: projection(targetId, { runs: [run(1, "completed")], checkpointStatus: "missing" }),
      });
      const error = yield* service
        .rollbackThread(threadCaller, { threadId: targetId, runOrdinal: 1 })
        .pipe(Effect.flip);
      assert.equal(error.code, "invalid_request");
      const missing = yield* service
        .rollbackThread(threadCaller, { threadId: targetId, runOrdinal: 7 })
        .pipe(Effect.flip);
      assert.equal(missing.code, "invalid_request");
      assert.lengthOf(yield* Ref.get(dispatched), 0);
    }),
  );
});
