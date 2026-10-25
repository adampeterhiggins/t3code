// @effect-diagnostics nodeBuiltinImport:off - The Google loopback OAuth callback is a Node HTTP boundary.
import * as NodeHttp from "node:http";

import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import {
  GoogleAccount,
  type GoogleCancelLoginInput,
  GoogleClientCredentials,
  type GoogleCompleteLoginInput,
  type GoogleConnectionState,
  GoogleError,
  type GoogleStartLoginInput,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Exit from "effect/Exit";
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
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import {
  type CallbackReply,
  type IntegrationRedirect,
  resolveIntegrationRedirect,
} from "../integrationOAuth.ts";
import {
  buildGoogleAuthorizeUrl,
  GOOGLE_LOOPBACK_PORT,
  GOOGLE_REDIRECT_URI,
  GOOGLE_REVOKE_URL,
  GOOGLE_SERVER_CALLBACK_PATH,
  GOOGLE_TOKEN_URL,
  readGoogleCallback,
  readPastedGoogleCallback,
} from "./googleOAuth.ts";

const GOOGLE_TOKEN_SECRET = "google-oauth-token";
const GOOGLE_CREDENTIALS_SECRET = "google-oauth-client";
const LOGIN_TIMEOUT = Duration.minutes(10);
const UNEXPECTED_STOP = "Google sign-in stopped unexpectedly. Try again.";

const PersistedGoogleToken = Schema.Struct({
  accessToken: Schema.String,
  refreshToken: Schema.NullOr(Schema.String),
  account: GoogleAccount,
});
type PersistedGoogleToken = typeof PersistedGoogleToken.Type;
const PersistedGoogleTokenJson = Schema.fromJsonString(PersistedGoogleToken);
const decodePersistedToken = Schema.decodeUnknownEffect(PersistedGoogleTokenJson);
const encodePersistedToken = Schema.encodeEffect(PersistedGoogleTokenJson);
const GoogleClientCredentialsJson = Schema.fromJsonString(GoogleClientCredentials);
const decodeCredentials = Schema.decodeUnknownEffect(GoogleClientCredentialsJson);
const encodeCredentials = Schema.encodeEffect(GoogleClientCredentialsJson);

const TokenResponse = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.optional(Schema.String),
});

type Credentials = GoogleClientCredentials | null;

const disconnectedState = (
  credentials: Credentials,
  redirectUri: string,
): GoogleConnectionState => ({
  configured: credentials !== null,
  clientId: credentials?.clientId ?? null,
  redirectUri,
  phase: "disconnected",
  account: null,
  flowId: null,
  authorizationUrl: null,
  expiresAt: null,
  message: null,
});

const connectedState = (
  account: GoogleAccount,
  credentials: Credentials,
  redirectUri: string,
): GoogleConnectionState => ({
  ...disconnectedState(credentials, redirectUri),
  phase: "connected",
  account,
});

const failedState = (
  message: string,
  credentials: Credentials,
  redirectUri: string,
): GoogleConnectionState => ({
  ...disconnectedState(credentials, redirectUri),
  phase: "failed",
  message,
});

type UsableRedirect = Exclude<IntegrationRedirect, { readonly _tag: "Invalid" }>;

interface ActiveFlow {
  readonly flowId: string;
  readonly state: string;
  readonly redirect: UsableRedirect;
  readonly credentials: GoogleClientCredentials;
  readonly callback: Deferred.Deferred<string, GoogleError>;
  /** What to show again if the flow is cancelled. */
  readonly previous: GoogleConnectionState;
}

