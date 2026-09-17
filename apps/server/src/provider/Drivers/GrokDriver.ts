import { GrokSettings, ProviderDriverKind, type ServerProvider } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { HttpClient } from "effect/unstable/http";
import { ChildProcessSpawner } from "effect/unstable/process";

import * as BackgroundPolicy from "../../background/BackgroundPolicy.ts";
import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { makeGrokTextGeneration } from "../../textGeneration/GrokTextGeneration.ts";
import { ProviderDriverError } from "../Errors.ts";
import { makeGrokAdapter } from "../Layers/GrokAdapter.ts";
import {
  buildInitialGrokProviderSnapshot,
  checkGrokProviderStatus,
  enrichGrokSnapshot,
} from "../Layers/GrokProvider.ts";
import { ProviderEventLoggers } from "../Layers/ProviderEventLoggers.ts";
import { readGrokUsageLimits } from "../Layers/grokUsageLimits.ts";
import { makeManagedServerProvider } from "../makeManagedServerProvider.ts";
import {
  authMethodDescriptors,
  type CliAuthMethodSpec,
  makeCliProviderAuth,
  providerAuthMethodPersistence,
  providerEnvVarCredential,
} from "../CliProviderAuth.ts";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "../ProviderDriver.ts";
import { withInstanceIdentity } from "./instanceIdentity.ts";
import { mergeProviderInstanceEnvironment } from "../ProviderInstanceEnvironment.ts";
import { discoverGrokSkills } from "./GrokSkills.ts";
import { makeManualOnlyProviderMaintenanceCapabilities } from "../providerMaintenance.ts";
import {
  haveProviderSnapshotSettingsChanged,
  makeProviderSnapshotSettingsSource,
  type ProviderSnapshotSettings,
} from "../providerUpdateSettings.ts";
const decodeGrokSettings = Schema.decodeSync(GrokSettings);

const DRIVER_KIND = ProviderDriverKind.make("grok");
const MAINTENANCE_CAPABILITIES = makeManualOnlyProviderMaintenanceCapabilities({
  provider: DRIVER_KIND,
  packageName: null,
});

export type GrokDriverEnv =
  | BackgroundPolicy.BackgroundPolicy
  | ChildProcessSpawner.ChildProcessSpawner
  | Crypto.Crypto
  | FileSystem.FileSystem
  | HttpClient.HttpClient
  | Path.Path
  | ProviderEventLoggers
  | ServerConfig
  | ServerSettingsService;

