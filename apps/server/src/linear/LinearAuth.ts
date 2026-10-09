// @effect-diagnostics nodeBuiltinImport:off - The Linear loopback OAuth callback is a Node HTTP boundary.
import * as NodeHttp from "node:http";

import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import {
  LinearAccount,
  type LinearCancelLoginInput,
  type LinearCompleteLoginInput,
  type LinearConnectionState,
  LinearError,
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
import { linearGraphqlRequest } from "./linearGraphql.ts";
import {
  buildLinearAuthorizeUrl,
  DEFAULT_LINEAR_CLIENT_ID,
  LINEAR_LOOPBACK_PORT,
  LINEAR_REDIRECT_URI,
  LINEAR_SERVER_CALLBACK_PATH,
  LINEAR_REVOKE_URL,
  LINEAR_TOKEN_URL,
  readLinearCallback,
  readPastedLinearCallback,
} from "./linearOAuth.ts";

const LINEAR_TOKEN_SECRET = "linear-oauth-token";
const LOGIN_TIMEOUT = Duration.minutes(10);
const UNEXPECTED_STOP = "Linear sign-in stopped unexpectedly. Try again.";
const REFRESH_EARLY_MS = Duration.toMillis(Duration.minutes(5));

const PersistedLinearToken = Schema.Struct({
  accessToken: Schema.String,
  refreshToken: Schema.String,
  expiresAtEpochMs: Schema.Number,
  account: LinearAccount,
});
type PersistedLinearToken = typeof PersistedLinearToken.Type;
const PersistedLinearTokenJson = Schema.fromJsonString(PersistedLinearToken);
const decodePersistedToken = Schema.decodeUnknownEffect(PersistedLinearTokenJson);
const encodePersistedToken = Schema.encodeEffect(PersistedLinearTokenJson);

const TokenResponse = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.String,
  expires_in: Schema.Number,
});
const TokenErrorResponse = Schema.Struct({ error: Schema.String });

const ViewerData = Schema.Struct({
  viewer: Schema.Struct({
    name: Schema.String,
    email: Schema.String,
    organization: Schema.Struct({ name: Schema.String, urlKey: Schema.String }),
  }),
});
const VIEWER_QUERY = "query LinearViewer { viewer { name email organization { name urlKey } } }";

const DISCONNECTED: LinearConnectionState = {
  phase: "disconnected",
  account: null,
  flowId: null,
  authorizationUrl: null,
  expiresAt: null,
  message: null,
};

const connectedState = (account: LinearAccount): LinearConnectionState => ({
  ...DISCONNECTED,
  phase: "connected",
  account,
});

const failedState = (message: string): LinearConnectionState => ({
  ...DISCONNECTED,
  phase: "failed",
  message,
});

type UsableRedirect = Exclude<IntegrationRedirect, { readonly _tag: "Invalid" }>;

interface ActiveFlow {
  readonly flowId: string;
  readonly state: string;
  readonly redirect: UsableRedirect;
  readonly callback: Deferred.Deferred<string, LinearError>;
  /** What to show again if the flow is cancelled. */
  readonly previous: LinearConnectionState;
}

const loginError = (detail: string, cause?: unknown) =>
  new LinearError({ reason: "login", detail, ...(cause === undefined ? {} : { cause }) });

export class LinearAuth extends Context.Service<
  LinearAuth,
  {
    readonly state: Stream.Stream<LinearConnectionState>;
    readonly startLogin: Effect.Effect<LinearConnectionState, LinearError>;
    readonly completeLogin: (
      input: LinearCompleteLoginInput,
    ) => Effect.Effect<LinearConnectionState, LinearError>;
    readonly cancelLogin: (
      input: LinearCancelLoginInput,
    ) => Effect.Effect<LinearConnectionState, LinearError>;
    readonly disconnect: Effect.Effect<LinearConnectionState, LinearError>;
    /** A current access token, refreshed shortly before it expires. */
    readonly accessToken: Effect.Effect<string, LinearError>;
    /** Drops the stored credential after Linear rejects it. */
    readonly markRevoked: Effect.Effect<void>;
    /** Settles the active login from a redirect that reached the main server. */
    readonly receiveCallback: (url: URL) => Effect.Effect<CallbackReply>;
  }
