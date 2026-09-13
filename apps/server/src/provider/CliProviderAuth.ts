/**
 * CliProviderAuth — a generic `ProviderAuthController` for providers whose
 * credentials are owned by an external CLI (its keychain entries, credential
 * files, or an instance-level API key environment variable).
 *
 * Each driver advertises a list of `CliAuthMethodSpec`s on its snapshot's
 * `setup.authMethods`; the controller runs them:
 *
 *   - `saved-credentials` re-probes the provider so credentials the CLI
 *     already holds (a previous `devin auth login`, a macOS Keychain entry,
 *     `~/.codex/auth.json`, …) are picked up without a sign-in flow.
 *   - `paste-credential` stores a pasted key — usually a sensitive provider
 *     environment variable (`XAI_API_KEY`, `WINDSURF_API_KEY`, …) — then
 *     re-probes.
 *   - `cli` spawns the provider's own login command (`codex login
 *     --device-auth`, `cursor-agent login`, …), surfaces the URL / device
 *     code it prints, and optionally pipes a pasted response to its stdin.
 *   - `effect` runs an arbitrary scoped effect — used for Devin's ACP
 *     `authenticate` browser flow.
 *
 * Sign-in is always explicit: sessions never invoke these methods, and ACP
 * session runtimes are built without `authMethodId` so every new thread no
 * longer triggers a login.
 *
 * @module provider/CliProviderAuth
 */
import {
  type ProviderAuthMethod,
  type ProviderAuthState,
  ProviderDriverKind,
  type ProviderInstanceEnvironmentVariable,
  ProviderInstanceEnvironmentVariableName,
  type ProviderInstanceId,
  ProviderSetupError,
  type ServerProviderAuth,
} from "@t3tools/contracts";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

import type { ServerSettingsService } from "../serverSettings.ts";
import type { ProviderAuthController } from "./Services/ProviderAuthService.ts";

const AUTH_TIMEOUT = Duration.minutes(5);
const OUTPUT_TAIL_CHARS = 8_192;

// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE = /\x1b\[[0-9;]*[A-Za-z]|\x1b\].*?(?:\x07|\x1b\\)|\x1b\[\?[0-9;]*[a-zA-Z]/g;
const stripAnsi = (text: string) => text.replace(ANSI_ESCAPE, "");
const isSetupError = Schema.is(ProviderSetupError);

interface CliAuthMethodBase {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
}

/**
 * One selectable way to authenticate. `id`, `label`, `description` are
 * advertised verbatim on the snapshot; `kind` maps to the wire-level
 * `ProviderAuthMethodKind`.
 */
export type CliAuthMethodSpec =
  | (CliAuthMethodBase & {
      readonly kind: "saved-credentials";
      /** Failure detail when the re-probe still reports no credentials. */
      readonly missingMessage: string;
      /**
       * Custom detection for providers whose `auth.status` never reaches
       * "authenticated" (e.g. OpenCode keeps credentials per upstream
       * provider). Defaults to the controller's `probeAuth`.
       */
      readonly probe?: Effect.Effect<boolean>;
    })
  | (CliAuthMethodBase & {
      readonly kind: "paste-credential";
      readonly credentialLabel: string;
      readonly credentialPlaceholder?: string;
      readonly apply: (secret: string) => Effect.Effect<void, ProviderSetupError>;
      /**
       * Defaults to `true`. Set `false` when `apply` rewrites instance
       * settings — the write tears this instance down and the rebuilt
       * instance's probe reports the outcome instead.
       */
      readonly probeAfterApply?: boolean;
      readonly appliedMessage?: string;
    })
  | (CliAuthMethodBase & {
      readonly kind: "cli";
      readonly args: ReadonlyArray<string>;
      readonly env?: Readonly<Record<string, string>>;
      /** First capture group (or full match) becomes `authorizationUrl`. */
      readonly urlPattern?: RegExp;
      /** First capture group is shown as the one-time code in `message`. */
      readonly codePattern?: RegExp;
      /** When set, `waiting` shows a paste box; `complete` writes it to stdin. */
      readonly inputPrompt?: string;
      /** Overrides the `waiting`-phase status line. */
      readonly waitingMessage?: string;
      readonly timeout?: Duration.Input;
    })
  | (CliAuthMethodBase & {
      readonly kind: "effect";
      /** Shown while the effect runs (e.g. "Complete the sign-in in the opened browser."). */
      readonly waitingMessage?: string;
      readonly run: Effect.Effect<void, ProviderSetupError, Scope.Scope>;
    });

