// @effect-diagnostics nodeBuiltinImport:off globalTimers:off -- The probe is a plain Node child; this deadline kills it if it hangs.
import * as NodeChildProcess from "node:child_process";
import { assert, describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import type { CursorConfigureOptions } from "@cursor/sdk";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Path from "effect/Path";
import { vi } from "vite-plus/test";
import * as CursorSdk from "./CursorSdk.ts";

const sdkDefaults = vi.hoisted(() => ({ useHttp1ForAgent: undefined as boolean | undefined }));

// Holds the SDK's process-wide default the way it does: only keys present change, null clears.
vi.mock("./sdk.ts", () => ({
  loadCursorSdk: () => ({
    Cursor: {
      configure: ({ local }: CursorConfigureOptions) => {
        if (local !== undefined && "useHttp1ForAgent" in local) {
          sdkDefaults.useHttp1ForAgent = local.useHttp1ForAgent ?? undefined;
        }
      },
    },
  }),
  loadCursorSqlite: () => ({}),
}));

const withHost = (environment: NodeJS.ProcessEnv, home: string) =>
  Effect.provide(
    Layer.mergeAll(
      NodeServices.layer,
      Layer.succeed(HostProcess.Environment, environment),
      Layer.succeed(HostProcess.HomeDirectory, home),
    ),
  );
const cursorSdkUrl = new URL("./CursorSdk.ts", import.meta.url).href;
const sdkUrl = new URL("./sdk.ts", import.meta.url).href;

// Builds the CursorSdk layer in a fresh process. The model-request probe uses
// the real SDK; the shell guard probes stub @cursor/sdk. The vitest worker
// already has its own unhandledRejection listener, which would hide the
// process-exit behavior.
const probeProgram = `
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire, registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

const sdkRequire = createRequire(createRequire(${JSON.stringify(cursorSdkUrl)}).resolve("@cursor/sdk"));
const protobufUrl = pathToFileURL(sdkRequire.resolve("@bufbuild/protobuf")).href;
const { proto3 } = sdkRequire("@bufbuild/protobuf");
const mode = process.argv[1];
if (mode === "sdk-model-requests") {
  process.on("uncaughtException", error => {
    console.error(error.stack);
    process.exit(1);
  });
}
const dir = mkdtempSync(join(tmpdir(), "cursor-sdk-stub-"));
const stub = join(dir, "stub.cjs");
writeFileSync(
  stub,
  "module.exports = { Agent: {}, AuthenticationError: class {}, createAgentPlatform: () => ({}), Cursor: { configure() {} }, CursorSdkError: class {}, InMemoryCredentialStore: class {} };",
);
registerHooks({
  resolve(specifier, context, next) {
    if ((specifier === "@cursor/sdk" && mode !== "sdk-model-requests") || specifier === "@cursor/sdk/sqlite") {
      return { url: pathToFileURL(stub).href, shortCircuit: true };
    }
    if (specifier === "@bufbuild/protobuf") {
      return { url: protobufUrl, shortCircuit: true };
    }
    return next(specifier, context);
  },
});

const { layer } = await import(${JSON.stringify(cursorSdkUrl)});
const { loadCursorSdk } = await import(${JSON.stringify(sdkUrl)});
const { createAgentPlatform } = loadCursorSdk();
const Effect = await import("effect/Effect");
const Layer = await import("effect/Layer");
const Exit = await import("effect/Exit");
const Scope = await import("effect/Scope");
const NodeServices = await import("@effect/platform-node/NodeServices");
const scope = Scope.makeUnsafe();
await Effect.runPromise(Layer.buildWithScope(layer, scope).pipe(Effect.provide(NodeServices.layer)));
const missingCwd = join(tmpdir(), "t3-missing-cwd-" + process.pid);

if (mode === "sdk-model-requests") {
  const { JsonlLocalAgentStore } = sdkRequire("@cursor/sdk");
  const store = new JsonlLocalAgentStore(join(dir, "store"));
  const platform = await createAgentPlatform({ localStore: store, workspaceRef: dir });
  // Catalog validation is an external dependency; the SDK's send path and
  // generated RequestedModel constructor stay real. Stop before transport.
  platform.listModelsForLocalValidation = async () => [
    { id: "grok-4.7", variants: [
      { params: [{ id: "context", value: "500k" }], isMaxMode: true },
      { params: [{ id: "context", value: "256k" }], isMaxMode: false },
    ] },
    { id: "claude-opus-5-5", variants: [
      { params: [{ id: "context", value: "1m" }], isMaxMode: true },
      { params: [{ id: "context", value: "300k" }], isMaxMode: false },
    ] },
  ];
  globalThis.fetch = async () => { throw new Error("Unexpected network request"); };
  const requests = [];
  const initPartial = proto3.util.initPartial;
  const captured = new Error("model request captured before transport");
  proto3.util.initPartial = function(source, target) {
    initPartial.call(this, source, target);
    if (target.getType().typeName !== "agent.v1.RequestedModel" || !target.modelId) return;
    const decoded = target.getType().fromBinary(target.toBinary());
    requests.push({ model: decoded.modelId, maxMode: decoded.maxMode,
      context: decoded.parameters.find(parameter => parameter.id === "context")?.value });
    throw captured;
  };
  for (const [id, context] of [
    ["grok-4.7", "500k"], ["grok-4.7", "256k"],
    ["claude-opus-5-5", "1m"], ["claude-opus-5-5", "300k"],
  ]) {
    const agent = await platform.createAgent({
      apiKey: "t3-offline-test-key", model: { id, params: [{ id: "context", value: context }] },
      mode: "plan", tools: [], local: { cwd: dir, store, autoReview: false,
        settingSources: [], sandboxOptions: { enabled: false }, enableAgentRetries: false },
    });
    try {
      await agent.send("Reply with exactly: pong");
      throw new Error("SDK did not construct a model request");
    } catch (error) {
      if (error !== captured && error.cause !== captured) throw error;
    } finally {
      await agent[Symbol.asyncDispose]();
    }
  }
  console.log(JSON.stringify(requests));
  process.exit(0);
}

if (mode === "cursor-shell") {
  const child = spawn("/bin/zsh", ["-c", "dump_zsh_state >&4", "--", "true"], {
    cwd: missingCwd,
  });
  child.on("error", (error) => {
    Promise.reject(error);
  });
  setTimeout(() => process.exit(0), 500);
} else if (mode === "released") {
  await Effect.runPromise(Scope.close(scope, Exit.void));
  Promise.reject(
    Object.assign(new Error("spawn /bin/zsh ENOENT"), {
      code: "ENOENT",
      syscall: "spawn /bin/zsh",
      spawnargs: ["-c", "dump_zsh_state >&4"],
    }),
  );
  setTimeout(() => process.exit(0), 500);
} else if (mode === "other-spawn") {
  Promise.reject(
    Object.assign(new Error("spawn git ENOENT"), {
      code: "ENOENT",
      syscall: "spawn git",
      path: "git",
      spawnargs: ["status"],
    }),
  );
  setTimeout(() => process.exit(0), 500);
} else if (mode === "other-rejection") {
  Promise.reject(new Error("boom"));
  setTimeout(() => process.exit(0), 500);
} else if (mode === "spawn-without-listener") {
  spawn(process.execPath, ["-e", "process.exit(0)"], { cwd: missingCwd });
  setTimeout(() => process.exit(0), 500);
} else {
  console.error("Unknown cursor shell spawn guard probe: " + mode);
  process.exit(2);
}
`;

function runProbe(mode: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = NodeChildProcess.spawn(
      process.execPath,
      [
        "--experimental-strip-types",
        "--disable-warning=ExperimentalWarning",
        "--input-type=module",
        "-e",
        probeProgram,
        mode,
      ],
      { stdio: ["ignore", "pipe", "pipe"], cwd: new URL("../..", import.meta.url) },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    // oxlint-disable-next-line t3code/no-real-time-wait-in-tests -- Kill a hung subprocess probe; this is a deadline, not a synchronization wait.
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`probe ${mode} timed out`));
    }, 5_000);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

