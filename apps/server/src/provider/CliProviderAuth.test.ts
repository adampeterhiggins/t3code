// @effect-diagnostics nodeBuiltinImport:off
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "@effect/vitest";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderAuthState,
  type ServerProviderAuth,
} from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

import { ServerSettingsService } from "../serverSettings.ts";
import {
  cliOutputProbe,
  makeCliProviderAuth,
  providerEnvVarCredential,
  type CliAuthMethodSpec,
  type CliProviderAuthOptions,
} from "./CliProviderAuth.ts";

const instanceId = ProviderInstanceId.make("cli-auth-test");
const testLayer = Layer.mergeAll(NodeServices.layer, ServerSettingsService.layerTest());

// `#!/bin/sh` stubs cannot be resolved as executables on Windows.
const windowsHost = HostProcessPlatform.defaultValue() === "win32";

const authenticated: ServerProviderAuth = { status: "authenticated" };
const unauthenticated: ServerProviderAuth = { status: "unauthenticated" };

const makeScript = (body: string) =>
  Effect.gen(function* () {
    const dir = yield* Effect.promise(() =>
      NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "cli-auth-test-")),
    );
    const scriptPath = NodePath.join(dir, "fake-provider.sh");
    yield* Effect.promise(() =>
      NodeFSP.writeFile(scriptPath, `#!/bin/sh\n${body}\n`, "utf8"),
    );
    yield* Effect.promise(() => NodeFSP.chmod(scriptPath, 0o755));
    return scriptPath;
  });

const makeAuth = (options: Partial<CliProviderAuthOptions>) =>
  Effect.gen(function* () {
    const controller = yield* makeCliProviderAuth({
      instanceId,
      providerLabel: "Test",
      command: "unused-provider",
      processEnv: {},
      methods: [],
      probeAuth: Effect.succeed(unauthenticated),
      ...options,
    });
    return controller;
  }).pipe(Effect.scoped);

/** First state matching `phase`, or dies on stream end. */
const awaitPhase = (
  controller: { subscribe: (owner: string) => Stream.Stream<ProviderAuthState> },
  owner: string,
  phases: ReadonlyArray<ProviderAuthState["phase"]>,
) =>
  controller
    .subscribe(owner)
    .pipe(
      Stream.filter((state) => phases.includes(state.phase)),
      Stream.runHead,
      Effect.flatMap((state) =>
        Option.match(state, {
          onNone: () => Effect.die("auth stream ended before reaching the phase"),
          onSome: Effect.succeed,
        }),
      ),
    );

const collectUntil = (
  controller: { subscribe: (owner: string) => Stream.Stream<ProviderAuthState> },
  owner: string,
  terminal: ReadonlyArray<ProviderAuthState["phase"]>,
) =>
  controller
    .subscribe(owner)
    .pipe(
      Stream.takeUntil((state) => terminal.includes(state.phase)),
      Stream.runCollect,
      Effect.map((chunk) => Array.from(chunk)),
    );