export class GoogleAuth extends Context.Service<
  GoogleAuth,
  {
    readonly state: Stream.Stream<GoogleConnectionState>;
    readonly startLogin: (
      input: GoogleStartLoginInput,
    ) => Effect.Effect<GoogleConnectionState, GoogleError>;
    readonly completeLogin: (
      input: GoogleCompleteLoginInput,
    ) => Effect.Effect<GoogleConnectionState, GoogleError>;
    readonly cancelLogin: (
      input: GoogleCancelLoginInput,
    ) => Effect.Effect<GoogleConnectionState, GoogleError>;
    readonly disconnect: Effect.Effect<GoogleConnectionState, GoogleError>;
    /** The stored access token. Rejected tokens are refreshed by the API boundary. */
    readonly accessToken: Effect.Effect<string, GoogleError>;
    /** Rotates a rejected token once across concurrent requests. */
    readonly refreshAccessToken: (rejectedToken: string) => Effect.Effect<string, GoogleError>;
    /** Drops the credential when refreshing cannot recover access. */
    readonly markRevoked: Effect.Effect<void>;
    /** Settles the active login from a redirect that reached the main server. */
    readonly receiveCallback: (url: URL) => Effect.Effect<CallbackReply>;
  }
>()("t3/google/GoogleAuth") {}

