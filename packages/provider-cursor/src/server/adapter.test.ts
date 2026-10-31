import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import type { InteractionUpdate } from "@cursor/sdk";
import {
  EnvironmentId,
  MessageId,
  NodeId,
  ProjectId,
  ProviderInstanceId,
  ProviderSessionId,
  RunAttemptId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as TestProviderHost from "@t3tools/provider-testing/TestProviderHost";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as McpProviderSessions from "@t3tools/provider-core/server/McpProviderSessions";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import { makeProviderFailure } from "@t3tools/provider-core/server/failure";
import { findSubscriptionLimitStop } from "@t3tools/provider-core/server/SubscriptionLimitPolicy";
import {
  CursorProviderCapabilitiesV2,
  cursorMcpServers,
  cursorRunFailure,
  cursorRuntimeAgentPolicy,
  cursorSdkModelSelection,
  makeCursorAgentOptions,
  makeCursorAdapterV2,
  nestedToolCallFromEnvelope,
} from "./adapter.ts";
import * as CursorAgentSdk from "./CursorAgentSdk.ts";
import { ConfigurationError } from "./sdk.ts";

describe("CursorAdapterV2", () => {
  it.effect.each([
    { status: "finished", model: undefined, lateModel: undefined },
    { status: "cancelled", model: "claude-opus-4-6", lateModel: undefined },
    { status: "cancelled", model: undefined, lateModel: undefined },
    { status: "finished", model: "grok-4.7", lateModel: undefined },
    { status: "error", model: "custom-fable", lateModel: undefined },
    { status: "finished", model: undefined, lateModel: "gpt-6-sol" },
    { status: "finished", model: "gpt-6-sol", lateModel: null },
  ] as const)(
    "projects Cursor tasks: $status, late model $lateModel",
    ({ status, model, lateModel }) =>
      Effect.gen(function* () {
        const streamed = model !== undefined || lateModel !== undefined;
        const hasFinalUsage = status === "finished" && model !== "grok-4.7";
        const fileSystem = yield* FileSystem.FileSystem;
        const workspace = yield* fileSystem.makeTempDirectoryScoped({
          prefix: "cursor-v2-lifecycle-",
        });
        const instanceId = ProviderInstanceId.make("cursor");
        const threadId = ThreadId.make("cursor-lifecycle-thread");
        const mcpSessions = yield* McpProviderSessions.McpProviderSessions;
        yield* mcpSessions.set({
          environmentId: EnvironmentId.make("cursor-lifecycle-environment"),
          threadId,
          providerSessionId: "cursor-lifecycle-session",
          providerInstanceId: instanceId,
          endpoint: "http://127.0.0.1:43123/mcp",
          authorizationHeader: "Bearer synthetic-cursor-token",
          browserToolsAvailable: true,
        });
        let sentWithMcpOverride = true;
        const modelSelection = { instanceId, model: "composer-2.5" };
        const runtimePolicy = ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({
          runtimeMode: "full-access",
          interactionMode: "default",
          cwd: workspace,
        });
        const adapter = yield* makeCursorAdapterV2({
          instanceId,
          environment: { HOME: workspace },
        }).pipe(
          Effect.provideService(CursorAgentSdk.CursorAgentSdkRunner, {
            assertComplete: Effect.void,
            open: () =>
              Effect.succeed({
                agentId: "native-cursor-lifecycle",
                listMessages: Effect.succeed([]),
                close: Effect.void,
                send: (input) =>
                  Effect.gen(function* () {
                    sentWithMcpOverride = Object.hasOwn(input.options ?? {}, "mcpServers");
                    // Recorded tasks stream partial args before start, then end without completion; live runs cannot force this.
                    const taskToolCall = {
                      type: "task" as const,
                      args: {
                        description: "Review",
                        prompt: "Review the code.",
                        subagentType: { kind: "unspecified" },
                        ...(model === undefined ? {} : { model }),
                        agentId: "cursor-task-agent",
                        mode: "unspecified" as const,
                      },
                    };
                    const updates =
                      lateModel !== undefined
                        ? (["tool-call-started", "tool-call-completed"] as const)
                        : (["partial-tool-call", "tool-call-started"] as const);
                    for (const type of updates) {
                      yield* input.onDelta!({
                        type,
                        modelCallId: "model-call",
                        callId: "task-call",
                        toolCall: {
                          ...taskToolCall,
                          args: {
                            ...taskToolCall.args,
                            ...(type === "tool-call-completed"
                              ? { model: lateModel ?? undefined }
                              : {}),
                          },
                        },
                      }).pipe(Effect.orDie);
                    }
                    for (const usage of streamed
                      ? [
                          {
                            inputTokens: 10,
                            outputTokens: 2,
                            cacheReadTokens: 4,
                            cacheWriteTokens: 1,
                            reasoningTokens: 1,
                          },
                          undefined,
                          {
                            inputTokens: 20,
                            outputTokens: 3,
                            cacheReadTokens: 5,
                            cacheWriteTokens: 2,
                            reasoningTokens: 1,
                          },
                        ]
                      : []) {
                      yield* input.onDelta!({
                        type: "turn-ended",
                        ...(usage === undefined ? {} : { usage }),
                      }).pipe(Effect.orDie);
                    }
                    return {
                      agentId: "native-cursor-lifecycle",
                      runId: "native-cursor-run",
                      wait: Effect.succeed({
                        id: "native-cursor-run",
                        requestId: "native-request",
                        status,
                        model: { id: "composer-2.5" },
                        durationMs: 1,
                        ...(hasFinalUsage
                          ? {
                              usage: {
                                inputTokens: 100,
                                outputTokens: 20,
                                cacheReadTokens: 40,
                                cacheWriteTokens: 0,
                                totalTokens: 160,
                                reasoningTokens: 5,
                              },
                            }
                          : status === "error"
                            ? {
                                usage: {
                                  inputTokens: 0,
                                  outputTokens: 0,
                                  cacheReadTokens: 0,
                                  cacheWriteTokens: 0,
                                  totalTokens: 0,
                                },
                              }
                            : {}),
                      }),
                      cancel: Effect.void,
                      steer: () => Effect.die("unused steer"),
                    };
                  }),
              }),
          }),
          Effect.provide(TestProviderHost.layer({ cwd: workspace })),
        );
        const runtime = yield* adapter.openSession({
          threadId,
          providerSessionId: ProviderSessionId.make("cursor-lifecycle-session"),
          modelSelection,
          runtimePolicy,
        });
        const providerThread = yield* runtime.ensureThread({
          threadId,
          modelSelection,
          runtimePolicy,
        });
        const now = yield* DateTime.now;
        yield* runtime.startTurn({
          threadId,
          providerThread,
          modelSelection,
          runtimePolicy,
          runId: RunId.make("cursor-lifecycle-run"),
          runOrdinal: 1,
          providerTurnOrdinal: 1,
          attemptId: RunAttemptId.make("cursor-lifecycle-attempt"),
          rootNodeId: NodeId.make("cursor-lifecycle-root"),
          appThread: {
            id: threadId,
            projectId: ProjectId.make("cursor-lifecycle-project"),
            createdBy: "user",
            creationSource: "web",
            title: "Cursor lifecycle",
            providerInstanceId: instanceId,
            modelSelection,
            runtimeMode: "full-access",
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            activeProviderThreadId: providerThread.id,
            lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
            forkedFrom: null,
            createdAt: now,
            updatedAt: now,
            archivedAt: null,
            settledOverride: null,
            settledAt: null,
            lastVisitedAt: null,
            deletedAt: null,
          },
          message: {
            messageId: MessageId.make("cursor-lifecycle-message"),
            createdBy: "user",
            creationSource: "web",
            text: "Review the code.",
            attachments: [],
          },
        });
        const events = yield* runtime.events.pipe(
          Stream.takeUntil((event) => event.type === "turn.terminal"),
          Stream.runCollect,
        );
        assert.isFalse(sentWithMcpOverride);
        const rows = events.filter((event) => event.type === "subagent.updated");
        assert.equal(rows[0]?.subagent.status, "running");
        assert.equal(rows[0]?.subagent.model, model ?? null);
        assert.equal(rows.at(-1)?.subagent.model, lateModel ?? model ?? null);
        assert.equal(
          rows.at(-1)?.subagent.status,
          lateModel !== undefined
            ? "completed"
            : status === "finished"
              ? "idle"
              : status === "cancelled"
                ? "cancelled"
                : "failed",
        );
        assert.isNotNull(rows.at(-1)?.subagent.completedAt);
        const liveTurns = events.filter(
          (event) =>
            event.type === "provider_turn.updated" &&
            event.providerTurn.status === "running" &&
            event.providerTurn.turnTokenUsage !== undefined,
        );
        assert.deepStrictEqual(
          liveTurns.map((event) =>
            event.type === "provider_turn.updated" ? event.providerTurn.turnTokenUsage : undefined,
          ),
          streamed
            ? [
                {
                  usageStatus: "partial",
                  usageScope: "main_agent",
                  inputTokens: 15,
                  cachedInputTokens: 4,
                  cacheCreationTokens: 1,
                  outputTokens: 2,
                  reasoningTokens: 1,
                  hasSubagents: true,
                },
                {
                  usageStatus: "partial",
                  usageScope: "main_agent",
                  inputTokens: 42,
                  cachedInputTokens: 9,
                  cacheCreationTokens: 3,
                  outputTokens: 5,
                  reasoningTokens: 2,
                  hasSubagents: true,
                },
              ]
            : [],
        );
        // Final totals replace streamed usage; cancelled/failed runs retain measured partial usage.
        const terminalTurn = events
          .filter((event) => event.type === "provider_turn.updated")
          .at(-1)?.providerTurn;
        assert.isUndefined(terminalTurn?.tokenUsage);
        assert.deepStrictEqual(
          terminalTurn?.turnTokenUsage,
          hasFinalUsage
            ? {
                usageStatus: "complete",
                usageScope: "main_agent",
                inputTokens: 140,
                cachedInputTokens: 40,
                cacheCreationTokens: 0,
                outputTokens: 20,
                reasoningTokens: 5,
                hasSubagents: true,
              }
            : streamed
              ? {
                  usageStatus: "partial",
                  usageScope: "main_agent",
                  inputTokens: 42,
                  cachedInputTokens: 9,
                  cacheCreationTokens: 3,
                  outputTokens: 5,
                  reasoningTokens: 2,
                  hasSubagents: true,
                }
              : { usageStatus: "unavailable", usageScope: "main_agent", hasSubagents: true },
        );
      }).pipe(
        Effect.scoped,
        Effect.provide(
          Layer.mergeAll(NodeServices.layer, IdAllocator.layer, McpProviderSessions.layer),
        ),
      ),
  );

  it.effect.each([
    {
      reason: "the SDK's detailed plan usage limit code",
      wait: Effect.succeed({
        id: "native-cursor-run",
        status: "error" as const,
        error: { message: "You've hit your usage limit", code: "PRO_USER_USAGE_LIMIT" },
      }),
      failure: { class: "usage_limit", message: "You've hit your usage limit" },
    },
    {
      reason: "the error Cursor's run ended with",
      wait: Effect.succeed({
        id: "native-cursor-run",
        requestId: "native-request",
        status: "error" as const,
        error: {
          message: "Model Blocked Please ask your admin to enable access to Claude Fable 5.",
        },
        model: { id: "claude-fable-5" },
        durationMs: 1,
      }),
      failure: {
        class: "provider_error",
        message: "Model Blocked Please ask your admin to enable access to Claude Fable 5.",
      },
    },
    {
      reason: "the SDK rate limit that broke the run",
      wait: Effect.fail(
        new CursorAgentSdk.CursorAgentSdkRunnerError({
          method: "run.wait",
          cause: Object.assign(new Error("Too many requests"), {
            code: "resource_exhausted",
            status: 429,
          }),
        }),
      ),
      failure: {
        class: "usage_limit",
        message:
          "Cursor Agent SDK run.wait failed: Too many requests (resource_exhausted, HTTP 429)",
      },
    },
    {
      reason: "a transport dump sent after earlier commentary",
      updates: [
        { type: "text-delta", text: "Checking the build first." },
        { type: "step-completed", stepId: 1, stepDurationMs: 1 },
        { type: "text-delta", text: "Error: RetriableError: WritableIterable is closed" },
      ] satisfies ReadonlyArray<InteractionUpdate>,
      wait: Effect.succeed({
        id: "native-cursor-run",
        requestId: "native-request",
        status: "finished" as const,
        model: { id: "claude-fable-5" },
        durationMs: 1,
      }),
      failure: { class: "transport_error", message: "Provider turn failed." },
    },
    {
      reason: "no failure when Cursor's resume after the turn ended made no progress",
      // Cursor's SDK resumed from an older checkpoint after the answer was
      // delivered, regenerated the closing, then gave up on the run.
      updates: [
        { type: "text-delta", text: "The answer." },
        { type: "turn-ended" },
        { type: "text-delta", text: "A regenerated closing." },
        { type: "turn-ended" },
      ] satisfies ReadonlyArray<InteractionUpdate>,
      wait: Effect.succeed({
        id: "native-cursor-run",
        requestId: "native-request",
        status: "error" as const,
        error: { message: "Agent turn stopped after repeated resume attempts made no progress" },
        model: { id: "claude-fable-5" },
        durationMs: 1,
      }),
      failure: null,
    },
    {
      reason: "the error a continuation after the turn ended stopped with",
      updates: [
        { type: "text-delta", text: "The answer." },
        { type: "turn-ended" },
        { type: "text-delta", text: "Following up on the stop hook." },
      ] satisfies ReadonlyArray<InteractionUpdate>,
      wait: Effect.succeed({
        id: "native-cursor-run",
        requestId: "native-request",
        status: "error" as const,
        error: { message: "Agent turn stopped after repeated resume attempts made no progress" },
        model: { id: "claude-fable-5" },
        durationMs: 1,
      }),
      failure: {
        class: "provider_error",
        message: "Agent turn stopped after repeated resume attempts made no progress",
      },
    },
    {
      reason: "no answer from a resume after the turn ended that made no progress",
      updates: [{ type: "turn-ended" }] satisfies ReadonlyArray<InteractionUpdate>,
      wait: Effect.succeed({
        id: "native-cursor-run",
        requestId: "native-request",
        status: "error" as const,
        error: { message: "Agent turn stopped after repeated resume attempts made no progress" },
        result: "A regenerated closing.",
        model: { id: "claude-fable-5" },
        durationMs: 1,
      }),
      failure: null,
      answers: [],
    },
  ])("ends the turn with $reason", ({ updates = [], wait, failure, answers }) =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const workspace = yield* fileSystem.makeTempDirectoryScoped({ prefix: "cursor-v2-failure-" });
      const instanceId = ProviderInstanceId.make("cursor");
      const threadId = ThreadId.make("cursor-failure-thread");
      const modelSelection = { instanceId, model: "claude-fable-5" };
      const runtimePolicy = ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({
        runtimeMode: "full-access",
        interactionMode: "default",
        cwd: workspace,
      });
      const adapter = yield* makeCursorAdapterV2({
        instanceId,
        environment: { HOME: workspace },
      }).pipe(
        Effect.provideService(CursorAgentSdk.CursorAgentSdkRunner, {
          assertComplete: Effect.void,
          open: () =>
            Effect.succeed({
              agentId: "native-cursor-failure",
              listMessages: Effect.succeed([]),
              close: Effect.void,
              send: (input) =>
                Effect.gen(function* () {
                  for (const update of updates) {
                    yield* input.onDelta!(update).pipe(Effect.orDie);
                  }
                  return {
                    agentId: "native-cursor-failure",
                    runId: "native-cursor-run",
                    wait,
                    cancel: Effect.void,
                    steer: () => Effect.die("unused steer"),
                  };
                }),
            }),
        }),
        Effect.provide(TestProviderHost.layer({ cwd: workspace })),
      );
      const runtime = yield* adapter.openSession({
        threadId,
        providerSessionId: ProviderSessionId.make("cursor-failure-session"),
        modelSelection,
        runtimePolicy,
      });
      const providerThread = yield* runtime.ensureThread({
        threadId,
        modelSelection,
        runtimePolicy,
      });
      const now = yield* DateTime.now;
      yield* runtime.startTurn({
        threadId,
        providerThread,
        modelSelection,
        runtimePolicy,
        runId: RunId.make("cursor-failure-run"),
        runOrdinal: 1,
        providerTurnOrdinal: 1,
        attemptId: RunAttemptId.make("cursor-failure-attempt"),
        rootNodeId: NodeId.make("cursor-failure-root"),
        appThread: {
          id: threadId,
          projectId: ProjectId.make("cursor-failure-project"),
          createdBy: "user",
          creationSource: "web",
          title: "Cursor failure",
          providerInstanceId: instanceId,
          modelSelection,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          activeProviderThreadId: providerThread.id,
          lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
          forkedFrom: null,
          createdAt: now,
          updatedAt: now,
          archivedAt: null,
          settledOverride: null,
          settledAt: null,
          lastVisitedAt: null,
          deletedAt: null,
        },
        message: {
          messageId: MessageId.make("cursor-failure-message"),
          createdBy: "user",
          creationSource: "web",
          text: "hi",
          attachments: [],
        },
      });
      const events = yield* runtime.events.pipe(
        Stream.takeUntil((event) => event.type === "turn.terminal"),
        Stream.runCollect,
      );
      const terminal = events.find((event) => event.type === "turn.terminal");
      assert.equal(terminal?.status, failure === null ? "completed" : "failed");
      assert.equal(terminal?.failure?.class, failure?.class);
      assert.equal(terminal?.failure?.message, failure?.message);
      if (answers !== undefined) {
        assert.deepEqual(
          events.flatMap((event) =>
            event.type === "message.updated" && event.message.role === "assistant"
              ? [event.message.text]
              : [],
          ),
          answers,
        );
      }
    }).pipe(
      Effect.scoped,
      Effect.provide(
        Layer.mergeAll(NodeServices.layer, IdAllocator.layer, McpProviderSessions.layer),
      ),
    ),
  );

  it.effect("fails standalone SDK transport diagnostics and sends compaction as /compress", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const workspace = yield* fileSystem.makeTempDirectoryScoped({ prefix: "cursor-v2-errors-" });
      const sentMessages: Array<string> = [];
      let sendCalls = 0;
      const instanceId = ProviderInstanceId.make("cursor");
      const threadId = ThreadId.make("cursor-transport-error-thread");
      const modelSelection = { instanceId, model: "composer-2.5" };
      const runtimePolicy = ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({
        runtimeMode: "full-access",
        interactionMode: "default",
        cwd: workspace,
      });
      const adapter = yield* makeCursorAdapterV2({
        instanceId,
        environment: { HOME: workspace },
      }).pipe(
        Effect.provideService(CursorAgentSdk.CursorAgentSdkRunner, {
          assertComplete: Effect.void,
          open: () =>
            Effect.succeed({
              agentId: "native-cursor-error",
              listMessages: Effect.succeed([]),
              close: Effect.void,
              send: (input) =>
                Effect.sync(() => {
                  sendCalls += 1;
                  sentMessages.push(
                    typeof input.message === "string" ? input.message : input.message.text,
                  );
                  const runId = `native-cursor-run-${sendCalls}`;
                  return {
                    agentId: "native-cursor-error",
                    runId,
                    wait: Effect.succeed({
                      id: runId,
                      requestId: `native-request-${sendCalls}`,
                      status: "finished" as const,
                      model: { id: "composer-2.5" },
                      durationMs: 1,
                      ...(sendCalls === 1
                        ? { result: "Error: RetriableError: WritableIterable is closed" }
                        : {}),
                    }),
                    cancel: Effect.void,
                    steer: () => Effect.die("unused steer"),
                  };
                }),
            }),
        }),
        Effect.provide(TestProviderHost.layer({ cwd: workspace })),
      );
      const runtime = yield* adapter.openSession({
        threadId,
        providerSessionId: ProviderSessionId.make("cursor-error-session"),
        modelSelection,
        runtimePolicy,
      });
      const providerThread = yield* runtime.ensureThread({
        threadId,
        modelSelection,
        runtimePolicy,
      });
      const now = yield* DateTime.now;
      const appThread = {
        id: threadId,
        projectId: ProjectId.make("cursor-error-project"),
        createdBy: "user" as const,
        creationSource: "web" as const,
        title: "Cursor transport failure",
        providerInstanceId: instanceId,
        modelSelection,
        runtimeMode: "full-access" as const,
        interactionMode: "default" as const,
        branch: null,
        worktreePath: null,
        activeProviderThreadId: providerThread.id,
        lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
        forkedFrom: null,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
        settledOverride: null,
        settledAt: null,
        lastVisitedAt: null,
        deletedAt: null,
      };
      yield* runtime.startTurn({
        threadId,
        providerThread,
        modelSelection,
        runtimePolicy,
        runId: RunId.make("cursor-error-run"),
        runOrdinal: 1,
        providerTurnOrdinal: 1,
        attemptId: RunAttemptId.make("cursor-error-attempt"),
        rootNodeId: NodeId.make("cursor-error-root"),
        appThread,
        message: {
          messageId: MessageId.make("cursor-error-message"),
          createdBy: "user",
          creationSource: "web",
          text: "continue",
          attachments: [],
        },
      });
      const first = yield* runtime.events.pipe(
        Stream.filter((event) => event.type === "turn.terminal"),
        Stream.runHead,
      );
      assert.isTrue(Option.isSome(first));
      if (Option.isSome(first)) {
        assert.equal(first.value.status, "failed");
        assert.equal(first.value.failure?.class, "transport_error");
      }

      assert.isDefined(runtime.compactThread);
      yield* runtime.compactThread!({
        threadId,
        providerThread,
        modelSelection,
        runtimePolicy,
        runId: RunId.make("cursor-compact-run"),
        runOrdinal: 2,
        providerTurnOrdinal: 2,
        attemptId: RunAttemptId.make("cursor-compact-attempt"),
        rootNodeId: NodeId.make("cursor-compact-root"),
        appThread,
        message: {
          messageId: MessageId.make("cursor-compact-message"),
          createdBy: "user",
          creationSource: "web",
          text: "ignored by compactThread",
          attachments: [],
        },
      });
      yield* runtime.events.pipe(
        Stream.filter((event) => event.type === "turn.terminal"),
        Stream.runHead,
      );
      assert.equal(sentMessages[1], "/compress");
    }).pipe(
      Effect.scoped,
      Effect.provide(
        Layer.mergeAll(NodeServices.layer, IdAllocator.layer, McpProviderSessions.layer),
      ),
    ),
  );

  it.effect("sends T3 instructions to each Cursor conversation that lacks them", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const workspace = yield* fileSystem.makeTempDirectoryScoped({ prefix: "cursor-v2-device-" });
      const sentMessages: Array<string> = [];
      const instanceId = ProviderInstanceId.make("cursor");
      const threadId = ThreadId.make("cursor-device-thread");
      const mcpSessions = yield* McpProviderSessions.McpProviderSessions;
      const setDeviceAccess = (device: boolean) =>
        mcpSessions.set({
          environmentId: EnvironmentId.make("cursor-device-environment"),
          threadId,
          providerSessionId: "cursor-device-session",
          providerInstanceId: instanceId,
          endpoint: "http://127.0.0.1:43123/mcp",
          authorizationHeader: "Bearer synthetic-cursor-token",
          browserToolsAvailable: true,
          capabilities: new Set(device ? ["device"] : []),
        });
      const modelSelection = { instanceId, model: "composer-2.5" };
      const runtimePolicy = ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({
        runtimeMode: "full-access",
        interactionMode: "default",
        cwd: workspace,
      });
      const adapter = yield* makeCursorAdapterV2({
        instanceId,
        environment: { HOME: workspace },
      }).pipe(
        Effect.provideService(CursorAgentSdk.CursorAgentSdkRunner, {
          assertComplete: Effect.void,
          open: () =>
            Effect.succeed({
              agentId: "native-cursor-device",
              listMessages: Effect.succeed([]),
              close: Effect.void,
              send: (input) =>
                Effect.sync(() => {
                  sentMessages.push(
                    typeof input.message === "string" ? input.message : input.message.text,
                  );
                  const runId = `native-cursor-run-${sentMessages.length}`;
                  return {
                    agentId: "native-cursor-device",
                    runId,
                    wait: Effect.succeed({
                      id: runId,
                      requestId: `native-request-${sentMessages.length}`,
                      status: "finished" as const,
                      model: { id: "composer-2.5" },
                      durationMs: 1,
                    }),
                    cancel: Effect.void,
                    steer: () => Effect.die("unused steer"),
                  };
                }),
            }),
        }),
        Effect.provide(TestProviderHost.layer({ cwd: workspace })),
      );
      const runtime = yield* adapter.openSession({
        threadId,
        providerSessionId: ProviderSessionId.make("cursor-device-session"),
        modelSelection,
        runtimePolicy,
      });
      const providerThread = yield* runtime.ensureThread({
        threadId,
        modelSelection,
        runtimePolicy,
      });
      const now = yield* DateTime.now;
      const appThread = {
        id: threadId,
        projectId: ProjectId.make("cursor-device-project"),
        createdBy: "user" as const,
        creationSource: "web" as const,
        title: "Cursor devices",
        providerInstanceId: instanceId,
        modelSelection,
        runtimeMode: "full-access" as const,
        interactionMode: "default" as const,
        branch: null,
        worktreePath: null,
        activeProviderThreadId: providerThread.id,
        lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
        forkedFrom: null,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
        settledOverride: null,
        settledAt: null,
        lastVisitedAt: null,
        deletedAt: null,
      };
      // Starts at run 5: a conversation from before device instructions existed, now resumed.
      let runOrdinal = 4;
      const send = Effect.fnUntraced(function* (compact = false) {
        runOrdinal += 1;
        const turnInput = {
          threadId,
          providerThread,
          modelSelection,
          runtimePolicy,
          runId: RunId.make(`cursor-device-run-${runOrdinal}`),
          runOrdinal,
          providerTurnOrdinal: runOrdinal,
          attemptId: RunAttemptId.make(`cursor-device-attempt-${runOrdinal}`),
          rootNodeId: NodeId.make(`cursor-device-root-${runOrdinal}`),
          appThread,
          message: {
            messageId: MessageId.make(`cursor-device-message-${runOrdinal}`),
            createdBy: "user" as const,
            creationSource: "web" as const,
            text: "Open the app.",
            attachments: [],
          },
        };
        yield* compact ? runtime.compactThread!(turnInput) : runtime.startTurn(turnInput);
        yield* runtime.events.pipe(
          Stream.filter((event) => event.type === "turn.terminal"),
          Stream.runHead,
        );
        const sent = sentMessages.at(-1)!;
        return {
          orchestration: sent.includes("## T3 Code orchestration"),
          devices: sent.includes("## T3 Code devices"),
        };
      });
      const told = (orchestration: boolean, devices: boolean) => ({ orchestration, devices });

      yield* setDeviceAccess(true);
      assert.deepEqual(yield* send(), told(false, true));
      assert.deepEqual(yield* send(), told(false, false));
      yield* send(true);
      assert.deepEqual(
        yield* send(),
        told(true, true),
        "compaction drops what the conversation was told",
      );
      yield* setDeviceAccess(false);
      assert.deepEqual(yield* send(), told(false, false));
      yield* setDeviceAccess(true);
      assert.deepEqual(yield* send(), told(false, true), "device access turned on later");
      assert.deepEqual(yield* send(), told(false, false));
    }).pipe(
      Effect.scoped,
      Effect.provide(
        Layer.mergeAll(NodeServices.layer, IdAllocator.layer, McpProviderSessions.layer),
      ),
    ),
  );

  it.effect("projects Cursor directory trees and lint diagnostics as file search results", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const workspace = yield* fileSystem.makeTempDirectoryScoped({ prefix: "cursor-v2-search-" });
      const instanceId = ProviderInstanceId.make("cursor");
      const threadId = ThreadId.make("cursor-search-thread");
      const modelSelection = { instanceId, model: "composer-2.5" };
      const runtimePolicy = ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({
        runtimeMode: "full-access",
        interactionMode: "default",
        cwd: workspace,
      });
      const emptyLsNode = {
        childrenDirs: [],
        childrenFiles: [],
        childrenWereProcessed: true,
        fullSubtreeExtensionCounts: {},
        numFiles: 0,
      };
      const updates: ReadonlyArray<InteractionUpdate> = [
        ...(["tool-call-started", "tool-call-completed"] as const).map((type) => ({
          type,
          modelCallId: "native-model-call",
          callId: "mcp-weather",
          toolCall: {
            type: "mcp" as const,
            args: {
              providerIdentifier: "weather",
              toolName: "get_weather",
              args: { city: "Berlin" },
            },
            ...(type === "tool-call-completed"
              ? {
                  result: {
                    status: "success" as const,
                    value: { content: [{ text: { text: "Sunny" } }], isError: false },
                  },
                }
              : {}),
          },
        })),
        {
          type: "tool-call-completed",
          modelCallId: "native-model-call",
          callId: "read-file",
          toolCall: {
            type: "read",
            args: { path: "src/env.ts" },
            result: {
              status: "success",
              value: { fileSize: 12, content: "---\nfile body", totalLines: 2 },
            },
          },
        },
        {
          type: "tool-call-completed",
          modelCallId: "native-model-call",
          callId: "ls-nested",
          toolCall: {
            type: "ls",
            args: { path: workspace },
            result: {
              status: "success",
              value: {
                directoryTreeRoot: {
                  ...emptyLsNode,
                  absPath: workspace,
                  childrenFiles: [{ name: "README.md" }],
                  childrenDirs: [
                    {
                      ...emptyLsNode,
                      absPath: path.join(workspace, "src"),
                      childrenFiles: [{ name: "index.ts" }],
                      childrenDirs: [
                        {
                          ...emptyLsNode,
                          absPath: path.join(workspace, "src", "nested"),
                          childrenFiles: [{ name: "util.ts" }],
                        },
                      ],
                    },
                  ],
                },
              },
            },
          },
        },
        {
          type: "tool-call-completed",
          modelCallId: "native-model-call",
          callId: "ls-empty",
          toolCall: {
            type: "ls",
            args: { path: path.join(workspace, "empty") },
            result: {
              status: "success",
              value: {
                directoryTreeRoot: { ...emptyLsNode, absPath: path.join(workspace, "empty") },
              },
            },
          },
        },
        {
          type: "tool-call-completed",
          modelCallId: "native-model-call",
          callId: "ls-failed",
          toolCall: {
            type: "ls",
            args: { path: path.join(workspace, "missing") },
            result: { status: "error", error: "ENOENT" },
          },
        },
        {
          type: "tool-call-completed",
          modelCallId: "native-model-call",
          callId: "grep-failed",
          toolCall: {
            type: "grep",
            args: { pattern: "TODO", path: "src" },
            result: { status: "error", error: "search failed" },
          },
        },
        {
          type: "tool-call-completed",
          modelCallId: "native-model-call",
          callId: "grep-counts",
          toolCall: {
            type: "grep",
            args: { pattern: "TODO", outputMode: "count" },
            result: {
              status: "success",
              value: {
                workspaceResults: {
                  [workspace]: {
                    type: "count",
                    output: {
                      counts: [
                        { file: "src/a.ts", count: 1 },
                        { file: "src/b.ts", count: 3 },
                      ],
                      total: 4,
                    },
                  },
                },
              },
            },
          },
        },
        {
          type: "tool-call-completed",
          modelCallId: "native-model-call",
          callId: "glob-failed",
          toolCall: {
            type: "glob",
            args: { globPattern: "*.ts" },
            result: { status: "error", error: "search failed" },
          },
        },
        {
          type: "tool-call-completed",
          modelCallId: "native-model-call",
          callId: "lints",
          toolCall: {
            type: "readLints",
            args: { paths: ["src/a.ts", "src/b.ts"] },
            result: {
              status: "success",
              value: {
                totalFiles: 2,
                totalDiagnostics: 3,
                fileDiagnostics: [
                  {
                    path: "src/a.ts",
                    diagnosticsCount: 2,
                    diagnostics: [
                      {
                        message: "Unused variable",
                        code: "TS6133",
                        source: "ts",
                        severity: "warning",
                        range: { start: { line: 0, character: 4 } },
                      },
                      {
                        message: "Cannot find name",
                        code: "TS2304",
                        source: "ts",
                        severity: "error",
                        range: { start: { line: 11 } },
                      },
                    ],
                  },
                  {
                    path: "src/b.ts",
                    diagnosticsCount: 1,
                    diagnostics: [
                      {
                        message: "File-level diagnostic",
                        code: "TS0",
                        source: "ts",
                        severity: "information",
                      },
                    ],
                  },
                ],
              },
            },
          },
        },
        {
          type: "tool-call-completed",
          modelCallId: "native-model-call",
          callId: "lints-empty",
          toolCall: {
            type: "readLints",
            args: { paths: ["src/clean.ts"] },
            result: {
              status: "success",
              value: {
                totalFiles: 1,
                totalDiagnostics: 0,
                fileDiagnostics: [{ path: "src/clean.ts", diagnosticsCount: 0, diagnostics: [] }],
              },
            },
          },
        },
        {
          type: "tool-call-completed",
          modelCallId: "native-model-call",
          callId: "lints-failed",
          toolCall: {
            type: "readLints",
            args: { paths: ["src/a.ts"] },
            result: { status: "error", error: "lint failed" },
          },
        },
      ];
      const adapter = yield* makeCursorAdapterV2({
        instanceId,
        environment: { HOME: workspace },
      }).pipe(
        Effect.provideService(CursorAgentSdk.CursorAgentSdkRunner, {
          assertComplete: Effect.void,
          open: () =>
            Effect.succeed({
              agentId: "native-cursor-search",
              listMessages: Effect.succeed([]),
              close: Effect.void,
              send: (input) =>
                Effect.gen(function* () {
                  for (const update of updates) {
                    if (input.onDelta !== undefined) {
                      yield* input.onDelta(update).pipe(Effect.orDie);
                    }
                  }
                  return {
                    agentId: "native-cursor-search",
                    runId: "native-cursor-run",
                    wait: Effect.succeed({
                      id: "native-cursor-run",
                      requestId: "native-request",
                      status: "finished" as const,
                      model: { id: "composer-2.5" },
                      durationMs: 1,
                    }),
                    cancel: Effect.void,
                    steer: () => Effect.die("unused steer"),
                  };
                }),
            }),
        }),
        Effect.provide(TestProviderHost.layer({ cwd: workspace })),
      );
      const runtime = yield* adapter.openSession({
        threadId,
        providerSessionId: ProviderSessionId.make("cursor-search-session"),
        modelSelection,
        runtimePolicy,
      });
      const providerThread = yield* runtime.ensureThread({
        threadId,
        modelSelection,
        runtimePolicy,
      });
      const now = yield* DateTime.now;
      yield* runtime.startTurn({
        threadId,
        providerThread,
        modelSelection,
        runtimePolicy,
        runId: RunId.make("cursor-search-run"),
        runOrdinal: 1,
        providerTurnOrdinal: 1,
        attemptId: RunAttemptId.make("cursor-search-attempt"),
        rootNodeId: NodeId.make("cursor-search-root"),
        appThread: {
          id: threadId,
          projectId: ProjectId.make("cursor-search-project"),
          createdBy: "user",
          creationSource: "web",
          title: "Cursor search results",
          providerInstanceId: instanceId,
          modelSelection,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          activeProviderThreadId: providerThread.id,
          lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
          forkedFrom: null,
          createdAt: now,
          updatedAt: now,
          archivedAt: null,
          settledOverride: null,
          settledAt: null,
          lastVisitedAt: null,
          deletedAt: null,
        },
        message: {
          messageId: MessageId.make("cursor-search-message"),
          createdBy: "user",
          creationSource: "web",
          text: "inspect the workspace",
          attachments: [],
        },
      });
      const events = yield* runtime.events.pipe(
        Stream.takeUntil((event) => event.type === "turn.terminal"),
        Stream.runCollect,
      );
      const mcpItems = events.flatMap((event) =>
        event.type === "turn_item.updated" &&
        event.turnItem.type === "dynamic_tool" &&
        event.turnItem.toolName === "mcp__weather__get_weather"
          ? [event.turnItem]
          : [],
      );
      assert.deepEqual(
        mcpItems.map((item) => item.status),
        ["running", "completed"],
      );
      for (const item of mcpItems) {
        assert.equal(item.title, "get weather");
        assert.deepEqual(item.toolSource, {
          key: "mcp:weather",
          name: "weather",
          kind: "integration",
        });
        assert.deepEqual(item.input, { city: "Berlin" });
      }
      assert.deepEqual(mcpItems.at(-1)?.output, {
        content: [{ type: "text", text: "Sunny" }],
        isError: false,
      });
      const fileSearchItems = events.flatMap((event) =>
        event.type === "turn_item.updated" &&
        event.turnItem.type === "file_search" &&
        event.turnItem.status !== "running"
          ? [event.turnItem]
          : [],
      );
      const readItems = events.flatMap((event) =>
        event.type === "turn_item.updated" &&
        event.turnItem.type === "dynamic_tool" &&
        event.turnItem.toolName === "Read" &&
        event.turnItem.status === "completed"
          ? [event.turnItem]
          : [],
      );
      assert.deepEqual(
        readItems.map((item) => ({ title: item.title, input: item.input })),
        [{ title: "Read src/env.ts", input: { path: "src/env.ts" } }],
      );
      assert.deepEqual(
        fileSearchItems.map((item) => ({
          pattern: item.pattern,
          status: item.status,
          results: item.results,
        })),
        [
          {
            pattern: workspace,
            status: "completed",
            results: [
              { fileName: path.join(workspace, "README.md") },
              { fileName: path.join(workspace, "src", "index.ts") },
              { fileName: path.join(workspace, "src", "nested", "util.ts") },
            ],
          },
          {
            pattern: path.join(workspace, "empty"),
            status: "completed",
            results: undefined,
          },
          {
            pattern: path.join(workspace, "missing"),
            status: "failed",
            results: [{ fileName: path.join(workspace, "missing"), preview: "ENOENT" }],
          },
          {
            pattern: "TODO",
            status: "failed",
            results: [{ fileName: "src", preview: "search failed" }],
          },
          {
            pattern: "TODO",
            status: "completed",
            results: [
              { fileName: "src/a.ts", preview: "1 match" },
              { fileName: "src/b.ts", preview: "3 matches" },
            ],
          },
          {
            pattern: "*.ts",
            status: "failed",
            results: [{ fileName: ".", preview: "search failed" }],
          },
          {
            pattern: "src/a.ts, src/b.ts",
            status: "completed",
            results: [
              { fileName: "src/a.ts", line: 1, column: 5, preview: "Unused variable" },
              { fileName: "src/a.ts", line: 12, preview: "Cannot find name" },
              { fileName: "src/b.ts", preview: "File-level diagnostic" },
            ],
          },
          {
            pattern: "src/clean.ts",
            status: "completed",
            results: undefined,
          },
          {
            pattern: "src/a.ts",
            status: "failed",
            results: [{ fileName: "src/a.ts", preview: "lint failed" }],
          },
        ],
      );
    }).pipe(
      Effect.scoped,
      Effect.provide(
        Layer.mergeAll(NodeServices.layer, IdAllocator.layer, McpProviderSessions.layer),
      ),
    ),
  );

  it.effect("projects subagent directory trees Cursor serialized without empty lists", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const workspace = yield* fileSystem.makeTempDirectoryScoped({ prefix: "cursor-v2-task-ls-" });
      const instanceId = ProviderInstanceId.make("cursor");
      const threadId = ThreadId.make("cursor-task-ls-thread");
      const modelSelection = { instanceId, model: "composer-2.5" };
      const runtimePolicy = ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({
        runtimeMode: "full-access",
        interactionMode: "default",
        cwd: workspace,
      });
      // The SDK serializes subagent steps with protobuf toJson(), which omits empty repeated fields.
      const conversationSteps = [
        {
          toolCall: {
            toolCallId: "tool:ls",
            lsToolCall: {
              args: { path: workspace },
              result: {
                success: {
                  directoryTreeRoot: {
                    absPath: workspace,
                    childrenWereProcessed: true,
                    childrenDirs: [
                      {
                        absPath: path.join(workspace, "src"),
                        childrenFiles: [{ name: "index.ts" }],
                        childrenWereProcessed: true,
                        numFiles: 1,
                      },
                    ],
                  },
                },
              },
            },
          },
        },
        {
          toolCall: {
            toolCallId: "tool:lints",
            readLintsToolCall: { args: {}, result: { success: {} } },
          },
        },
        {
          toolCall: {
            toolCallId: "tool:lints-clean-file",
            readLintsToolCall: {
              args: {},
              result: { success: { fileDiagnostics: [{ path: "src/clean.ts" }] } },
            },
          },
        },
        {
          toolCall: {
            toolCallId: "tool:mcp",
            mcpToolCall: {
              args: { providerIdentifier: "docs", toolName: "lookup", args: { query: "ls" } },
              result: { success: {} },
            },
          },
        },
      ];
      const adapter = yield* makeCursorAdapterV2({
        instanceId,
        environment: { HOME: workspace },
      }).pipe(
        Effect.provideService(CursorAgentSdk.CursorAgentSdkRunner, {
          assertComplete: Effect.void,
          open: () =>
            Effect.succeed({
              agentId: "native-cursor-task-ls",
              listMessages: Effect.succeed([]),
              close: Effect.void,
              send: (input) =>
                Effect.gen(function* () {
                  const args = {
                    description: "Explore",
                    prompt: "List the workspace.",
                    subagentType: { kind: "unspecified" as const },
                    agentId: "cursor-task-agent",
                    mode: "unspecified" as const,
                  };
                  yield* input.onDelta!({
                    type: "tool-call-started",
                    modelCallId: "model-call",
                    callId: "task-call",
                    toolCall: { type: "task", args },
                  });
                  yield* input.onDelta!({
                    type: "tool-call-completed",
                    modelCallId: "model-call",
                    callId: "task-call",
                    toolCall: {
                      type: "task",
                      args,
                      result: {
                        status: "success",
                        value: {
                          conversationSteps,
                          isBackground: false,
                          backgroundReason: "unspecified",
                        },
                      },
                    },
                  });
                  return {
                    agentId: "native-cursor-task-ls",
                    runId: "native-cursor-run",
                    wait: Effect.succeed({
                      id: "native-cursor-run",
                      requestId: "native-request",
                      status: "finished" as const,
                      model: { id: "composer-2.5" },
                      durationMs: 1,
                    }),
                    cancel: Effect.void,
                    steer: () => Effect.die("unused steer"),
                  };
                }).pipe(Effect.orDie),
            }),
        }),
        Effect.provide(TestProviderHost.layer({ cwd: workspace })),
      );
      const runtime = yield* adapter.openSession({
        threadId,
        providerSessionId: ProviderSessionId.make("cursor-task-ls-session"),
        modelSelection,
        runtimePolicy,
      });
      const providerThread = yield* runtime.ensureThread({
        threadId,
        modelSelection,
        runtimePolicy,
      });
      const now = yield* DateTime.now;
      yield* runtime.startTurn({
        threadId,
        providerThread,
        modelSelection,
        runtimePolicy,
        runId: RunId.make("cursor-task-ls-run"),
        runOrdinal: 1,
        providerTurnOrdinal: 1,
        attemptId: RunAttemptId.make("cursor-task-ls-attempt"),
        rootNodeId: NodeId.make("cursor-task-ls-root"),
        appThread: {
          id: threadId,
          projectId: ProjectId.make("cursor-task-ls-project"),
          createdBy: "user",
          creationSource: "web",
          title: "Cursor subagent ls",
          providerInstanceId: instanceId,
          modelSelection,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          activeProviderThreadId: providerThread.id,
          lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
          forkedFrom: null,
          createdAt: now,
          updatedAt: now,
          archivedAt: null,
          settledOverride: null,
          settledAt: null,
          lastVisitedAt: null,
          deletedAt: null,
        },
        message: {
          messageId: MessageId.make("cursor-task-ls-message"),
          createdBy: "user",
          creationSource: "web",
          text: "List the workspace with a subagent.",
          attachments: [],
        },
      });
      const events = yield* runtime.events.pipe(
        Stream.takeUntil((event) => event.type === "turn.terminal"),
        Stream.runCollect,
      );
      const terminal = events.find((event) => event.type === "turn.terminal");
      assert.equal(terminal?.status, "completed");
      const childThreadId = events.findLast((event) => event.type === "subagent.updated")?.subagent
        .childThreadId;
      assert.isDefined(childThreadId);
      assert.deepEqual(
        events.flatMap((event): ReadonlyArray<unknown> => {
          if (event.type !== "turn_item.updated" || event.turnItem.threadId !== childThreadId) {
            return [];
          }
          const item = event.turnItem;
          return item.type === "file_search"
            ? [{ status: item.status, pattern: item.pattern, results: item.results ?? [] }]
            : item.type === "dynamic_tool"
              ? [{ status: item.status, toolName: item.toolName, output: item.output }]
              : [];
        }),
        [
          {
            status: "completed",
            pattern: workspace,
            results: [{ fileName: path.join(workspace, "src", "index.ts") }],
          },
          { status: "completed", pattern: "", results: [] },
          { status: "completed", pattern: "", results: [] },
          {
            status: "completed",
            toolName: "mcp__docs__lookup",
            output: { content: [], isError: false },
          },
        ],
      );
    }).pipe(
      Effect.scoped,
      Effect.provide(
        Layer.mergeAll(NodeServices.layer, IdAllocator.layer, McpProviderSessions.layer),
      ),
    ),
  );

  it.effect("names a custom model Cursor's account catalog rejects", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const workspace = yield* fileSystem.makeTempDirectoryScoped({ prefix: "cursor-v2-model-" });
      const instanceId = ProviderInstanceId.make("cursor");
      const threadId = ThreadId.make("cursor-custom-model-thread");
      const catalogModel = { instanceId, model: "composer-2.5" };
      const customModel = { instanceId, model: "deepseek/deepseek-v4.1-flash" };
      const runtimePolicy = ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({
        runtimeMode: "full-access",
        interactionMode: "default",
        cwd: workspace,
      });
      // The SDK checks every create, resume, and send model against the account catalog.
      const checkModel = (method: string, model: { readonly id: string } | undefined) =>
        model === undefined || model.id === "composer-2.5"
          ? Effect.void
          : Effect.fail(
              new CursorAgentSdk.CursorAgentSdkRunnerError({
                method,
                cause: new ConfigurationError(
                  `Cannot use this model: ${model.id}. Available models: default, composer-2.5. Use Cursor.models.list() to discover valid selections.`,
                  { isRetryable: false },
                ),
              }),
            );
      const adapter = yield* makeCursorAdapterV2({
        instanceId,
        environment: { HOME: workspace },
      }).pipe(
        Effect.provideService(CursorAgentSdk.CursorAgentSdkRunner, {
          assertComplete: Effect.void,
          open: (input) =>
            checkModel(`agent.${input.operation}`, input.options.model).pipe(
              Effect.as({
                agentId: "native-cursor-custom-model",
                listMessages: Effect.succeed([]),
                close: Effect.void,
                send: (sendInput) =>
                  checkModel("run.start", sendInput.options?.model).pipe(
                    Effect.andThen(Effect.die("unexpected Cursor run")),
                  ),
              }),
            ),
        }),
        Effect.provide(TestProviderHost.layer({ cwd: workspace })),
      );
      const runtime = yield* adapter.openSession({
        threadId,
        providerSessionId: ProviderSessionId.make("cursor-custom-model-session"),
        modelSelection: catalogModel,
        runtimePolicy,
      });
      const expected =
        'Cursor cannot run the model "deepseek/deepseek-v4.1-flash". Cursor only runs models from your Cursor account. Choose one of those, or use OpenCode for OpenRouter and other API-key models.';

      const createFailure = yield* runtime
        .ensureThread({ threadId, modelSelection: customModel, runtimePolicy })
        .pipe(Effect.flip);
      assert.equal(makeProviderFailure({ cause: createFailure }).message, expected);

      const providerThread = yield* runtime.ensureThread({
        threadId,
        modelSelection: catalogModel,
        runtimePolicy,
      });
      const now = yield* DateTime.now;
      const sendFailure = yield* runtime
        .startTurn({
          threadId,
          providerThread,
          modelSelection: customModel,
          runtimePolicy,
          runId: RunId.make("cursor-custom-model-run"),
          runOrdinal: 1,
          providerTurnOrdinal: 1,
          attemptId: RunAttemptId.make("cursor-custom-model-attempt"),
          rootNodeId: NodeId.make("cursor-custom-model-root"),
          appThread: {
            id: threadId,
            projectId: ProjectId.make("cursor-custom-model-project"),
            createdBy: "user",
            creationSource: "web",
            title: "Cursor custom model",
            providerInstanceId: instanceId,
            modelSelection: customModel,
            runtimeMode: "full-access",
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            activeProviderThreadId: providerThread.id,
            lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
            forkedFrom: null,
            createdAt: now,
            updatedAt: now,
            archivedAt: null,
            settledOverride: null,
            settledAt: null,
            lastVisitedAt: null,
            deletedAt: null,
          },
          message: {
            messageId: MessageId.make("cursor-custom-model-message"),
            createdBy: "user",
            creationSource: "web",
            text: "Hello.",
            attachments: [],
          },
        })
        .pipe(Effect.flip);
      assert.equal(makeProviderFailure({ cause: sendFailure }).message, expected);
    }).pipe(
      Effect.scoped,
      Effect.provide(
        Layer.mergeAll(NodeServices.layer, IdAllocator.layer, McpProviderSessions.layer),
      ),
    ),
  );

  it("maps Cursor auto and model parameters to SDK selections", () => {
    assert.deepEqual(
      cursorSdkModelSelection({
        instanceId: ProviderInstanceId.make("cursor"),
        model: "auto",
        options: [
          { id: "thinking", value: "high" },
          { id: "contextWindow", value: "1m" },
          { id: "fastMode", value: true },
          // T3's own thread option never reaches Cursor.
          { id: "stopAtSubscriptionLimit", value: true },
        ],
      }),
      {
        id: "default",
        params: [
          { id: "thinking", value: "high" },
          { id: "context", value: "1m" },
          { id: "fast", value: "true" },
        ],
      },
    );
  });

  it("maps runtime modes to the SDK sandbox and auto-review controls", () => {
    const base = {
      interactionMode: "default" as const,
      cwd: "/tmp/cursor-adapter",
    };
    assert.deepEqual(
      cursorRuntimeAgentPolicy(
        {
          ...base,
          runtimeMode: "full-access",
        },
        "linux",
      ),
      {
        autoReview: false,
        sandboxEnabled: false,
      },
    );
    assert.deepEqual(
      cursorRuntimeAgentPolicy(
        {
          ...base,
          runtimeMode: "auto-accept-edits",
        },
        "linux",
      ),
      {
        autoReview: false,
        sandboxEnabled: true,
      },
    );
    assert.deepEqual(
      cursorRuntimeAgentPolicy(
        {
          ...base,
          runtimeMode: "auto",
        },
        "linux",
      ),
      {
        autoReview: true,
        sandboxEnabled: true,
      },
    );
    assert.deepEqual(
      cursorRuntimeAgentPolicy(
        {
          ...base,
          runtimeMode: "approval-required",
        },
        "linux",
      ),
      {
        autoReview: true,
        sandboxEnabled: true,
      },
    );
    assert.deepEqual(
      cursorRuntimeAgentPolicy(
        {
          ...base,
          runtimeMode: "full-access",
          approvalPolicy: "never",
          sandboxPolicy: { type: "readOnly" },
        },
        "linux",
      ),
      {
        autoReview: false,
        sandboxEnabled: true,
      },
    );
    assert.deepEqual(
      cursorRuntimeAgentPolicy(
        {
          ...base,
          runtimeMode: "approval-required",
          approvalPolicy: "never",
          sandboxPolicy: { type: "dangerFullAccess" },
        },
        "linux",
      ),
      {
        autoReview: false,
        sandboxEnabled: false,
      },
    );
    assert.deepEqual(
      cursorRuntimeAgentPolicy(
        {
          ...base,
          runtimeMode: "auto-accept-edits",
        },
        "win32",
      ),
      {
        autoReview: false,
        sandboxEnabled: true,
      },
    );
    assert.deepEqual(
      cursorRuntimeAgentPolicy(
        {
          ...base,
          runtimeMode: "auto",
          approvalPolicy: "never",
        },
        "win32",
      ),
      {
        autoReview: false,
        sandboxEnabled: true,
      },
    );
    // Auto-review can gate Windows execution without the unsupported SDK sandbox.
    assert.deepEqual(
      cursorRuntimeAgentPolicy(
        {
          ...base,
          runtimeMode: "auto",
        },
        "win32",
      ),
      {
        autoReview: true,
        sandboxEnabled: false,
      },
    );
    assert.deepEqual(
      cursorRuntimeAgentPolicy(
        {
          ...base,
          runtimeMode: "auto",
          sandboxPolicy: { type: "workspaceWrite" },
        },
        "win32",
      ),
      {
        autoReview: true,
        sandboxEnabled: true,
      },
    );
  });

  it("injects thread-scoped MCP credentials without logging them", () => {
    const threadId = ThreadId.make("thread-cursor-mcp");
    const mcpSession = {
      environmentId: EnvironmentId.make("environment-cursor-mcp"),
      threadId,
      providerSessionId: "mcp-session-cursor",
      providerInstanceId: ProviderInstanceId.make("cursor"),
      endpoint: "http://127.0.0.1:43123/mcp",
      authorizationHeader: "Bearer secret-cursor-mcp-token",
      browserToolsAvailable: true,
    };

    assert.deepEqual(cursorMcpServers(mcpSession), {
      "t3-code": {
        type: "http",
        url: "http://127.0.0.1:43123/mcp",
        headers: {
          Authorization: "Bearer secret-cursor-mcp-token",
        },
      },
    });

    const options = makeCursorAgentOptions({
      apiKey: "secret-cursor-api-key",
      modelSelection: {
        instanceId: ProviderInstanceId.make("cursor"),
        model: "composer-2.5",
      },
      runtimePolicy: {
        runtimeMode: "full-access",
        interactionMode: "default",
        cwd: "/workspace",
      },
      threadId,
      mcpSession,
      platform: "linux",
    });
    assert.deepEqual(options.mcpServers, cursorMcpServers(mcpSession));

    const logged = JSON.stringify(CursorAgentSdk.loggedCursorAgentOptions(options));
    assert.notInclude(logged, "secret-cursor-api-key");
    assert.notInclude(logged, "secret-cursor-mcp-token");
  });

  it("recognizes direct and SDK-wrapped abort failures as cancellation", () => {
    assert.isTrue(CursorAgentSdk.isCursorCancellationError({ name: "AbortError" }));
    assert.isTrue(
      CursorAgentSdk.isCursorCancellationError({
        name: "ConnectError",
        cause: {
          name: "ConnectError",
          cause: { name: "AbortError" },
        },
      }),
    );
    assert.isFalse(CursorAgentSdk.isCursorCancellationError(new Error("request failed")));
    assert.isFalse(CursorAgentSdk.isCursorCancellationError(null));
  });

  it("classifies an exhausted Cursor allowance as a usage limit", () => {
    // Recorded from Cursor's SDK `run.completed` result when an account ran out of usage.
    const failure = cursorRunFailure({
      message:
        "Increase limits for faster responses You're out of usage. Switch to Auto, or ask your admin to increase your limit to continue.",
    });
    assert.equal(failure.class, "usage_limit");
    assert.equal(failure.code, "cursor_out_of_usage");
    assert.include(failure.message, "out of usage");
  });

  it("keeps other Cursor run errors as provider errors with Cursor's message", () => {
    for (const [error, message] of [
      [{ message: "Something went wrong." }, "Something went wrong."],
      ["ENOENT", "ENOENT"],
      [undefined, "Provider turn failed."],
    ] as const) {
      const failure = cursorRunFailure(error);
      assert.equal(failure.class, "provider_error");
      assert.equal(failure.message, message);
    }
  });

  it("reads nested lint results whose clean files omit diagnostics", () => {
    assert.deepEqual(
      nestedToolCallFromEnvelope({
        toolCallId: "tool:lints",
        readLintsToolCall: {
          args: { paths: ["src/clean.ts", "src/broken.ts"] },
          result: {
            success: {
              fileDiagnostics: [
                { path: "src/clean.ts" },
                {
                  path: "src/broken.ts",
                  diagnostics: [
                    {
                      severity: "error",
                      message: "Cannot find name 'x'.",
                      source: "ts",
                      code: "2304",
                    },
                  ],
                },
              ],
            },
          },
        },
      }),
      {
        callId: "tool:lints",
        toolCall: {
          type: "readLints",
          args: { paths: ["src/clean.ts", "src/broken.ts"] },
          result: {
            status: "success",
            value: {
              fileDiagnostics: [
                { path: "src/clean.ts", diagnostics: [], diagnosticsCount: 0 },
                {
                  path: "src/broken.ts",
                  diagnostics: [
                    {
                      severity: "error",
                      message: "Cannot find name 'x'.",
                      source: "ts",
                      code: "2304",
                    },
                  ],
                  diagnosticsCount: 1,
                },
              ],
              totalFiles: 2,
              totalDiagnostics: 1,
            },
          },
        },
      },
    );
  });

  it("preserves failed nested read calls when Cursor omits their path", () => {
    assert.deepEqual(
      nestedToolCallFromEnvelope({
        toolCallId: "tool:failed-read",
        readToolCall: {
          args: {},
          result: { error: "File path was not provided." },
        },
      }),
      {
        callId: "tool:failed-read",
        toolCall: {
          type: "read",
          args: { path: "<unknown path>" },
          result: {
            status: "error",
            error: "File path was not provided.",
          },
        },
      },
    );
  });

  it.effect("injects a follow-up into the running Cursor turn", () =>
    Effect.gen(function* () {
      assert.isTrue(CursorProviderCapabilitiesV2.turns.supportsActiveSteering);
      assert.isFalse("activeSteeringInterruptsTools" in CursorProviderCapabilitiesV2.turns);
      const isSteerError = Schema.is(ProviderAdapter.ProviderAdapterSteerRunError);
      const isProtocolError = Schema.is(ProviderAdapter.ProviderAdapterProtocolError);

      const fileSystem = yield* FileSystem.FileSystem;
      const workspace = yield* fileSystem.makeTempDirectoryScoped({ prefix: "cursor-v2-steer-" });
      const idAllocator = yield* IdAllocator.IdAllocatorV2;
      const finished = yield* Deferred.make<void>();
      const steered: Array<string> = [];
      let steerOutcome: "complete_delivered" | "revert_to_followup" = "complete_delivered";
      const instanceId = ProviderInstanceId.make("cursor");
      const threadId = ThreadId.make("cursor-steer-thread");
      const modelSelection = { instanceId, model: "composer-2.5" };
      const runtimePolicy = ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({
        runtimeMode: "full-access",
        interactionMode: "default",
        cwd: workspace,
      });
      const adapter = yield* makeCursorAdapterV2({
        instanceId,
        environment: { HOME: workspace },
      }).pipe(
        Effect.provideService(CursorAgentSdk.CursorAgentSdkRunner, {
          assertComplete: Effect.void,
          open: () =>
            Effect.succeed({
              agentId: "native-cursor-steer",
              listMessages: Effect.succeed([]),
              close: Effect.void,
              send: () =>
                Effect.succeed({
                  agentId: "native-cursor-steer",
                  runId: "native-cursor-steer-run",
                  wait: Deferred.await(finished).pipe(
                    Effect.as({
                      id: "native-cursor-steer-run",
                      requestId: "native-request",
                      status: "finished" as const,
                      model: { id: "composer-2.5" },
                      durationMs: 1,
                    }),
                  ),
                  cancel: Effect.void,
                  steer: (message: string) =>
                    Effect.sync(() => {
                      steered.push(message);
                      return steerOutcome;
                    }),
                }),
            }),
        }),
        Effect.provide(TestProviderHost.layer({ cwd: workspace })),
      );
      const runtime = yield* adapter.openSession({
        threadId,
        providerSessionId: ProviderSessionId.make("cursor-steer-session"),
        modelSelection,
        runtimePolicy,
      });
      const providerThread = yield* runtime.ensureThread({
        threadId,
        modelSelection,
        runtimePolicy,
      });
      const now = yield* DateTime.now;
      const providerTurnId = idAllocator.derive.providerTurn({
        driver: CursorAgentSdk.CURSOR_PROVIDER,
        nativeTurnId: "native-cursor-steer-run",
      });
      const steer = (text: string) =>
        runtime.steerTurn({
          threadId,
          runId: RunId.make("cursor-steer-run"),
          providerThread,
          providerTurnId,
          message: {
            messageId: MessageId.make("cursor-steer-message"),
            createdBy: "agent",
            creationSource: "server",
            text,
            attachments: [],
          },
        });
      yield* runtime.startTurn({
        threadId,
        providerThread,
        modelSelection,
        runtimePolicy,
        runId: RunId.make("cursor-steer-run"),
        runOrdinal: 1,
        providerTurnOrdinal: 1,
        attemptId: RunAttemptId.make("cursor-steer-attempt"),
        rootNodeId: NodeId.make("cursor-steer-root"),
        appThread: {
          id: threadId,
          projectId: ProjectId.make("cursor-steer-project"),
          createdBy: "user",
          creationSource: "web",
          title: "Cursor steer",
          providerInstanceId: instanceId,
          modelSelection,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          activeProviderThreadId: providerThread.id,
          lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
          forkedFrom: null,
          createdAt: now,
          updatedAt: now,
          archivedAt: null,
          settledOverride: null,
          settledAt: null,
          lastVisitedAt: null,
          deletedAt: null,
        },
        message: {
          messageId: MessageId.make("cursor-steer-start"),
          createdBy: "user",
          creationSource: "web",
          text: "start",
          attachments: [],
        },
      });

      yield* steer("Delegated task finished.");
      assert.deepEqual(steered, ["Delegated task finished."]);

      const empty = yield* steer("  ").pipe(Effect.flip);
      assert.isTrue(isSteerError(empty));
      assert.equal(
        isProtocolError(empty.cause) ? empty.cause.detail : undefined,
        "Cursor steering requires non-empty text.",
      );
      assert.deepEqual(steered, ["Delegated task finished."]);

      steerOutcome = "revert_to_followup";
      const declined = yield* steer("Still running.").pipe(Effect.flip);
      assert.isTrue(isSteerError(declined));
      assert.equal(
        isProtocolError(declined.cause) ? declined.cause.detail : undefined,
        "Cursor declined to inject the steering message into the active run.",
      );

      yield* Deferred.succeed(finished, undefined);
      yield* runtime.events.pipe(
        Stream.filter((event) => event.type === "turn.terminal"),
        Stream.take(1),
        Stream.runDrain,
      );
      const inactive = yield* steer("Too late.").pipe(Effect.flip);
      assert.isTrue(isSteerError(inactive));
      assert.equal(
        isProtocolError(inactive.cause) ? inactive.cause.detail : undefined,
        `Cursor provider turn ${providerTurnId} is not active.`,
      );
    }).pipe(
      Effect.scoped,
      Effect.provide(
        Layer.mergeAll(NodeServices.layer, IdAllocator.layer, McpProviderSessions.layer),
      ),
    ),
  );
});