>()("t3/linear/LinearAuth") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const clientId = yield* Config.String("T3CODE_LINEAR_CLIENT_ID").pipe(
    Config.withDefault(DEFAULT_LINEAR_CLIENT_ID),
  );
  const redirect = resolveIntegrationRedirect({
    configured: yield* Config.String("T3CODE_LINEAR_REDIRECT_URI").pipe(Config.option),
    variable: "T3CODE_LINEAR_REDIRECT_URI",
    loopbackUri: LINEAR_REDIRECT_URI,
    callbackPath: LINEAR_SERVER_CALLBACK_PATH,
  });
  const crypto = yield* Crypto.Crypto;
  const httpClient = yield* HttpClient.HttpClient;
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const services = Context.make(HttpClient.HttpClient, httpClient);
  // Refreshing rotates the refresh token, so two concurrent refreshes would
  // spend the same one and the second would fail.
  const tokenLock = yield* Semaphore.make(1);
  const flowHandle = yield* FiberHandle.make<void, never>();
  const activeFlow = yield* Ref.make<ActiveFlow | null>(null);

  const readToken = secrets
    .get(LINEAR_TOKEN_SECRET)
    .pipe(
      Effect.flatMap((bytes) =>
        Option.isNone(bytes)
          ? Effect.succeedNone
          : decodePersistedToken(new TextDecoder().decode(bytes.value)).pipe(Effect.asSome),
      ),
    );
  const persistToken = (token: PersistedLinearToken) =>
    encodePersistedToken(token).pipe(
      Effect.flatMap((encoded) =>
        secrets.set(LINEAR_TOKEN_SECRET, new TextEncoder().encode(encoded)),
      ),
      Effect.mapError((cause) => loginError("Could not save the Linear credential.", cause)),
    );
  const removeToken = secrets.remove(LINEAR_TOKEN_SECRET).pipe(Effect.ignore);

  const initial = yield* readToken.pipe(
    Effect.map((token) =>
      Option.isSome(token) ? connectedState(token.value.account) : DISCONNECTED,
    ),
    Effect.orElseSucceed(() => DISCONNECTED),
  );
  const state = yield* SubscriptionRef.make<LinearConnectionState>(initial);

  const postToken = (params: Record<string, string>) =>
    Effect.gen(function* () {
      const response = yield* HttpClientRequest.post(LINEAR_TOKEN_URL).pipe(
        HttpClientRequest.bodyUrlParams(params),
        httpClient.execute,
      );
      if (response.status >= 200 && response.status < 300) {
        return {
          _tag: "Ok",
          token: yield* response.json.pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(TokenResponse)),
          ),
        } as const;
      }
      const failure = yield* response.json.pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(TokenErrorResponse)),
        Effect.orElseSucceed(() => ({ error: `HTTP ${response.status}` })),
      );
      return { _tag: "Rejected", error: failure.error } as const;
    });

  const exchangeCode = Effect.fn("linear.auth.exchange_code")(function* (
    code: string,
    verifier: string,
    redirectUri: string,
  ) {
    const result = yield* postToken({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: verifier,
    }).pipe(
      Effect.mapError((cause) => loginError("Could not reach Linear to finish sign-in.", cause)),
    );
    if (result._tag === "Rejected") {
      return yield* loginError(`Linear refused the sign-in (${result.error}).`);
    }
    const viewer = yield* linearGraphqlRequest(
      result.token.access_token,
      VIEWER_QUERY,
      {},
      ViewerData,
    ).pipe(Effect.provide(services));
    const now = yield* Clock.currentTimeMillis;
    const token: PersistedLinearToken = {
      accessToken: result.token.access_token,
      refreshToken: result.token.refresh_token,
      expiresAtEpochMs: now + result.token.expires_in * 1_000,
      account: {
        name: viewer.viewer.name,
        email: viewer.viewer.email,
        workspaceName: viewer.viewer.organization.name,
        workspaceUrlKey: viewer.viewer.organization.urlKey,
      },
    };
    yield* persistToken(token);
    return token.account;
  });

  /** Settles a login from the redirect the browser followed. The reply never carries the code. */
  const settleCallback = (flow: ActiveFlow | null, url: URL) =>
    Effect.gen(function* () {
      if (flow === null) {
        return {
          status: 400,
          message: "This Linear sign-in is no longer active. Start again in T3 Code.",
        } satisfies CallbackReply;
      }
      const result = readLinearCallback(url, flow.state);
      switch (result._tag) {
        case "Invalid":
          return { status: 400, message: result.reason } satisfies CallbackReply;
        case "Denied":
          yield* Deferred.fail(flow.callback, loginError("Linear sign-in was cancelled."));
          return {
            status: 200,
            message: "Linear sign-in was cancelled. You can close this tab.",
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
            message: "Linear authorization received. Return to T3 Code to check the connection.",
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
          new URL(request.originalUrl, LINEAR_REDIRECT_URI),
        );
        return HttpServerResponse.text(reply.message, { status: reply.status });
      }),
    );

  /** Binds the loopback port for one login; a server redirect needs no listener. */
  const listenOnLoopback = (flow: ActiveFlow) =>
    Effect.gen(function* () {
      const listener = HttpRouter.serve(callbackRoute(flow), {
        disableListenLog: true,
        disableLogger: true,
      }).pipe(
        Layer.provide(
          NodeHttpServer.layer(NodeHttp.createServer, {
            host: "127.0.0.1",
            port: LINEAR_LOOPBACK_PORT,
            disablePreemptiveShutdown: true,
          }),
        ),
      );
      // A fresh memo map: requests inside the server carry the app's memo
      // map, and reusing its memoized HttpRouter would serve the whole app
      // on the loopback port and fail the next login's route registration.
      yield* Layer.buildWithMemoMap(listener, yield* Layer.makeMemoMap, yield* Effect.scope).pipe(
        Effect.mapError((cause) =>
          loginError(
            `Port ${LINEAR_LOOPBACK_PORT} is in use, so the Linear callback cannot be received. Free the port and try again.`,
            cause,
          ),
        ),
      );
    });

  /**
   * Owns one login and its loopback listener. `listening` settles once the
   * port is bound (or failed to bind) so `startLogin` can report a busy port.
   */
  const runFlow = (
    flow: ActiveFlow,
    verifier: string,
    listening: Deferred.Deferred<void, LinearError>,
  ) =>
    Effect.scoped(
      Effect.gen(function* () {
        if (flow.redirect._tag === "Loopback") yield* listenOnLoopback(flow);
        yield* Deferred.succeed(listening, undefined);
        const code = yield* Deferred.await(flow.callback).pipe(
          Effect.timeout(LOGIN_TIMEOUT),
          Effect.catchTags({
            TimeoutError: () => Effect.fail(loginError("Linear sign-in timed out. Start again.")),
          }),
        );
        return yield* exchangeCode(code, verifier, flow.redirect.uri);
      }),
    ).pipe(
      Effect.matchEffect({
        onSuccess: (account) => SubscriptionRef.set(state, connectedState(account)),
        onFailure: (error) =>
          Effect.andThen(
            Deferred.fail(listening, error),
            SubscriptionRef.set(state, failedState(error.detail)),
          ),
      }),
      // `startLogin` waits on `listening`, so a defect or interruption must
      // settle it too; a no-op once the listener is up.
      Effect.onExit((exit) =>
        Exit.isSuccess(exit)
          ? Effect.void
          : Effect.andThen(
              Deferred.fail(listening, loginError(UNEXPECTED_STOP)),
              Cause.hasInterruptsOnly(exit.cause)
                ? Effect.void
                : SubscriptionRef.set(state, failedState(UNEXPECTED_STOP)),
            ),
      ),
      Effect.ensuring(Ref.set(activeFlow, null)),
    );

  const clearFlow = Effect.gen(function* () {
    yield* FiberHandle.clear(flowHandle);
    return yield* Ref.getAndSet(activeFlow, null);
  });

  const makePkce = Effect.gen(function* () {
    const verifier = Base64Url.encode(yield* crypto.randomBytes(32));
    const challenge = Base64Url.encode(
      yield* crypto.digest("SHA-256", new TextEncoder().encode(verifier)),
    );
    return {
      verifier,
      challenge,
      flowId: yield* crypto.randomUUIDv4,
      state: Base64Url.encode(yield* crypto.randomBytes(16)),
    };
  }).pipe(Effect.mapError((cause) => loginError("Could not start Linear sign-in.", cause)));

  const startLogin = Effect.gen(function* () {
    if (redirect._tag === "Invalid") return yield* loginError(redirect.reason);
    const interrupted = yield* clearFlow;
    const current = yield* SubscriptionRef.get(state);
    const previous = interrupted?.previous ?? current;
    const pkce = yield* makePkce;
    const flow: ActiveFlow = {
      flowId: pkce.flowId,
      state: pkce.state,
      redirect,
      callback: yield* Deferred.make<string, LinearError>(),
      previous,
    };
    const listening = yield* Deferred.make<void, LinearError>();
    yield* Ref.set(activeFlow, flow);
    yield* FiberHandle.run(flowHandle, runFlow(flow, pkce.verifier, listening));
    yield* Deferred.await(listening);
    const now = yield* Clock.currentTimeMillis;
    const waiting: LinearConnectionState = {
      ...previous,
      phase: "waiting",
      flowId: flow.flowId,
      authorizationUrl: buildLinearAuthorizeUrl({
        clientId,
        redirectUri: redirect.uri,
        state: flow.state,
        challenge: pkce.challenge,
      }),
      expiresAt: DateTime.formatIso(DateTime.makeUnsafe(now + Duration.toMillis(LOGIN_TIMEOUT))),
      message: null,
    };
    yield* SubscriptionRef.set(state, waiting);
    return waiting;
  }).pipe(Effect.withSpan("linear.auth.start_login"));

  const requireFlow = (flowId: string) =>
    Ref.get(activeFlow).pipe(
      Effect.filterOrFail(
        (flow): flow is ActiveFlow => flow !== null && flow.flowId === flowId,
        () => loginError("This Linear sign-in is no longer active. Start again."),
      ),
    );

  const completeLogin = Effect.fn("linear.auth.complete_login")(function* (
    input: LinearCompleteLoginInput,
  ) {
    const flow = yield* requireFlow(input.flowId);
    const result = readPastedLinearCallback(input.callbackUrl, flow.state, flow.redirect.uri);
    switch (result._tag) {
      case "Invalid":
        return yield* loginError(result.reason);
      case "Denied":
        yield* Deferred.fail(flow.callback, loginError("Linear sign-in was cancelled."));
        break;
      case "Code":
        yield* Deferred.succeed(flow.callback, result.code);
        break;
    }
    return yield* SubscriptionRef.get(state);
  });

  const cancelLogin = Effect.fn("linear.auth.cancel_login")(function* (
    input: LinearCancelLoginInput,
  ) {
    const flow = yield* requireFlow(input.flowId);
    yield* clearFlow;
    yield* SubscriptionRef.set(state, flow.previous);
    return flow.previous;
  });

  const revoke = (token: PersistedLinearToken) =>
    HttpClientRequest.post(LINEAR_REVOKE_URL).pipe(
      HttpClientRequest.bodyUrlParams({
        token: token.refreshToken,
        token_type_hint: "refresh_token",
      }),
      httpClient.execute,
      Effect.timeout(Duration.seconds(5)),
      Effect.ignore,
    );

  const disconnect = tokenLock
    .withPermits(1)(
      Effect.gen(function* () {
        yield* clearFlow;
        const token = yield* readToken.pipe(Effect.orElseSucceed(() => Option.none()));
        // Revoking is courtesy; a failure must not keep the credential around.
        if (Option.isSome(token)) yield* revoke(token.value);
        yield* removeToken;
        yield* SubscriptionRef.set(state, DISCONNECTED);
        return DISCONNECTED;
      }),
    )
    .pipe(Effect.withSpan("linear.auth.disconnect"));

  const markRevoked = tokenLock.withPermits(1)(
    Effect.gen(function* () {
      yield* removeToken;
      yield* SubscriptionRef.set(
        state,
        failedState("Linear access was revoked or has expired. Reconnect Linear."),
      );
    }),
  );

  const accessToken = tokenLock
    .withPermits(1)(
      Effect.gen(function* () {
        const stored = yield* readToken.pipe(
          Effect.mapError(
            (cause) =>
              new LinearError({
                reason: "api",
                detail: "Could not read the Linear credential.",
                cause,
              }),
          ),
        );
        if (Option.isNone(stored)) {
          return yield* new LinearError({
            reason: "not-connected",
            detail: "Linear is not connected. Connect it in Settings → Integrations.",
          });
        }
        const token = stored.value;
        const now = yield* Clock.currentTimeMillis;
        if (token.expiresAtEpochMs - REFRESH_EARLY_MS > now) return token.accessToken;
        const result = yield* postToken({
          grant_type: "refresh_token",
          refresh_token: token.refreshToken,
          client_id: clientId,
        }).pipe(
          Effect.mapError(
            (cause) => new LinearError({ reason: "api", detail: "Could not reach Linear.", cause }),
          ),
        );
        if (result._tag === "Rejected") {
          return yield* new LinearError({
            reason: "revoked",
            detail: "Linear access was revoked or has expired. Reconnect Linear.",
          });
        }
        yield* persistToken({
          ...token,
          accessToken: result.token.access_token,
          refreshToken: result.token.refresh_token,
          expiresAtEpochMs: now + result.token.expires_in * 1_000,
        });
        return result.token.access_token;
      }),
    )
    .pipe(
      Effect.tapError((error) => (error.reason === "revoked" ? markRevoked : Effect.void)),
      Effect.withSpan("linear.auth.access_token"),
    );

  return LinearAuth.of({
    state: SubscriptionRef.changes(state),
    startLogin,
    completeLogin,
    cancelLogin,
    disconnect,
    accessToken,
    markRevoked,
    receiveCallback: (url) =>
      Ref.get(activeFlow).pipe(Effect.flatMap((flow) => settleCallback(flow, url))),
  });
});

export const layer = Layer.effect(LinearAuth, make);

/**
 * The main server's end of `T3CODE_LINEAR_REDIRECT_URI`. It needs no session:
 * the browser arrives from Linear, and only the login's state is accepted.
 */
export const layerCallbackRoute = HttpRouter.add(
  "GET",
  LINEAR_SERVER_CALLBACK_PATH,
  Effect.gen(function* () {
    const auth = yield* LinearAuth;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const reply = yield* auth.receiveCallback(new URL(request.originalUrl, "http://localhost"));
    return HttpServerResponse.text(reply.message, {
      status: reply.status,
      headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" },
    });
  }),
);
