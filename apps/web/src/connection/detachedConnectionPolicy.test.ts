import { EnvironmentId, type DesktopSshEnvironmentTarget } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import {
  BearerConnectionTarget,
  RelayConnectionRegistration,
  RelayConnectionTarget,
  SshConnectionTarget,
} from "@t3tools/client-runtime/connection";

import {
  detachedSshGateway,
  isolateDetachedConnectionCatalog,
  secondaryBootstrapsForWindow,
} from "./detachedConnectionPolicy.ts";

const TARGET: DesktopSshEnvironmentTarget = {
  alias: "devbox",
  hostname: "devbox.example.test",
  username: "developer",
  port: 22,
};

describe("floating chat connections", () => {
  it("registers only the primary local environment", () => {
    const read = () => ({ _tag: "Failure" as const, cause: new Error("main window reads") });
    expect(secondaryBootstrapsForWindow(true, read)).toEqual({ _tag: "Success", bootstraps: [] });
    expect(secondaryBootstrapsForWindow(false, read)._tag).toBe("Failure");
  });

  it.effect("does not open an SSH tunnel", () =>
    Effect.gen(function* () {
      const provisionError = yield* detachedSshGateway.provision(TARGET).pipe(Effect.flip);
      const prepareError = yield* detachedSshGateway
        .prepare({
          connectionId: "ssh-1",
          expectedEnvironmentId: EnvironmentId.make("env-ssh"),
          target: TARGET,
          bearerToken: "saved-token",
        })
        .pipe(Effect.flip);
      yield* detachedSshGateway.disconnect(TARGET);

      expect(provisionError._tag).toBe("ConnectionBlockedError");
      expect(prepareError._tag).toBe("ConnectionBlockedError");
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
      const isolated = isolateDetachedConnectionCatalog({
        targets: {
          list: Effect.succeed([relay, ssh, savedUrl]),
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