describe("CursorAdapterV2 subscription-limit guard", () => {
  const usage = (percents: Readonly<Record<string, number>>) => Ref.make(percents);

  const makeGuardedSession = Effect.fn(function* (input: {
    readonly name: string;
    readonly model?: string;
    readonly usedPercent: Ref.Ref<Readonly<Record<string, number>>>;
    readonly guardSwitchedOn: Queue.Queue<void>;
    readonly cancelled: Deferred.Deferred<void>;
  }) {
    const fileSystem = yield* FileSystem.FileSystem;
    const workspace = yield* fileSystem.makeTempDirectoryScoped({ prefix: "cursor-v2-guard-" });
    const instanceId = ProviderInstanceId.make("cursor");
    const threadId = ThreadId.make(`cursor-guard-${input.name}`);
    const modelSelection = { instanceId, model: input.model ?? "composer-2.5" };
    const runtimePolicy = ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({
      runtimeMode: "full-access",
      interactionMode: "default",
      cwd: workspace,
    });
    const sends = yield* Ref.make(0);
    const adapter = yield* makeCursorAdapterV2({
      instanceId,
      environment: { HOME: workspace },
      subscriptionLimit: {
        policy: {
          enabled: () => Effect.succeed(true),
          enabledChanges: () => Stream.fromQueue(input.guardSwitchedOn),
        },
        checkUsage: Effect.gen(function* () {
          return {
            checkedAt: "2026-10-21T08:00:00.000Z",
            windows: Object.entries(yield* Ref.get(input.usedPercent)).map(([id, usedPercent]) => ({
              id,
              kind: "monthly" as const,
              label: id,
              usedPercent,
              resetsAt: "2033-05-19T07:20:00.000Z",
            })),
          };
        }),
      },
    }).pipe(
      Effect.provideService(CursorAgentSdk.CursorAgentSdkRunner, {
        assertComplete: Effect.void,
        open: () =>
          Effect.succeed({
            agentId: `native-cursor-guard-${input.name}`,
            listMessages: Effect.succeed([]),
            close: Effect.void,
            send: () =>
              Ref.update(sends, (count) => count + 1).pipe(
                Effect.as({
                  agentId: `native-cursor-guard-${input.name}`,
                  runId: `native-cursor-guard-run-${input.name}`,
                  wait: Deferred.await(input.cancelled).pipe(
                    Effect.as({
                      id: `native-cursor-guard-run-${input.name}`,
                      requestId: "native-request",
                      status: "cancelled" as const,
                      model: { id: "composer-2.5" },
                      durationMs: 1,
                    }),
                  ),
                  cancel: Deferred.succeed(input.cancelled, undefined).pipe(Effect.asVoid),
                  steer: () => Effect.succeed("complete_delivered" as const),
                }),
              ),
          }),
      }),
      Effect.provide(TestProviderHost.layer({ cwd: workspace })),
    );
    const runtime = yield* adapter.openSession({
      threadId,
      providerSessionId: ProviderSessionId.make(`cursor-guard-session-${input.name}`),
      modelSelection,
      runtimePolicy,
    });
    const providerThread = yield* runtime.ensureThread({ threadId, modelSelection, runtimePolicy });
    const now = yield* DateTime.now;
    const startTurn = runtime.startTurn({
      threadId,
      providerThread,
      modelSelection,
      runtimePolicy,
      runId: RunId.make(`cursor-guard-run-${input.name}`),
      runOrdinal: 1,
      providerTurnOrdinal: 1,
      attemptId: RunAttemptId.make(`cursor-guard-attempt-${input.name}`),
      rootNodeId: NodeId.make(`cursor-guard-root-${input.name}`),
      appThread: {
        id: threadId,
        projectId: ProjectId.make("cursor-guard-project"),
        createdBy: "user",
        creationSource: "web",
        title: "Cursor guard",
        providerInstanceId: instanceId,
        modelSelection,
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        activeProviderThreadId: providerThread.id,
        lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
        forkedFrom: null,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
        settledOverride: null,
        settledAt: null,
        lastVisitedAt: null,
        deletedAt: null,
      },
      message: {
        messageId: MessageId.make(`cursor-guard-message-${input.name}`),
        createdBy: "user",
        creationSource: "web",
        text: "Keep going.",
        attachments: [],
      },
    });
    return { runtime, startTurn, sends };
  });

  it.effect(
    "refuses a guarded Composer turn before Cursor runs it once both pools are used up",
    () =>
      Effect.gen(function* () {
        const session = yield* makeGuardedSession({
          name: "refused",
          usedPercent: yield* usage({ autoPercentUsed: 100, apiPercentUsed: 100 }),
          guardSwitchedOn: yield* Queue.unbounded<void>(),
          cancelled: yield* Deferred.make<void>(),
        });
        const error = yield* session.startTurn.pipe(Effect.flip);
        const failure = findSubscriptionLimitStop(error);
        assert.equal(failure?.class, "usage_limit");
        assert.equal(failure?.resetAt, "2033-05-19T07:20:00.000Z");
        assert.equal(yield* Ref.get(session.sends), 0);
      }).pipe(
        Effect.scoped,
        Effect.provide(
          Layer.mergeAll(NodeServices.layer, IdAllocator.layer, McpProviderSessions.layer),
        ),
      ),
  );

  it.effect("cancels a running guarded turn once a recheck finds the allowance used up", () =>
    Effect.gen(function* () {
      const usedPercent = yield* usage({ autoPercentUsed: 40, apiPercentUsed: 100 });
      const guardSwitchedOn = yield* Queue.unbounded<void>();
      const session = yield* makeGuardedSession({
        name: "live",
        usedPercent,
        guardSwitchedOn,
        cancelled: yield* Deferred.make<void>(),
      });
      yield* session.startTurn;
      yield* Ref.set(usedPercent, { autoPercentUsed: 100, apiPercentUsed: 100 });
      yield* Queue.offer(guardSwitchedOn, undefined);
      const terminal = yield* session.runtime.events.pipe(
        Stream.filter((event) => event.type === "turn.terminal"),
        Stream.runHead,
      );
      const event = Option.getOrUndefined(terminal);
      assert.equal(event?.type === "turn.terminal" ? event.status : undefined, "failed");
      if (event?.type !== "turn.terminal" || event.status !== "failed") return;
      assert.equal(event.failure.class, "usage_limit");
      assert.equal(event.failure.code, "subscription_limit_guard");
    }).pipe(
      Effect.scoped,
      Effect.provide(
        Layer.mergeAll(NodeServices.layer, IdAllocator.layer, McpProviderSessions.layer),
      ),
    ),
  );

  it.effect("runs a Composer turn while either pool still has room", () =>
    Effect.gen(function* () {
      const apiSpent = yield* makeGuardedSession({
        name: "composer-api-spent",
        usedPercent: yield* usage({
          totalPercentUsed: 100,
          autoPercentUsed: 30,
          apiPercentUsed: 100,
        }),
        guardSwitchedOn: yield* Queue.unbounded<void>(),
        cancelled: yield* Deferred.make<void>(),
      });
      yield* apiSpent.startTurn;
      assert.equal(yield* Ref.get(apiSpent.sends), 1);

      const autoSpent = yield* makeGuardedSession({
        name: "composer-auto-spent",
        usedPercent: yield* usage({
          totalPercentUsed: 100,
          autoPercentUsed: 100,
          apiPercentUsed: 30,
        }),
        guardSwitchedOn: yield* Queue.unbounded<void>(),
        cancelled: yield* Deferred.make<void>(),
      });
      yield* autoSpent.startTurn;
      assert.equal(yield* Ref.get(autoSpent.sends), 1);
    }).pipe(
      Effect.scoped,
      Effect.provide(
        Layer.mergeAll(NodeServices.layer, IdAllocator.layer, McpProviderSessions.layer),
      ),
    ),
  );

  it.effect("checks other models against the API allowance only", () =>
    Effect.gen(function* () {
      const runs = yield* makeGuardedSession({
        name: "api-model-auto-spent",
        model: "claude-4.5-sonnet",
        usedPercent: yield* usage({ autoPercentUsed: 100, apiPercentUsed: 30 }),
        guardSwitchedOn: yield* Queue.unbounded<void>(),
        cancelled: yield* Deferred.make<void>(),
      });
      yield* runs.startTurn;
      assert.equal(yield* Ref.get(runs.sends), 1);

      const refused = yield* makeGuardedSession({
        name: "api-model-api-spent",
        model: "claude-4.5-sonnet",
        usedPercent: yield* usage({ autoPercentUsed: 30, apiPercentUsed: 100 }),
        guardSwitchedOn: yield* Queue.unbounded<void>(),
        cancelled: yield* Deferred.make<void>(),
      });
      const error = yield* refused.startTurn.pipe(Effect.flip);
      assert.equal(findSubscriptionLimitStop(error)?.class, "usage_limit");
      assert.equal(yield* Ref.get(refused.sends), 0);
    }).pipe(
      Effect.scoped,
      Effect.provide(
        Layer.mergeAll(NodeServices.layer, IdAllocator.layer, McpProviderSessions.layer),
      ),
    ),
  );

  it.effect("stops Auto only once both pools are used up", () =>
    Effect.gen(function* () {
      const runs = yield* makeGuardedSession({
        name: "auto-one-spent",
        model: "auto",
        usedPercent: yield* usage({ autoPercentUsed: 100, apiPercentUsed: 30 }),
        guardSwitchedOn: yield* Queue.unbounded<void>(),
        cancelled: yield* Deferred.make<void>(),
      });
      yield* runs.startTurn;
      assert.equal(yield* Ref.get(runs.sends), 1);

      const refused = yield* makeGuardedSession({
        name: "auto-both-spent",
        model: "auto",
        usedPercent: yield* usage({ autoPercentUsed: 100, apiPercentUsed: 100 }),
        guardSwitchedOn: yield* Queue.unbounded<void>(),
        cancelled: yield* Deferred.make<void>(),
      });
      const error = yield* refused.startTurn.pipe(Effect.flip);
      assert.equal(findSubscriptionLimitStop(error)?.class, "usage_limit");
      assert.equal(yield* Ref.get(refused.sends), 0);
    }).pipe(
      Effect.scoped,
      Effect.provide(
        Layer.mergeAll(NodeServices.layer, IdAllocator.layer, McpProviderSessions.layer),
      ),
    ),
  );

  it.effect("refuses a guarded turn when one of its model's pools is missing from usage", () =>
    Effect.gen(function* () {
      const session = yield* makeGuardedSession({
        name: "pool-unreported",
        usedPercent: yield* usage({ totalPercentUsed: 10, apiPercentUsed: 10 }),
        guardSwitchedOn: yield* Queue.unbounded<void>(),
        cancelled: yield* Deferred.make<void>(),
      });
      const error = yield* session.startTurn.pipe(Effect.flip);
      assert.equal(findSubscriptionLimitStop(error)?.class, "provider_error");
      assert.equal(yield* Ref.get(session.sends), 0);
    }).pipe(
      Effect.scoped,
      Effect.provide(
        Layer.mergeAll(NodeServices.layer, IdAllocator.layer, McpProviderSessions.layer),
      ),
    ),
  );
});