describe("Cursor long-context requests", () => {
  it("sets Max Mode in real SDK sends for the reported context tiers", async () => {
    const result = await runProbe("sdk-model-requests");
    expect(result.code, result.stderr.slice(-2_000)).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([
      { model: "grok-4.7", context: "500k", maxMode: true },
      { model: "grok-4.7", context: "256k", maxMode: false },
      { model: "claude-opus-5-5", context: "1m", maxMode: true },
      { model: "claude-opus-5-5", context: "300k", maxMode: false },
    ]);
  });
});

describe("Cursor shell spawn guard", () => {
  it("keeps the process alive when Cursor's shell spawn rejects", async () => {
    const result = await runProbe("cursor-shell");
    expect(result.code).toBe(0);
    expect(result.stderr).toContain("The server will keep running.");
    expect(result.stderr).toContain("ENOENT");
  });

  it("still exits when a different spawn failure is unhandled", async () => {
    const result = await runProbe("other-spawn");
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("spawn git ENOENT");
    expect(result.stderr).not.toContain("The server will keep running.");
  });

  it("still exits on unrelated unhandled rejections", async () => {
    const result = await runProbe("other-rejection");
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("boom");
  });

  it("removes the guard when the layer is released", async () => {
    const result = await runProbe("released");
    expect(result.code).toBe(1);
    expect(result.stderr).not.toContain("The server will keep running.");
  });

  it("leaves a spawn with no error listener fatal", async () => {
    const result = await runProbe("spawn-without-listener");
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Unhandled");
    expect(result.stderr).not.toContain("The server will keep running.");
  });
});

