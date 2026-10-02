// @effect-diagnostics nodeBuiltinImport:off - The Notion loopback OAuth callback is a Node HTTP boundary.
import * as NodeHttp from "node:http";

import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import {
  NotionAccount,
  type NotionCancelLoginInput,
  type NotionCompleteLoginInput,
  type NotionConnectionState,
  NotionError,
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
import * as Encoding from "effect/Encoding";
import * as Exit from "effect/Exit";
import * as FiberHandle from "effect/FiberHandle";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import {
  buildNotionAuthorizeUrl,
  NOTION_LOOPBACK_PORT,
  NOTION_REDIRECT_URI,
  NOTION_REVOKE_URL,
  NOTION_TOKEN_URL,
  readNotionCallback,
  readPastedNotionCallback,
} from "./notionOAuth.ts";

const NOTION_TOKEN_SECRET = "notion-oauth-token";
const LOGIN_TIMEOUT = Duration.minutes(10);
const UNEXPECTED_STOP = "Notion sign-in stopped unexpectedly. Try again.";

const PersistedNotionToken = Schema.Struct({
  accessToken: Schema.String,
  refreshToken: Schema.NullOr(Schema.String),
  account: NotionAccount,
});
type PersistedNotionToken = typeof PersistedNotionToken.Type;
const PersistedNotionTokenJson = Schema.fromJsonString(PersistedNotionToken);
const decodePersistedToken = Schema.decodeUnknownEffect(PersistedNotionTokenJson);
const encodePersistedToken = Schema.encodeEffect(PersistedNotionTokenJson);

const TokenResponse = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.NullOr(Schema.String),
  workspace_id: Schema.String,
  workspace_name: Schema.NullOr(Schema.String),
});
const TokenErrorResponse = Schema.Struct({ error: Schema.String });

const disconnectedState = (configured: boolean): NotionConnectionState => ({
  configured,
  phase: "disconnected",
  account: null,
  flowId: null,
  authorizationUrl: null,
  expiresAt: null,
  message: null,
});

const connectedState = (account: NotionAccount, configured: boolean): NotionConnectionState => ({
  ...disconnectedState(configured),
  phase: "connected",
  account,
});

const failedState = (message: string, configured: boolean): NotionConnectionState => ({
  ...disconnectedState(configured),
  phase: "failed",
  message,
});

interface ActiveFlow {
  readonly flowId: string;
  readonly state: string;
  readonly callback: Deferred.Deferred<string, NotionError>;
  /** What to show again if the flow is cancelled. */
  readonly previous: NotionConnectionState;
}

const loginError = (detail: string, _cause?: unknown) =>
  new NotionError({ reason: "login", detail });

export class NotionAuth extends Context.Service<
  NotionAuth,
  {
    readonly state: Stream.Stream<NotionConnectionState>;
    readonly startLogin: Effect.Effect<NotionConnectionState, NotionError>;
    readonly completeLogin: (
      input: NotionCompleteLoginInput,
    ) => Effect.Effect<NotionConnectionState, NotionError>;
    readonly cancelLogin: (
      input: NotionCancelLoginInput,
    ) => Effect.Effect<NotionConnectionState, NotionError>;
    readonly disconnect: Effect.Effect<NotionConnectionState, NotionError>;
    /** The stored access token. Rejected tokens are refreshed by the API boundary. */
    readonly accessToken: Effect.Effect<string, NotionError>;
    /** Rotates a rejected token once across concurrent requests. */
    readonly refreshAccessToken: (rejectedToken: string) => Effect.Effect<string, NotionError>;
    /** Drops the credential when refreshing cannot recover access. */
    readonly markRevoked: Effect.Effect<void>;
  }
