// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import {
  ApprovalRequestId,
  CustomAcpSettings,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderRuntimeEvent,
  ThreadId,
} from "@t3tools/contracts";

import { ServerConfig } from "../../config.ts";
import { execScriptSource, writeFakeCli } from "../../testUtils/fakeCli.ts";
import { makeCustomAcpAdapter } from "./CustomAcpAdapter.ts";
import { checkCustomAcpProviderStatus } from "./CustomAcpProvider.ts";

const decodeSettings = Schema.decodeSync(CustomAcpSettings);
const INSTANCE_ID = ProviderInstanceId.make("gemini");
const PROVIDER = ProviderDriverKind.make("customAcp");

const __dirname = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const mockAgentPath = NodePath.join(__dirname, "../../../scripts/acp-mock-agent.ts");

interface MockAgent {
  readonly workspace: string;
  readonly binaryPath: string;
  readonly argvLogPath: string;
  readonly requestLogPath: string;
}

const makeMockAgent = Effect.promise(async (): Promise<MockAgent> => {
  const workspace = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "custom-acp-"));
  const requestLogPath = NodePath.join(workspace, "requests.ndjson");
  const argvLogPath = NodePath.join(workspace, "argv.txt");
  await NodeFSP.writeFile(requestLogPath, "", "utf8");
  const binaryPath = writeFakeCli({
    directory: NodePath.join(workspace, "bin"),
    name: "fake-agent",
    env: { T3_ACP_REQUEST_LOG_PATH: requestLogPath },
    source: execScriptSource({ scriptPath: mockAgentPath, argvLogPath }),
  });
  return { workspace, binaryPath, argvLogPath, requestLogPath };
});

const readJsonLines = (filePath: string) =>
  Effect.promise(async () =>
    (await NodeFSP.readFile(filePath, "utf8"))
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>),
  );

const configWrites = (requests: ReadonlyArray<Record<string, unknown>>) =>
  requests
    .filter((entry) => entry.method === "session/set_config_option")
    .map((entry) => {
      const params = entry.params as { configId: string; value: unknown };
      return { configId: params.configId, value: params.value };
    });

const layer = it.layer(
  Layer.mergeAll(ServerConfig.layerTest(process.cwd(), { prefix: "t3code-custom-acp-test-" })).pipe(
    Layer.provideMerge(NodeServices.layer),
  ),
);