/** The wire `ProviderAuthMethod` list stamped onto `ServerProvider.setup.authMethods`. */
export function authMethodDescriptors(
  methods: ReadonlyArray<CliAuthMethodSpec>,
): ReadonlyArray<ProviderAuthMethod> {
  return methods.map((method) => ({
    id: method.id,
    kind:
      method.kind === "cli" || method.kind === "effect" ? ("sign-in-flow" as const) : method.kind,
    label: method.label,
    ...(method.description !== undefined ? { description: method.description } : {}),
    ...(method.kind === "paste-credential"
      ? {
          credentialLabel: method.credentialLabel,
          ...(method.credentialPlaceholder !== undefined
            ? { credentialPlaceholder: method.credentialPlaceholder }
            : {}),
        }
      : {}),
  }));
}

interface CliAuthFlow {
  readonly id: string;
  readonly ownerSessionId: string;
  readonly expiresAtMillis: number;
  state: ProviderAuthState;
  child: ChildProcessSpawner.ChildProcessHandle | undefined;
  acceptsInput: boolean;
  fiber: Fiber.Fiber<void> | undefined;
}

interface AuthSnapshot {
  readonly ownerSessionId: string | null;
  readonly state: ProviderAuthState;
}

function visibleSnapshot(snapshot: AuthSnapshot, ownerSessionId: string): ProviderAuthState {
  if (snapshot.ownerSessionId === null || snapshot.ownerSessionId === ownerSessionId) {
    return snapshot.state;
  }
  const busy = ["starting", "waiting", "verifying"].includes(snapshot.state.phase);
  return {
    ...snapshot.state,
    flowId: null,
    authorizationUrl: null,
    expiresAt: null,
    inputPrompt: undefined,
    ...(busy ? { message: "Sign-in is in progress in another client." } : {}),
  };
}

export interface CliProviderAuthOptions {
  readonly instanceId: ProviderInstanceId;
  /** Display name used in status messages, e.g. "Devin". */
  readonly providerLabel: string;
  /** Resolved provider binary used by `cli` methods and `logoutCommand`. */
  readonly command: string;
  /** Environment the provider CLI runs under (instance env already merged). */
  readonly processEnv: NodeJS.ProcessEnv;
  readonly methods: ReadonlyArray<CliAuthMethodSpec>;
  /** Re-probe the provider and return the auth block it will publish. */
  readonly probeAuth: Effect.Effect<ServerProviderAuth>;
  /** Args appended to `command` for sign-out (e.g. `["auth", "logout"]`). */
  readonly logoutCommand?: ReadonlyArray<string>;
  /** Extra teardown on sign-out — e.g. removing a stored API-key env var. */
  readonly onLogout?: Effect.Effect<void, ProviderSetupError>;
}

