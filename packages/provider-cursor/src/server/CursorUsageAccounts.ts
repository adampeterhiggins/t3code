import {
  ProviderDriverKind,
  type ProviderInstanceEnvironment,
  type ProviderInstanceId,
} from "@t3tools/contracts";
import { resolveInstanceHomePath } from "@t3tools/provider-core/server/instanceEnvironment";
import * as ProviderHost from "@t3tools/provider-core/server/ProviderHost";
import type { ProviderUsageScan } from "@t3tools/provider-core/server/usage";
import { makeCursorEnvironment } from "./CursorHome.ts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as HttpClient from "effect/http/HttpClient";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import {
  CURSOR_ACCOUNT_CACHE_FILE_NAME,
  CURSOR_ACCOUNT_TTL_MS,
  cursorFetchRange,
  decodeCursorAccountCaches,
  encodeCursorAccountCaches,
  isCursorCacheFresh,
  mergeCursorFetch,
  type CursorAccountCache,
  type CursorCredentialSource,
} from "./accountCache.ts";
import { cursorAccountKey } from "./accountUsage.ts";
import * as CursorAccountReader from "./CursorAccountReader.ts";
import { readCursorSdkCredential } from "./credentialStore.ts";
import { exchangeCursorApiKey } from "./usageLimits.ts";

const CURSOR_ACCOUNT_READ_ERROR = "Cursor account usage could not be read.";

const decodeCacheFile = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Unknown as unknown as Schema.Codec<unknown>),
);

export class CursorUsageAccounts extends Context.Service<
  CursorUsageAccounts,
  {
    readonly scan: (input: {
      /** Every Cursor instance; each one's own SDK sign-in is its own account source. */
      readonly instances: ReadonlyArray<{
        readonly instanceId: ProviderInstanceId;
        readonly environment: NodeJS.ProcessEnv;
        /** Configured home, or `""` when the instance uses its default. */
        readonly homePath: string;
        /** Instance environment variables, before they are merged over the host. */
        readonly configuredEnvironment: ProviderInstanceEnvironment | undefined;
      }>;
      /** From the same settings snapshot as the rest of the usage read. */
      readonly keychainUsageEnabled: boolean;
      readonly windowStartMs: number;
      readonly retentionCutoffMs: number;
      readonly awaitRefresh: boolean;
    }) => Effect.Effect<ReadonlyArray<ProviderUsageScan>>;
    readonly awaitPersisted: Effect.Effect<void>;
  }
>()("@t3tools/provider-cursor/server/CursorUsageAccounts") {}

