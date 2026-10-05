import * as NodeOS from "node:os";
import {
  type CursorSettings,
  type ServerProviderUsageWindow,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import { CURSOR_USAGE_WINDOWS } from "@t3tools/shared/usageLimits";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";
import {
  clampPercent,
  makeUnavailableUsageLimits,
  makeUsageLimits,
} from "../providerUsageLimits.ts";
import { readMacCursorAccessToken } from "../cursorKeychainToken.ts";

const CursorCredentials = Schema.Struct({ accessToken: Schema.optional(Schema.String) });
const DEFAULT_CURSOR_API_ENDPOINT = "https://api2.cursor.sh";
const CursorApiKeyExchange = Schema.Struct({ accessToken: TrimmedNonEmptyString });

/** An instance's own Cursor SDK sign-in, or its CURSOR_API_KEY. */
export interface CursorSdkCredential {
  readonly apiKey: string;
  /** The backend the key was minted against; absent for a configured key. */
  readonly backendUrl?: string | undefined;
}

/** Where a credential's key is exchanged and its dashboard read, as the SDK resolves it. */
export function cursorSdkBackendUrl(
  credential: CursorSdkCredential,
  environment: NodeJS.ProcessEnv,
): string {
  return (
    credential.backendUrl?.trim() ||
    environment.CURSOR_BACKEND_URL?.trim() ||
    DEFAULT_CURSOR_API_ENDPOINT
  ).replace(/\/+$/, "");
}

/**
 * Trades a user API key for a short-lived access token, the way the Cursor SDK does before
 * its RPCs. The token names the key's own account, so usage read with it is that account's.
 */
export const exchangeCursorApiKey = Effect.fn("exchangeCursorApiKey")(function* (
  credential: CursorSdkCredential,
  environment: NodeJS.ProcessEnv,
) {
  const client = yield* HttpClient.HttpClient;
  const response = yield* client.execute(
    HttpClientRequest.post(
      `${cursorSdkBackendUrl(credential, environment)}/auth/exchange_user_api_key`,
    ).pipe(HttpClientRequest.bearerToken(credential.apiKey), HttpClientRequest.bodyJsonUnsafe({})),
  );
  const body = yield* HttpClientResponse.schemaBodyJson(CursorApiKeyExchange)(
    yield* HttpClientResponse.filterStatusOk(response),
  );
  return body.accessToken;
});

export interface ReadCursorUsageLimitsOptions {
  /** Read the shared macOS Keychain CLI login (the user opted in). */
  readonly allowKeychain?: boolean;
  readonly keychainToken?: () => Promise<string | null>;
  /** The instance's own SDK credential, which wins over every shared login. */
  readonly sdkCredential?: CursorSdkCredential | undefined;
  /**
   * Whether the host's shared CLI login may stand in for this instance. Only the default
   * instance gets it, so an added instance never shows another account's usage.
   */
  readonly sharedLogin?: boolean;
}
const decodeCredentials = Schema.decodeEffect(Schema.fromJsonString(CursorCredentials));
const CursorUsageResponse = Schema.Struct({
  billingCycleEnd: Schema.optional(Schema.Union([Schema.String, Schema.Number])),
  planUsage: Schema.optional(
    Schema.Struct({
      totalPercentUsed: Schema.optional(Schema.Number),
      autoPercentUsed: Schema.optional(Schema.Number),
      apiPercentUsed: Schema.optional(Schema.Number),
    }),
  ),
});

/** Cursor's dashboard percentages include bonus usage; spend / limit does not. */
export function cursorUsageResponseToLimits(
  response: typeof CursorUsageResponse.Type,
  checkedAt: string,
) {
  const reset = DateTime.make(Number(response.billingCycleEnd));
  const resetsAt =
    Number(response.billingCycleEnd) > 0 && Option.isSome(reset)
      ? DateTime.formatIso(reset.value)
      : undefined;
  const windows: ServerProviderUsageWindow[] = [];
  if (response.planUsage) {
    for (const { id, label } of CURSOR_USAGE_WINDOWS) {
      const usedPercent = response.planUsage[id];
      if (usedPercent === undefined || !Number.isFinite(usedPercent)) continue;
      windows.push({
        id,
        kind: "monthly",
        label,
        usedPercent: clampPercent(usedPercent),
        ...(resetsAt ? { resetsAt } : {}),
      });
    }
  }
  return windows.length > 0
    ? makeUsageLimits({ checkedAt, windows })
    : makeUnavailableUsageLimits({ checkedAt, reason: "unsupported" });
}

export const readCursorUsageLimits = Effect.fn("readCursorUsageLimits")(function* (
  settings: Pick<CursorSettings, "apiEndpoint">,
  environment: NodeJS.ProcessEnv = process.env,
  options: ReadCursorUsageLimitsOptions = {},
) {
  const {
    allowKeychain = false,
    keychainToken = readMacCursorAccessToken,
    sdkCredential,
    sharedLogin = true,
  } = options;
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  return yield* Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const platform = yield* HostProcessPlatform;
    let endpoint = (
      settings.apiEndpoint?.trim() ||
      environment.CURSOR_API_ENDPOINT?.trim() ||
      DEFAULT_CURSOR_API_ENDPOINT
    ).replace(/\/$/, "");
    let token: string | undefined;
    if (sdkCredential) {
      // The instance's own sign-in names its account; nothing shared may replace it.
      endpoint = cursorSdkBackendUrl(sdkCredential, environment);
      token = yield* exchangeCursorApiKey(sdkCredential, environment);
    } else {
      token = environment.CURSOR_AUTH_TOKEN?.trim();
    }
    // An explicit API key can name a different account from the stored login.
    if (!token && environment.CURSOR_API_KEY?.trim()) {
      return makeUnavailableUsageLimits({ checkedAt, reason: "unsupported" });
    }
    if (!token && !sharedLogin) {
      return makeUnavailableUsageLimits({ checkedAt, reason: "unsupported" });
    }
    const credentialStore = environment.AGENT_CLI_CREDENTIAL_STORE;
    if (!token && credentialStore === "memory") {
      return makeUnavailableUsageLimits({
        checkedAt,
        reason: "unsupported",
        message: "Cursor usage requires a CLI login or CURSOR_AUTH_TOKEN.",
      });
    }
    if (!token && platform === "darwin" && credentialStore !== "file") {
      if (!allowKeychain) {
        return makeUnavailableUsageLimits({
          checkedAt,
          reason: "unsupported",
          message: "Enable Cursor account usage in T3 Code to read its Keychain login.",
        });
      }
      if (endpoint !== DEFAULT_CURSOR_API_ENDPOINT) {
        return makeUnavailableUsageLimits({
          checkedAt,
          reason: "unsupported",
          message: "Cursor account usage requires the default Cursor endpoint when using Keychain.",
        });
      }
      token = (yield* Effect.tryPromise(keychainToken))?.trim();
    } else if (!token) {
      const home =
        (platform === "win32" ? environment.USERPROFILE : environment.HOME) || NodeOS.homedir();
      const directory =
        platform === "win32"
          ? path.join(environment.APPDATA || path.join(home, "AppData", "Roaming"), "Cursor")
          : platform === "darwin"
            ? path.join(home, ".cursor")
            : path.join(environment.XDG_CONFIG_HOME || path.join(home, ".config"), "cursor");
      const credentials = yield* fs.readFileString(path.join(directory, "auth.json")).pipe(
        Effect.catchTags({
          PlatformError: (error) =>
            error.reason._tag === "NotFound" ? Effect.succeed("{}") : Effect.fail(error),
        }),
        Effect.flatMap(decodeCredentials),
      );
      token = credentials.accessToken?.trim();
    }
    if (!token) return makeUnavailableUsageLimits({ checkedAt, reason: "unsupported" });
    const client = yield* HttpClient.HttpClient;
    const response = yield* client.execute(
      HttpClientRequest.post(`${endpoint}/aiserver.v1.DashboardService/GetCurrentPeriodUsage`).pipe(
        HttpClientRequest.bearerToken(token),
        HttpClientRequest.setHeaders({
          "connect-protocol-version": "1",
          "x-cursor-client-type": "cli",
        }),
        HttpClientRequest.bodyJsonUnsafe({}),
      ),
    );
    const body = yield* HttpClientResponse.schemaBodyJson(CursorUsageResponse)(
      yield* HttpClientResponse.filterStatusOk(response),
    );
    return cursorUsageResponseToLimits(body, checkedAt);
  }).pipe(
    Effect.timeout("10 seconds"),
    Effect.orElseSucceed(() =>
      makeUnavailableUsageLimits({
        checkedAt,
        reason: "probeFailed",
        message: "Cursor could not read usage limits.",
      }),
    ),
  );
});
