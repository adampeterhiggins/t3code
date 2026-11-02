import { ClientCapabilities, Persistence } from "@t3tools/client-runtime/platform";
import { ConnectionBlockedError } from "@t3tools/client-runtime/connection";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { type DesktopSecondaryBootstrapsRead } from "./desktopLocal";
import * as ConnectionStorage from "./storage";

/**
 * The floating chat only connects to this computer's primary environment. It runs its own
 * renderer over the desktop's shared connection catalog, so anything it registered or removed
 * there would change the main window's connections too.
 */
const DETACHED_CATALOG_MESSAGE = "The floating chat only connects to this computer.";

function detachedSshBlocked() {
  return new ConnectionBlockedError({
    reason: "unsupported",
    detail: "SSH environments are not available in the floating chat.",
  });
}

/** SSH setup would open a tunnel and then persist that machine into the shared catalog. */
export const detachedSshGateway = ClientCapabilities.SshEnvironmentGateway.of({
  provision: Effect.fn("web.connectionPlatform.ssh.provision")(function* () {
    return yield* detachedSshBlocked();
  }),
  prepare: Effect.fn("web.connectionPlatform.ssh.prepare")(function* () {
    return yield* detachedSshBlocked();
  }),
  disconnect: Effect.fn("web.connectionPlatform.ssh.disconnect")(function* () {}),
});

/** WSL and other desktop-local backends are separate machines; the primary is collected apart. */
export function secondaryBootstrapsForWindow(
  detached: boolean,
  read: () => DesktopSecondaryBootstrapsRead,
): DesktopSecondaryBootstrapsRead {
  return detached ? { _tag: "Success", bootstraps: [] } : read();
}

type ConnectionTargetStoreService = Persistence.ConnectionTargetStore["Service"];
type ConnectionRegistrationStoreService = Persistence.ConnectionRegistrationStore["Service"];

function detachedCatalogWriteError(
  operation: Persistence.ConnectionPersistenceError["operation"],
): Persistence.ConnectionPersistenceError {
  return new Persistence.ConnectionPersistenceError({
    operation,
    message: DETACHED_CATALOG_MESSAGE,
  });
}

/**
 * The registry acquires environments from these stores at startup. Filtering here, and refusing
 * later writes, keeps the shared desktop document intact: a filtered copy written back would
 * delete the main window's remotes.
 */
export function isolateDetachedConnectionCatalog(stores: {
  readonly targets: ConnectionTargetStoreService;
  readonly registrations: ConnectionRegistrationStoreService;
}): {
  readonly targets: ConnectionTargetStoreService;
  readonly registrations: ConnectionRegistrationStoreService;
} {
  return {
    targets: {
      list: stores.targets.list.pipe(Effect.as([])),
      listDisabled: stores.targets.listDisabled.pipe(Effect.as([])),
    },
    registrations: {
      register: () => Effect.fail(detachedCatalogWriteError("register-connection")),
      setRoutes: () => Effect.fail(detachedCatalogWriteError("set-connection-routes")),
      remove: () => Effect.fail(detachedCatalogWriteError("remove-connection")),
      setEnabled: () => Effect.fail(detachedCatalogWriteError("set-connection-enabled")),
    },
  };
}

/** The connection storage layer, with an isolated catalog in the floating window. */
export function connectionStorageForWindow(detached: boolean): typeof ConnectionStorage.layer {
  if (!detached) return ConnectionStorage.layer;
  return Layer.effectContext(
    Effect.gen(function* () {
      const context = yield* Layer.build(ConnectionStorage.layer);
      const isolated = isolateDetachedConnectionCatalog({
        targets: Context.get(context, Persistence.ConnectionTargetStore),
        registrations: Context.get(context, Persistence.ConnectionRegistrationStore),
      });
      return context.pipe(
        Context.add(
          Persistence.ConnectionTargetStore,
          Persistence.ConnectionTargetStore.of(isolated.targets),
        ),
        Context.add(
          Persistence.ConnectionRegistrationStore,
          Persistence.ConnectionRegistrationStore.of(isolated.registrations),
        ),
      );
    }),
  );
}