// Shaped like the SDK's minified class: the constructor is not named after the error.
// @effect-diagnostics-next-line extendsNativeError:off - mimics the Cursor SDK's own native Error class.
class o extends Error {
  override name = "WriteIterableClosedError";
}

// Calls the guard directly, with Vitest's own listener detached so the guard does not defer to it.
const rejectThroughGuard = (reason: unknown) =>
  Effect.gen(function* () {
    const others = process.listeners("unhandledRejection");
    yield* Layer.build(CursorSdk.layer);
    const guard = process.listeners("unhandledRejection").find((l) => !others.includes(l));
    assert.isDefined(guard);
    using exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    using _log = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const listener of others) process.off("unhandledRejection", listener);
    try {
      guard(reason, Promise.resolve());
    } finally {
      for (const listener of others) process.on("unhandledRejection", listener);
    }
    return exit.mock.calls;
  }).pipe(Effect.scoped, withHost({}, "/nonexistent-home"));

describe("CursorSdk unhandled rejection guard", () => {
  it.effect("keeps the server running when the SDK writes to a closed stream", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* rejectThroughGuard(new o("WritableIterable is closed")), []);
    }),
  );

  it.effect("keeps the server running when the SDK writes after its request stream ended", () =>
    Effect.gen(function* () {
      // Shaped like `ConnectError.from(e, Code.Aborted)` from the SDK's connect-node body pump.
      const cause = Object.assign(new Error("write after end"), {
        code: "ERR_STREAM_WRITE_AFTER_END",
      });
      const reason = Object.assign(new Error("[aborted] write after end", { cause }), {
        name: "ConnectError",
        code: 10,
        rawMessage: "write after end",
      });
      assert.deepStrictEqual(yield* rejectThroughGuard(reason), []);
    }),
  );

  it.effect("still exits on other rejections", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* rejectThroughGuard(new Error("WritableIterable is closed")), [
        [1],
      ]);
    }),
  );

  it.effect("still exits on aborted requests other than a write after end", () =>
    Effect.gen(function* () {
      const cause = Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
      const reason = Object.assign(new Error("[aborted] socket hang up", { cause }), {
        name: "ConnectError",
        code: 10,
      });
      assert.deepStrictEqual(yield* rejectThroughGuard(reason), [[1]]);
    }),
  );
});

const http1 = JSON.stringify({ network: { useHttp1ForAgent: true } });

describe("CursorSdk agent transport", () => {
  it.effect.each([
    {
      name: "when set in CURSOR_CONFIG_DIR over XDG_CONFIG_HOME",
      env: { CURSOR_CONFIG_DIR: "config", XDG_CONFIG_HOME: "xdg" },
      file: "config/cli-config.json",
      text: http1,
      expected: true,
    },
    {
      name: "when set in XDG_CONFIG_HOME",
      env: { XDG_CONFIG_HOME: "xdg" },
      file: "xdg/cursor/cli-config.json",
      text: http1,
      expected: true,
    },
    {
      name: "when set in the home directory",
      env: {},
      file: "home/.cursor/cli-config.json",
      text: http1,
      expected: true,
    },
    {
      name: "when it is off",
      env: {},
      file: "home/.cursor/cli-config.json",
      text: JSON.stringify({ network: { useHttp1ForAgent: false } }),
      expected: undefined,
    },
    {
      name: "when the file is damaged",
      env: {},
      file: "home/.cursor/cli-config.json",
      text: "{",
      expected: undefined,
      warns: true,
    },
    { name: "when there is no file", env: {}, file: undefined, text: "", expected: undefined },
  ])("follows the Cursor CLI's HTTP/1.1 setting $name", ({ env, file, text, expected, warns }) =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-cursor-cli-config-" });
      if (file !== undefined) {
        yield* fileSystem.makeDirectory(path.dirname(path.join(root, file)), { recursive: true });
        yield* fileSystem.writeFileString(path.join(root, file), text);
      }
      const environment = Object.fromEntries(
        Object.entries(env).map(([key, directory]) => [key, path.join(root, directory)]),
      );
      const warnings: Array<unknown> = [];
      const captureWarnings = Logger.make(({ logLevel, message }) => {
        if (logLevel === "Warn") warnings.push(message);
      });
      yield* Effect.gen(function* () {
        const sdk = Context.get(yield* Layer.build(CursorSdk.layer), CursorSdk.CursorSdk);
        assert.isUndefined(sdkDefaults.useHttp1ForAgent);
        sdk.load();
        assert.strictEqual(sdkDefaults.useHttp1ForAgent, expected);
      }).pipe(
        Effect.scoped,
        withHost(environment, path.join(root, "home")),
        Effect.provide(Logger.layer([captureWarnings], { mergeWithExisting: false })),
      );
      assert.isUndefined(sdkDefaults.useHttp1ForAgent);
      assert.lengthOf(warnings, warns ? 1 : 0);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
