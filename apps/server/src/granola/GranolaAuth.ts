import {
  GranolaAccount,
  type GranolaCancelLoginInput,
  type GranolaConnectionState,
  GranolaError,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FiberHandle from "effect/FiberHandle";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { callGranolaTool, GRANOLA_MCP_URL } from "./granolaMcp.ts";

const AUTH_SERVER = "https://mcp-auth.granola.ai";
const REGISTER_URL = `${AUTH_SERVER}/oauth2/register`;
const DEVICE_URL = `${AUTH_SERVER}/oauth2/device_authorization`;
const TOKEN_URL = `${AUTH_SERVER}/oauth2/token`;
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const SCOPE = "openid email profile offline_access";
const TOKEN_SECRET = "granola-oauth-token";
const CLIENT_SECRET = "granola-oauth-client";
const NOT_CONNECTED = "Connect Granola in Settings → Integrations.";

const PersistedToken = Schema.Struct({
  accessToken: Schema.String,
  refreshToken: Schema.NullOr(Schema.String),
  account: GranolaAccount,
});
type PersistedToken = typeof PersistedToken.Type;
const PersistedTokenJson = Schema.fromJsonString(PersistedToken);
const decodeToken = Schema.decodeUnknownEffect(PersistedTokenJson);
const encodeToken = Schema.encodeEffect(PersistedTokenJson);

const Registration = Schema.Struct({ client_id: Schema.String });
const DeviceAuthorization = Schema.Struct({
  device_code: Schema.String,
  user_code: Schema.String,
  verification_uri: Schema.String,
  verification_uri_complete: Schema.optional(Schema.String),
  expires_in: Schema.Number,
  interval: Schema.optional(Schema.Number),
});
const TokenResponse = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.optional(Schema.NullOr(Schema.String)),
});
const OAuthError = Schema.Struct({ error: Schema.String });

const AccountInfo = Schema.Struct({
  email: Schema.String,
  active_workspace: Schema.optional(
    Schema.NullOr(Schema.Struct({ display_name: Schema.optional(Schema.String) })),
  ),
});

const decodeOAuthError = Schema.decodeUnknownEffect(OAuthError);
const decodeTokenResponse = Schema.decodeUnknownEffect(TokenResponse);
const decodeDeviceAuthorization = Schema.decodeUnknownEffect(DeviceAuthorization);
const decodeRegistration = Schema.decodeUnknownEffect(Registration);
const decodeAccountInfo = Schema.decodeUnknownEffect(Schema.fromJsonString(AccountInfo));

const emptyState: GranolaConnectionState = {
  phase: "disconnected",
  account: null,
  flowId: null,
  verificationUrl: null,
  userCode: null,
  expiresAt: null,
  message: null,
};

const loginError = (detail: string) => new GranolaError({ reason: "login", detail });

interface ActiveFlow {
  readonly flowId: string;
  /** What to show again if the flow is cancelled. */
  readonly previous: GranolaConnectionState;
}

export class GranolaAuth extends Context.Service<
  GranolaAuth,
  {
    readonly state: Stream.Stream<GranolaConnectionState>;
    /** Starts a device sign-in; the state carries the code to approve and where. */
    readonly startLogin: Effect.Effect<GranolaConnectionState, GranolaError>;
    readonly cancelLogin: (
      input: GranolaCancelLoginInput,
    ) => Effect.Effect<GranolaConnectionState, GranolaError>;
    readonly disconnect: Effect.Effect<GranolaConnectionState, GranolaError>;
    /** The stored access token. Rejected tokens are refreshed by the API boundary. */
    readonly accessToken: Effect.Effect<string, GranolaError>;
    /** Rotates a rejected token once across concurrent requests. */
    readonly refreshAccessToken: (rejectedToken: string) => Effect.Effect<string, GranolaError>;
    /** Drops the credential when refreshing cannot recover access. */
    readonly markRevoked: Effect.Effect<void>;
  }
