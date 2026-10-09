import { ProviderDriverKind, type ServerProvider } from "@t3tools/contracts";
import { GrokSettings } from "../settings.ts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { HttpClient } from "effect/http";
import { ChildProcessSpawner } from "effect/process";

import * as ProviderHost from "@t3tools/provider-core/server/ProviderHost";
import * as ProviderEventLoggers from "@t3tools/provider-core/server/ProviderEventLoggers";
import { makeGrokTextGeneration } from "./textGeneration.ts";
import { GrokAdapterV2Driver, type GrokAdapterV2DriverEnv } from "./adapter.ts";
import { ProviderDriverError } from "@t3tools/provider-core/server/errors";
import {
  buildInitialGrokProviderSnapshot,
  checkGrokProviderStatus,
  enrichGrokSnapshot,
} from "./status.ts";
import { readGrokAccount } from "./usageLimits.ts";
import { makeManagedServerProvider } from "@t3tools/provider-core/server/managedProvider";
import {
  authMethodDescriptors,
  type CliAuthMethodSpec,
  makeCliProviderAuth,
  providerAuthMethodPersistence,
  providerEnvVarCredential,
} from "@t3tools/provider-core/server/cliAuth";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "@t3tools/provider-core/server/driver";
import { withInstanceIdentity } from "@t3tools/provider-core/server/instanceIdentity";
import {
  mergeProviderInstanceEnvironment,
  resolveInstanceHomePath,
  withProviderHomePathVariables,
} from "@t3tools/provider-core/server/instanceEnvironment";
import { discoverGrokSkills } from "./skills.ts";
import {
  makeCachedProviderMaintenanceResolution,
  makeManualOnlyProviderMaintenanceCapabilities,
  makeProviderMaintenanceCapabilities,
  type ProviderMaintenanceCapabilitiesResolver,
  resolveProviderMaintenanceCapabilitiesEffect,
} from "@t3tools/provider-core/server/maintenanceResolver";
import {
  haveProviderSnapshotSettingsChanged,
  makeProviderSnapshotSettingsSource,
  type ProviderSnapshotSettings,
} from "@t3tools/provider-core/server/snapshotSettings";
const decodeGrokSettings = Schema.decodeSync(GrokSettings);

const DRIVER_KIND = ProviderDriverKind.make("grok");
// npm's `latest` tracks Grok's stable channel, the one `grok update` installs
// by default, so the registry stays the source for "latest".
const GROK_NPM_PACKAGE = "@xai-official/grok";
// `grok update` finds the installer that owns the binary itself, so the
// resolved executable is its own updater. It installs under `GROK_HOME`, so it
// runs with the instance's environment. No executable means nothing to update,
// not "whatever is on PATH".
const UPDATE: ProviderMaintenanceCapabilitiesResolver = {
  resolve: (context) =>
    Effect.succeed(
      context
        ? makeProviderMaintenanceCapabilities({
            provider: DRIVER_KIND,
            packageName: GROK_NPM_PACKAGE,
            updateExecutable: context.resolvedCommandPath,
            updateArgs: ["update"],
            updateLockKey: "grok",
            platform: context.platform,
            env: context.env,
          })
        : makeManualOnlyProviderMaintenanceCapabilities({
            provider: DRIVER_KIND,
            packageName: GROK_NPM_PACKAGE,
          }),
    ),
};

export type GrokDriverEnv =
  | GrokAdapterV2DriverEnv
  | ProviderHost.ProviderHost
  | ChildProcessSpawner.ChildProcessSpawner
  | Crypto.Crypto
  | FileSystem.FileSystem
  | HttpClient.HttpClient
  | Path.Path
  | ProviderEventLoggers.ProviderEventLoggers;

export const GrokDriver: ProviderDriver<GrokSettings, GrokDriverEnv> = {
  driverKind: DRIVER_KIND,
  metadata: {
    displayName: "Grok",
    supportsMultipleInstances: true,
  },
  configSchema: GrokSettings,
  defaultConfig: (): GrokSettings => decodeGrokSettings({}),
  create: ({ instanceId, displayName, accentColor, environment, enabled, config: configured }) =>
    Effect.gen(function* () {
      const config = {
        ...configured,
        homePath: yield* resolveInstanceHomePath({
          homePath: configured.homePath,
          stateDir: (yield* ProviderHost.ProviderHost).paths.stateDir,
          driver: DRIVER_KIND,
          instanceId,
          environment,
          homeVariables: ["GROK_HOME"],
        }),
      };
      const crypto = yield* Crypto.Crypto;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const httpClient = yield* HttpClient.HttpClient;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const host = yield* ProviderHost.ProviderHost;
      const { cwd } = host.paths;
      const instanceEnvironment = yield* withProviderHomePathVariables(
        config.homePath,
        ["GROK_HOME"],
        environment,
      );
      const processEnv = mergeProviderInstanceEnvironment(instanceEnvironment);
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
      const orchestrationAdapter = yield* GrokAdapterV2Driver.create({
        instanceId,
        displayName,
        accentColor,
        environment: instanceEnvironment,
        enabled,
        config,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: DRIVER_KIND,
              instanceId,
              detail: "Failed to build Grok orchestration adapter.",
              cause,
            }),
        ),
      );
      const textGeneration = yield* makeGrokTextGeneration(effectiveConfig, processEnv);

      const apiKeyCredential = providerEnvVarCredential({
        serverSettings: host.settings,
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
        serverSettings: host.settings,
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
            ? readGrokAccount(processEnv).pipe(
                Effect.map(({ email, usageLimits }) => ({
                  ...snapshot,
                  auth: email ? { ...snapshot.auth, email } : snapshot.auth,
                  usageLimits,
                })),
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

      const snapshotSettings = makeProviderSnapshotSettingsSource(effectiveConfig, host.settings);
      const snapshot = yield* makeManagedServerProvider<ProviderSnapshotSettings<GrokSettings>>({
        resolveMaintenance,
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
          resolveMaintenance().pipe(
            Effect.flatMap((maintenanceCapabilities) =>
              enrichGrokSnapshot({
                snapshot: currentSnapshot,
                maintenanceCapabilities,
                enableProviderUpdateChecks: settings.enableProviderUpdateChecks,
                publishSnapshot,
                httpClient,
              }),
            ),
          ),
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
        orchestrationAdapter,
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