export const makeCliProviderAuth = Effect.fn("makeCliProviderAuth")(function* (
  options: CliProviderAuthOptions,
): Effect.fn.Return<
  ProviderAuthController,
  never,
  Crypto.Crypto | ChildProcessSpawner.ChildProcessSpawner | Scope.Scope
> {
  const crypto = yield* Crypto.Crypto;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const instanceScope = yield* Scope.Scope;
  const lock = yield* Semaphore.make(1);
  const emptyState: ProviderAuthState = {
    instanceId: options.instanceId,
    phase: "idle",
    flowId: null,
    authorizationUrl: null,
    expiresAt: null,
    message: null,
  };
  const snapshot = yield* SubscriptionRef.make<AuthSnapshot>({
    ownerSessionId: null,
    state: emptyState,
  });
  let activeFlow: CliAuthFlow | undefined;
  let operation: "idle" | "auth" | "logout" | "cancel" = "idle";

  const setupError = (name: string, detail: string) =>
    new ProviderSetupError({ instanceId: options.instanceId, operation: name, detail });
  const publishFlow = (flow: CliAuthFlow, state: ProviderAuthState) => {
    flow.state = state;
    return SubscriptionRef.set(snapshot, { ownerSessionId: flow.ownerSessionId, state });
  };
  const publishUpdate = (flow: CliAuthFlow, patch: Partial<ProviderAuthState>) =>
    lock.withPermits(1)(
      Effect.suspend(() =>
        activeFlow === flow ? publishFlow(flow, { ...flow.state, ...patch }) : Effect.void,
      ),
    );

  const defaultDetect = options.probeAuth.pipe(
    Effect.map((auth) => auth.status === "authenticated"),
    Effect.orElseSucceed(() => false),
  );
  const verifyNow = (flow: CliAuthFlow, missingMessage?: string, detect = defaultDetect) =>
    Effect.gen(function* () {
      yield* publishUpdate(flow, {
        phase: "verifying",
        authorizationUrl: null,
        inputPrompt: undefined,
        message: `Checking ${options.providerLabel} credentials.`,
      });
      if (yield* detect) {
        yield* publishUpdate(flow, {
          phase: "succeeded",
          expiresAt: null,
          message: `${options.providerLabel} is signed in.`,
        });
        return;
      }
      yield* publishUpdate(flow, {
        phase: "failed",
        expiresAt: null,
        message:
          missingMessage ??
          `${options.providerLabel} still reports no credentials on this environment.`,
      });
    });

  const runCliFlow = (flow: CliAuthFlow, spec: CliAuthMethodSpec & { kind: "cli" }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const env = { ...options.processEnv, ...spec.env };
        const resolved = yield* resolveSpawnCommand(options.command, spec.args, { env });
        const child = yield* spawner.spawn(
          ChildProcess.make(resolved.command, resolved.args, {
            env,
            shell: resolved.shell,
          }),
        );
        flow.child = child;
        flow.acceptsInput = spec.inputPrompt !== undefined;
        if (spec.urlPattern === undefined) {
          yield* publishUpdate(flow, {
            phase: "waiting",
            inputPrompt: spec.inputPrompt,
            message:
              spec.waitingMessage ?? spec.description ?? `${spec.label} is waiting for input.`,
          });
        }

        let outputTail = "";
        let urlPublished = false;
        let lastCode: string | undefined;
        const scanOutput = (text: string) =>
          Effect.suspend(() => {
            outputTail = (outputTail + stripAnsi(text)).slice(-OUTPUT_TAIL_CHARS);
            const updates: Array<Effect.Effect<void>> = [];
            if (!urlPublished && spec.urlPattern !== undefined) {
              const match = outputTail.match(spec.urlPattern);
              if (match) {
                urlPublished = true;
                updates.push(
                  publishUpdate(flow, {
                    phase: "waiting",
                    authorizationUrl: match[1] ?? match[0],
                    inputPrompt: spec.inputPrompt,
                    message:
                      spec.waitingMessage ??
                      (spec.inputPrompt !== undefined
                        ? "Open the link, sign in, then paste the code it shows."
                        : `Open the link to finish ${options.providerLabel} sign-in.`),
                  }),
                );
              }
            }
            if (spec.codePattern !== undefined) {
              const match = outputTail.match(spec.codePattern);
              const code = match?.[1]?.trim();
              if (code && code !== lastCode) {
                lastCode = code;
                updates.push(
                  publishUpdate(flow, {
                    phase: "waiting",
                    message: `Enter this code on the sign-in page: ${code}`,
                  }),
                );
              }
            }
            return updates.length === 0 ? Effect.void : Effect.all(updates, { discard: true });
          });
        const reader = yield* child.all.pipe(
          Stream.decodeText(),
          Stream.runForEach(scanOutput),
          Effect.forkChild,
        );

        const code = yield* child.exitCode.pipe(
          Effect.map(Number),
          Effect.ensuring(Fiber.interrupt(reader)),
        );
        if (code === 0) {
          return;
        }
        const tail = outputTail.trim().split("\n").slice(-3).join(" ").trim();
        return yield* setupError(
          "start",
          tail.length > 0 && tail.length < 240
            ? tail
            : `${options.providerLabel} sign-in exited with code ${code}.`,
        );
      }),
    );

  const runMethod = (
    flow: CliAuthFlow,
    method: CliAuthMethodSpec,
    credential: string | undefined,
  ) =>
    Effect.gen(function* () {
      switch (method.kind) {
        case "saved-credentials":
          yield* verifyNow(flow, method.missingMessage, method.probe ?? defaultDetect);
          return;
        case "paste-credential": {
          if (!credential) {
            return yield* setupError("start", `Paste ${method.credentialLabel} first.`);
          }
          yield* publishUpdate(flow, {
            phase: "verifying",
            message: `Saving ${method.credentialLabel}.`,
          });
          yield* method.apply(credential);
          if (method.probeAfterApply === false) {
            yield* publishUpdate(flow, {
              phase: "succeeded",
              expiresAt: null,
              message:
                method.appliedMessage ??
                `${method.credentialLabel} saved. ${options.providerLabel} re-checks its credentials next.`,
            });
            return;
          }
          yield* verifyNow(flow);
          return;
        }
        case "cli":
          yield* runCliFlow(flow, method);
          yield* verifyNow(flow);
          return;
        case "effect":
          yield* publishUpdate(flow, {
            phase: "waiting",
            message:
              method.waitingMessage ??
              method.description ??
              `Complete the ${options.providerLabel} sign-in.`,
          });
          yield* Effect.scoped(method.run);
          yield* verifyNow(flow);
          return;
      }
    });

  const runFlow = (flow: CliAuthFlow, method: CliAuthMethodSpec, credential: string | undefined) =>
    runMethod(flow, method, credential).pipe(
      Effect.timeoutOrElse({
        duration: AUTH_TIMEOUT,
        orElse: () =>
          Effect.fail(setupError("start", `${options.providerLabel} sign-in timed out.`)),
      }),
      Effect.exit,
      Effect.flatMap((result) =>
        lock.withPermits(1)(
          Effect.gen(function* () {
            if (activeFlow !== flow) return;
            activeFlow = undefined;
            operation = "idle";
            flow.child = undefined;
            flow.acceptsInput = false;
            if (Exit.isSuccess(result)) return;
            const error = Option.getOrUndefined(Cause.findErrorOption(result.cause));
            yield* publishFlow(flow, {
              ...flow.state,
              phase: "failed",
              authorizationUrl: null,
              expiresAt: null,
              inputPrompt: undefined,
              message:
                error !== undefined && isSetupError(error)
                  ? error.detail
                  : `${options.providerLabel} sign-in failed. Try again.`,
            });
          }),
        ),
      ),
    );

  const stopFlow = (flow: CliAuthFlow, phase: "cancelled" | "failed", message: string) =>
    Effect.uninterruptible(
      Effect.gen(function* () {
        const detached = yield* lock.withPermits(1)(
          Effect.gen(function* () {
            if (activeFlow !== flow) return false;
            activeFlow = undefined;
            operation = "cancel";
            flow.acceptsInput = false;
            yield* publishFlow(flow, {
              ...flow.state,
              phase,
              authorizationUrl: null,
              expiresAt: null,
              inputPrompt: undefined,
              message,
            });
            return true;
          }),
        );
        if (!detached) return;
        // Interrupting the flow fiber closes its scope, which kills the
        // spawned CLI. Its `runFlow` tail sees activeFlow has moved on and
        // does not republish.
        if (flow.fiber) yield* Fiber.interrupt(flow.fiber);
        yield* lock.withPermits(1)(
          Effect.sync(() => {
            if (operation === "cancel") operation = "idle";
          }),
        );
      }),
    );

  const requireFlow = (ownerSessionId: string, flowId: string, name: string) =>
    Effect.gen(function* () {
      const flow = activeFlow;
      if (!flow || flow.id !== flowId || flow.ownerSessionId !== ownerSessionId) {
        return yield* setupError(name, "This sign-in is no longer active in this client.");
      }
      const now = yield* Clock.currentTimeMillis;
      if (now >= flow.expiresAtMillis) {
        return yield* setupError(name, `${options.providerLabel} sign-in expired. Start again.`);
      }
      return flow;
    });

  const defaultMethod = () =>
    options.methods.find((method) => method.kind === "cli" || method.kind === "effect") ??
    options.methods[0];

  const controller: ProviderAuthController = {
    start: (ownerSessionId, startOptions) =>
      lock.withPermits(1)(
        Effect.uninterruptible(
          Effect.gen(function* () {
            if (activeFlow?.ownerSessionId === ownerSessionId && operation === "auth") {
              return activeFlow.state;
            }
            if (operation !== "idle") {
              return yield* setupError(
                "start",
                `${options.providerLabel} setup is already in progress.`,
              );
            }
            const method = startOptions?.methodId
              ? options.methods.find((candidate) => candidate.id === startOptions.methodId)
              : defaultMethod();
            if (!method) {
              return yield* setupError(
                "start",
                `${options.providerLabel} has no sign-in method '${startOptions?.methodId}'.`,
              );
            }
            const flowId = yield* crypto.randomUUIDv4.pipe(
              Effect.mapError(() => setupError("start", "Could not start sign-in. Try again.")),
            );
            const expiresAtMillis =
              (yield* Clock.currentTimeMillis) + Duration.toMillis(AUTH_TIMEOUT);
            const state: ProviderAuthState = {
              ...emptyState,
              phase: "starting",
              flowId,
              expiresAt: DateTime.formatIso(DateTime.makeUnsafe(expiresAtMillis)),
              message: `${method.label}…`,
            };
            const flow: CliAuthFlow = {
              id: flowId,
              ownerSessionId,
              expiresAtMillis,
              state,
              child: undefined,
              acceptsInput: false,
              fiber: undefined,
            };
            activeFlow = flow;
            operation = "auth";
            yield* publishFlow(flow, state);
            flow.fiber = yield* runFlow(flow, method, startOptions?.credential).pipe(
              Effect.interruptible,
              Effect.forkIn(instanceScope),
            );
            return state;
          }),
        ),
      ),
    complete: Effect.fn("CliProviderAuth.complete")(function* (ownerSessionId, input) {
      const flow = yield* lock.withPermits(1)(
        requireFlow(ownerSessionId, input.flowId, "complete"),
      );
      if (!flow.acceptsInput || flow.child === undefined) {
        return yield* setupError("complete", "This sign-in does not accept a pasted response.");
      }
      const child = flow.child;
      yield* Stream.run(Stream.encodeText(Stream.make(`${input.callbackUrl}\n`)), child.stdin).pipe(
        Effect.mapError(() =>
          setupError("complete", "Could not deliver the response to the sign-in prompt."),
        ),
      );
      yield* publishUpdate(flow, {
        phase: "verifying",
        authorizationUrl: null,
        inputPrompt: undefined,
        message: `Finishing ${options.providerLabel} sign-in.`,
      });
      return flow.state;
    }),
    cancel: Effect.fn("CliProviderAuth.cancel")(function* (ownerSessionId, flowId) {
      const flow = yield* lock.withPermits(1)(requireFlow(ownerSessionId, flowId, "cancel"));
      yield* stopFlow(flow, "cancelled", `${options.providerLabel} sign-in was cancelled.`);
      return flow.state;
    }),
    // Running threads own their credentials for their lifetime — sign-out
    // only clears stored credentials, so `stopSessions` is intentionally not
    // invoked for CLI providers.
    logout: Effect.fn("CliProviderAuth.logout")(function* (_stopSessions) {
      const result = yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const flow = yield* lock.withPermits(1)(
            Effect.gen(function* () {
              if (operation !== "idle" && operation !== "auth") {
                return yield* setupError(
                  "logout",
                  `${options.providerLabel} setup is already stopping.`,
                );
              }
              operation = "logout";
              const currentFlow = activeFlow;
              activeFlow = undefined;
              if (currentFlow) {
                currentFlow.acceptsInput = false;
                yield* publishFlow(currentFlow, {
                  ...currentFlow.state,
                  phase: "cancelled",
                  authorizationUrl: null,
                  expiresAt: null,
                  inputPrompt: undefined,
                  message: `${options.providerLabel} sign-in was cancelled by sign-out.`,
                });
              }
              return currentFlow;
            }),
          );
          if (flow?.fiber) yield* Fiber.interrupt(flow.fiber);
          const outcome = yield* restore(
            Effect.gen(function* () {
              if (options.logoutCommand !== undefined) {
                const env = options.processEnv;
                const resolved = yield* resolveSpawnCommand(
                  options.command,
                  options.logoutCommand,
                  {
                    env,
                  },
                );
                const child = yield* spawner.spawn(
                  ChildProcess.make(resolved.command, resolved.args, {
                    env,
                    shell: resolved.shell,
                  }),
                );
                const code = yield* child.exitCode.pipe(Effect.map(Number));
                if (code !== 0) {
                  return yield* setupError(
                    "logout",
                    `${options.providerLabel} sign-out exited with code ${code}.`,
                  );
                }
              }
              if (options.onLogout !== undefined) {
                yield* options.onLogout;
              }
              yield* options.probeAuth;
            }).pipe(Effect.scoped),
          ).pipe(Effect.exit);
          yield* lock.withPermits(1)(
            Effect.gen(function* () {
              operation = "idle";
              yield* SubscriptionRef.set(snapshot, {
                ownerSessionId: null,
                state: {
                  ...emptyState,
                  phase: Exit.isSuccess(outcome) ? "idle" : "failed",
                  message: Exit.isSuccess(outcome)
                    ? `Signed out of ${options.providerLabel}.`
                    : `${options.providerLabel} sign-out failed. Try again.`,
                },
              });
            }),
          );
          if (Exit.isFailure(outcome)) {
            const error = Option.getOrUndefined(Cause.findErrorOption(outcome.cause));
            if (error !== undefined && isSetupError(error)) {
              return yield* error;
            }
            return yield* setupError(
              "logout",
              `${options.providerLabel} sign-out failed. Try again.`,
            );
          }
          // The published snapshot has no owner, so it is visible to every
          // subscriber and is the state to hand back here.
          return yield* SubscriptionRef.get(snapshot).pipe(Effect.map((value) => value.state));
        }),
      );
      return result;
    }),
    subscribe: (ownerSessionId) =>
      SubscriptionRef.changes(snapshot).pipe(
        Stream.map((value) => visibleSnapshot(value, ownerSessionId)),
      ),
  };

  return controller;
});