it.layer(testLayer)("CliProviderAuth", (it) => {
  it.effect("saved-credentials succeeds when the probe reports authentication", () =>
    Effect.gen(function* () {
      const controller = yield* makeAuth({
        methods: [
          {
            kind: "saved-credentials",
            id: "saved",
            label: "Use saved login",
            missingMessage: "No saved login.",
          },
        ],
        probeAuth: Effect.succeed(authenticated),
      });
      const collector = yield* collectUntil(controller, "owner", [
        "succeeded",
        "failed",
      ]).pipe(Effect.forkChild);
      const started = yield* controller.start("owner", { methodId: "saved" });
      expect(started.phase).toBe("starting");
      const done = yield* collector;
      expect(done.at(-1)?.phase).toBe("succeeded");
    }),
  );

  it.effect("saved-credentials reports the missing message when no credentials exist", () =>
    Effect.gen(function* () {
      const controller = yield* makeAuth({
        methods: [
          {
            kind: "saved-credentials",
            id: "saved",
            label: "Use saved login",
            missingMessage: "No saved login on this machine.",
          },
        ],
        probeAuth: Effect.succeed(unauthenticated),
      });
      const final = yield* awaitPhase(controller, "owner", ["succeeded", "failed"]).pipe(
        Effect.forkChild,
      );
      yield* controller.start("owner", { methodId: "saved" });
      const state = yield* final;
      expect(state.phase).toBe("failed");
      expect(state.message).toBe("No saved login on this machine.");
    }),
  );

  it.effect("paste-credential requires the credential", () =>
    Effect.gen(function* () {
      const applied: Array<string> = [];
      const controller = yield* makeAuth({
        methods: [
          {
            kind: "paste-credential",
            id: "api-key",
            label: "Paste a key",
            credentialLabel: "API key",
            probeAfterApply: false,
            appliedMessage: "Key saved.",
            apply: (secret) =>
              Effect.sync(() => {
                applied.push(secret);
              }),
          },
        ],
      });
      const final = yield* awaitPhase(controller, "owner", ["succeeded", "failed"]).pipe(
        Effect.forkChild,
      );
      yield* controller.start("owner", { methodId: "api-key" });
      const state = yield* final;
      expect(state.phase).toBe("failed");
      expect(applied).toEqual([]);

      const final2 = yield* awaitPhase(controller, "owner", ["succeeded", "failed"]).pipe(
        Effect.forkChild,
      );
      yield* controller.start("owner", { methodId: "api-key", credential: " sk-secret " });
      const state2 = yield* final2;
      expect(state2.phase).toBe("succeeded");
      expect(state2.message).toBe("Key saved.");
      expect(applied).toEqual([" sk-secret "]);
    }),
  );

  it.effect.skipIf(windowsHost)(
    "cli flow publishes the sign-in URL, then verifies on exit",
    () =>
      Effect.gen(function* () {
        const script = yield* makeScript(
          `echo "Visit https://auth.example.com/device to sign in"\nexit 0`,
        );
        const controller = yield* makeAuth({
          command: script,
          methods: [
            {
              kind: "cli",
              id: "device",
              label: "Sign in with device code",
              args: [],
              urlPattern: /(https:\/\/auth\.example\.com\/\S+)/,
            },
          ],
          probeAuth: Effect.succeed(authenticated),
        });
        const states = yield* collectUntil(controller, "owner", ["succeeded", "failed"]).pipe(
          Effect.forkChild,
        );
        yield* controller.start("owner", { methodId: "device" });
        const seen = yield* states;
        const waiting = seen.find((state) => state.phase === "waiting");
        expect(waiting?.authorizationUrl).toBe("https://auth.example.com/device");
        expect(seen.at(-1)?.phase).toBe("succeeded");
      }),
  );

  it.effect.skipIf(windowsHost)(
    "cli flow fails with the command's output tail on non-zero exit",
    () =>
      Effect.gen(function* () {
        const script = yield* makeScript(`echo "login exploded" >&2\nexit 3`);
        const controller = yield* makeAuth({
          command: script,
          methods: [
            {
              kind: "cli",
              id: "browser",
              label: "Sign in with browser",
              args: [],
              urlPattern: /(https:\/\/\S+)/,
            },
          ],
        });
        const final = yield* awaitPhase(controller, "owner", ["succeeded", "failed"]).pipe(
          Effect.forkChild,
        );
        yield* controller.start("owner", { methodId: "browser" });
        const state = yield* final;
        expect(state.phase).toBe("failed");
        expect(state.message).toContain("login exploded");
      }),
  );

  it.effect.skipIf(windowsHost)(
    "complete writes the pasted response to the login command's stdin",
    () =>
      Effect.gen(function* () {
        const dir = yield* Effect.promise(() =>
          NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "cli-auth-stdin-")),
        );
        const outPath = NodePath.join(dir, "received.txt");
        const script = yield* makeScript(
          `read -r code\nprintf '%s' "$code" > '${outPath}'\nexit 0`,
        );
        const controller = yield* makeAuth({
          command: script,
          methods: [
            {
              kind: "cli",
              id: "browser",
              label: "Sign in",
              args: [],
              inputPrompt: "Paste the code",
            },
          ],
          probeAuth: Effect.succeed(authenticated),
        });
        const final = yield* awaitPhase(controller, "owner", ["succeeded", "failed"]).pipe(
          Effect.forkChild,
        );
        yield* controller.start("owner", { methodId: "browser" });
        // No urlPattern, so the flow publishes `waiting` with the prompt at once.
        const waiting = yield* awaitPhase(controller, "owner", ["waiting"]);
        expect(waiting.inputPrompt).toBe("Paste the code");
        const accepted = yield* controller.complete("owner", {
          flowId: waiting.flowId!,
          callbackUrl: "pasted-code-123",
        });
        expect(accepted.phase).toBe("verifying");
        const done = yield* final;
        expect(done.phase).toBe("succeeded");
        const received = yield* Effect.promise(() => NodeFSP.readFile(outPath, "utf8"));
        expect(received).toBe("pasted-code-123");
      }),
  );

  it.effect.skipIf(windowsHost)(
    "hides the URL and flow id from clients that do not own the flow",
    () =>
      Effect.gen(function* () {
        const script = yield* makeScript(`echo "https://auth.example.com/login"\nsleep 30`);
        const controller = yield* makeAuth({
          command: script,
          methods: [
            {
              kind: "cli",
              id: "browser",
              label: "Sign in",
              args: [],
              urlPattern: /(https:\/\/\S+)/,
            },
          ],
          probeAuth: Effect.succeed(authenticated),
        });
        yield* controller.start("owner", { methodId: "browser" });
        const waiting = yield* awaitPhase(controller, "owner", ["waiting"]);
        expect(waiting.authorizationUrl).toBe("https://auth.example.com/login");

        const other = yield* awaitPhase(controller, "other-client", ["waiting"]);
        expect(other.flowId).toBeNull();
        expect(other.authorizationUrl).toBeNull();
        expect(other.message).toBe("Sign-in is in progress in another client.");

        // The other client cannot complete a flow it cannot see.
        const completed = yield* controller
          .complete("other-client", {
            flowId: waiting.flowId!,
            callbackUrl: "x",
          })
          .pipe(Effect.result);
        expect(completed._tag).toBe("Failure");

        const cancelled = yield* controller.cancel("owner", waiting.flowId!);
        expect(cancelled.phase).toBe("cancelled");
      }),
  );

  it.effect.skipIf(windowsHost)("logout runs the logout command and the extra teardown", () =>
    Effect.gen(function* () {
      const dir = yield* Effect.promise(() =>
        NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "cli-auth-logout-")),
      );
      const markerPath = NodePath.join(dir, "logout-ran");
      const script = yield* makeScript(`touch '${markerPath}'\nexit 0`);
      let tornDown = false;
      const controller = yield* makeAuth({
        command: script,
        methods: [
          {
            kind: "saved-credentials",
            id: "saved",
            label: "Use saved login",
            missingMessage: "none",
          },
        ],
        probeAuth: Effect.succeed(authenticated),
        logoutCommand: [],
        onLogout: Effect.sync(() => {
          tornDown = true;
        }),
      });
      const state = yield* controller.logout(Effect.void);
      expect(state.phase).toBe("idle");
      expect(tornDown).toBe(true);
      yield* Effect.promise(() => NodeFSP.access(markerPath));
    }),
  );

  it.effect("stores a pasted env credential as a sensitive variable", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;
      const credential = providerEnvVarCredential({
        serverSettings,
        instanceId,
        driverKind: ProviderDriverKind.make("devin"),
        envName: "WINDSURF_API_KEY",
      });
      yield* credential.apply("devin-secret-key");
      const settings = yield* serverSettings.getSettings;
      const env = settings.providerInstances[instanceId]?.environment ?? [];
      expect(env).toEqual([
        { name: "WINDSURF_API_KEY", value: "devin-secret-key", sensitive: true },
      ]);

      yield* credential.remove;
      const cleared = yield* serverSettings.getSettings;
      expect(
        cleared.providerInstances[instanceId]?.environment ?? [],
      ).toEqual([]);
    }),
  );

  it.effect.skipIf(windowsHost)("cliOutputProbe matches stored-credential listings", () =>
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const withCreds = yield* makeScript(
        `echo "1 credentials"\necho "1 environment variable"`,
      );
      const withoutCreds = yield* makeScript(`echo "no credentials found"`);
      const match = /\d+\s+(credentials?|environment variables?)/i;

      expect(
        yield* cliOutputProbe({
          spawner,
          command: withCreds,
          args: ["auth", "list"],
          processEnv: {},
          match,
        }),
      ).toBe(true);
      expect(
        yield* cliOutputProbe({
          spawner,
          command: withoutCreds,
          args: [],
          processEnv: {},
          match,
        }),
      ).toBe(false);
    }),
  );
});
