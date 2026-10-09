/**
 * CustomAcpDriver — any stdio ACP agent the user configures in Settings.
 *
 * Each added instance is one agent: its executable, arguments, and the
 * instance's environment variables. There is no default instance. Sign-in,
 * updates, and text generation belong to the agent's own tooling, so this
 * driver offers none of them.
 *
 * @module CustomAcpDriver
 */
import { CustomAcpSettings, type ServerProvider, TextGenerationError } from "@t3tools/contracts";
import { resolveSelfInvocation } from "@t3tools/shared/nodeRuntime";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/process";

import { makeCustomAcpAdapterV2 } from "../../orchestration-v2/Adapters/CustomAcpAdapterV2.ts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import { ProviderHost } from "@t3tools/provider-core/server/ProviderHost";
import type { TextGeneration } from "../../textGeneration/TextGeneration.ts";
import { makeAcpCommandCatalog } from "../acp/AcpCommandCatalog.ts";
import { makeAcpNativeLoggerFactory } from "@t3tools/provider-acp/server/nativeLogging";
import { CUSTOM_ACP_DRIVER_KIND } from "../acp/CustomAcpSupport.ts";
import { ProviderDriverError } from "../Errors.ts";
import {
  buildInitialCustomAcpProviderSnapshot,
  checkCustomAcpProviderStatus,
} from "../CustomAcpProvider.ts";
import { ProviderEventLoggers } from "../ProviderEventLoggers.ts";
import { makeManagedServerProvider } from "@t3tools/provider-core/server/managedProvider";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "@t3tools/provider-core/server/driver";
import { mergeProviderInstanceEnvironment } from "@t3tools/provider-core/server/instanceEnvironment";
import { makeManualOnlyProviderMaintenanceCapabilities } from "@t3tools/provider-core/server/maintenanceResolver";
import { withInstanceIdentity } from "@t3tools/provider-core/server/instanceIdentity";

const decodeCustomAcpSettings = Schema.decodeSync(CustomAcpSettings);
const MAINTENANCE = makeManualOnlyProviderMaintenanceCapabilities({
  provider: CUSTOM_ACP_DRIVER_KIND,
  packageName: null,
});

const unsupportedTextGeneration: TextGeneration["Service"] = (() => {
  const fail = (operation: string) =>
    Effect.fail(
      new TextGenerationError({
        operation,
        detail: "Custom ACP agents do not generate commit messages, titles, or names.",
      }),
    );
  return {
    generateCommitMessage: () => fail("generateCommitMessage"),
    generatePrContent: () => fail("generatePrContent"),
    generateBranchName: () => fail("generateBranchName"),
    generateThreadTitle: () => fail("generateThreadTitle"),
    generateIgnoredNames: () => fail("generateIgnoredNames"),
  };
})();

export type CustomAcpDriverEnv =
  | ChildProcessSpawner.ChildProcessSpawner
  | Crypto.Crypto
  | FileSystem.FileSystem
  | IdAllocator.IdAllocatorV2
  | Path.Path
  | ProviderEventLoggers
  | ProviderHost;

export const CustomAcpDriver: ProviderDriver<CustomAcpSettings, CustomAcpDriverEnv> = {
  driverKind: CUSTOM_ACP_DRIVER_KIND,
  metadata: {
    displayName: "Custom ACP",
    supportsMultipleInstances: true,
    // Each added instance is one agent; there is nothing to run unconfigured.
    hasDefaultInstance: false,
  },
  configSchema: CustomAcpSettings,
  defaultConfig: (): CustomAcpSettings => decodeCustomAcpSettings({}),
  create: ({ instanceId, displayName, accentColor, environment, enabled, config }) =>
    Effect.gen(function* () {
      const crypto = yield* Crypto.Crypto;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const { cwd } = (yield* ProviderHost).paths;
      const selfInvocation = yield* resolveSelfInvocation();
      const eventLoggers = yield* ProviderEventLoggers;
      const makeNativeLogger = yield* makeAcpNativeLoggerFactory();
      const processEnv = mergeProviderInstanceEnvironment(environment);
      const effectiveConfig = { ...config, enabled } satisfies CustomAcpSettings;
      const continuationIdentity = defaultProviderContinuationIdentity({
        driverKind: CUSTOM_ACP_DRIVER_KIND,
        instanceId,
      });
      const stampIdentity = withInstanceIdentity({
        instanceId,
        driverKind: CUSTOM_ACP_DRIVER_KIND,
        displayName,
        accentColor,
        continuationGroupKey: continuationIdentity.continuationKey,
      });
      // Sign-in and text generation belong to the agent's own tooling.
      const withAgentOwnedSetup = (snapshot: ServerProvider): ServerProvider => ({
        ...snapshot,
        supportsTextGeneration: false,
        setup: { canAuthenticate: false, canInstall: false },
      });

      // Settings are fixed for the instance's lifetime: the registry rebuilds
      // the instance when its config changes.
      const managedSnapshot = yield* makeManagedServerProvider<CustomAcpSettings>({
        resolveMaintenance: () => Effect.succeed(MAINTENANCE),
        getSettings: Effect.succeed(effectiveConfig),
        streamSettings: Stream.never,
        haveSettingsChanged: () => false,
        initialSnapshot: (settings) =>
          buildInitialCustomAcpProviderSnapshot(settings).pipe(
            Effect.map(stampIdentity),
            Effect.map(withAgentOwnedSetup),
          ),
        checkProvider: checkCustomAcpProviderStatus(effectiveConfig, processEnv, cwd).pipe(
          Effect.map(stampIdentity),
          Effect.map(withAgentOwnedSetup),
          Effect.provideService(Crypto.Crypto, crypto),
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        ),
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: CUSTOM_ACP_DRIVER_KIND,
              instanceId,
              detail: `Failed to build Custom ACP snapshot: ${cause.message ?? String(cause)}`,
              cause,
            }),
        ),
      );
      // Slash commands arrive per workspace once a session is running.
      const { snapshot, onAvailableCommands, snapshotForCwd } =
        yield* makeAcpCommandCatalog(managedSnapshot);

      const orchestrationAdapter = yield* makeCustomAcpAdapterV2({
        instanceId,
        settings: effectiveConfig,
        harness: displayName ?? "Custom ACP agent",
        environment: processEnv,
        childProcessSpawner: spawner,
        selfInvocation,
        onAvailableCommands: (commands, workspaceCwd) =>
          onAvailableCommands(commands, workspaceCwd, []),
        nativeLogging: (threadId) =>
          makeNativeLogger({
            nativeEventLogger: eventLoggers.native,
            provider: CUSTOM_ACP_DRIVER_KIND,
            threadId,
          }),
      });

      return {
        instanceId,
        driverKind: CUSTOM_ACP_DRIVER_KIND,
        continuationIdentity,
        displayName,
        accentColor,
        enabled,
        snapshot,
        snapshotForCwd: (workspaceCwd) => snapshotForCwd(workspaceCwd, []),
        orchestrationAdapter,
        textGeneration: unsupportedTextGeneration,
      } satisfies ProviderInstance;
    }),
};
