import {
  AuthStandardClientScopes,
  EnvironmentId,
  PRIMARY_LOCAL_ENVIRONMENT_ID,
  type DesktopBridge,
  type DesktopSshEnvironmentBootstrap,
  type DesktopSshEnvironmentTarget,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { afterEach, vi } from "vite-plus/test";
import { ClientCapabilities } from "@t3tools/client-runtime/platform";
import {
  BearerConnectionTarget,
  ConnectionBlockedError,
  ConnectionTransientError,
  RelayConnectionRegistration,
  RelayConnectionTarget,
  SshConnectionTarget,
} from "@t3tools/client-runtime/connection";

import {
  canRetainCachedPlatformRegistrationAfterRefreshFailure,
  canReuseCachedPlatformRegistration,
  includeSecondaryPlatformRegistrations,
  isolateDetachedConnectionCatalog,
  layer,
  isRejectedBootstrapCredentialError,
  isRejectedSecondaryBootstrap,
  makeDesktopSshGateway,
  nextRejectedSecondaryBootstrap,
  persistedTargetsForDetachedCatalog,
  primaryRegistrationToRetainAfterTopologyRead,
  prepareDesktopSshEnvironment,
  provisionDesktopSshEnvironment,
  readPrimaryEnvironmentTargetResult,
  secondaryRegistrationsToRetainAfterTopologyRead,
  secondaryBearerExpiresAtEpochMs,
  secondaryBearerRefreshAtEpochMs,
} from "./platform.ts";

const TARGET: DesktopSshEnvironmentTarget = {
  alias: "devbox",
  hostname: "devbox.example.test",
  username: "developer",
  port: 22,
};

const SSH_BOOTSTRAP = {
  target: TARGET,
  httpBaseUrl: "http://127.0.0.1:3201/",
  wsBaseUrl: "ws://127.0.0.1:3201/",
  pairingToken: "abandoned-token",
};

function pendingSetup() {
  let resolve!: (bootstrap: DesktopSshEnvironmentBootstrap) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<DesktopSshEnvironmentBootstrap>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function makeBridge(
  calls: string[],
  options?: {
    readonly failDescriptor?: boolean;
    readonly savedTokenRejected?: boolean;
    readonly savedTokenPermissions?: ReadonlyArray<string>;
  },
): DesktopBridge {
  return {
    ensureSshEnvironment: async (
      target: DesktopSshEnvironmentTarget,
      ensureOptions?: { issuePairingToken?: boolean },
    ) => {
      calls.push("ensure");
      return {
        target,
        httpBaseUrl: "http://127.0.0.1:3201/",
        wsBaseUrl: "ws://127.0.0.1:3201/",
        pairingToken: ensureOptions?.issuePairingToken === true ? "pairing-token" : null,
      };
    },
    disconnectSshEnvironment: async () => {
      calls.push("disconnect");
    },
    fetchSshSessionState: async () => {
      calls.push("session");
      return {
        authenticated: options?.savedTokenRejected !== true,
        permissions: options?.savedTokenPermissions ?? AuthStandardClientScopes,
      };
    },
    fetchSshEnvironmentDescriptor: async () => {
      calls.push("descriptor");
      if (options?.failDescriptor === true) {
        throw new Error("descriptor unavailable");
      }
      return {
        environmentId: EnvironmentId.make("environment-ssh"),
        label: "SSH environment",
        platform: {
          os: "linux",
          arch: "x64",
        },
        serverVersion: "0.0.0-test",
        capabilities: {
          repositoryIdentity: true,
        },
      };
    },
    bootstrapSshBearerSession: async () => {
      calls.push("token");
      return {
        access_token: "bearer-token",
        issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
        token_type: "Bearer",
        expires_in: 3_600,
        scope: AuthStandardClientScopes.join(" "),
      };
    },
  } as unknown as DesktopBridge;
}

describe("desktop SSH pairing", () => {
  it.effect("fetches the descriptor before consuming the one-time credential", () =>
    Effect.gen(function* () {
      const calls: string[] = [];

      const provisioned = yield* provisionDesktopSshEnvironment(makeBridge(calls), TARGET);

      expect(provisioned.environmentId).toBe(EnvironmentId.make("environment-ssh"));
      expect(calls).toEqual(["ensure", "descriptor", "token"]);
    }),
  );

  it.effect("does not consume the credential when adding a route to a different machine", () =>
    Effect.gen(function* () {
      const calls: string[] = [];

      const error = yield* provisionDesktopSshEnvironment(
        makeBridge(calls),
        TARGET,
        EnvironmentId.make("some-other-machine"),
      ).pipe(Effect.flip);

      expect(error).toMatchObject({ reason: "configuration" });
      expect(calls).toEqual(["ensure", "descriptor"]);
    }),
  );

  it.effect("does not consume the credential when descriptor discovery fails", () =>
    Effect.gen(function* () {
      const calls: string[] = [];

      yield* provisionDesktopSshEnvironment(
        makeBridge(calls, { failDescriptor: true }),
        TARGET,
      ).pipe(Effect.flip);

      expect(calls).toEqual(["ensure", "descriptor"]);
    }),
  );

  it.effect("exchanges one setup credential after repeated interrupted provisions", () =>
    Effect.gen(function* () {
      const bridge = makeBridge([]);
      const setup = pendingSetup();
      const ensure = vi.spyOn(bridge, "ensureSshEnvironment").mockReturnValue(setup.promise);
      const exchange = vi.spyOn(bridge, "bootstrapSshBearerSession");
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const interrupted = yield* Effect.forkChild(
          provisionDesktopSshEnvironment(bridge, TARGET),
          { startImmediately: true },
        );
        yield* Fiber.interrupt(interrupted);
      }

      const retry = yield* Effect.forkChild(provisionDesktopSshEnvironment(bridge, TARGET), {
        startImmediately: true,
      });
      setup.resolve(SSH_BOOTSTRAP);
      const provisioned = yield* Fiber.join(retry);

      expect(provisioned.bearerToken).toBe("bearer-token");
      expect(ensure).toHaveBeenCalledExactlyOnceWith(TARGET, { issuePairingToken: true });
      expect(exchange).toHaveBeenCalledExactlyOnceWith(
        SSH_BOOTSTRAP.httpBaseUrl,
        "abandoned-token",
      );
    }),
  );

  it.effect("starts fresh after an abandoned setup settles in success or failure", () =>
    Effect.gen(function* () {
      for (const outcome of ["success", "failure"]) {
        const bridge = makeBridge([]);
        const setup = pendingSetup();
        const ensure = vi.spyOn(bridge, "ensureSshEnvironment").mockReturnValueOnce(setup.promise);
        const exchange = vi.spyOn(bridge, "bootstrapSshBearerSession");
        const interrupted = yield* Effect.forkChild(
          provisionDesktopSshEnvironment(bridge, TARGET),
          { startImmediately: true },
        );
        yield* Fiber.interrupt(interrupted);
        if (outcome === "success") setup.resolve(SSH_BOOTSTRAP);
        else setup.reject(new Error("remote launch failed"));
        yield* Effect.promise(() =>
          setup.promise.then(
            () => undefined,
            () => undefined,
          ),
        );

        const provisioned = yield* provisionDesktopSshEnvironment(bridge, TARGET);

        expect(provisioned.bearerToken).toBe("bearer-token");
        expect(ensure).toHaveBeenCalledTimes(2);
        expect(exchange).toHaveBeenCalledExactlyOnceWith(
          SSH_BOOTSTRAP.httpBaseUrl,
          "pairing-token",
        );
      }
    }),
  );

  it.effect("disconnect invalidates unfinished setup even before provision is interrupted", () =>
    Effect.gen(function* () {
      const calls: string[] = [];
      const bridge = makeBridge(calls);
      const setup = pendingSetup();
      const ensure = vi.spyOn(bridge, "ensureSshEnvironment").mockReturnValueOnce(setup.promise);
      const exchange = vi.spyOn(bridge, "bootstrapSshBearerSession");
      vi.stubGlobal("window", { desktopBridge: bridge });
      const ssh = yield* ClientCapabilities.SshEnvironmentGateway.pipe(Effect.provide(layer));
      const interrupted = yield* Effect.forkChild(ssh.provision(TARGET), {
        startImmediately: true,
      });
      yield* ssh.disconnect(TARGET);
      yield* Fiber.interrupt(interrupted);

      const retry = yield* Effect.forkChild(ssh.provision(TARGET), { startImmediately: true });
      setup.resolve(SSH_BOOTSTRAP);
      const provisioned = yield* Fiber.join(retry);

      expect(provisioned.bearerToken).toBe("bearer-token");
      expect(ensure).toHaveBeenCalledTimes(2);
      expect(calls).toEqual(["disconnect", "ensure", "descriptor", "token"]);
      expect(exchange).toHaveBeenCalledExactlyOnceWith(SSH_BOOTSTRAP.httpBaseUrl, "pairing-token");
    }),
  );

  it.effect("reconnects with the saved token while it holds every standard scope", () =>
    Effect.gen(function* () {
      const calls: string[] = [];

      const bridge = makeBridge(calls);
      const ensure = vi.spyOn(bridge, "ensureSshEnvironment");
      const prepared = yield* prepareDesktopSshEnvironment(bridge, {
        target: TARGET,
        expectedEnvironmentId: EnvironmentId.make("environment-ssh"),
        bearerToken: "saved-token",
      });

      expect(prepared.bearerToken).toBe("saved-token");
      expect(ensure).toHaveBeenCalledExactlyOnceWith(TARGET, { issuePairingToken: false });
      expect(calls).toEqual(["ensure", "descriptor", "session"]);
    }),
  );

  it.effect("pairs again when the host no longer accepts the saved token", () =>
    Effect.gen(function* () {
      const calls: string[] = [];

      const prepared = yield* prepareDesktopSshEnvironment(
        makeBridge(calls, { savedTokenRejected: true }),
        {
          target: TARGET,
          expectedEnvironmentId: EnvironmentId.make("environment-ssh"),
          bearerToken: "saved-token",
        },
      );

      expect(prepared.bearerToken).toBe("bearer-token");
      expect(calls).toEqual(["ensure", "descriptor", "session", "ensure", "descriptor", "token"]);
    }),
  );

  it.effect("pairs again when the saved token predates a standard scope", () =>
    Effect.gen(function* () {
      const calls: string[] = [];

      const prepared = yield* prepareDesktopSshEnvironment(
        makeBridge(calls, {
          savedTokenPermissions: ["orchestration:read", "orchestration:operate"],
        }),
        {
          target: TARGET,
          expectedEnvironmentId: EnvironmentId.make("environment-ssh"),
          bearerToken: "saved-token",
        },
      );

      expect(prepared.bearerToken).toBe("bearer-token");
      expect(calls).toEqual(["ensure", "descriptor", "session", "ensure", "descriptor", "token"]);
    }),
  );

  it.effect("stops before sending the saved token or pairing on a different machine", () =>
    Effect.gen(function* () {
      const calls: string[] = [];

      const error = yield* prepareDesktopSshEnvironment(makeBridge(calls), {
        target: TARGET,
        expectedEnvironmentId: EnvironmentId.make("some-other-machine"),
        bearerToken: "saved-token",
      }).pipe(Effect.flip);

      expect(error).toMatchObject({ reason: "configuration" });
      expect(calls).toEqual(["ensure", "descriptor"]);
    }),
  );
});

describe("desktop-local bearer cache", () => {
  const registration = {} as never;

  it("refreshes a secondary bearer before it expires", () => {
    const issuedAtEpochMs = 10_000;
    const refreshAtEpochMs = secondaryBearerRefreshAtEpochMs(issuedAtEpochMs, 60);
    const expiresAtEpochMs = secondaryBearerExpiresAtEpochMs(issuedAtEpochMs, 60);
    const cached = {
      expiresAtEpochMs,
      signature: "secondary-signature",
      registration,
      refreshAtEpochMs,
    };

    expect(refreshAtEpochMs).toBe(65_000);
    expect(canReuseCachedPlatformRegistration(cached, cached.signature, 64_999)).toBe(true);
    expect(canReuseCachedPlatformRegistration(cached, cached.signature, 65_000)).toBe(false);
    expect(
      canRetainCachedPlatformRegistrationAfterRefreshFailure(cached, cached.signature, 69_999),
    ).toBe(true);
    expect(
      canRetainCachedPlatformRegistrationAfterRefreshFailure(cached, cached.signature, 70_000),
    ).toBe(false);
  });

  it("does not cache credentials whose lifetime is shorter than the refresh skew", () => {
    const refreshAtEpochMs = secondaryBearerRefreshAtEpochMs(10_000, 3);
    const cached = {
      expiresAtEpochMs: secondaryBearerExpiresAtEpochMs(10_000, 3),
      signature: "secondary-signature",
      registration,
      refreshAtEpochMs,
    };

    expect(refreshAtEpochMs).toBe(10_000);
    expect(canReuseCachedPlatformRegistration(cached, cached.signature, 10_000)).toBe(false);
  });

  it("retains only unexpired secondaries after a topology read failure", () => {
    const valid = {
      expiresAtEpochMs: 20_000,
      signature: "valid-secondary",
      registration,
      refreshAtEpochMs: 15_000,
    };
    const previous = new Map([
      ["valid-secondary", valid],
      [
        "expired-secondary",
        {
          expiresAtEpochMs: 10_000,
          signature: "expired-secondary",
          registration,
          refreshAtEpochMs: 5_000,
        },
      ],
    ]);

    expect(
      secondaryRegistrationsToRetainAfterTopologyRead(
        previous,
        { _tag: "Failure", cause: new Error("IPC unavailable") },
        10_000,
      ),
    ).toEqual(new Map([["valid-secondary", valid]]));
  });

  it("treats a successful empty topology as authoritative removal", () => {
    const previous = new Map([
      [
        "secondary",
        {
          expiresAtEpochMs: 20_000,
          signature: "secondary",
          registration,
          refreshAtEpochMs: 15_000,
        },
      ],
    ]);

    expect(
      secondaryRegistrationsToRetainAfterTopologyRead(
        previous,
        { _tag: "Success", bootstraps: [] },
        10_000,
      ),
    ).toEqual(new Map());
  });
});

describe("rejected desktop-local bootstrap tokens", () => {
  it("backs off on a rejected signature and retries it on a growing, capped delay", () => {
    const signature = "http://a|ws://a|old-token";
    const first = nextRejectedSecondaryBootstrap(undefined, signature, 0);

    expect(isRejectedSecondaryBootstrap(first, signature, 59_999)).toBe(true);
    expect(isRejectedSecondaryBootstrap(first, signature, 60_000)).toBe(false);

    const second = nextRejectedSecondaryBootstrap(first, signature, 60_000);
    expect(second.retryAtEpochMs).toBe(180_000);

    let backoff = second;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      backoff = nextRejectedSecondaryBootstrap(backoff, signature, 0);
    }
    expect(backoff.delayMs).toBe(30 * 60_000);
  });

  it("retries at once when the token or endpoint changes", () => {
    const rejected = nextRejectedSecondaryBootstrap(undefined, "http://a|ws://a|old-token", 0);

    expect(isRejectedSecondaryBootstrap(rejected, "http://a|ws://a|new-token", 1)).toBe(false);
    expect(isRejectedSecondaryBootstrap(rejected, "http://b|ws://b|old-token", 1)).toBe(false);
    expect(isRejectedSecondaryBootstrap(undefined, "http://a|ws://a|old-token", 1)).toBe(false);
    expect(nextRejectedSecondaryBootstrap(rejected, "http://a|ws://a|new-token", 1).delayMs).toBe(
      60_000,
    );
  });

  it("treats only authentication rejections as a dead credential", () => {
    expect(
      isRejectedBootstrapCredentialError(
        new ConnectionBlockedError({ reason: "authentication", detail: "invalid" }),
      ),
    ).toBe(true);
    expect(
      isRejectedBootstrapCredentialError(
        new ConnectionTransientError({ reason: "endpoint-unavailable", detail: "booting" }),
      ),
    ).toBe(false);
  });
});

