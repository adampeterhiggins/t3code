// @effect-diagnostics nodeBuiltinImport:off - The Slack loopback OAuth callback is a Node HTTP boundary.
import * as NodeHttp from "node:http";

import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import {
  SlackAccount,
  type SlackCancelLoginInput,
  type SlackCompleteLoginInput,
  type SlackConnectionState,
  SlackError,
  SLACK_REDIRECT_URI,
  type SlackStartLoginInput,
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
import { slackApiRequest } from "./slackWebApi.ts";
import {
  buildSlackAuthorizeUrl,
  readPastedSlackCallback,
  readSlackCallback,
  SLACK_API_URL,
  SLACK_LOOPBACK_PORT,
} from "./slackOAuth.ts";

const SLACK_TOKEN_SECRET = "slack-oauth-token";
/** Kept across disconnects so reconnecting needs no setup. */
const SLACK_CLIENT_ID_SECRET = "slack-oauth-client-id";
const LOGIN_TIMEOUT = Duration.minutes(10);
const UNEXPECTED_STOP = "Slack sign-in stopped unexpectedly. Try again.";
const REVOKED = "Slack access was revoked or has expired. Reconnect Slack.";
const REFRESH_EARLY_MS = Duration.toMillis(Duration.minutes(5));
const TOKEN_URL = `${SLACK_API_URL}/oauth.v2.access`;
const REVOKED_REFRESH_ERRORS = new Set(["invalid_refresh_token", "invalid_grant", "token_revoked"]);

/** Without token rotation Slack issues no refresh token and the token never expires. */
const PersistedSlackToken = Schema.Struct({
  clientId: Schema.String,
  accessToken: Schema.String,
  refreshToken: Schema.NullOr(Schema.String),
  expiresAtEpochMs: Schema.NullOr(Schema.Number),
  account: SlackAccount,
});
type PersistedSlackToken = typeof PersistedSlackToken.Type;
const PersistedSlackTokenJson = Schema.fromJsonString(PersistedSlackToken);
const decodePersistedToken = Schema.decodeUnknownEffect(PersistedSlackTokenJson);
const encodePersistedToken = Schema.encodeEffect(PersistedSlackTokenJson);

const TokenFields = {
  access_token: Schema.optional(Schema.String),
  refresh_token: Schema.optional(Schema.String),
  expires_in: Schema.optional(Schema.Number),
};
// The code exchange puts the user token under `authed_user`; a refresh may put
// it there or at the top level, so both are read leniently.
const TokenResponse = Schema.Struct({
  ok: Schema.Boolean,
  error: Schema.optional(Schema.String),
  ...TokenFields,
  authed_user: Schema.optional(Schema.Struct(TokenFields)),
});
type TokenResponse = typeof TokenResponse.Type;

const AuthTestData = Schema.Struct({
  url: Schema.String,
  team: Schema.String,
  user: Schema.String,
  team_id: Schema.String,
  user_id: Schema.String,
});
const UserInfoData = Schema.Struct({
  user: Schema.Struct({
    name: Schema.String,
    real_name: Schema.optional(Schema.String),
    profile: Schema.optional(
      Schema.Struct({
        display_name: Schema.optional(Schema.String),
        real_name: Schema.optional(Schema.String),
      }),
    ),
  }),
});

const disconnectedState = (clientId: string | null): SlackConnectionState => ({
  phase: "disconnected",
  account: null,
  clientId,
  flowId: null,
  authorizationUrl: null,
  expiresAt: null,
  message: null,
});

const connectedState = (account: SlackAccount, clientId: string | null): SlackConnectionState => ({
  ...disconnectedState(clientId),
  phase: "connected",
  account,
});

const failedState = (message: string, clientId: string | null): SlackConnectionState => ({
  ...disconnectedState(clientId),
  phase: "failed",
  message,
});

interface ActiveFlow {
  readonly flowId: string;
  readonly state: string;
  readonly clientId: string;
  readonly callback: Deferred.Deferred<string, SlackError>;
  /** What to show again if the flow is cancelled. */
  readonly previous: SlackConnectionState;
}

const loginError = (detail: string, cause?: unknown) =>
  new SlackError({ reason: "login", detail, ...(cause === undefined ? {} : { cause }) });

/** The user token from an exchange or refresh reply, wherever Slack put it. */
function readUserToken(reply: TokenResponse) {
  const accessToken = reply.authed_user?.access_token ?? reply.access_token;
  if (accessToken === undefined) return null;
  const nested = reply.authed_user?.access_token !== undefined;
  const source = nested ? reply.authed_user : reply;
  return {
    accessToken,
    refreshToken: source?.refresh_token ?? null,
    expiresIn: source?.expires_in ?? null,
  };
}

export class SlackAuth extends Context.Service<
  SlackAuth,
  {
    readonly state: Stream.Stream<SlackConnectionState>;
    readonly startLogin: (
      input: SlackStartLoginInput,
    ) => Effect.Effect<SlackConnectionState, SlackError>;
    readonly completeLogin: (
      input: SlackCompleteLoginInput,
    ) => Effect.Effect<SlackConnectionState, SlackError>;
    readonly cancelLogin: (
      input: SlackCancelLoginInput,
    ) => Effect.Effect<SlackConnectionState, SlackError>;
    readonly disconnect: Effect.Effect<SlackConnectionState, SlackError>;
    /** A current access token, refreshed shortly before it expires when Slack rotates tokens. */
    readonly accessToken: Effect.Effect<string, SlackError>;
    /** The connected account, for the workspace a snapshot came from. */
    readonly account: Effect.Effect<SlackAccount, SlackError>;
    /** Drops the stored credential after Slack rejects it. */
    readonly markRevoked: Effect.Effect<void>;
  }
>()("t3/slack/SlackAuth") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const envClientId = yield* Config.String("T3CODE_SLACK_CLIENT_ID").pipe(Config.option);
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
    .get(SLACK_TOKEN_SECRET)
    .pipe(
      Effect.flatMap((bytes) =>
        Option.isNone(bytes)
          ? Effect.succeedNone
          : decodePersistedToken(new TextDecoder().decode(bytes.value)).pipe(Effect.asSome),
      ),
    );
  const persistToken = (token: PersistedSlackToken) =>
    encodePersistedToken(token).pipe(
      Effect.flatMap((encoded) =>
        secrets.set(SLACK_TOKEN_SECRET, new TextEncoder().encode(encoded)),
      ),
      Effect.mapError((cause) => loginError("Could not save the Slack credential.", cause)),
    );
  const removeToken = secrets.remove(SLACK_TOKEN_SECRET).pipe(Effect.ignore);

  /** The client ID to offer without input: the last one used, then the environment's. */
  const resolvedClientId = secrets.get(SLACK_CLIENT_ID_SECRET).pipe(
    Effect.map((bytes) =>
      Option.map(bytes, (value) => new TextDecoder().decode(value)).pipe(
        Option.filter((value) => value.length > 0),
        Option.orElse(() => envClientId),
        Option.getOrNull,
      ),
    ),
    Effect.orElseSucceed(() => Option.getOrNull(envClientId)),
  );

  const initial = yield* Effect.gen(function* () {
    const clientId = yield* resolvedClientId;
    const token = yield* readToken.pipe(Effect.orElseSucceed(() => Option.none()));
    return Option.isSome(token)
      ? connectedState(token.value.account, clientId)
      : disconnectedState(clientId);
  });
  const state = yield* SubscriptionRef.make<SlackConnectionState>(initial);

  const postToken = (params: Record<string, string>) =>
    Effect.gen(function* () {
      const response = yield* HttpClientRequest.post(TOKEN_URL).pipe(
        HttpClientRequest.bodyUrlParams(params),
        httpClient.execute,
      );
      const reply = yield* response.json.pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(TokenResponse)),
        Effect.orElseSucceed(() => null),
      );
      if (response.status < 200 || response.status >= 300 || reply === null) {
        return { _tag: "Rejected", error: reply?.error ?? `HTTP ${response.status}` } as const;
      }
      if (!reply.ok) return { _tag: "Rejected", error: reply.error ?? "unknown_error" } as const;
      const token = readUserToken(reply);
      return token === null
        ? ({ _tag: "Rejected", error: "no user token" } as const)
        : ({ _tag: "Ok", token } as const);
    });

  const expiresAt = (now: number, expiresIn: number | null) =>
    expiresIn === null ? null : now + expiresIn * 1_000;

  const readAccount = (accessToken: string) =>
    Effect.gen(function* () {
      const identity = yield* slackApiRequest(accessToken, "auth.test", {}, AuthTestData);
      // The display name is what Slack shows; auth.test only has the handle.
      const info = yield* slackApiRequest(
        accessToken,
        "users.info",
        { user: identity.user_id },
        UserInfoData,
      ).pipe(Effect.option);
      const user = Option.getOrUndefined(info)?.user;
      return {
        userId: identity.user_id,
        userName:
          user?.profile?.display_name ||
          user?.profile?.real_name ||
          user?.real_name ||
          identity.user,
        teamId: identity.team_id,
        teamName: identity.team,
        teamUrl: identity.url,
      } satisfies SlackAccount;
    }).pipe(Effect.provide(services));

  const exchangeCode = Effect.fn("slack.auth.exchange_code")(function* (
    code: string,
    verifier: string,
    clientId: string,
  ) {
    const result = yield* postToken({
      client_id: clientId,
      code,
      code_verifier: verifier,
      redirect_uri: SLACK_REDIRECT_URI,
    }).pipe(
      Effect.mapError((cause) => loginError("Could not reach Slack to finish sign-in.", cause)),
    );
    if (result._tag === "Rejected") {
      return yield* loginError(`Slack refused the sign-in (${result.error}).`);
    }
    const account = yield* readAccount(result.token.accessToken);
    const now = yield* Clock.currentTimeMillis;
    yield* persistToken({
      clientId,
      accessToken: result.token.accessToken,
      refreshToken: result.token.refreshToken,
      expiresAtEpochMs: expiresAt(now, result.token.expiresIn),
      account,
    });
    yield* secrets
      .set(SLACK_CLIENT_ID_SECRET, new TextEncoder().encode(clientId))
      .pipe(Effect.mapError((cause) => loginError("Could not save the Slack client ID.", cause)));
    return account;
  });

  const callbackRoute = (flow: ActiveFlow) =>
    HttpRouter.add(
      "GET",
      "/callback",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const result = readSlackCallback(
          new URL(request.originalUrl, SLACK_REDIRECT_URI),
          flow.state,
        );
        switch (result._tag) {
          case "Invalid":
            return HttpServerResponse.text(result.reason, { status: 400 });
          case "Denied":
            yield* Deferred.fail(flow.callback, loginError("Slack sign-in was cancelled."));
            return HttpServerResponse.text("Slack sign-in was cancelled. You can close this tab.");
          case "Code":
            yield* Deferred.succeed(flow.callback, result.code);
            return HttpServerResponse.text("Slack connected. You can close this tab.");
        }
      }),
    );

  /**
   * Owns the loopback listener for one login. `listening` settles once the
   * port is bound (or failed to bind) so `startLogin` can report a busy port.
   */
  const runFlow = (
    flow: ActiveFlow,
    verifier: string,
    listening: Deferred.Deferred<void, SlackError>,
  ) =>
    Effect.scoped(
      Effect.gen(function* () {
        const listener = HttpRouter.serve(callbackRoute(flow), {
          disableListenLog: true,
          disableLogger: true,
        }).pipe(
          Layer.provide(
            NodeHttpServer.layer(NodeHttp.createServer, {
              host: "127.0.0.1",
              port: SLACK_LOOPBACK_PORT,
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
              `Port ${SLACK_LOOPBACK_PORT} is in use, so the Slack callback cannot be received. Free the port and try again.`,
              cause,
            ),
          ),
        );
        yield* Deferred.succeed(listening, undefined);
        const code = yield* Deferred.await(flow.callback).pipe(
          Effect.timeout(LOGIN_TIMEOUT),
          Effect.catchTags({
            TimeoutError: () => Effect.fail(loginError("Slack sign-in timed out. Start again.")),
          }),
        );
        return yield* exchangeCode(code, verifier, flow.clientId);
      }),
    ).pipe(
      Effect.matchEffect({
        onSuccess: (account) => SubscriptionRef.set(state, connectedState(account, flow.clientId)),
        onFailure: (error) =>
          Effect.andThen(
            Deferred.fail(listening, error),
            Effect.flatMap(resolvedClientId, (clientId) =>
              SubscriptionRef.set(state, failedState(error.detail, clientId)),
            ),
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
                : Effect.flatMap(resolvedClientId, (clientId) =>
                    SubscriptionRef.set(state, failedState(UNEXPECTED_STOP, clientId)),
                  ),
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
  }).pipe(Effect.mapError((cause) => loginError("Could not start Slack sign-in.", cause)));

  const startLogin = Effect.fn("slack.auth.start_login")(function* (input: SlackStartLoginInput) {
    const clientId = input.clientId ?? (yield* resolvedClientId);
    if (clientId === null) {
      return yield* new SlackError({
        reason: "not-configured",
        detail: "Add your Slack app's client ID in Settings → Integrations → Slack.",
      });
    }
    const interrupted = yield* clearFlow;
    const current = yield* SubscriptionRef.get(state);
    const previous = interrupted?.previous ?? current;
    const pkce = yield* makePkce;
    const flow: ActiveFlow = {
      flowId: pkce.flowId,
      state: pkce.state,
      clientId,
      callback: yield* Deferred.make<string, SlackError>(),
      previous,
    };
    const listening = yield* Deferred.make<void, SlackError>();
    yield* Ref.set(activeFlow, flow);
    yield* FiberHandle.run(flowHandle, runFlow(flow, pkce.verifier, listening));
    yield* Deferred.await(listening);
    const now = yield* Clock.currentTimeMillis;
    const waiting: SlackConnectionState = {
      ...previous,
      phase: "waiting",
      clientId,
      flowId: flow.flowId,
      authorizationUrl: buildSlackAuthorizeUrl({
        clientId,
        state: flow.state,
        challenge: pkce.challenge,
      }),
      expiresAt: DateTime.formatIso(DateTime.makeUnsafe(now + Duration.toMillis(LOGIN_TIMEOUT))),
      message: null,
    };
    yield* SubscriptionRef.set(state, waiting);
    return waiting;
  });

  const requireFlow = (flowId: string) =>
    Ref.get(activeFlow).pipe(
      Effect.filterOrFail(
        (flow): flow is ActiveFlow => flow !== null && flow.flowId === flowId,
        () => loginError("This Slack sign-in is no longer active. Start again."),
      ),
    );

  const completeLogin = Effect.fn("slack.auth.complete_login")(function* (
    input: SlackCompleteLoginInput,
  ) {
    const flow = yield* requireFlow(input.flowId);
    const result = readPastedSlackCallback(input.callbackUrl, flow.state);
    switch (result._tag) {
      case "Invalid":
        return yield* loginError(result.reason);
      case "Denied":
        yield* Deferred.fail(flow.callback, loginError("Slack sign-in was cancelled."));
        break;
      case "Code":
        yield* Deferred.succeed(flow.callback, result.code);
        break;
    }
    return yield* SubscriptionRef.get(state);
  });

  const cancelLogin = Effect.fn("slack.auth.cancel_login")(function* (
    input: SlackCancelLoginInput,
  ) {
    const flow = yield* requireFlow(input.flowId);
    yield* clearFlow;
    yield* SubscriptionRef.set(state, flow.previous);
    return flow.previous;
  });

  const revoke = (token: PersistedSlackToken) =>
    HttpClientRequest.post(`${SLACK_API_URL}/auth.revoke`).pipe(
      HttpClientRequest.bearerToken(token.accessToken),
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
        const disconnected = disconnectedState(yield* resolvedClientId);
        yield* SubscriptionRef.set(state, disconnected);
        return disconnected;
      }),
    )
    .pipe(Effect.withSpan("slack.auth.disconnect"));

  const markRevoked = tokenLock.withPermits(1)(
    Effect.gen(function* () {
      yield* removeToken;
      yield* SubscriptionRef.set(state, failedState(REVOKED, yield* resolvedClientId));
    }),
  );

  const storedToken = readToken.pipe(
    Effect.mapError(
      (cause) =>
        new SlackError({ reason: "api", detail: "Could not read the Slack credential.", cause }),
    ),
    Effect.flatMap((stored) =>
      Option.isSome(stored)
        ? Effect.succeed(stored.value)
        : Effect.fail(
            new SlackError({
              reason: "not-connected",
              detail: "Slack is not connected. Connect it in Settings → Integrations.",
            }),
          ),
    ),
  );

  const accessToken = tokenLock
    .withPermits(1)(
      Effect.gen(function* () {
        const token = yield* storedToken;
        const now = yield* Clock.currentTimeMillis;
        if (token.expiresAtEpochMs === null || token.expiresAtEpochMs - REFRESH_EARLY_MS > now) {
          return token.accessToken;
        }
        if (token.refreshToken === null) {
          return yield* new SlackError({ reason: "revoked", detail: REVOKED });
        }
        const result = yield* postToken({
          grant_type: "refresh_token",
          refresh_token: token.refreshToken,
          client_id: token.clientId,
        }).pipe(
          Effect.mapError(
            (cause) => new SlackError({ reason: "api", detail: "Could not reach Slack.", cause }),
          ),
        );
        if (result._tag === "Rejected") {
          return yield* REVOKED_REFRESH_ERRORS.has(result.error)
            ? new SlackError({ reason: "revoked", detail: REVOKED })
            : new SlackError({
                reason: "api",
                detail: `Slack could not refresh the credential (${result.error}).`,
              });
        }
        yield* persistToken({
          ...token,
          accessToken: result.token.accessToken,
          refreshToken: result.token.refreshToken ?? token.refreshToken,
          expiresAtEpochMs: expiresAt(now, result.token.expiresIn),
        });
        return result.token.accessToken;
      }),
    )
    .pipe(
      Effect.tapError((error) => (error.reason === "revoked" ? markRevoked : Effect.void)),
      Effect.withSpan("slack.auth.access_token"),
    );

  return SlackAuth.of({
    state: SubscriptionRef.changes(state),
    startLogin,
    completeLogin,
    cancelLogin,
    disconnect,
    accessToken,
    account: storedToken.pipe(Effect.map((token) => token.account)),
    markRevoked,
  });
});

export const layer = Layer.effect(SlackAuth, make);