>()("t3/granola/GranolaAuth") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const httpClient = yield* HttpClient.HttpClient;
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  // Refreshing may rotate the refresh token, so concurrent refreshes would spend the same one.
  const tokenLock = yield* Semaphore.make(1);
  const flowHandle = yield* FiberHandle.make<void, never>();
  const activeFlow = yield* Ref.make<ActiveFlow | null>(null);

  const readSecret = (name: string) =>
    secrets
      .get(name)
      .pipe(Effect.map((bytes) => Option.map(bytes, (value) => new TextDecoder().decode(value))));
  const readToken = readSecret(TOKEN_SECRET).pipe(
    Effect.flatMap((text) =>
      Option.isNone(text) ? Effect.succeedNone : decodeToken(text.value).pipe(Effect.asSome),
    ),
  );
  const persistToken = (token: PersistedToken) =>
    encodeToken(token).pipe(
      Effect.flatMap((encoded) => secrets.set(TOKEN_SECRET, new TextEncoder().encode(encoded))),
      Effect.mapError(() => loginError("Could not save the Granola credential.")),
    );
  const removeToken = secrets.remove(TOKEN_SECRET).pipe(Effect.ignore);

  const initial = yield* readToken.pipe(
    Effect.map((token): GranolaConnectionState =>
      Option.isSome(token)
        ? { ...emptyState, phase: "connected", account: token.value.account }
        : emptyState,
    ),
    Effect.orElseSucceed(() => emptyState),
  );
  const state = yield* SubscriptionRef.make<GranolaConnectionState>(initial);
  const fail = (message: string) =>
    SubscriptionRef.set(state, { ...emptyState, phase: "failed", message });

  const postForm = (url: string, params: Record<string, string>) =>
    Effect.gen(function* () {
      const response = yield* HttpClientRequest.post(url).pipe(
        HttpClientRequest.bodyUrlParams(params),
        httpClient.execute,
      );
      const body = yield* response.json;
      if (response.status >= 200 && response.status < 300) return { _tag: "Ok", body } as const;
      const error = yield* decodeOAuthError(body).pipe(
        Effect.orElseSucceed(() => ({ error: `HTTP ${response.status}` })),
      );
      return { _tag: "Rejected", error: error.error } as const;
    });
  const postToken = (params: Record<string, string>) =>
    Effect.gen(function* () {
      const result = yield* postForm(TOKEN_URL, params);
      if (result._tag === "Rejected") return result;
      return { _tag: "Ok", token: yield* decodeTokenResponse(result.body) } as const;
    });

  /**
   * Granola has no published client for third parties, so each environment registers its own
   * public client once (dynamic client registration) and keeps its id.
   */
  const registerClient = Effect.gen(function* () {
    const response = yield* HttpClientRequest.post(REGISTER_URL).pipe(
      HttpClientRequest.bodyJsonUnsafe({
        client_name: "T3 Code",
        grant_types: ["authorization_code", DEVICE_GRANT, "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        // Registration requires one, though the device flow never redirects.
        redirect_uris: ["http://127.0.0.1/callback"],
      }),
      httpClient.execute,
    );
    const registration = yield* response.json.pipe(Effect.flatMap(decodeRegistration));
    yield* secrets.set(CLIENT_SECRET, new TextEncoder().encode(registration.client_id));
    return registration.client_id;
  }).pipe(Effect.mapError(() => loginError("Could not register T3 Code with Granola.")));
  const clientId = (renew: boolean) =>
    renew
      ? registerClient
      : readSecret(CLIENT_SECRET).pipe(
          Effect.orElseSucceed(() => Option.none<string>()),
          Effect.flatMap((saved) =>
            Option.isSome(saved) ? Effect.succeed(saved.value) : registerClient,
          ),
        );

  const readAccount = (accessToken: string) =>
    Effect.gen(function* () {
      const result = yield* callGranolaTool(httpClient, accessToken, "get_account_info", {});
      if (result._tag !== "Ok") return null;
      const info = yield* decodeAccountInfo(result.text);
      return {
        email: info.email,
        workspaceName: info.active_workspace?.display_name ?? null,
      } satisfies GranolaAccount;
    }).pipe(
      // The account only labels the connection; a reply in a new shape must not block it.
      Effect.orElseSucceed(() => null),
      Effect.map(
        (account): GranolaAccount => account ?? { email: "Granola account", workspaceName: null },
      ),
    );

  /** Polls the token endpoint until the user approves, denies, or the code expires. */
  const pollForToken = (flow: ActiveFlow, id: string, device: typeof DeviceAuthorization.Type) =>
    Effect.gen(function* () {
      let interval = Math.max(device.interval ?? 5, 1);
      const deadline = (yield* Clock.currentTimeMillis) + device.expires_in * 1000;
      while ((yield* Clock.currentTimeMillis) < deadline) {
        yield* Effect.sleep(Duration.seconds(interval));
        const result = yield* postToken({
          grant_type: DEVICE_GRANT,
          device_code: device.device_code,
          client_id: id,
        }).pipe(Effect.mapError(() => loginError("Could not reach Granola to finish sign-in.")));
        if (result._tag === "Ok") {
          const account = yield* readAccount(result.token.access_token);
          yield* persistToken({
            accessToken: result.token.access_token,
            refreshToken: result.token.refresh_token ?? null,
            account,
          });
          return account;
        }
        if (result.error === "authorization_pending") continue;
        if (result.error === "slow_down") {
          interval += 5;
          continue;
        }
        return yield* loginError(
          result.error === "access_denied"
            ? "Granola sign-in was cancelled."
            : result.error === "expired_token"
              ? "The Granola code expired. Start again."
              : `Granola refused the sign-in (${result.error}).`,
        );
      }
      return yield* loginError("The Granola code expired. Start again.");
    }).pipe(
      Effect.matchEffect({
        onSuccess: (account) =>
          SubscriptionRef.set(state, { ...emptyState, phase: "connected", account }),
        onFailure: (error) => fail(error.detail),
      }),
      Effect.ensuring(
        Ref.update(activeFlow, (current) => (current?.flowId === flow.flowId ? null : current)),
      ),
    );

  const clearFlow = Effect.gen(function* () {
    const flow = yield* Ref.getAndSet(activeFlow, null);
    yield* FiberHandle.clear(flowHandle);
    return flow;
  });

  const requestDeviceCode = (id: string) =>
    Effect.gen(function* () {
      const result = yield* postForm(DEVICE_URL, {
        client_id: id,
        scope: SCOPE,
        resource: GRANOLA_MCP_URL,
      });
      if (result._tag === "Rejected") return result;
      return { _tag: "Ok", value: yield* decodeDeviceAuthorization(result.body) } as const;
    }).pipe(Effect.mapError(() => loginError("Could not reach Granola to start sign-in.")));

  const startLogin = Effect.gen(function* () {
    const interrupted = yield* clearFlow;
    const previous = interrupted?.previous ?? (yield* SubscriptionRef.get(state));
    let id = yield* clientId(false);
    let device = yield* requestDeviceCode(id);
    // A client Granola has since forgotten is registered again, once.
    if (device._tag === "Rejected" && device.error === "invalid_client") {
      id = yield* clientId(true);
      device = yield* requestDeviceCode(id);
    }
    if (device._tag === "Rejected")
      return yield* loginError(`Granola refused to start sign-in (${device.error}).`);
    const flow: ActiveFlow = {
      flowId: yield* crypto.randomUUIDv4.pipe(
        Effect.mapError(() => loginError("Could not start Granola sign-in.")),
      ),
      previous,
    };
    yield* Ref.set(activeFlow, flow);
    yield* FiberHandle.run(flowHandle, pollForToken(flow, id, device.value));
    const now = yield* Clock.currentTimeMillis;
    const waiting: GranolaConnectionState = {
      ...previous,
      phase: "waiting",
      flowId: flow.flowId,
      verificationUrl: device.value.verification_uri_complete ?? device.value.verification_uri,
      userCode: device.value.user_code,
      expiresAt: DateTime.formatIso(DateTime.makeUnsafe(now + device.value.expires_in * 1000)),
      message: null,
    };
    yield* SubscriptionRef.set(state, waiting);
    return waiting;
  }).pipe(Effect.withSpan("granola.auth.start_login"));

  const cancelLogin = Effect.fn("granola.auth.cancel_login")(function* (
    input: GranolaCancelLoginInput,
  ) {
    const flow = yield* Ref.get(activeFlow);
    if (flow === null || flow.flowId !== input.flowId)
      return yield* loginError("This Granola sign-in is no longer active. Start again.");
    yield* clearFlow;
    yield* SubscriptionRef.set(state, flow.previous);
    return flow.previous;
  });

  const disconnect = tokenLock
    .withPermits(1)(
      Effect.gen(function* () {
        yield* clearFlow;
        const token = yield* readToken.pipe(Effect.orElseSucceed(() => Option.none()));
        // Signing out revokes this client's grant; a failure must not keep the credential.
        if (Option.isSome(token))
          yield* callGranolaTool(httpClient, token.value.accessToken, "sign_out", {}).pipe(
            Effect.timeout(Duration.seconds(5)),
            Effect.ignore,
          );
        yield* removeToken;
        yield* SubscriptionRef.set(state, emptyState);
        return emptyState;
      }),
    )
    .pipe(Effect.withSpan("granola.auth.disconnect"));

  const markRevoked = tokenLock.withPermits(1)(
    Effect.andThen(
      removeToken,
      fail("Granola access was revoked or has expired. Reconnect Granola."),
    ),
  );

  const accessToken = readToken.pipe(
    Effect.mapError(
      () => new GranolaError({ reason: "api", detail: "Could not read the Granola credential." }),
    ),
    Effect.flatMap((stored) =>
      Option.isSome(stored)
        ? Effect.succeed(stored.value.accessToken)
        : Effect.fail(new GranolaError({ reason: "not-connected", detail: NOT_CONNECTED })),
    ),
  );

  const revoked = new GranolaError({
    reason: "revoked",
    detail: "Reconnect Granola in Settings → Integrations.",
  });
  // Only one caller rotates a rejected token; others reuse the token it saved.
  const refreshAccessToken = (rejectedToken: string) =>
    tokenLock
      .withPermits(1)(
        Effect.gen(function* () {
          const stored = yield* readToken.pipe(
            Effect.mapError(() => loginError("Could not read the Granola credential.")),
          );
          if (Option.isNone(stored))
            return yield* new GranolaError({ reason: "not-connected", detail: NOT_CONNECTED });
          if (stored.value.accessToken !== rejectedToken) return stored.value.accessToken;
          if (stored.value.refreshToken === null) return yield* revoked;
          const id = yield* clientId(false);
          const result = yield* postToken({
            grant_type: "refresh_token",
            refresh_token: stored.value.refreshToken,
            client_id: id,
          }).pipe(Effect.mapError(() => loginError("Could not refresh Granola access.")));
          if (result._tag === "Rejected") return yield* revoked;
          yield* persistToken({
            ...stored.value,
            accessToken: result.token.access_token,
            refreshToken: result.token.refresh_token ?? stored.value.refreshToken,
          });
          return result.token.access_token;
        }),
      )
      .pipe(Effect.tapError((error) => (error.reason === "revoked" ? markRevoked : Effect.void)));

  return GranolaAuth.of({
    state: SubscriptionRef.changes(state),
    startLogin,
    cancelLogin,
    disconnect,
    accessToken,
    refreshAccessToken,
    markRevoked,
  });
});

export const layer = Layer.effect(GranolaAuth, make);