describe("desktop-local bearer cache across token changes", () => {
  it("keeps a live bearer when only the bootstrap token rotates", () => {
    const cached = {
      signature: "http://a|ws://a",
      registration: {} as never,
      expiresAtEpochMs: 20_000,
      refreshAtEpochMs: 15_000,
    };

    expect(canReuseCachedPlatformRegistration(cached, "http://a|ws://a", 10_000)).toBe(true);
    expect(
      canRetainCachedPlatformRegistrationAfterRefreshFailure(cached, "http://a|ws://a", 16_000),
    ).toBe(true);
    expect(canReuseCachedPlatformRegistration(cached, "http://b|ws://b", 10_000)).toBe(false);
  });
});

describe("primary topology cache", () => {
  const registration = {} as never;
  const cached = {
    signature: "primary|http://127.0.0.1:3773/|ws://127.0.0.1:3773/",
    registration,
  };
  const previous = new Map([[PRIMARY_LOCAL_ENVIRONMENT_ID, cached]]);

  it("captures synchronous primary target read failures", () => {
    const cause = new Error("invalid primary target");

    expect(
      readPrimaryEnvironmentTargetResult(() => {
        throw cause;
      }),
    ).toEqual({ _tag: "Failure", cause });
  });

  it("retains the cached primary after a transient topology read failure", () => {
    expect(
      primaryRegistrationToRetainAfterTopologyRead(previous, {
        _tag: "Failure",
        cause: new Error("IPC unavailable"),
      }),
    ).toBe(cached);
  });

  it("treats a successful primary absence as authoritative removal", () => {
    expect(
      primaryRegistrationToRetainAfterTopologyRead(previous, {
        _tag: "Success",
        target: null,
      }),
    ).toBeUndefined();
  });
});

