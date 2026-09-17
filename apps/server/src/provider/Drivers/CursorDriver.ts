/**
 * CursorDriver — `ProviderDriver` for the Cursor Agent (`cursor-agent`) runtime.
 *
 * Cursor exposes an ACP-based CLI. Model catalog and capability refreshes
 * happen during the managed provider status check via Cursor's
 * `list_available_models` extension method.
 *
 * Text generation is supported via the ACP runtime — `makeCursorTextGeneration`
 * drives `runtime.prompt` with a structured-output schema and collects the
 * agent's `agent_message_chunk` stream into a single JSON blob.
 *
 * @module provider/Drivers/CursorDriver
 */
import { CursorSettings, ProviderDriverKind, type ServerProvider } from "@t3tools/contracts";
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
import { makeCursorTextGeneration } from "../../textGeneration/CursorTextGeneration.ts";
import { ProviderDriverError } from "../Errors.ts";
import { makeCursorAdapter } from "../Layers/CursorAdapter.ts";
import { readCursorUsageLimits } from "../Layers/cursorUsageLimits.ts";
import {
  buildInitialCursorProviderSnapshot,
  checkCursorProviderStatus,
  makeCursorModelDiscovery,
  enrichCursorSnapshot,
  makeCursorCommandCatalog,
} from "../Layers/CursorProvider.ts";
import { ProviderEventLoggers } from "../Layers/ProviderEventLoggers.ts";
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
import {
  makeCachedProviderMaintenanceResolution,
  makeManualOnlyProviderMaintenanceCapabilities,
  makeProviderMaintenanceCapabilities,
  type ProviderMaintenanceCapabilitiesResolver,
  resolveProviderMaintenanceCapabilitiesEffect,
} from "../providerMaintenance.ts";
import {
  haveProviderSnapshotSettingsChanged,
  makeProviderSnapshotSettingsSource,
  type ProviderSnapshotSettings,
} from "../providerUpdateSettings.ts";
import { discoverCursorSkills, probeCursorSkills } from "./CursorSkills.ts";
const decodeCursorSettings = Schema.decodeSync(CursorSettings);

const DRIVER_KIND = ProviderDriverKind.make("cursor");
// cursor-agent updates itself, so the resolved executable is its own updater.
// No executable means nothing to update, not "whatever is on PATH".
const UPDATE: ProviderMaintenanceCapabilitiesResolver = {
  resolve: (context) =>
    Effect.succeed(
      context
        ? makeProviderMaintenanceCapabilities({
            provider: DRIVER_KIND,
            packageName: null,
            updateExecutable: context.resolvedCommandPath,
            updateArgs: ["update"],
            updateLockKey: "cursor-agent",
            platform: context.platform,
          })
        : makeManualOnlyProviderMaintenanceCapabilities({
            provider: DRIVER_KIND,
            packageName: null,
          }),
    ),
};

export type CursorDriverEnv =
  | BackgroundPolicy.BackgroundPolicy
  | ChildProcessSpawner.ChildProcessSpawner
  | Crypto.Crypto
  | FileSystem.FileSystem
  | HttpClient.HttpClient
  | Path.Path
  | ProviderEventLoggers
  | ServerConfig
  | ServerSettingsService;