export const GrokDriver: ProviderDriver<GrokSettings, GrokDriverEnv> = {
  driverKind: DRIVER_KIND,
  metadata: {
    displayName: "Grok",
    supportsMultipleInstances: true,
  },
  configSchema: GrokSettings,
  defaultConfig: (): GrokSettings => decodeGrokSettings({}),
  create: ({ instanceId, displayName, accentColor, environment, enabled, config }) =>
    Effect.gen(function* () {
      const crypto = yield* Crypto.Crypto;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const httpClient = yield* HttpClient.HttpClient;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const serverSettings = yield* ServerSettingsService;
      const { cwd } = yield* ServerConfig;
      const eventLoggers = yield* ProviderEventLoggers;
      const processEnv = mergeProviderInstanceEnvironment(environment);
      const continuationIdentity = defaultProviderContinuationIdentity({
        driverKind: DRIVER_KIND,
        instanceId,
      });
      const stampIdentity = withInstanceIdentity({
        instanceId,
        driverKind: DRIVER_KIND,
        displayName,
        accentColor,
        continuationGroupKey: continuationIdentity.continuationKey,
      });
      const effectiveConfig = { ...config, enabled } satisfies GrokSettings;
      const adapter = yield* makeGrokAdapter(effectiveConfig, {
        environment: processEnv,
        ...(eventLoggers.native ? { nativeEventLogger: eventLoggers.native } : {}),
        instanceId,
      });
      const textGeneration = yield* makeGrokTextGeneration(effectiveConfig, processEnv);

      const apiKeyCredential = providerEnvVarCredential({
        serverSettings,
        instanceId,
        driverKind: DRIVER_KIND,
        envName: "XAI_API_KEY",
      });
      const authMethods: ReadonlyArray<CliAuthMethodSpec> = [
        {
          kind: "cli",
          id: "oauth",
          label: "Sign in with browser",
          description:
            "Runs `grok login --oauth` and shows a Grok sign-in URL to open in your browser.",
          args: ["login", "--oauth"],
          env: { NO_OPEN_BROWSER: "1" },
          urlPattern: /https:\/\/\S*\.?x\.ai\/\S+/,
          waitingMessage: "Open the Grok sign-in URL in your browser to finish signing in.",
        },
        {
          kind: "cli",
          id: "device",
          label: "Sign in with device code",
          description:
            "Runs `grok login --device-auth` — sign in at the shown URL with a one-time code. Works on remote and headless environments.",
          args: ["login", "--device-auth"],
          urlPattern: /https:\/\/\S*\.?x\.ai\/\S+/,
          codePattern: /code[^A-Z0-9]*([A-Z0-9]{4}-[A-Z0-9]{4})/i,
          waitingMessage: "Open the URL and enter the device code to finish signing in.",
        },
        {
          kind: "saved-credentials",
          id: "saved",
          label: "Use saved Grok login",
          description: "Reuses the credentials `grok login` stored on this environment.",
          missingMessage: "No Grok login found on this environment. Sign in or paste an API key.",
        },
        {
          kind: "paste-credential",
          id: "api-key",
          label: "Paste an API key",
          description: "Stored as a sensitive XAI_API_KEY variable on this instance.",
          credentialLabel: "xAI API key",
          credentialPlaceholder: "xai-…",
          probeAfterApply: false,
          appliedMessage: "xAI API key saved.",
          apply: apiKeyCredential.apply,
        },
      ];
      const providerSetup: ServerProvider["setup"] = {
        canAuthenticate: true,
        canInstall: false,
        authMethods: authMethodDescriptors(authMethods),
      };
      const authMethodPersistence = providerAuthMethodPersistence({
        serverSettings,
        instanceId,
        methods: authMethods,
      });
      const stampSetup = <T extends { setup?: ServerProvider["setup"] }>(draft: T) => ({
        ...draft,
        setup: providerSetup,
      });

      const checkProvider = checkGrokProviderStatus(effectiveConfig, processEnv, cwd).pipe(
        Effect.flatMap((snapshot) =>
          effectiveConfig.enabled && snapshot.installed && snapshot.auth.status === "authenticated"
            ? readGrokUsageLimits(processEnv).pipe(
                Effect.map((usageLimits) => ({ ...snapshot, usageLimits })),
              )
            : Effect.succeed(snapshot),
        ),
        Effect.map(stampSetup),
        Effect.map(stampIdentity),
        Effect.flatMap(authMethodPersistence.stamp),
        Effect.provideService(HttpClient.HttpClient, httpClient),
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, path),
        Effect.provideService(Crypto.Crypto, crypto),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      );

      const snapshotSettings = makeProviderSnapshotSettingsSource(effectiveConfig, serverSettings);
      const snapshot = yield* makeManagedServerProvider<ProviderSnapshotSettings<GrokSettings>>({
        resolveMaintenance: () => Effect.succeed(MAINTENANCE_CAPABILITIES),
        getSettings: snapshotSettings.getSettings,
        streamSettings: snapshotSettings.streamSettings,
        haveSettingsChanged: haveProviderSnapshotSettingsChanged,
        initialSnapshot: (settings) =>
          buildInitialGrokProviderSnapshot(settings.provider).pipe(
            Effect.map(stampSetup),
            Effect.map(stampIdentity),
          ),
        checkProvider,
        enrichSnapshot: ({ settings, snapshot: currentSnapshot, publishSnapshot }) =>
          enrichGrokSnapshot({
            snapshot: currentSnapshot,
            maintenanceCapabilities: MAINTENANCE_CAPABILITIES,
            enableProviderUpdateChecks: settings.enableProviderUpdateChecks,
            publishSnapshot,
            httpClient,
          }),
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: DRIVER_KIND,
              instanceId,
              detail: `Failed to build Grok snapshot: ${cause.message ?? String(cause)}`,
              cause,
            }),
        ),
      );
      const snapshotForCwd = (workspaceCwd: string) =>
        !effectiveConfig.enabled
          ? snapshot.getSnapshot
          : Effect.all([
              snapshot.getSnapshot,
              discoverGrokSkills(effectiveConfig, processEnv, workspaceCwd).pipe(
                Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
                Effect.mapError(
                  (cause) =>
                    new ProviderDriverError({
                      driver: DRIVER_KIND,
                      instanceId,
                      detail: `Failed to discover Grok skills for '${workspaceCwd}'`,
                      cause,
                    }),
                ),
              ),
            ]).pipe(Effect.map(([machineSnapshot, skills]) => ({ ...machineSnapshot, skills })));

      return {
        instanceId,
        driverKind: DRIVER_KIND,
        continuationIdentity,
        displayName,
        accentColor,
        enabled,
        snapshot,
        snapshotForCwd,
        adapter,
        textGeneration,
        auth: yield* makeCliProviderAuth({
          instanceId,
          providerLabel: "Grok",
          command: effectiveConfig.binaryPath || "grok",
          processEnv,
          methods: authMethods,
          probeAuth: snapshot.refresh.pipe(Effect.map((provider) => provider.auth)),
          recordAuthMethod: authMethodPersistence.record,
          logoutCommand: ["logout"],
          onLogout: apiKeyCredential.remove,
        }),
      } satisfies ProviderInstance;
    }),
};