/**
 * `saved-credentials` `probe` for CLIs that list stored credentials (e.g.
 * `opencode auth list`). Runs the command, strips ANSI, and reports whether
 * `match` appears in the output.
 */
export function cliOutputProbe(input: {
  readonly spawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly processEnv: NodeJS.ProcessEnv;
  readonly match: RegExp;
}): Effect.Effect<boolean> {
  return Effect.gen(function* () {
    const resolved = yield* resolveSpawnCommand(input.command, input.args, {
      env: input.processEnv,
    });
    const child = yield* input.spawner.spawn(
      ChildProcess.make(resolved.command, resolved.args, {
        env: input.processEnv,
        shell: resolved.shell,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      }),
    );
    const output = yield* child.all.pipe(
      Stream.decodeText(),
      Stream.runFold(
        () => "",
        (acc: string, chunk) => acc + chunk,
      ),
      Effect.map(stripAnsi),
    );
    return input.match.test(output);
  }).pipe(
    Effect.scoped,
    Effect.orElseSucceed(() => false),
  );
}

/**
 * `paste-credential` `apply` for CLIs that ingest a key on stdin (e.g.
 * `codex login --with-api-key`). The secret streams to stdin with
 * `endOnDone`, the process exits, and the CLI's own credential store is
 * written — nothing is persisted by T3. Pair with `probeAfterApply: true`
 * (the default) so the post-apply probe verifies the stored credential.
 */