layer("CustomAcpAdapter", (it) => {
  it.effect("runs a turn with the configured arguments and the advertised model", () =>
    Effect.gen(function* () {
      const agent = yield* makeMockAgent;
      const adapter = yield* makeCustomAcpAdapter(
        decodeSettings({ binaryPath: agent.binaryPath, arguments: "acp\n--verbose" }),
        { instanceId: INSTANCE_ID, harness: "Gemini" },
      );
      const threadId = ThreadId.make("custom-acp-turn");
      const events = yield* adapter.streamEvents.pipe(
        Stream.filter((event) => event.threadId === threadId),
        Stream.takeUntil((event) => event.type === "turn.completed"),
        Stream.runCollect,
        Effect.forkChild,
      );

      const session = yield* adapter.startSession({
        threadId,
        provider: PROVIDER,
        cwd: agent.workspace,
        runtimeMode: "full-access",
        modelSelection: { instanceId: INSTANCE_ID, model: "composer-2" },
      });
      assert.deepStrictEqual(session.resumeCursor, {
        schemaVersion: 1,
        sessionId: "mock-session-1",
      });
      yield* adapter.sendTurn({ threadId, input: "hello mock", attachments: [] });

      const collected: ReadonlyArray<ProviderRuntimeEvent> = Array.from(yield* Fiber.join(events));
      const delta = collected.find((event) => event.type === "content.delta");
      assert.equal(
        delta?.type === "content.delta" ? delta.payload.delta : undefined,
        "hello from mock",
      );
      assert.include(
        collected.map((event) => event.type),
        "turn.completed",
      );
      yield* adapter.stopSession(threadId);

      const argv = yield* Effect.promise(() => NodeFSP.readFile(agent.argvLogPath, "utf8"));
      assert.deepStrictEqual(argv.trim().split("\t"), ["acp", "--verbose"]);
      // The mock advertises `composer-2` in its model config option; a model
      // it does not advertise (like T3's "default" placeholder) is never sent.
      assert.includeDeepMembers(configWrites(yield* readJsonLines(agent.requestLogPath)), [
        { configId: "model", value: "composer-2" },
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect("asks before tools and answers with the agent's own option id", () =>
    Effect.gen(function* () {
      const agent = yield* makeMockAgent;
      const adapter = yield* makeCustomAcpAdapter(
        decodeSettings({ binaryPath: agent.binaryPath }),
        {
          instanceId: INSTANCE_ID,
          harness: "Gemini",
          // Instance environment variables reach the agent process.
          environment: {
            ...process.env,
            T3_ACP_EMIT_TOOL_CALLS: "1",
            T3_ACP_ALLOW_ONCE_OPTION_ID: "proceed_once",
          },
        },
      );
      const threadId = ThreadId.make("custom-acp-approval");
      const answered = yield* adapter.streamEvents.pipe(
        Stream.filter((event) => event.threadId === threadId),
        Stream.tap((event) =>
          event.type === "request.opened" && event.requestId
            ? adapter.respondToRequest(threadId, ApprovalRequestId.make(event.requestId), "accept")
            : Effect.void,
        ),
        Stream.takeUntil((event) => event.type === "turn.completed"),
        Stream.runCollect,
        Effect.forkChild,
      );

      yield* adapter.startSession({
        threadId,
        provider: PROVIDER,
        cwd: agent.workspace,
        runtimeMode: "approval-required",
      });
      yield* adapter.sendTurn({ threadId, input: "run a tool", attachments: [] });
      const types = Array.from(yield* Fiber.join(answered), (event) => event.type);
      assert.includeMembers(types, ["request.opened", "request.resolved", "turn.completed"]);
      yield* adapter.stopSession(threadId);

      const selected = (yield* readJsonLines(agent.requestLogPath)).flatMap((entry) => {
        const outcome = (entry.result as { outcome?: { optionId?: string } } | undefined)?.outcome;
        return outcome?.optionId ? [outcome.optionId] : [];
      });
      assert.deepStrictEqual(selected, ["proceed_once"]);
    }).pipe(Effect.scoped),
  );

  it.effect("switches plan turns to the agent's plan mode", () =>
    Effect.gen(function* () {
      const agent = yield* makeMockAgent;
      const adapter = yield* makeCustomAcpAdapter(
        decodeSettings({ binaryPath: agent.binaryPath }),
        {
          instanceId: INSTANCE_ID,
          harness: "Gemini",
        },
      );
      const threadId = ThreadId.make("custom-acp-plan");
      yield* adapter.startSession({
        threadId,
        provider: PROVIDER,
        cwd: agent.workspace,
        runtimeMode: "approval-required",
      });
      yield* adapter.sendTurn({
        threadId,
        input: "plan it",
        attachments: [],
        interactionMode: "plan",
      });
      yield* adapter.stopSession(threadId);

      // The mock's modes are ask, architect, and code; approval-required keeps `ask`.
      const modeWrites = configWrites(yield* readJsonLines(agent.requestLogPath)).filter(
        (write) => write.configId === "mode",
      );
      assert.deepStrictEqual(modeWrites, [{ configId: "mode", value: "architect" }]);
    }).pipe(Effect.scoped),
  );

  it.effect("starts a fresh session when the agent cannot load the old one", () =>
    Effect.gen(function* () {
      const agent = yield* makeMockAgent;
      const adapter = yield* makeCustomAcpAdapter(
        decodeSettings({ binaryPath: agent.binaryPath }),
        {
          instanceId: INSTANCE_ID,
          harness: "Gemini",
          environment: { ...process.env, T3_ACP_FAIL_LOAD_SESSION: "1" },
        },
      );
      const threadId = ThreadId.make("custom-acp-resume");
      const session = yield* adapter.startSession({
        threadId,
        provider: PROVIDER,
        cwd: agent.workspace,
        runtimeMode: "full-access",
        resumeCursor: { schemaVersion: 1, sessionId: "lost-session" },
      });
      yield* adapter.stopSession(threadId);

      assert.deepStrictEqual(session.resumeCursor, {
        schemaVersion: 1,
        sessionId: "mock-session-1",
      });
      const methods = (yield* readJsonLines(agent.requestLogPath)).map((entry) => entry.method);
      assert.includeMembers(methods, ["session/load", "session/new"]);
    }).pipe(Effect.scoped),
  );
});

layer("checkCustomAcpProviderStatus", (it) => {
  it.effect("reports the models and modes the agent advertises", () =>
    Effect.gen(function* () {
      const agent = yield* makeMockAgent;
      const snapshot = yield* checkCustomAcpProviderStatus(
        decodeSettings({ binaryPath: agent.binaryPath }),
        process.env,
        agent.workspace,
      );

      assert.equal(snapshot.status, "ready");
      assert.equal(snapshot.showInteractionModeToggle, true);
      assert.deepStrictEqual(
        snapshot.models.map((model) => [model.slug, model.isDefault ?? false]),
        [
          ["default", true],
          ["composer-2", false],
          ["composer-2[fast=true]", false],
          ["gpt-5.3-codex[reasoning=medium,fast=false]", false],
        ],
      );
    }),
  );

  it.effect("explains a missing executable", () =>
    Effect.gen(function* () {
      const missing = yield* checkCustomAcpProviderStatus(
        decodeSettings({ binaryPath: "t3-no-such-acp-agent" }),
        process.env,
        process.cwd(),
      );
      assert.equal(missing.status, "error");
      assert.equal(missing.installed, false);

      const unset = yield* checkCustomAcpProviderStatus(
        decodeSettings({}),
        process.env,
        process.cwd(),
      );
      assert.equal(unset.status, "error");
      assert.equal(unset.message, "Set the agent executable in Settings → Providers.");
    }),
  );
});