const make = Effect.gen(function* () {
  const envClientId = yield* Config.String("T3CODE_GOOGLE_CLIENT_ID").pipe(Config.withDefault(""));
  const envClientSecret = yield* Config.String("T3CODE_GOOGLE_CLIENT_SECRET").pipe(
    Config.withDefault(""),
  );
  const redirect = resolveIntegrationRedirect({
    configured: yield* Config.String("T3CODE_GOOGLE_REDIRECT_URI").pipe(Config.option),
    variable: "T3CODE_GOOGLE_REDIRECT_URI",
    loopbackUri: GOOGLE_REDIRECT_URI,
    callbackPath: GOOGLE_SERVER_CALLBACK_PATH,
  });
  // An invalid setting fails sign-in with its reason; until then the
  // settings page names the URI sign-in would use without it.
  const redirectUri = redirect._tag === "Invalid" ? GOOGLE_REDIRECT_URI : redirect.uri;
  const crypto = yield* Crypto.Crypto;
  const httpClient = yield* HttpClient.HttpClient;
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  // Refreshing rotates the refresh token, so two concurrent refreshes would
  // spend the same one and the second would fail.
  const tokenLock = yield* Semaphore.make(1);
  const flowHandle = yield* FiberHandle.make<void, never>();
  const activeFlow = yield* Ref.make<ActiveFlow | null>(null);

  const readToken = secrets
    .get(GOOGLE_TOKEN_SECRET)
    .pipe(
      Effect.flatMap((bytes) =>
        Option.isNone(bytes)
          ? Effect.succeedNone
          : decodePersistedToken(new TextDecoder().decode(bytes.value)).pipe(Effect.asSome),
      ),
    );
  const persistToken = Effect.fn("google.auth.persist_token")((token: PersistedGoogleToken) =>
    encodePersistedToken(token).pipe(
      Effect.flatMap((encoded) =>
        secrets.set(GOOGLE_TOKEN_SECRET, new TextEncoder().encode(encoded)),
      ),
      Effect.mapError((cause) => GoogleError.login("Could not save the Google credential.", cause)),
    ),
  );
  const removeToken = secrets.remove(GOOGLE_TOKEN_SECRET).pipe(Effect.ignore);

  // The last credentials that signed in, entered in Settings, win over the
  // environment's, so a desktop app needs no environment variables.
  const savedCredentials = yield* secrets.get(GOOGLE_CREDENTIALS_SECRET).pipe(
    Effect.flatMap((bytes) =>
      Option.isNone(bytes)
        ? Effect.succeedNone
        : decodeCredentials(new TextDecoder().decode(bytes.value)).pipe(Effect.asSome),
    ),
    Effect.orElseSucceed(() => Option.none()),
  );
  const credentialsRef = yield* Ref.make<Credentials>(
    Option.getOrElse(savedCredentials, () =>
      envClientId.length > 0 && envClientSecret.length > 0
        ? { clientId: envClientId, clientSecret: envClientSecret }
        : null,
    ),
  );
  const persistCredentials = Effect.fn("google.auth.persist_credentials")(
    (credentials: GoogleClientCredentials) =>
      encodeCredentials(credentials).pipe(
        Effect.flatMap((encoded) =>
          secrets.set(GOOGLE_CREDENTIALS_SECRET, new TextEncoder().encode(encoded)),
        ),
        Effect.mapError((cause) =>
          GoogleError.login("Could not save the Google client credentials.", cause),
        ),
        Effect.andThen(Ref.set(credentialsRef, credentials)),
      ),
  );
  const disconnected = Effect.map(Ref.get(credentialsRef), (credentials) =>
    disconnectedState(credentials, redirectUri),
  );
  const failed = Effect.fn("google.auth.failed_state")((message: string) =>
    Effect.map(Ref.get(credentialsRef), (credentials) =>
      failedState(message, credentials, redirectUri),
    ),
  );

  const initial = yield* readToken.pipe(
    Effect.flatMap((token) =>
      Option.isSome(token)
        ? Effect.map(Ref.get(credentialsRef), (credentials) =>
            connectedState(token.value.account, credentials, redirectUri),
          )
        : disconnected,
    ),
    Effect.catch(() => disconnected),
  );
  const state = yield* SubscriptionRef.make<GoogleConnectionState>(initial);

  const postToken = Effect.fn("google.auth.post_token")(function* (
    credentials: GoogleClientCredentials,
    params: Record<string, string>,
  ) {
    const response = yield* HttpClientRequest.post(GOOGLE_TOKEN_URL).pipe(
      HttpClientRequest.bodyUrlParams(
        new URLSearchParams({
          ...params,
          client_id: credentials.clientId,
          client_secret: credentials.clientSecret,
        }),
      ),
      httpClient.execute,
    );
    if (response.status >= 200 && response.status < 300) {
      return {
        _tag: "Ok",
        token: yield* response.json.pipe(Effect.flatMap(Schema.decodeUnknownEffect(TokenResponse))),
      } as const;
    }
    yield* response.text.pipe(Effect.ignore);
    return { _tag: "Rejected", status: response.status } as const;
  });

  const exchangeCode = Effect.fn("google.auth.exchange_code")(function* (
    code: string,
    credentials: GoogleClientCredentials,
    redirectUri: string,
  ) {
    const result = yield* postToken(credentials, {
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }).pipe(
      Effect.mapError((cause) =>
        GoogleError.login("Could not reach Google to finish sign-in.", cause),
      ),
    );
    if (result._tag === "Rejected") {
      return yield* GoogleError.login(
        "Google refused the sign-in. Check the OAuth client and approved permissions.",
      );
    }
    const identity = yield* HttpClientRequest.get(
      "https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress)",
    ).pipe(
      HttpClientRequest.bearerToken(result.token.access_token),
      httpClient.execute,
      Effect.flatMap((response) => response.json),
      Effect.flatMap(
        Schema.decodeUnknownEffect(
          Schema.Struct({
            user: Schema.Struct({ displayName: Schema.String, emailAddress: Schema.String }),
          }),
        ),
      ),
      Effect.mapError((cause) => GoogleError.login("Could not read the Google account.", cause)),
    );
    const token: PersistedGoogleToken = {
      accessToken: result.token.access_token,
      refreshToken: result.token.refresh_token ?? null,
      account: { email: identity.user.emailAddress, name: identity.user.displayName },
    };
    yield* persistToken(token);
    yield* persistCredentials(credentials);
    return token.account;
  });

  /** Settles a login from the redirect the browser followed. The reply never carries the code. */
  const settleCallback = Effect.fn("google.auth.settle_callback")(function* (
    flow: ActiveFlow | null,
    url: URL,
  ) {
    if (flow === null) {
      return {
        status: 400,
        message: "This Google sign-in is no longer active. Start again in T3 Code.",
      } satisfies CallbackReply;
    }
    const result = readGoogleCallback(url, flow.state);
    switch (result._tag) {
      case "Invalid":
        return { status: 400, message: result.reason } satisfies CallbackReply;
      case "Denied":
        yield* Deferred.fail(flow.callback, GoogleError.login("Google sign-in was cancelled."));
        return {
          status: 200,
          message: "Google sign-in was cancelled. You can close this tab.",
        } satisfies CallbackReply;
      case "Code":
        const accepted = yield* Deferred.succeed(flow.callback, result.code);
        if (!accepted)
          return {
            status: 400,
            message: "This sign-in callback was already received.",
          } satisfies CallbackReply;
        return {
          status: 200,
          message: "Google authorization received. Return to T3 Code to check the connection.",
        } satisfies CallbackReply;
    }
  });

  const callbackRoute = (flow: ActiveFlow) =>
    HttpRouter.add(
      "GET",
      "/callback",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const reply = yield* settleCallback(
          flow,
          new URL(request.originalUrl, GOOGLE_REDIRECT_URI),
        );
        return HttpServerResponse.text(reply.message, { status: reply.status });
      }),
    );

  /** Binds the loopback port for one login; a server redirect needs no listener. */
  const listenOnLoopback = Effect.fn("google.auth.listen_on_loopback")(function* (
    flow: ActiveFlow,
  ) {
    const listener = HttpRouter.serve(callbackRoute(flow), {
      disableListenLog: true,
      disableLogger: true,
    }).pipe(
      Layer.provide(
        NodeHttpServer.layer(NodeHttp.createServer, {
          host: "127.0.0.1",
          port: GOOGLE_LOOPBACK_PORT,
          disablePreemptiveShutdown: true,
        }),
      ),
    );
    // A fresh memo map: requests inside the server carry the app's memo
    // map, and reusing its memoized HttpRouter would serve the whole app
    // on the loopback port and fail the next login's route registration.
    yield* Layer.buildWithMemoMap(listener, yield* Layer.makeMemoMap, yield* Effect.scope).pipe(
      Effect.mapError((cause) =>
        GoogleError.login(
          `Port ${GOOGLE_LOOPBACK_PORT} is in use, so the Google callback cannot be received. Free the port and try again.`,
          cause,
        ),
      ),
    );
  });

  /**
   * Owns one login and its loopback listener. `listening` settles once the
   * port is bound (or failed to bind) so `startLogin` can report a busy port.
   */
  const runFlow = (flow: ActiveFlow, listening: Deferred.Deferred<void, GoogleError>) =>
    Effect.scoped(
      Effect.gen(function* () {
        if (flow.redirect._tag === "Loopback") yield* listenOnLoopback(flow);
        yield* Deferred.succeed(listening, undefined);
        const code = yield* Deferred.await(flow.callback).pipe(
          Effect.timeout(LOGIN_TIMEOUT),
          Effect.catchTags({
            TimeoutError: () =>
              Effect.fail(GoogleError.login("Google sign-in timed out. Start again.")),
          }),
        );
        return yield* exchangeCode(code, flow.credentials, flow.redirect.uri);
      }),
    ).pipe(
      Effect.matchEffect({
        onSuccess: (account) =>
          SubscriptionRef.set(state, connectedState(account, flow.credentials, redirectUri)),
        onFailure: (error) =>
          Effect.andThen(
            Deferred.fail(listening, error),
            Effect.flatMap(failed(error.detail), (next) => SubscriptionRef.set(state, next)),
          ),
      }),
      // `startLogin` waits on `listening`, so a defect or interruption must
      // settle it too; a no-op once the listener is up.
      Effect.onExit((exit) =>
        Exit.isSuccess(exit)
          ? Effect.void
          : Effect.andThen(
              Deferred.fail(listening, GoogleError.login(UNEXPECTED_STOP)),
              Cause.hasInterruptsOnly(exit.cause)
                ? Effect.void
                : Effect.flatMap(failed(UNEXPECTED_STOP), (next) =>
                    SubscriptionRef.set(state, next),
                  ),
            ),
      ),
      Effect.ensuring(Ref.set(activeFlow, null)),
    );

  const clearFlow = Effect.gen(function* () {
    const flow = yield* Ref.getAndSet(activeFlow, null);
    yield* FiberHandle.clear(flowHandle);
    return flow;
  });

  const makeFlowIdentity = Effect.gen(function* () {
    return {
      flowId: yield* crypto.randomUUIDv4(),
      state: Base64Url.encode(yield* crypto.randomBytes(16)),
    };
  }).pipe(Effect.mapError((cause) => GoogleError.login("Could not start Google sign-in.", cause)));

  const startLogin = Effect.fn("google.auth.start_login")(function* (input: GoogleStartLoginInput) {
    const credentials = input.credentials ?? (yield* Ref.get(credentialsRef));
    if (credentials === null)
      return yield* new GoogleError({
        reason: "not-configured",
        detail:
          "Add your Google connection's client ID and secret in Settings → Integrations → Google.",
      });
    if (redirect._tag === "Invalid") return yield* GoogleError.login(redirect.reason);
    const interrupted = yield* clearFlow;
    const current = yield* SubscriptionRef.get(state);
    const previous = interrupted?.previous ?? current;
    const identity = yield* makeFlowIdentity;
    const flow: ActiveFlow = {
      flowId: identity.flowId,
      state: identity.state,
      redirect,
      credentials,
      callback: yield* Deferred.make<string, GoogleError>(),
      previous,
    };
    const listening = yield* Deferred.make<void, GoogleError>();
    yield* Ref.set(activeFlow, flow);
    yield* FiberHandle.run(flowHandle, runFlow(flow, listening));
    yield* Deferred.await(listening);
    const now = yield* Clock.currentTimeMillis;
    const waiting: GoogleConnectionState = {
      ...previous,
      phase: "waiting",
      clientId: credentials.clientId,
      flowId: flow.flowId,
      authorizationUrl: buildGoogleAuthorizeUrl({
        clientId: credentials.clientId,
        redirectUri: redirect.uri,
        state: flow.state,
      }),
      expiresAt: DateTime.formatIso(DateTime.makeUnsafe(now + Duration.toMillis(LOGIN_TIMEOUT))),
      message: null,
    };
    yield* SubscriptionRef.set(state, waiting);
    return waiting;
  });

  const requireFlow = Effect.fn("google.auth.require_flow")((flowId: string) =>
    Ref.get(activeFlow).pipe(
      Effect.filterOrFail(
        (flow): flow is ActiveFlow => flow !== null && flow.flowId === flowId,
        () => GoogleError.login("This Google sign-in is no longer active. Start again."),
      ),
    ),
  );

  const completeLogin = Effect.fn("google.auth.complete_login")(function* (
    input: GoogleCompleteLoginInput,
  ) {
    const flow = yield* requireFlow(input.flowId);
    const result = readPastedGoogleCallback(input.callbackUrl, flow.state, flow.redirect.uri);
    switch (result._tag) {
      case "Invalid":
        return yield* GoogleError.login(result.reason);
      case "Denied":
        yield* Deferred.fail(flow.callback, GoogleError.login("Google sign-in was cancelled."));
        break;
      case "Code":
        yield* Deferred.succeed(flow.callback, result.code);
        break;
    }
    return yield* SubscriptionRef.get(state);
  });

  const cancelLogin = Effect.fn("google.auth.cancel_login")(function* (
    input: GoogleCancelLoginInput,
  ) {
    const flow = yield* requireFlow(input.flowId);
    yield* clearFlow;
    yield* SubscriptionRef.set(state, flow.previous);
    return flow.previous;
  });

  const revoke = Effect.fn("google.auth.revoke")((token: PersistedGoogleToken) =>
    HttpClientRequest.post(GOOGLE_REVOKE_URL).pipe(
      HttpClientRequest.bodyUrlParams(
        new URLSearchParams({ token: token.refreshToken ?? token.accessToken }),
      ),
      httpClient.execute,
      Effect.timeout(Duration.seconds(5)),
      Effect.ignore,
    ),
  );

  const disconnect = tokenLock
    .withPermits(1)(
      Effect.gen(function* () {
        yield* clearFlow;
        const token = yield* readToken.pipe(Effect.orElseSucceed(() => Option.none()));
        // Revoking is courtesy; a failure must not keep the credential around.
        const credentials = yield* Ref.get(credentialsRef);
        if (Option.isSome(token) && credentials !== null) yield* revoke(token.value);
        yield* removeToken;
        const next = yield* disconnected;
        yield* SubscriptionRef.set(state, next);
        return next;
      }),
    )
    .pipe(Effect.withSpan("google.auth.disconnect"));

  const markRevoked = tokenLock.withPermits(1)(
    Effect.gen(function* () {
      yield* removeToken;
      yield* SubscriptionRef.set(
        state,
        yield* failed("Google access was revoked or has expired. Reconnect Google."),
      );
    }),
  );

  const accessToken = readToken.pipe(
    Effect.mapError(
      () => new GoogleError({ reason: "api", detail: "Could not read the Google credential." }),
    ),
    Effect.flatMap((stored) =>
      Option.isSome(stored)
        ? Effect.succeed(stored.value.accessToken)
        : Effect.fail(
            new GoogleError({
              reason: "not-connected",
              detail: "Connect Google in Settings → Integrations.",
            }),
          ),
    ),
  );
  // Only one caller rotates a rejected token; others reuse the token it saved.
  const refreshAccessToken = Effect.fn("google.auth.refresh_access_token")(
    (rejectedToken: string) =>
      tokenLock
        .withPermits(1)(
          Effect.gen(function* () {
            const stored = yield* readToken.pipe(
              Effect.mapError(() => GoogleError.login("Could not read the Google credential.")),
            );
            if (Option.isNone(stored))
              return yield* new GoogleError({
                reason: "not-connected",
                detail: "Connect Google in Settings → Integrations.",
              });
            if (stored.value.accessToken !== rejectedToken) return stored.value.accessToken;
            if (stored.value.refreshToken === null)
              return yield* new GoogleError({
                reason: "revoked",
                detail: "Reconnect Google in Settings → Integrations.",
              });
            const credentials = yield* Ref.get(credentialsRef);
            if (credentials === null)
              return yield* new GoogleError({
                reason: "revoked",
                detail: "Reconnect Google in Settings → Integrations.",
              });
            const result = yield* postToken(credentials, {
              grant_type: "refresh_token",
              refresh_token: stored.value.refreshToken,
            }).pipe(Effect.mapError(() => GoogleError.login("Could not refresh Google access.")));
            if (result._tag === "Rejected" && (result.status === 429 || result.status >= 500))
              return yield* new GoogleError({
                reason: result.status === 429 ? "rate-limited" : "api",
                detail: "Google could not refresh access right now. Try again shortly.",
              });
            if (result._tag === "Rejected")
              return yield* new GoogleError({
                reason: "revoked",
                detail: "Reconnect Google in Settings → Integrations.",
              });
            yield* persistToken({
              ...stored.value,
              accessToken: result.token.access_token,
              refreshToken: result.token.refresh_token ?? stored.value.refreshToken,
            });
            return result.token.access_token;
          }),
        )
        .pipe(Effect.tapError((error) => (error.reason === "revoked" ? markRevoked : Effect.void))),
  );

  return GoogleAuth.of({
    state: SubscriptionRef.changes(state),
    startLogin,
    completeLogin,
    cancelLogin,
    disconnect,
    accessToken,
    refreshAccessToken,
    markRevoked,
    receiveCallback: Effect.fn("google.auth.receive_callback")((url: URL) =>
      Ref.get(activeFlow).pipe(Effect.flatMap((flow) => settleCallback(flow, url))),
    ),
  });
});

export const layer = Layer.effect(GoogleAuth, make);

/**
 * The main server's end of `T3CODE_GOOGLE_REDIRECT_URI`. It needs no session:
 * the browser arrives from Google, and only the login's state is accepted.
 */
export const layerCallbackRoute = HttpRouter.add(
  "GET",
  GOOGLE_SERVER_CALLBACK_PATH,
  Effect.gen(function* () {
    const auth = yield* GoogleAuth;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const reply = yield* auth.receiveCallback(new URL(request.originalUrl, "http://localhost"));
    return HttpServerResponse.text(reply.message, {
      status: reply.status,
      headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" },
    });
  }),
);