describe("floating chat connections", () => {
  it("registers only the primary local environment", () => {
    expect(includeSecondaryPlatformRegistrations(true)).toBe(false);
    expect(includeSecondaryPlatformRegistrations(false)).toBe(true);
  });

  it.effect("does not open an SSH tunnel", () =>
    Effect.gen(function* () {
      const ensureSshEnvironment = vi.fn();
      const disconnectSshEnvironment = vi.fn();
      vi.stubGlobal("window", {
        desktopBridge: { ensureSshEnvironment, disconnectSshEnvironment },
      });
      const gateway = makeDesktopSshGateway(true);

      const provisionError = yield* gateway.provision(TARGET).pipe(Effect.flip);
      const prepareError = yield* gateway
        .prepare({
          connectionId: "ssh-1",
          expectedEnvironmentId: EnvironmentId.make("env-ssh"),
          target: TARGET,
          bearerToken: "saved-token",
        })
        .pipe(Effect.flip);
      yield* gateway.disconnect(TARGET);

      expect(provisionError._tag).toBe("ConnectionBlockedError");
      expect(prepareError._tag).toBe("ConnectionBlockedError");
      expect(ensureSshEnvironment).not.toHaveBeenCalled();
      expect(disconnectSshEnvironment).not.toHaveBeenCalled();
    }),
  );

  it.effect("does not acquire saved remote, relay, or SSH connections", () =>
    Effect.gen(function* () {
      const writes: string[] = [];
      const relay = new RelayConnectionTarget({
        environmentId: EnvironmentId.make("env-relay"),
        label: "Relay",
      });
      const ssh = new SshConnectionTarget({
        environmentId: EnvironmentId.make("env-ssh"),
        label: "SSH",
        connectionId: "ssh-1",
      });
      const savedUrl = new BearerConnectionTarget({
        environmentId: EnvironmentId.make("env-url"),
        label: "URL",
        connectionId: "url-1",
      });
      const saved = [relay, ssh, savedUrl];
      const isolated = isolateDetachedConnectionCatalog({
        targets: {
          list: Effect.succeed(saved),
          listDisabled: Effect.succeed([relay.environmentId]),
        },
        registrations: {
          register: () =>
            Effect.sync(() => {
              writes.push("register");
            }),
          setRoutes: () =>
            Effect.sync(() => {
              writes.push("routes");
            }),
          remove: () =>
            Effect.sync(() => {
              writes.push("remove");
            }),
          setEnabled: () =>
            Effect.sync(() => {
              writes.push("enabled");
            }),
        },
      });

      expect(yield* isolated.targets.list).toEqual([]);
      expect(yield* isolated.targets.listDisabled).toEqual([]);
      expect(persistedTargetsForDetachedCatalog(false, saved)).toBe(saved);

      const registration = new RelayConnectionRegistration({ target: relay });
      const refused = [
        yield* isolated.registrations.register(registration, [relay]).pipe(Effect.flip),
        yield* isolated.registrations.setRoutes(relay.environmentId, [relay]).pipe(Effect.flip),
        yield* isolated.registrations.remove(relay.environmentId).pipe(Effect.flip),
        yield* isolated.registrations.setEnabled(relay.environmentId, false).pipe(Effect.flip),
      ];
      expect(refused.map((error) => error.operation)).toEqual([
        "register-connection",
        "set-connection-routes",
        "remove-connection",
        "set-connection-enabled",
      ]);
      expect(writes).toEqual([]);
    }),
  );
});
