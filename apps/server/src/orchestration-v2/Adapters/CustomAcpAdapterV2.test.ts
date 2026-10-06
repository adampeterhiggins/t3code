import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  type ModelSelection,
  ProviderInstanceId,
  ProviderSessionId,
  ThreadId,
} from "@t3tools/contracts";
import { resolveSelfInvocation } from "@t3tools/shared/nodeRuntime";
import * as Crypto from "effect/Crypto";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { ChildProcessSpawner } from "effect/process";

import * as ServerConfig from "../../config.ts";
import { CUSTOM_ACP_DRIVER_KIND } from "../../provider/acp/CustomAcpSupport.ts";
import * as IdAllocator from "../IdAllocator.ts";
import { ProviderAdapterV2RuntimePolicy } from "../ProviderAdapter.ts";
import {
  decodeAcpReplayTranscript,
  makeAcpReplayCompletenessAssertion,
  makeAcpReplayRuntime,
} from "./AcpAdapterV2.testkit.ts";
import { makeCustomAcpAdapterV2 } from "./CustomAcpAdapterV2.ts";

const testLayer = Layer.mergeAll(
  NodeServices.layer,
  IdAllocator.layer,
  ServerConfig.layerTest(process.cwd(), { prefix: "t3-custom-acp-v2-adapter-" }).pipe(
    Layer.provide(NodeServices.layer),
  ),
);

type Frame = Record<string, unknown>;
const outbound = (method: string, params: unknown = "<any>"): Frame => ({
  type: "expect_outbound",
  frame: { kind: "request", method, params },
});
const answer = (method: string, result: unknown): Frame => ({
  type: "emit_inbound",
  frame: { kind: "response", method, result },
});
const notify = (params: unknown): Frame => ({
  type: "emit_inbound",
  frame: { kind: "notification", method: "session/update", params },
});

// Claude Code's ACP modes and options.
const claudeModes = {
  currentModeId: "default",
  availableModes: [
    { id: "default", name: "Default" },
    { id: "acceptEdits", name: "Accept Edits" },
    { id: "plan", name: "Plan Mode" },
    { id: "bypassPermissions", name: "Bypass Permissions" },
  ],
};
const modelOption = (currentValue: string) => ({
  id: "model",
  name: "Model",
  category: "model",
  type: "select",
  currentValue,
  options: ["sonnet", "opus"].map((value) => ({ value, name: value })),
});
const effortOption = (currentValue: string) => ({
  id: "effort",
  name: "Effort",
  category: "thought_level",
  type: "select",
  currentValue,
  options: ["medium", "high"].map((value) => ({ value, name: value })),
});

