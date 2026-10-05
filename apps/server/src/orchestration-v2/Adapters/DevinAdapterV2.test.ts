import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { ProviderInstanceId, ProviderSessionId, ThreadId } from "@t3tools/contracts";
import { resolveSelfInvocation } from "@t3tools/shared/nodeRuntime";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { ChildProcessSpawner } from "effect/unstable/process";

import * as ServerConfig from "../../config.ts";
import * as IdAllocator from "../IdAllocator.ts";
import { ProviderAdapterV2RuntimePolicy } from "../ProviderAdapter.ts";
import {
  decodeAcpReplayTranscript,
  makeAcpReplayCompletenessAssertion,
  makeAcpReplayRuntime,
} from "./AcpAdapterV2.testkit.ts";
import {
  DEVIN_PROVIDER,
  devinModelContextWindow,
  dispatchDevinSkills,
  makeDevinAdapterV2,
} from "./DevinAdapterV2.ts";

const testLayer = Layer.mergeAll(
  NodeServices.layer,
  IdAllocator.layer,
  ServerConfig.layerTest(process.cwd(), { prefix: "t3-devin-v2-adapter-" }).pipe(
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

const DEVIN_MODES = {
  currentModeId: "accept-edits",
  availableModes: [
    { id: "accept-edits", name: "Code" },
    { id: "smart", name: "Smart" },
    { id: "ask", name: "Ask" },
    { id: "plan", name: "Plan" },
    { id: "bypass", name: "Bypass Permissions" },
  ],
};
const modelOption = (currentValue: string) => ({
  id: "model",
  name: "Model",
  category: "model",
  type: "select",
  currentValue,
  options: ["adaptive", "swe-1-7", "swe-1-7-high"].map((value) => ({ value, name: value })),
});

describe("DevinAdapterV2", () => {
  it.effect(
    "opens a session on the resolved model variant and the runtime mode's session mode",
    () =>
      Effect.gen(function* () {
        const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const replayDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-devin-v2-" });
        const statusPath = path.join(replayDir, "status.json");
        const transcript = yield* decodeAcpReplayTranscript(
          {
            provider: DEVIN_PROVIDER,
            protocol: "acp.ndjson-jsonrpc",
            version: "1",
            scenario: "devin-session-setup",
            entries: [
              outbound("initialize"),
              answer("initialize", {
                protocolVersion: 1,
                agentCapabilities: { loadSession: true },
                authMethods: [{ id: "devin-browser", name: "Log in with browser" }],
              }),
              outbound("session/new"),
              answer("session/new", {
                sessionId: "devin-session",
                modes: DEVIN_MODES,
                configOptions: [modelOption("adaptive")],
              }),
              outbound("session/set_config_option", {
                sessionId: "devin-session",
                configId: "model",
                value: "swe-1-7-high",
              }),
              answer("session/set_config_option", {
                configOptions: [modelOption("swe-1-7-high")],
              }),
              outbound("session/set_mode", { sessionId: "devin-session", modeId: "bypass" }),
              answer("session/set_mode", {}),
            ] as never,
          },
          DEVIN_PROVIDER,
        );
        const replayRuntime = makeAcpReplayRuntime({
          transcript,
          statusPath,
          scriptPath: yield* path.fromFileUrl(
            new URL("../../../scripts/acp-replay-agent.ts", import.meta.url),
          ),
          childProcessSpawner,
          fileSystem,
        });
        let clientCapabilities: unknown;
        const instanceId = ProviderInstanceId.make("devin-v2-test");
        const adapter = makeDevinAdapterV2({
          instanceId,
          settings: { binaryPath: "devin" },
          environment: {},
          childProcessSpawner,
          crypto: yield* Crypto.Crypto,
          fileSystem,
          idAllocator: yield* IdAllocator.IdAllocatorV2,
          serverConfig: yield* ServerConfig.ServerConfig,
          selfInvocation: yield* resolveSelfInvocation(),
          skillNames: () => Effect.succeed(new Set()),
          makeRuntime: (input) => {
            clientCapabilities = input.clientCapabilities;
            return replayRuntime(input);
          },
        });
        const contextWindow = yield* adapter
          .openSession({
            threadId: ThreadId.make("thread-devin-v2"),
            providerSessionId: ProviderSessionId.make("provider-session-devin-v2"),
            modelSelection: {
              instanceId,
              model: "swe-1-7",
              options: [{ id: "effort", value: "high" }],
            },
            runtimePolicy: ProviderAdapterV2RuntimePolicy.make({
              runtimeMode: "full-access",
              interactionMode: "default",
              cwd: replayDir,
            }),
          })
          .pipe(
            Effect.map((session) =>
              session.getModelContextWindow?.({
                instanceId,
                model: "glm-5-2",
                options: [{ id: "context", value: "1m" }],
              }),
            ),
            Effect.scoped,
          );
        yield* makeAcpReplayCompletenessAssertion(fileSystem, statusPath, transcript);

        assert.strictEqual(contextWindow, 1_000_000);
        // Same as Devin through the ACP Registry: client terminals plus
        // Devin's subagent and message-grouping extensions.
        assert.deepInclude(clientCapabilities, {
          terminal: true,
          _meta: {
            "cognition.ai/subagentSupport": true,
            "cognition.ai/messageGrouping": true,
          },
        });
      }).pipe(Effect.provide(testLayer), Effect.scoped),
  );
});

describe("dispatchDevinSkills", () => {
  const skillNames = (cwd: string) =>
    Effect.sync(() => {
      lookups.push(cwd);
      return new Set(["deploy"]) as ReadonlySet<string>;
    });
  let lookups: Array<string> = [];

  it.effect("rewrites known $skill mentions to Devin's @skills syntax", () =>
    Effect.gen(function* () {
      lookups = [];
      const text = yield* dispatchDevinSkills({
        text: "please $deploy staging, not $HOME",
        cwd: "/repo",
        skillNames,
      });
      assert.strictEqual(text, "please @skills:deploy staging, not $HOME");
      assert.deepStrictEqual(lookups, ["/repo"]);
    }),
  );

  it.effect("skips discovery when the prompt has no candidate mention", () =>
    Effect.gen(function* () {
      lookups = [];
      const text = yield* dispatchDevinSkills({ text: "plain prompt", cwd: "/repo", skillNames });
      assert.strictEqual(text, "plain prompt");
      assert.deepStrictEqual(lookups, []);
    }),
  );
});

describe("devinModelContextWindow", () => {
  it("uses the 1M context variant when selected, else the family window", () => {
    const instanceId = ProviderInstanceId.make("devin");
    assert.strictEqual(
      devinModelContextWindow({
        instanceId,
        model: "swe-2",
        options: [{ id: "context", value: "1m" }],
      }),
      1_000_000,
    );
    assert.strictEqual(devinModelContextWindow({ instanceId, model: "unknown-model" }), undefined);
  });
});