export function stdinCredentialApply(input: {
  readonly spawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly instanceId: ProviderInstanceId;
  readonly providerLabel: string;
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly processEnv: NodeJS.ProcessEnv;
}): (secret: string) => Effect.Effect<void, ProviderSetupError> {
  return (secret) =>
    Effect.scoped(
      Effect.gen(function* () {
        const resolved = yield* resolveSpawnCommand(input.command, input.args, {
          env: input.processEnv,
        });
        const child = yield* input.spawner.spawn(
          ChildProcess.make(resolved.command, resolved.args, {
            env: input.processEnv,
            shell: resolved.shell,
            stdin: Stream.encodeText(Stream.make(`${secret}\n`)),
            stdout: "pipe",
            stderr: "pipe",
          }),
        );
        const code = yield* child.exitCode.pipe(Effect.map(Number));
        if (code !== 0) {
          return yield* new ProviderSetupError({
            instanceId: input.instanceId,
            operation: "credential",
            detail: `${input.providerLabel} rejected the pasted credential.`,
          });
        }
      }),
    ).pipe(
      Effect.mapError((cause) =>
        isSetupError(cause)
          ? cause
          : new ProviderSetupError({
              instanceId: input.instanceId,
              operation: "credential",
              detail: `Could not pass the credential to ${input.providerLabel}.`,
              cause: cause as Error,
            }),
      ),
    );
}