>()("t3/notion/NotionAuth") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const clientId = yield* Config.String("T3CODE_NOTION_CLIENT_ID").pipe(Config.withDefault(""));
  const clientSecret = yield* Config.String("T3CODE_NOTION_CLIENT_SECRET").pipe(
    Config.withDefault(""),
  );
  const configured = clientId.length > 0 && clientSecret.length > 0;
  const DISCONNECTED = disconnectedState(configured);
  const crypto = yield* Crypto.Crypto;
  const httpClient = yield* HttpClient.HttpClient;
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  // Refreshing rotates the refresh token, so two concurrent refreshes would
  // spend the same one and the second would fail.
  const tokenLock = yield* Semaphore.make(1);
  const flowHandle = yield* FiberHandle.make<void, never>();
  const activeFlow = yield* Ref.make<ActiveFlow | null>(null);

  const readToken = secrets
    .get(NOTION_TOKEN_SECRET)
    .pipe(
      Effect.flatMap((bytes) =>
        Option.isNone(bytes)
          ? Effect.succeedNone
          : decodePersistedToken(new TextDecoder().decode(bytes.value)).pipe(Effect.asSome),
      ),
    );
  const persistToken = (token: PersistedNotionToken) =>
    encodePersistedToken(token).pipe(
      Effect.flatMap((encoded) =>
        secrets.set(NOTION_TOKEN_SECRET, new TextEncoder().encode(encoded)),
      ),
      Effect.mapError((cause) => loginError("Could not save the Notion credential.", cause)),
    );
  const removeToken = secrets.remove(NOTION_TOKEN_SECRET).pipe(Effect.ignore);

  const initial = yield* readToken.pipe(
    Effect.map((token) =>
      Option.isSome(token) ? connectedState(token.value.account, configured) : DISCONNECTED,
    ),
    Effect.orElseSucceed(() => DISCONNECTED),
  );
  const state = yield* SubscriptionRef.make<NotionConnectionState>(initial);

  const postToken = (params: Record<string, string>) =>
    Effect.gen(function* () {
      const response = yield* HttpClientRequest.post(NOTION_TOKEN_URL).pipe(
        HttpClientRequest.setHeader(
          "Authorization",
          `Basic ${Encoding.encodeBase64(new TextEncoder().encode(`${clientId}:${clientSecret}`))}`,
        ),
        HttpClientRequest.bodyJsonUnsafe(params),
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

  const exchangeCode = Effect.fn("notion.auth.exchange_code")(function* (code: string) {
    const result = yield* postToken({
      grant_type: "authorization_code",
      code,
      redirect_uri: NOTION_REDIRECT_URI,
    }).pipe(
      Effect.mapError((cause) => loginError("Could not reach Notion to finish sign-in.", cause)),
    );
    if (result._tag === "Rejected") {
      return yield* loginError(`Notion refused the sign-in (${result.error}).`);
    }
    const token: PersistedNotionToken = {
      accessToken: result.token.access_token,
      refreshToken: result.token.refresh_token,
      account: {
        workspaceId: result.token.workspace_id,
        workspaceName: result.token.workspace_name ?? "Notion workspace",
      },
    };
    yield* persistToken(token);
    return token.account;
  });

  const callbackRoute = (flow: ActiveFlow) =>
    HttpRouter.add(
      "GET",
      "/callback",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const result = readNotionCallback(
          new URL(request.originalUrl, NOTION_REDIRECT_URI),
          flow.state,
        );
        switch (result._tag) {
          case "Invalid":
            return HttpServerResponse.text(result.reason, { status: 400 });
          case "Denied":
            yield* Deferred.fail(flow.callback, loginError("Notion sign-in was cancelled."));
            return HttpServerResponse.text("Notion sign-in was cancelled. You can close this tab.");
          case "Code":
            yield* Deferred.succeed(flow.callback, result.code);
            return HttpServerResponse.text("Notion connected. You can close this tab.");
        }
      }),
    );

  /**
   * Owns the loopback listener for one login. `listening` settles once the
   * port is bound (or failed to bind) so `startLogin` can report a busy port.
   */
  const runFlow = (flow: ActiveFlow, listening: Deferred.Deferred<void, NotionError>) =>
    Effect.scoped(
      Effect.gen(function* () {
        const listener = HttpRouter.serve(callbackRoute(flow), {
          disableListenLog: true,
          disableLogger: true,
        }).pipe(
          Layer.provide(
            NodeHttpServer.layer(NodeHttp.createServer, {
              host: "127.0.0.1",
              port: NOTION_LOOPBACK_PORT,
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
              `Port ${NOTION_LOOPBACK_PORT} is in use, so the Notion callback cannot be received. Free the port and try again.`,
              cause,
            ),
          ),
        );
        yield* Deferred.succeed(listening, undefined);
        const code = yield* Deferred.await(flow.callback).pipe(
          Effect.timeout(LOGIN_TIMEOUT),
          Effect.catchTag("TimeoutError", () =>
            Effect.fail(loginError("Notion sign-in timed out. Start again.")),
          ),
        );
        return yield* exchangeCode(code);
      }),
    ).pipe(
      Effect.matchEffect({
        onSuccess: (account) => SubscriptionRef.set(state, connectedState(account, configured)),
        onFailure: (error) =>
          Effect.andThen(
            Deferred.fail(listening, error),
            SubscriptionRef.set(state, failedState(error.detail, configured)),
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
                : SubscriptionRef.set(state, failedState(UNEXPECTED_STOP, configured)),
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
      flowId: yield* crypto.randomUUIDv4,
      state: Encoding.encodeBase64Url(yield* crypto.randomBytes(16)),
    };
  }).pipe(Effect.mapError((cause) => loginError("Could not start Notion sign-in.", cause)));

  const startLogin = Effect.gen(function* () {
    if (!configured)
      return yield* new NotionError({
        reason: "not-configured",
        detail:
          "Configure T3CODE_NOTION_CLIENT_ID and T3CODE_NOTION_CLIENT_SECRET on this environment, then restart it.",
      });
    const interrupted = yield* clearFlow;
    const current = yield* SubscriptionRef.get(state);
    const previous = interrupted?.previous ?? current;
    const identity = yield* makeFlowIdentity;
    const flow: ActiveFlow = {
      flowId: identity.flowId,
      state: identity.state,
      callback: yield* Deferred.make<string, NotionError>(),
      previous,
    };
    const listening = yield* Deferred.make<void, NotionError>();
    yield* Ref.set(activeFlow, flow);
    yield* FiberHandle.run(flowHandle, runFlow(flow, listening));
    yield* Deferred.await(listening);
    const now = yield* Clock.currentTimeMillis;
    const waiting: NotionConnectionState = {
      ...previous,
      phase: "waiting",
      flowId: flow.flowId,
      authorizationUrl: buildNotionAuthorizeUrl({
        clientId,
        state: flow.state,
      }),
      expiresAt: DateTime.formatIso(DateTime.makeUnsafe(now + Duration.toMillis(LOGIN_TIMEOUT))),
      message: null,
    };
    yield* SubscriptionRef.set(state, waiting);
    return waiting;
  }).pipe(Effect.withSpan("notion.auth.start_login"));

  const requireFlow = (flowId: string) =>
    Ref.get(activeFlow).pipe(
      Effect.filterOrFail(
        (flow): flow is ActiveFlow => flow !== null && flow.flowId === flowId,
        () => loginError("This Notion sign-in is no longer active. Start again."),
      ),
    );

  const completeLogin = Effect.fn("notion.auth.complete_login")(function* (
    input: NotionCompleteLoginInput,
  ) {
    const flow = yield* requireFlow(input.flowId);
    const result = readPastedNotionCallback(input.callbackUrl, flow.state);
    switch (result._tag) {
      case "Invalid":
        return yield* loginError(result.reason);
      case "Denied":
        yield* Deferred.fail(flow.callback, loginError("Notion sign-in was cancelled."));
        break;
      case "Code":
        yield* Deferred.succeed(flow.callback, result.code);
        break;
    }
    return yield* SubscriptionRef.get(state);
  });

  const cancelLogin = Effect.fn("notion.auth.cancel_login")(function* (
    input: NotionCancelLoginInput,
  ) {
    const flow = yield* requireFlow(input.flowId);
    yield* clearFlow;
    yield* SubscriptionRef.set(state, flow.previous);
    return flow.previous;
  });

  const revoke = (token: PersistedNotionToken) =>
    HttpClientRequest.post(NOTION_REVOKE_URL).pipe(
      HttpClientRequest.setHeader(
        "Authorization",
        `Basic ${Encoding.encodeBase64(new TextEncoder().encode(`${clientId}:${clientSecret}`))}`,
      ),
      HttpClientRequest.bodyJsonUnsafe({ token: token.accessToken }),
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
    .pipe(Effect.withSpan("notion.auth.disconnect"));

  const markRevoked = tokenLock.withPermits(1)(
    Effect.gen(function* () {
      yield* removeToken;
      yield* SubscriptionRef.set(
        state,
        failedState("Notion access was revoked or has expired. Reconnect Notion.", configured),
      );
    }),
  );

  const accessToken = readToken.pipe(
    Effect.mapError(
      () => new NotionError({ reason: "api", detail: "Could not read the Notion credential." }),
    ),
    Effect.flatMap((stored) =>
      Option.isSome(stored)
        ? Effect.succeed(stored.value.accessToken)
        : Effect.fail(
            new NotionError({
              reason: "not-connected",
              detail: "Connect Notion in Settings → Integrations.",
            }),
          ),
    ),
  );
  // Only one caller rotates a rejected token; others reuse the token it saved.
  const refreshAccessToken = (rejectedToken: string) =>
    tokenLock
      .withPermits(1)(
        Effect.gen(function* () {
          const stored = yield* readToken.pipe(
            Effect.mapError(() => loginError("Could not read the Notion credential.")),
          );
          if (Option.isNone(stored))
            return yield* new NotionError({
              reason: "not-connected",
              detail: "Connect Notion in Settings → Integrations.",
            });
          if (stored.value.accessToken !== rejectedToken) return stored.value.accessToken;
          if (stored.value.refreshToken === null)
            return yield* new NotionError({
              reason: "revoked",
              detail: "Reconnect Notion in Settings → Integrations.",
            });
          const result = yield* postToken({
            grant_type: "refresh_token",
            refresh_token: stored.value.refreshToken,
          }).pipe(Effect.mapError(() => loginError("Could not refresh Notion access.")));
          if (result._tag === "Rejected")
            return yield* new NotionError({
              reason: "revoked",
              detail: "Reconnect Notion in Settings → Integrations.",
            });
          yield* persistToken({
            ...stored.value,
            accessToken: result.token.access_token,
            refreshToken: result.token.refresh_token,
          });
          return result.token.access_token;
        }),
      )
      .pipe(Effect.tapError((error) => (error.reason === "revoked" ? markRevoked : Effect.void)));

  return NotionAuth.of({
    state: SubscriptionRef.changes(state),
    startLogin,
    completeLogin,
    cancelLogin,
    disconnect,
    accessToken,
    refreshAccessToken,
    markRevoked,
  });
});

export const layer = Layer.effect(NotionAuth, make);