const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const host = yield* ProviderHost.ProviderHost;
  const accountReader = yield* CursorAccountReader.CursorAccountReader;
  const httpClient = yield* HttpClient.HttpClient;
  const crypto = yield* Crypto.Crypto;
  const hostEnvironment = yield* HostProcess.Environment;
  const platform = yield* HostProcess.Platform;

  const cachePath = path.join(host.paths.stateDir, CURSOR_ACCOUNT_CACHE_FILE_NAME);
  const caches = new Map<string, CursorAccountCache>();
  let cacheDirty = false;
  /** Failed refreshes share the cache TTL to prevent repeated requests; null means no login. */
  const failures = new Map<string, { readonly atMs: number; readonly error: string | null }>();
  const refreshes = new Map<string, Deferred.Deferred<void>>();

  const ensureLoaded = yield* Effect.cached(
    fileSystem.readFileString(cachePath).pipe(
      Effect.flatMap((raw) => decodeCacheFile(raw)),
      Effect.catchCause(() => Effect.succeed(null)),
      Effect.map((document) => {
        for (const [key, cache] of decodeCursorAccountCaches(document)) caches.set(key, cache);
      }),
    ),
  );

  // Serialize snapshots; clear dirty before encoding and restore it on failure so changes retry.
  const persistLock = yield* Semaphore.make(1);
  const persist = Effect.gen(function* () {
    if (!cacheDirty) return;
    cacheDirty = false;
    yield* Effect.sync(() => encodeCursorAccountCaches(caches)).pipe(
      Effect.flatMap((contents) => writeFileStringAtomically({ filePath: cachePath, contents })),
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
      Effect.catchCause(() =>
        Effect.sync(() => {
          cacheDirty = true;
        }),
      ),
    );
  }).pipe(persistLock.withPermit, Effect.withSpan("CursorUsageAccounts.persist"));

  const pendingPersists = new Set<Fiber.Fiber<void>>();
  const schedulePersist = Effect.forkDetach(persist).pipe(
    Effect.map((fiber) => {
      pendingPersists.add(fiber);
      fiber.addObserver(() => pendingPersists.delete(fiber));
    }),
  );
  const awaitPersisted = Effect.suspend(() => Fiber.awaitAll([...pendingPersists])).pipe(
    Effect.asVoid,
  );
  yield* Effect.addFinalizer(() => awaitPersisted);

  const refreshAccount = Effect.fn("CursorUsageAccounts.refreshAccount")(function* (
    credential: CursorCredentialSource,
    credentialKey: string,
    retentionStartMs: number,
  ) {
    const nowMs = yield* Clock.currentTimeMillis;
    const fetchMissing = (cache: CursorAccountCache | undefined) => {
      const range = cursorFetchRange(cache, retentionStartMs, nowMs);
      return accountReader
        .read(credential, range.sinceMs, range.untilMs)
        .pipe(Effect.map((result) => ({ range, result })));
    };
    let base = caches.get(credentialKey);
    let fetched = yield* fetchMissing(base);
    if (
      base !== undefined &&
      fetched.result.accountKey !== null &&
      fetched.result.accountKey !== base.accountKey
    ) {
      caches.delete(credentialKey);
      cacheDirty = true;
      base = undefined;
      fetched = yield* fetchMissing(base);
    }
    const { range, result } = fetched;
    if (result.missing || result.error !== null || result.accountKey === null) {
      failures.set(credentialKey, {
        atMs: nowMs,
        error: result.missing || result.error !== null ? result.error : CURSOR_ACCOUNT_READ_ERROR,
      });
      yield* schedulePersist;
      return;
    }
    const merged = mergeCursorFetch(
      base,
      result.accountKey,
      range,
      result.records,
      nowMs,
      retentionStartMs,
    );
    caches.set(credentialKey, merged.cache);
    failures.delete(credentialKey);
    if (merged.changed) cacheDirty = true;
    yield* schedulePersist;
  });

  const startRefresh = (
    credential: CursorCredentialSource,
    credentialKey: string,
    retentionStartMs: number,
  ) =>
    // Enroll and fork atomically so interruption cannot strand a registered refresh.
    Effect.uninterruptible(
      Effect.gen(function* () {
        const current = refreshes.get(credentialKey);
        if (current !== undefined) return current;
        const done = Deferred.makeUnsafe<void>();
        refreshes.set(credentialKey, done);
        // Detached: a departing client must not cancel a fetch later reads reuse.
        yield* refreshAccount(credential, credentialKey, retentionStartMs).pipe(
          Effect.catchCause(() =>
            Clock.currentTimeMillis.pipe(
              Effect.map((atMs) =>
                failures.set(credentialKey, { atMs, error: CURSOR_ACCOUNT_READ_ERROR }),
              ),
            ),
          ),
          Effect.ensuring(
            Effect.suspend(() => {
              refreshes.delete(credentialKey);
              return Deferred.succeed(done, undefined);
            }),
          ),
          Effect.forkDetach,
        );
        return done;
      }),
    );

  const accountSource = Effect.fn("CursorUsageAccounts.accountSource")(function* (
    credential: CursorCredentialSource,
    authPath: string,
    windowStartMs: number,
    retentionStartMs: number,
    awaitRefresh: boolean,
  ) {
    if (
      typeof credential === "string" &&
      !(yield* fileSystem.exists(credential).pipe(Effect.orElseSucceed(() => true)))
    ) {
      return null;
    }
    yield* ensureLoaded;
    const credentialKey =
      typeof credential === "string"
        ? credential
        : credential.kind === "token"
          ? `token:${
              (yield* cursorAccountKey(credential.accessToken).pipe(
                Effect.provideService(Crypto.Crypto, crypto),
              )) ?? authPath
            }`
          : "keychain";
    const nowMs = yield* Clock.currentTimeMillis;
    const recentFailure = failures.get(credentialKey);
    let refreshing = false;
    if (
      (recentFailure === undefined || nowMs - recentFailure.atMs >= CURSOR_ACCOUNT_TTL_MS) &&
      !isCursorCacheFresh(caches.get(credentialKey), nowMs)
    ) {
      const refresh = yield* startRefresh(credential, credentialKey, retentionStartMs);
      if (awaitRefresh) yield* Deferred.await(refresh);
      else refreshing = true;
    }

    const cache = caches.get(credentialKey);
    const failure = refreshing ? undefined : failures.get(credentialKey);
    const failureMessage = failure === undefined ? undefined : failure.error;
    if (failureMessage === null) return null;
    if (cache === undefined) {
      return {
        dir: authPath,
        // Never combine a local fallback with another server's account-wide history.
        ...(refreshing
          ? { files: [], refreshing: true }
          : { files: null, message: failureMessage ?? CURSOR_ACCOUNT_READ_ERROR }),
      } satisfies ProviderUsageScan;
    }
    // Account history spans machines; a stable fingerprint prevents duplicate environment counts.
    const source = `cursor-account:${cache.accountKey}`;
    return {
      dir: source,
      hostId: "cursor.com",
      volumeId: cache.accountKey,
      files: [
        {
          path: source,
          records: cache.records.filter((record) => record.timestampMs >= windowStartMs),
        },
      ],
      ...(failureMessage === undefined
        ? { status: "ok" }
        : { status: "partial", message: failureMessage }),
      ...(refreshing ? { refreshing: true } : {}),
    } satisfies ProviderUsageScan;
  });

  const scan: CursorUsageAccounts["Service"]["scan"] = Effect.fn("CursorUsageAccounts.scan")(
    function* ({
      instances,
      keychainUsageEnabled,
      windowStartMs,
      retentionCutoffMs,
      awaitRefresh,
    }) {
      // An instance signed in with its own Cursor SDK login (or CURSOR_API_KEY) names its own
      // account, so every such account is a source. Instances sharing an account count once.
      const instanceSources: ProviderUsageScan[] = [];
      const accounts = new Set<string>();
      for (const instance of instances) {
        const source = yield* readCursorSdkCredential(
          instance.instanceId,
          instance.environment,
        ).pipe(
          Effect.flatMap((credential) =>
            credential === undefined
              ? Effect.succeed(null)
              : exchangeCursorApiKey(credential, instance.environment).pipe(
                  Effect.flatMap((accessToken) =>
                    cursorAccountKey(accessToken).pipe(
                      Effect.flatMap((key) => {
                        if (key !== null && accounts.has(key)) return Effect.succeed(null);
                        if (key !== null) accounts.add(key);
                        return accountSource(
                          { kind: "token", accessToken },
                          `cursor-instance:${instance.instanceId}`,
                          windowStartMs,
                          retentionCutoffMs,
                          awaitRefresh,
                        );
                      }),
                    ),
                  ),
                ),
          ),
          Effect.provideService(ProviderHost.ProviderHost, host),
          Effect.provideService(HttpClient.HttpClient, httpClient),
          Effect.provideService(Crypto.Crypto, crypto),
          Effect.catchCause(() =>
            Effect.succeed({
              dir: `cursor-instance:${instance.instanceId}`,
              volumeId: "",
              files: null,
              message: "Cursor account usage could not be read with this account's sign-in.",
            } satisfies ProviderUsageScan),
          ),
        );
        if (source !== null) instanceSources.push(source);
      }
      const haveInstanceAccount = instanceSources.some((source) => source.hostId === "cursor.com");
      const home = yield* HostProcess.HomeDirectory;
      const cliSources: ProviderUsageScan[] = [];
      const seenCliLogins = new Set<string>();
      const instanceEnvironments = yield* Effect.forEach(instances, (instance) =>
        Effect.gen(function* () {
          const homePath = yield* resolveInstanceHomePath({
            homePath: instance.homePath,
            stateDir: host.paths.stateDir,
            driver: ProviderDriverKind.make("cursor"),
            instanceId: instance.instanceId,
            environment: instance.configuredEnvironment,
            homeVariables: ["HOME"],
          });
          return yield* makeCursorEnvironment({ homePath }, instance.environment);
        }).pipe(
          Effect.provideService(FileSystem.FileSystem, fileSystem),
          Effect.provideService(Path.Path, path),
        ),
      );
      // The host CLI login, plus each instance's shadow home. Instances that share a
      // login (or the macOS keychain) count once.
      for (const environment of [hostEnvironment, ...instanceEnvironments]) {
        const userHome =
          (platform === "win32" ? environment["USERPROFILE"] : environment["HOME"]) || home;
        const configHome = environment["XDG_CONFIG_HOME"]?.trim();
        const cursorHome =
          platform === "darwin"
            ? path.join(userHome, "Library", "Application Support")
            : platform === "win32"
              ? environment["APPDATA"] || path.join(userHome, "AppData", "Roaming")
              : configHome && path.isAbsolute(configHome)
                ? configHome
                : path.join(userHome, ".config");
        const authPath =
          platform === "darwin"
            ? path.join(userHome, ".cursor", "auth.json")
            : path.join(cursorHome, platform === "win32" ? "Cursor" : "cursor", "auth.json");
        const credentialStore = environment["AGENT_CLI_CREDENTIAL_STORE"];
        const loginUnavailable =
          Boolean(environment["CURSOR_AUTH_TOKEN"]?.trim()) ||
          Boolean(environment["CURSOR_API_KEY"]?.trim()) ||
          credentialStore === "memory";
        const useKeychain = platform === "darwin" && credentialStore !== "file";
        const credentialKey = useKeychain ? "keychain" : `file:${authPath}`;
        if (seenCliLogins.has(credentialKey)) continue;
        seenCliLogins.add(credentialKey);
        if (useKeychain && !loginUnavailable && !keychainUsageEnabled) {
          if (haveInstanceAccount) continue;
          cliSources.push({
            dir: authPath,
            volumeId: "",
            files: null,
            message: "Cursor account usage is off on this environment.",
            action: "enableCursorKeychain",
          });
          continue;
        }
        if (loginUnavailable) {
          if (haveInstanceAccount) continue;
          cliSources.push({
            dir: authPath,
            files: null,
            message: "Cursor account history needs a Cursor CLI login on this server.",
          });
          continue;
        }
        const source = yield* accountSource(
          useKeychain ? { kind: "keychain" } : authPath,
          authPath,
          windowStartMs,
          retentionCutoffMs,
          awaitRefresh,
        );
        if (source === null || (haveInstanceAccount && source.files === null)) continue;
        cliSources.push(source);
      }
      return [...instanceSources, ...cliSources];
    },
  );

  return CursorUsageAccounts.of({ scan, awaitPersisted });
});

export const layer = Layer.effect(CursorUsageAccounts, make);
