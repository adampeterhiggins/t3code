/**
 * CursorDriver — `ProviderDriver` for the Cursor Agent SDK runtime.
 *
 * Provider status, model discovery, orchestration, and text generation use the
 * official Cursor SDK with an instance browser login or CURSOR_API_KEY.
 *
 * @module provider/Drivers/CursorDriver
 */
import type { ModelSelection as CursorSdkModelSelection } from "@cursor/sdk";
import {
  defaultInstanceIdForDriver,
  ProviderDriverKind,
  ProviderSetupError,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { CursorSettings } from "../settings.ts";
import * as Effect from "effect/Effect";
import * as Crypto from "effect/Crypto";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as HttpClient from "effect/http/HttpClient";
import { readCursorUsageLimits, type CursorSdkCredential } from "./usageLimits.ts";

import * as ProviderHost from "@t3tools/provider-core/server/ProviderHost";
import * as SubscriptionLimitGuards from "@t3tools/provider-core/server/SubscriptionLimitGuards";
import {
  makeSubscriptionLimitPolicy,
  withSubscriptionLimitOption,
} from "@t3tools/provider-core/server/SubscriptionLimitPolicy";
import { makeCursorTextGeneration } from "./textGeneration.ts";
import { makeCursorAdapterV2, type CursorAdapterV2DriverEnv } from "./adapter.ts";
import {
  authMethodDescriptors,
  makeCliProviderAuth,
  providerAuthMethodPersistence,
  providerEnvVarCredential,
  type CliAuthMethodSpec,
} from "@t3tools/provider-core/server/cliAuth";
import { ProviderDriverError } from "@t3tools/provider-core/server/errors";
import { buildInitialCursorProviderSnapshot, checkCursorProviderStatus } from "./status.ts";
import * as CursorSdkCatalog from "./CursorSdkCatalog.ts";
import { makeManagedServerProvider } from "@t3tools/provider-core/server/managedProvider";
import { withCursorDefaultParameters } from "./sdkModel.ts";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "@t3tools/provider-core/server/driver";
import { withInstanceIdentity } from "@t3tools/provider-core/server/instanceIdentity";
import {
  mergeProviderInstanceEnvironment,
  resolveInstanceHomePath,
} from "@t3tools/provider-core/server/instanceEnvironment";
import { makeCursorEnvironment, materializeCursorShadowHome } from "./CursorHome.ts";
import { makeManualOnlyProviderMaintenanceCapabilities } from "@t3tools/provider-core/server/maintenanceResolver";
import {
  haveProviderSnapshotSettingsChanged,
  makeProviderSnapshotSettingsSource,
  type ProviderSnapshotSettings,
} from "@t3tools/provider-core/server/snapshotSettings";
import { probeCursorSkills } from "./skills.ts";
import { makeCursorAuth } from "./auth.ts";
import * as CursorCredentialStore from "./credentialStore.ts";
import * as CursorAgentSdk from "./CursorAgentSdk.ts";
import * as CursorSdk from "./CursorSdk.ts";
import * as CursorKeychain from "./CursorKeychain.ts";
import * as CursorUsageAccounts from "./CursorUsageAccounts.ts";

const decodeCursorSettings = Schema.decodeSync(CursorSettings);
const isSdkRunnerError = Schema.is(CursorAgentSdk.CursorAgentSdkRunnerError);

const DRIVER_KIND = ProviderDriverKind.make("cursor");
const MAINTENANCE_CAPABILITIES = makeManualOnlyProviderMaintenanceCapabilities({
  provider: DRIVER_KIND,
  packageName: null,
});

export type CursorDriverEnv =
  | CursorAdapterV2DriverEnv
  | Crypto.Crypto
  | FileSystem.FileSystem
  | Path.Path
  | HttpClient.HttpClient
  | ChildProcessSpawner.ChildProcessSpawner
  | CursorSdk.CursorSdk
  | ProviderHost.ProviderHost
  | CursorKeychain.CursorKeychain;

export const CursorDriver: ProviderDriver<
  CursorSettings,
  CursorDriverEnv,
  CursorUsageAccounts.CursorUsageAccounts
> = {
  driverKind: DRIVER_KIND,
  metadata: {
    displayName: "Cursor",
    supportsMultipleInstances: true,
  },
  configSchema: CursorSettings,
  defaultConfig: (): CursorSettings => decodeCursorSettings({}),
  // Account sources: each instance's own Cursor SDK sign-in, plus the host's Cursor CLI login.
  usage: {
    kind: "scan",
    provider: "cursor",
    scan: ({ instances, settings, windowStartMs, retentionCutoffMs, awaitRefresh }) =>
      CursorUsageAccounts.CursorUsageAccounts.pipe(
        Effect.flatMap((accounts) =>
          accounts.scan({
            instances: instances.map((instance) => ({
              instanceId: instance.instanceId,
              environment: instance.environment,
              homePath: instance.config?.homePath ?? "",
              configuredEnvironment: settings.providerInstances[instance.instanceId]?.environment,
            })),
            keychainUsageEnabled: settings.cursorKeychainUsageEnabled,
            windowStartMs,
            retentionCutoffMs,
            awaitRefresh,
          }),
        ),
      ),
  },
  create: Effect.fn("CursorDriver.create")(function* ({
    instanceId,
    displayName,
    accentColor,
    environment,
    enabled,
    config,
  }) {
    const host = yield* ProviderHost.ProviderHost;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const httpClient = yield* HttpClient.HttpClient;
    const keychain = yield* CursorKeychain.CursorKeychain;
    const sdkRunner = yield* CursorAgentSdk.CursorAgentSdkRunner;
    const homePath = yield* resolveInstanceHomePath({
      homePath: config.homePath,
      stateDir: host.paths.stateDir,
      driver: DRIVER_KIND,
      instanceId,
      environment,
      homeVariables: ["HOME"],
    });
    const configWithHome = { ...config, homePath };
    yield* materializeCursorShadowHome(configWithHome).pipe(
      Effect.mapError(
        (cause) =>
          new ProviderDriverError({
            driver: DRIVER_KIND,
            instanceId,
            detail: cause.message,
            cause,
          }),
      ),
    );
    const processEnv = yield* makeCursorEnvironment(
      configWithHome,
      yield* mergeProviderInstanceEnvironment(environment),
    );
    const continuationIdentity = defaultProviderContinuationIdentity({
      driverKind: DRIVER_KIND,
      instanceId,
    });
    const stampIdentity = withInstanceIdentity({
      instanceId,
      driverKind: DRIVER_KIND,
      displayName: displayName ?? "Cursor",
      accentColor,
      continuationGroupKey: continuationIdentity.continuationKey,
    });
    const effectiveConfig = { ...configWithHome, enabled } satisfies CursorSettings;
    const credentials = yield* CursorCredentialStore.makeCursorCredentialStore(
      instanceId,
      path.join(
        host.paths.stateDir,
        "provider-auth",
        encodeURIComponent(instanceId),
        "cursor.json",
      ),
    ).pipe(
      Effect.mapError(
        (cause) =>
          new ProviderDriverError({
            driver: DRIVER_KIND,
            instanceId,
            detail: "Could not open the Cursor credential store.",
            cause,
          }),
      ),
    );
    const apiKeyCredential = providerEnvVarCredential({
      serverSettings: host.settings,
      instanceId,
      driverKind: DRIVER_KIND,
      envName: "CURSOR_API_KEY",
    });
    const hasCliLogin = Effect.gen(function* () {
      const homeDir = processEnv.HOME?.trim();
      if (!homeDir) return false;
      const configHome = processEnv.XDG_CONFIG_HOME?.trim() || path.join(homeDir, ".config");
      const candidates = [
        path.join(homeDir, ".cursor", "auth.json"),
        path.join(configHome, "cursor", "auth.json"),
      ];
      for (const candidate of candidates) {
        if (yield* fileSystem.exists(candidate).pipe(Effect.orElseSucceed(() => false))) {
          return true;
        }
      }
      return false;
    });
    const auth = yield* makeCursorAuth({
      instanceId,
      displayName: displayName ?? "Cursor",
      enabled,
      ...(processEnv.CURSOR_API_KEY ? { apiKey: processEnv.CURSOR_API_KEY } : {}),
      store: credentials.store,
      credentialBinding: credentials.binding,
      onChanged: (signedIn): Effect.Effect<void, ProviderSetupError> =>
        snapshot.refresh.pipe(
          Effect.flatMap((provider) =>
            !signedIn || provider.auth.status === "authenticated"
              ? Effect.void
              : Effect.fail(
                  new ProviderSetupError({
                    instanceId,
                    operation: "start",
                    detail: provider.message ?? "Could not verify the Cursor sign-in. Try again.",
                  }),
                ),
          ),
        ),
    });
    const authMethods: ReadonlyArray<CliAuthMethodSpec> = [
      {
        kind: "effect",
        id: "browser",
        label: "Sign in with browser",
        description:
          "Opens Cursor's sign-in page and stores this instance's login for running agents.",
        waitingMessage:
          "Open the Cursor sign-in page and finish signing in. This page updates automatically.",
        run: ({ publishAuthorizationUrl }) => auth.browserSignIn(publishAuthorizationUrl),
      },
      {
        kind: "cli",
        id: "agent",
        label: "Sign in with cursor-agent",
        description:
          "Runs `cursor-agent login` in this instance's home, so this CLI login stays separate from the default account.",
        args: ["login"],
        env: { NO_OPEN_BROWSER: "1" },
        urlPattern: /https:\/\/cursor\.com\/\S+/,
        waitingMessage: "Open the Cursor sign-in URL in your browser to finish signing in.",
      },
      {
        kind: "saved-credentials",
        id: "saved",
        label: "Use saved Cursor login",
        description:
          "Reuses a Cursor sign-in or `cursor-agent login` already stored for this instance.",
        missingMessage:
          "No Cursor login found for this instance. Sign in with a browser or paste an API key.",
        probe: auth.readCredential.pipe(
          Effect.map((credential) => credential !== undefined),
          Effect.orElseSucceed(() => false),
          Effect.flatMap((signedIn) => (signedIn ? Effect.succeed(true) : hasCliLogin)),
        ),
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
    const authMethodPersistence = providerAuthMethodPersistence({
      serverSettings: host.settings,
      instanceId,
      methods: authMethods,
    });
    // Filled in once the snapshot exists. Sign-in verification runs after that.
    let providerIsAuthenticated: () => Effect.Effect<boolean> = () => Effect.succeed(false);
    const settingsAuth = yield* makeCliProviderAuth({
      instanceId,
      providerLabel: displayName ?? "Cursor",
      command: effectiveConfig.binaryPath?.trim() || "cursor-agent",
      processEnv,
      methods: authMethods,
      probeAuth: Effect.gen(function* () {
        const signedIn = (yield* providerIsAuthenticated()) || (yield* hasCliLogin);
        return { status: signedIn ? "authenticated" : "unauthenticated" };
      }),
      recordAuthMethod: authMethodPersistence.record,
      onLogout: auth.usesApiKey
        ? apiKeyCredential.remove
        : auth.controller.logout(Effect.void).pipe(Effect.andThen(apiKeyCredential.remove)),
    });
    const stampSnapshot: typeof stampIdentity = (draft) =>
      stampIdentity({
        ...draft,
        models: draft.models.map((model) =>
          withSubscriptionLimitOption(
            model,
            "Stop when Cursor reports the included usage this model draws from used up, even if on-demand usage is enabled. Usage is checked about once a minute; this is not a billing cap.",
          ),
        ),
        setup: {
          canAuthenticate: true,
          canInstall: false,
          authMethods: authMethodDescriptors(authMethods),
        },
        auth: {
          ...draft.auth,
          canLogout: true,
        },
      });

    // Sends the defaults the model picker shows for anything the selection leaves out.
    const withPickerDefaults = Effect.fn("CursorDriver.withPickerDefaults")(function* (
      model: CursorSdkModelSelection | undefined,
    ) {
      if (model === undefined) return undefined;
      return yield* snapshot.getSnapshot.pipe(
        Effect.map((provider) =>
          withCursorDefaultParameters(
            model,
            (
              provider.models.find((candidate) => candidate.slug === model.id) ??
              catalogModels.find((candidate) => candidate.slug === model.id)
            )?.capabilities?.optionDescriptors,
          ),
        ),
      );
    });

    const withSendPickerDefaults = (
      session: CursorAgentSdk.CursorAgentSdkSession,
    ): CursorAgentSdk.CursorAgentSdkSession => ({
      ...session,
      send: (sendInput) =>
        withPickerDefaults(sendInput.options?.model).pipe(
          Effect.flatMap((model) =>
            session.send(
              model === undefined
                ? sendInput
                : { ...sendInput, options: { ...sendInput.options, model } },
            ),
          ),
        ),
    });

    // Each instance reads its own account's limits with its own key; only the default
    // instance may fall back to the host's shared CLI login.
    const readUsageLimits = (credential: CursorSdkCredential | undefined) =>
      host.settings.get.pipe(
        Effect.flatMap((settings) =>
          readCursorUsageLimits(effectiveConfig, processEnv, {
            allowKeychain: settings.cursorKeychainUsageEnabled,
            sdkCredential: credential,
            sharedLogin: instanceId === defaultInstanceIdForDriver(DRIVER_KIND),
          }),
        ),
        Effect.provideService(HttpClient.HttpClient, httpClient),
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, path),
        Effect.provideService(CursorKeychain.CursorKeychain, keychain),
      );

    let catalogModels: ReadonlyArray<ServerProviderModel> = [];
    const orchestrationAdapter = yield* makeCursorAdapterV2({
      instanceId,
      settings: effectiveConfig,
      environment: processEnv,
      getModels: () => catalogModels,
      subscriptionLimit: {
        policy: makeSubscriptionLimitPolicy({
          settings: host.settings,
          guards: yield* Effect.serviceOption(SubscriptionLimitGuards.SubscriptionLimitGuards),
        }),
        checkUsage: auth.readCredential.pipe(
          Effect.orElseSucceed(() => undefined),
          Effect.flatMap(readUsageLimits),
          Effect.orElseSucceed(() => undefined),
        ),
      },
    }).pipe(
      Effect.provideService(CursorAgentSdk.CursorAgentSdkRunner, {
        ...sdkRunner,
        open: (input) =>
          Effect.all([auth.requireApiKey, withPickerDefaults(input.options.model)]).pipe(
            Effect.flatMap(([apiKey, model]) =>
              Effect.acquireRelease(
                sdkRunner
                  .open({
                    ...input,
                    options: { ...input.options, apiKey, ...(model ? { model } : {}) },
                  })
                  .pipe(
                    Effect.flatMap((session) =>
                      Effect.cached(session.close).pipe(
                        Effect.map((close) => withSendPickerDefaults({ ...session, close })),
                      ),
                    ),
                  ),
                (session) => session.close.pipe(Effect.ignore),
              ),
            ),
            auth.withAccess,
            Effect.mapError((cause) =>
              isSdkRunnerError(cause)
                ? cause
                : new CursorAgentSdk.CursorAgentSdkRunnerError({ method: "open", cause }),
            ),
          ),
      }),
      Effect.mapError(
        (cause) =>
          new ProviderDriverError({
            driver: DRIVER_KIND,
            instanceId,
            detail: "Failed to build Cursor orchestration adapter.",
            cause,
          }),
      ),
    );
    const textGeneration = yield* makeCursorTextGeneration(
      effectiveConfig,
      processEnv,
      auth.requireApiKey,
      auth.withAccess,
    );

    const checkProvider = auth.readCredential.pipe(
      Effect.orElseSucceed(() => undefined),
      Effect.flatMap((credential) =>
        checkCursorProviderStatus(
          effectiveConfig,
          {
            ...processEnv,
            CURSOR_API_KEY: credential?.apiKey,
          },
          auth.usesApiKey ? "api-key" : "browser",
        ).pipe(
          Effect.filterOrElse(
            (snapshot) =>
              !(
                effectiveConfig.enabled &&
                snapshot.installed &&
                snapshot.auth.status === "authenticated"
              ),
            (snapshot) =>
              readUsageLimits(credential).pipe(
                Effect.map((usageLimits) => ({ ...snapshot, usageLimits })),
              ),
          ),
        ),
      ),
      Effect.provideService(HttpClient.HttpClient, httpClient),
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
      Effect.provideService(CursorKeychain.CursorKeychain, keychain),
      Effect.map(stampSnapshot),
      Effect.flatMap(authMethodPersistence.stamp),
      Effect.tap((provider) =>
        Effect.sync(() => {
          // A failed check lists only custom models, so keep the last loaded catalog.
          if (provider.models.some((model) => !model.isCustom)) {
            catalogModels = provider.models;
          }
        }),
      ),
      Effect.provide(CursorSdkCatalog.layer),
    );

    const snapshotSettings = yield* makeProviderSnapshotSettingsSource(effectiveConfig);
    const snapshot = yield* makeManagedServerProvider<ProviderSnapshotSettings<CursorSettings>>({
      resolveMaintenance: () => Effect.succeed(MAINTENANCE_CAPABILITIES),
      getSettings: snapshotSettings.getSettings,
      streamSettings: snapshotSettings.streamSettings,
      haveSettingsChanged: haveProviderSnapshotSettingsChanged,
      initialSnapshot: (settings) =>
        buildInitialCursorProviderSnapshot(settings.provider).pipe(Effect.map(stampSnapshot)),
      checkProvider,
    }).pipe(
      Effect.tap((created) =>
        Effect.sync(() => {
          providerIsAuthenticated = () =>
            created.getSnapshot.pipe(
              Effect.map((provider) => provider.auth.status === "authenticated"),
            );
        }),
      ),
      Effect.mapError(
        (cause) =>
          new ProviderDriverError({
            driver: DRIVER_KIND,
            instanceId,
            detail: "Failed to build Cursor snapshot.",
            cause,
          }),
      ),
    );

    return {
      instanceId,
      driverKind: DRIVER_KIND,
      continuationIdentity,
      displayName,
      accentColor,
      enabled,
      auth: settingsAuth,
      snapshot,
      snapshotForCwd: (cwd) =>
        !effectiveConfig.enabled
          ? snapshot.getSnapshot
          : Effect.all([
              snapshot.getSnapshot,
              probeCursorSkills(cwd, processEnv).pipe(
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
              ),
            ]).pipe(Effect.map(([machineSnapshot, skills]) => ({ ...machineSnapshot, skills }))),
      orchestrationAdapter,
      textGeneration,
    } satisfies ProviderInstance;
  }),
};