const openSession = Effect.fn("openCustomAcpSession")(function* (input: {
  readonly scenario: string;
  readonly frames: ReadonlyArray<Frame>;
  readonly modelSelection: Omit<ModelSelection, "instanceId">;
  readonly onAvailableCommands?: Parameters<
    typeof makeCustomAcpAdapterV2
  >[0]["onAvailableCommands"];
}) {
  const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const replayDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-custom-acp-v2-" });
  const statusPath = path.join(replayDir, "status.json");
  const transcript = yield* decodeAcpReplayTranscript(
    {
      provider: CUSTOM_ACP_DRIVER_KIND,
      protocol: "acp.ndjson-jsonrpc",
      version: "1",
      scenario: input.scenario,
      entries: [
        outbound("initialize"),
        answer("initialize", { protocolVersion: 1, agentCapabilities: { loadSession: false } }),
        outbound("session/new"),
        ...input.frames,
      ] as never,
    },
    CUSTOM_ACP_DRIVER_KIND,
  );
  const instanceId = ProviderInstanceId.make("custom-acp-v2-test");
  const adapter = makeCustomAcpAdapterV2({
    instanceId,
    settings: { binaryPath: "agent", arguments: "" },
    harness: "Test agent",
    environment: {},
    childProcessSpawner,
    crypto: yield* Crypto.Crypto,
    fileSystem,
    idAllocator: yield* IdAllocator.IdAllocatorV2,
    serverConfig: yield* ServerConfig.ServerConfig,
    selfInvocation: yield* resolveSelfInvocation(),
    onAvailableCommands: input.onAvailableCommands ?? (() => Effect.void),
    makeRuntime: makeAcpReplayRuntime({
      transcript,
      statusPath,
      scriptPath: yield* path.fromFileUrl(
        new URL("../../../scripts/acp-replay-agent.ts", import.meta.url),
      ),
      childProcessSpawner,
      fileSystem,
    }),
  });
  yield* adapter
    .openSession({
      threadId: ThreadId.make(`thread-${input.scenario}`),
      providerSessionId: ProviderSessionId.make(`provider-session-${input.scenario}`),
      modelSelection: { instanceId, ...input.modelSelection },
      runtimePolicy: ProviderAdapterV2RuntimePolicy.make({
        runtimeMode: "full-access",
        interactionMode: "default",
        cwd: replayDir,
      }),
    })
    .pipe(Effect.scoped);
  yield* makeAcpReplayCompletenessAssertion(fileSystem, statusPath, transcript);
  return replayDir;
});

describe("CustomAcpAdapterV2", () => {
  it.effect(
    "applies the advertised model and options, maps full access to the agent's mode, and scopes slash commands to the workspace",
    () =>
      Effect.gen(function* () {
        const commands = yield* Deferred.make<{
          readonly names: ReadonlyArray<string>;
          readonly cwd: string;
        }>();
        const workspace = yield* openSession({
          scenario: "custom-acp-config-option",
          modelSelection: { model: "opus", options: [{ id: "effort", value: "high" }] },
          onAvailableCommands: (available, cwd) =>
            Deferred.succeed(commands, {
              names: available.map((command) => command.name),
              cwd,
            }).pipe(Effect.asVoid),
          frames: [
            answer("session/new", {
              sessionId: "agent-session",
              modes: claudeModes,
              configOptions: [modelOption("sonnet"), effortOption("medium")],
            }),
            notify({
              sessionId: "agent-session",
              update: {
                sessionUpdate: "available_commands_update",
                availableCommands: [{ name: "review", description: "Review changes" }],
              },
            }),
            outbound("session/set_config_option", {
              sessionId: "agent-session",
              configId: "model",
              value: "opus",
            }),
            answer("session/set_config_option", {
              configOptions: [modelOption("opus"), effortOption("medium")],
            }),
            outbound("session/set_config_option", {
              sessionId: "agent-session",
              configId: "effort",
              value: "high",
            }),
            answer("session/set_config_option", {
              configOptions: [modelOption("opus"), effortOption("high")],
            }),
            outbound("session/set_mode", {
              sessionId: "agent-session",
              modeId: "bypassPermissions",
            }),
            answer("session/set_mode", {}),
          ],
        });
        assert.deepStrictEqual(yield* Deferred.await(commands), {
          names: ["review"],
          cwd: workspace,
        });
      }).pipe(Effect.provide(testLayer), Effect.scoped),
  );

  it.effect("switches agents that only advertise models state with session/set_model", () =>
    openSession({
      scenario: "custom-acp-session-model",
      modelSelection: { model: "gemini-flash" },
      frames: [
        answer("session/new", {
          sessionId: "agent-session",
          models: {
            currentModelId: "gemini-pro",
            availableModels: [
              { modelId: "gemini-flash", name: "Gemini Flash" },
              { modelId: "gemini-pro", name: "Gemini Pro" },
            ],
          },
        }),
        outbound("session/set_model", { sessionId: "agent-session", modelId: "gemini-flash" }),
        answer("session/set_model", {}),
      ],
    }).pipe(Effect.provide(testLayer), Effect.scoped),
  );
});