export const CursorDriver: ProviderDriver<CursorSettings, CursorDriverEnv> = {
  driverKind: DRIVER_KIND,
  metadata: {
    displayName: "Cursor",
    supportsMultipleInstances: true,
  },
  configSchema: CursorSettings,
  defaultConfig: (): CursorSettings => decodeCursorSettings({}),
  create: ({ instanceId, displayName, accentColor, environment, enabled, config }) =>
    Effect.gen(function* () {
      const crypto = yield* Crypto.Crypto;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const httpClient = yield* HttpClient.HttpClient;
      const serverSettings = yield* ServerSettingsService;
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
      const effectiveConfig = { ...config, enabled } satisfies CursorSettings;
      const resolveMaintenance = yield* makeCachedProviderMaintenanceResolution(
        resolveProviderMaintenanceCapabilitiesEffect(UPDATE, {
          binaryPath: effectiveConfig.binaryPath,
          env: processEnv,
        }).pipe(
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
          Effect.provideService(FileSystem.FileSystem, fileSystem),
          Effect.provideService(Path.Path, path),
        ),
      );

      const textGeneration = yield* makeCursorTextGeneration(effectiveConfig, processEnv);

      const discoverModels = yield* makeCursorModelDiscovery(effectiveConfig, processEnv);

      const apiKeyCredential = providerEnvVarCredential({
        serverSettings,
        instanceId,
        driverKind: DRIVER_KIND,
        envName: "CURSOR_API_KEY",
      });
      const authMethods: ReadonlyArray<CliAuthMethodSpec> = [
        {
          kind: "cli",
          id: "browser",
          label: "Sign in with browser",
          description:
            "Runs `cursor-agent login` and shows a Cursor sign-in URL to open in your browser.",
          args: ["login"],
          env: { NO_OPEN_BROWSER: "1" },
          urlPattern: /https:\/\/cursor\.com\/\S+/,
          waitingMessage: "Open the Cursor sign-in URL in your browser to finish signing in.",
        },
        {
          kind: "saved-credentials",
          id: "saved",
          label: "Use saved Cursor login",
          description: "Reuses the credentials `cursor-agent login` stored on this environment.",
          missingMessage:
            "No Cursor login found on this environment. Sign in with a browser or paste an API key.",
        },
        {
          kind: "paste-credential",
          id: "api-key",
          label: "Paste an API key",
          description: "Stored as a sensitive CURSOR_API_KEY variable on this instance.",
          credentialLabel: "Cursor API key",
          credentialPlaceholder: "key_…",
          probeAfterApply: false,
          appliedMessage: "Cursor API key saved.",
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

      const checkProvider = checkCursorProviderStatus(
        effectiveConfig,
        processEnv,
        discoverModels,
      ).pipe(
        Effect.flatMap((snapshot) =>
          effectiveConfig.enabled && snapshot.installed && snapshot.auth.status === "authenticated"
            ? readCursorUsageLimits(effectiveConfig, processEnv).pipe(
                Effect.map((usageLimits) => ({ ...snapshot, usageLimits })),
              )
            : Effect.succeed(snapshot),
        ),
        Effect.map(stampSetup),
        Effect.map(stampIdentity),
        Effect.flatMap(authMethodPersistence.stamp),
        Effect.provideService(HttpClient.HttpClient, httpClient),
        Effect.provideService(Crypto.Crypto, crypto),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, path),
      );

      const snapshotSettings = makeProviderSnapshotSettingsSource(effectiveConfig, serverSettings);
      const managedSnapshot = yield* makeManagedServerProvider<
        ProviderSnapshotSettings<CursorSettings>
      >({
        resolveMaintenance,
        getSettings: snapshotSettings.getSettings,
        streamSettings: snapshotSettings.streamSettings,
        haveSettingsChanged: haveProviderSnapshotSettingsChanged,
        initialSnapshot: (settings) =>
          buildInitialCursorProviderSnapshot(settings.provider).pipe(
            Effect.map(stampSetup),
            Effect.map(stampIdentity),
          ),
        checkProvider,
        // Model catalog and capabilities come exclusively from Cursor's
        // list_available_models extension method during provider checks.
        enrichSnapshot: ({ settings, snapshot: currentSnapshot, publishSnapshot }) =>
          resolveMaintenance().pipe(
            Effect.flatMap((maintenanceCapabilities) =>
              enrichCursorSnapshot({
                settings: settings.provider,
                snapshot: currentSnapshot,
                maintenanceCapabilities,
                enableProviderUpdateChecks: settings.enableProviderUpdateChecks,
                publishSnapshot,
                stampIdentity,
                httpClient,
              }),
            ),
            Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
          ),
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: DRIVER_KIND,
              instanceId,
              detail: `Failed to build Cursor snapshot: ${cause.message ?? String(cause)}`,
              cause,
            }),
        ),
      );

      const { snapshot, onAvailableCommands, snapshotForCwd } =
        yield* makeCursorCommandCatalog(managedSnapshot);
      const adapter = yield* makeCursorAdapter(effectiveConfig, {
        environment: processEnv,
        ...(eventLoggers.native ? { nativeEventLogger: eventLoggers.native } : {}),
        instanceId,
        onAvailableCommands: (commands, cwd) =>
          discoverCursorSkills(cwd, processEnv).pipe(
            Effect.provideService(FileSystem.FileSystem, fileSystem),
            Effect.provideService(Path.Path, path),
            Effect.flatMap((skills) => onAvailableCommands(commands, cwd, skills)),
          ),
      });

      return {
        instanceId,
        driverKind: DRIVER_KIND,
        continuationIdentity,
        displayName,
        accentColor,
        enabled,
        snapshot,
        snapshotForCwd: (cwd) =>
          !effectiveConfig.enabled
            ? snapshot.getSnapshot
            : probeCursorSkills(cwd, processEnv).pipe(
                Effect.provideService(FileSystem.FileSystem, fileSystem),
                Effect.provideService(Path.Path, path),
                Effect.mapError(
                  (cause) =>
                    new ProviderDriverError({
                      driver: DRIVER_KIND,
                      instanceId,
                      detail: `Failed to discover Cursor skills for '${cwd}'`,
                      cause,
                    }),
                ),
                Effect.flatMap((skills) => snapshotForCwd(cwd, skills)),
              ),
        adapter,
        textGeneration,
        auth: yield* makeCliProviderAuth({
          instanceId,
          providerLabel: "Cursor",
          command: effectiveConfig.binaryPath || "cursor-agent",
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