/**
 * `paste-credential` `apply` that stores the secret as a sensitive provider
 * environment variable. The write rebuilds the instance, so pair it with
 * `probeAfterApply: false` — the rebuilt probe reports the outcome.
 */
export function providerEnvVarCredential(input: {
  readonly serverSettings: ServerSettingsService["Service"];
  readonly instanceId: ProviderInstanceId;
  readonly driverKind: ProviderDriverKind;
  readonly envName: string;
}): {
  readonly apply: (secret: string) => Effect.Effect<void, ProviderSetupError>;
  readonly remove: Effect.Effect<void, ProviderSetupError>;
} {
  const write = (value: string | undefined) =>
    Effect.gen(function* () {
      const settings = yield* input.serverSettings.getSettings;
      const entry = settings.providerInstances[input.instanceId] ?? { driver: input.driverKind };
      const environment = (entry.environment ?? []).filter(
        (variable) => variable.name !== input.envName,
      );
      if (value !== undefined) {
        environment.push({
          name: ProviderInstanceEnvironmentVariableName.make(input.envName),
          value,
          sensitive: true,
        } satisfies ProviderInstanceEnvironmentVariable);
      }
      yield* input.serverSettings.updateSettings({
        providerInstances: {
          ...settings.providerInstances,
          [input.instanceId]: { ...entry, environment },
        },
      });
    }).pipe(
      Effect.mapError(
        (cause) =>
          new ProviderSetupError({
            instanceId: input.instanceId,
            operation: "credential",
            detail: `Could not save ${input.envName} for this provider instance.`,
            cause: cause as Error,
          }),
      ),
    );
  return {
    apply: (secret) => write(secret),
    remove: write(undefined),
  };
}
