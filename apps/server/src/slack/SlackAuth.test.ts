import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as SlackAuth from "./SlackAuth.ts";

const TOKEN_SECRET = "slack-oauth-token";
const CLIENT_ID_SECRET = "slack-oauth-client-id";
const account = {
  userId: "U1",
  userName: "Ada",
  teamId: "T1",
  teamName: "Acme",
  teamUrl: "https://acme.slack.com/",
};

interface RecordedRequest {
  readonly url: string;
  readonly authorization: string | undefined;
  readonly params: URLSearchParams | null;
}

function makeHarness(input: {
  readonly env?: Record<string, string>;
  readonly clientId?: string;
  readonly stored?: {
    readonly refreshToken: string | null;
    readonly expiresAtEpochMs: number | null;
  };
  readonly tokenReply?: unknown;
}) {
  const encoder = new TextEncoder();
  const secrets = new Map<string, Uint8Array>();
  if (input.clientId) secrets.set(CLIENT_ID_SECRET, encoder.encode(input.clientId));
  if (input.stored) {
    secrets.set(
      TOKEN_SECRET,
      encoder.encode(
        JSON.stringify({
          clientId: "client-1",
          accessToken: "old-access",
          account,
          ...input.stored,
        }),
      ),
    );
  }
  const requests: Array<RecordedRequest> = [];
  const reply = (request: HttpClientRequest.HttpClientRequest, body: unknown) =>
    HttpClientResponse.fromWeb(
      request,
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  const client = HttpClient.make((request) =>
    Effect.sync(() => {
      const params =
        request.body._tag === "Uint8Array"
          ? new URLSearchParams(new TextDecoder().decode(request.body.body))
          : null;
      requests.push({ url: request.url, authorization: request.headers.authorization, params });
      const method = request.url.split("/").at(-1);
      switch (method) {
        case "oauth.v2.access":
          if (input.tokenReply) return reply(request, input.tokenReply);
          return params?.get("grant_type") === "refresh_token"
            ? reply(request, {
                ok: true,
                access_token: "xoxe-access-2",
                refresh_token: "refresh-2",
                expires_in: 43_200,
              })
            : reply(request, {
                ok: true,
                authed_user: { id: "U1", access_token: "xoxp-access" },
                team: { id: "T1", name: "Acme" },
              });
        case "auth.test":
          return reply(request, {
            ok: true,
            url: account.teamUrl,
            team: account.teamName,
            user: "ada",
            team_id: account.teamId,
            user_id: account.userId,
          });
        case "users.info":
          return reply(request, {
            ok: true,
            user: { name: "ada", profile: { display_name: "Ada" } },
          });
        default:
          return reply(request, { ok: true });
      }
    }),
  );
  const layer = SlackAuth.layer.pipe(
    Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
    Layer.provide(
      Layer.mock(ServerSecretStore.ServerSecretStore)({
        get: (name) => Effect.sync(() => Option.fromNullishOr(secrets.get(name))),
        set: (name, value) => Effect.sync(() => void secrets.set(name, value)),
        remove: (name) => Effect.sync(() => void secrets.delete(name)),
      }),
    ),
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: input.env ?? {} }))),
    Layer.provide(NodeServices.layer),
  );
  const readSecret = (name: string) => {
    const bytes = secrets.get(name);
    return bytes === undefined ? null : new TextDecoder().decode(bytes);
  };
  const storedToken = () => {
    const token = readSecret(TOKEN_SECRET);
    return token === null ? null : JSON.parse(token);
  };
  return { layer, requests, storedToken, readSecret };
}

const firstStateWhere = (
  auth: SlackAuth.SlackAuth["Service"],
  phase: "connected" | "failed" | "disconnected",
) =>
  auth.state.pipe(
    Stream.filter((state) => state.phase === phase),
    Stream.runHead,
  );

it.effect("asks for a client ID when none was given, saved, or configured", () => {
  const harness = makeHarness({});
  return Effect.gen(function* () {
    const auth = yield* SlackAuth.SlackAuth;
    const error = yield* Effect.flip(auth.startLogin({}));
    assert.strictEqual(error.reason, "not-configured");
  }).pipe(Effect.provide(harness.layer));
});

it.effect("falls back to T3CODE_SLACK_CLIENT_ID and reports it in the state", () => {
  const harness = makeHarness({ env: { T3CODE_SLACK_CLIENT_ID: "env-client" } });
  return Effect.gen(function* () {
    const auth = yield* SlackAuth.SlackAuth;
    const disconnected = yield* firstStateWhere(auth, "disconnected");
    assert.strictEqual(Option.getOrNull(disconnected)?.clientId, "env-client");
    const waiting = yield* auth.startLogin({});
    assert.strictEqual(
      new URL(waiting.authorizationUrl ?? "").searchParams.get("client_id"),
      "env-client",
    );
    yield* auth.cancelLogin({ flowId: waiting.flowId ?? "" });
  }).pipe(Effect.provide(harness.layer));
});

it.effect("finishes a login from a pasted redirect URL and remembers the client ID", () => {
  const harness = makeHarness({});
  return Effect.gen(function* () {
    const auth = yield* SlackAuth.SlackAuth;
    const waiting = yield* auth.startLogin({ clientId: "client-1" });
    assert.strictEqual(waiting.phase, "waiting");
    const state = new URL(waiting.authorizationUrl ?? "").searchParams.get("state");
    yield* auth.completeLogin({
      flowId: waiting.flowId ?? "",
      callbackUrl: `http://localhost:47832/callback?code=the-code&state=${state}`,
    });
    const connected = Option.getOrNull(yield* firstStateWhere(auth, "connected"));
    assert.deepEqual(connected?.account, account);
    assert.strictEqual(connected?.clientId, "client-1");
    const exchange = harness.requests.find((request) => request.url.endsWith("/oauth.v2.access"));
    assert.strictEqual(exchange?.params?.get("client_id"), "client-1");
    assert.strictEqual(exchange?.params?.get("code"), "the-code");
    assert.isTrue(exchange?.params?.has("code_verifier"));
    assert.isFalse(exchange?.params?.has("client_secret"));
    assert.deepEqual(harness.storedToken(), {
      clientId: "client-1",
      accessToken: "xoxp-access",
      refreshToken: null,
      expiresAtEpochMs: null,
      account,
    });
    assert.strictEqual(harness.readSecret("slack-oauth-client-id"), "client-1");
    // Without rotation the token never expires, so no refresh happens.
    assert.strictEqual(yield* auth.accessToken, "xoxp-access");
  }).pipe(Effect.provide(harness.layer));
});

it.effect("revokes the token on disconnect but keeps the client ID for reconnecting", () => {
  const harness = makeHarness({
    clientId: "client-1",
    stored: { refreshToken: null, expiresAtEpochMs: null },
  });
  return Effect.gen(function* () {
    const auth = yield* SlackAuth.SlackAuth;
    const state = yield* auth.disconnect;
    assert.strictEqual(state.phase, "disconnected");
    assert.strictEqual(state.clientId, "client-1");
    assert.isNull(harness.storedToken());
    assert.strictEqual(harness.readSecret("slack-oauth-client-id"), "client-1");
    const revoke = harness.requests.find((request) => request.url.endsWith("/auth.revoke"));
    assert.strictEqual(revoke?.authorization, "Bearer old-access");
  }).pipe(Effect.provide(harness.layer));
});

it.effect("refreshes an expiring rotated token with the client ID it was issued to", () => {
  const harness = makeHarness({ stored: { refreshToken: "refresh-1", expiresAtEpochMs: 0 } });
  return Effect.gen(function* () {
    const auth = yield* SlackAuth.SlackAuth;
    assert.strictEqual(yield* auth.accessToken, "xoxe-access-2");
    const refresh = harness.requests.find((request) => request.url.endsWith("/oauth.v2.access"));
    assert.strictEqual(refresh?.params?.get("grant_type"), "refresh_token");
    assert.strictEqual(refresh?.params?.get("refresh_token"), "refresh-1");
    assert.strictEqual(refresh?.params?.get("client_id"), "client-1");
    assert.strictEqual(harness.storedToken()?.refreshToken, "refresh-2");
    assert.isAbove(harness.storedToken()?.expiresAtEpochMs, 0);
  }).pipe(Effect.provide(harness.layer));
});

it.effect("drops the credential when Slack rejects the refresh token", () => {
  const harness = makeHarness({
    stored: { refreshToken: "refresh-1", expiresAtEpochMs: 0 },
    tokenReply: { ok: false, error: "invalid_refresh_token" },
  });
  return Effect.gen(function* () {
    const auth = yield* SlackAuth.SlackAuth;
    const error = yield* Effect.flip(auth.accessToken);
    assert.strictEqual(error.reason, "revoked");
    assert.isNull(harness.storedToken());
    assert.isTrue(Option.isSome(yield* firstStateWhere(auth, "failed")));
  }).pipe(Effect.provide(harness.layer));
});

it.effect("receives a remote callback with the same registered URI used for exchange", () => {
  const redirectUri = "https://t3.example.test/oauth/slack/callback";
  const harness = makeHarness({
    env: { T3CODE_SLACK_REDIRECT_URI: redirectUri },
    clientId: "client",
  });
  return Effect.gen(function* () {
    const auth = yield* SlackAuth.SlackAuth;
    const waiting = yield* auth.startLogin({});
    const authorize = new URL(waiting.authorizationUrl ?? "");
    assert.strictEqual(authorize.searchParams.get("redirect_uri"), redirectUri);
    const state = authorize.searchParams.get("state");
    assert.strictEqual(
      (yield* auth.receiveCallback(new URL(`${redirectUri}?code=bad&state=wrong`))).status,
      400,
    );
    assert.strictEqual(harness.requests.length, 0);
    assert.strictEqual(
      (yield* auth.receiveCallback(new URL(`${redirectUri}?code=remote-code&state=${state}`)))
        .status,
      200,
    );
    yield* firstStateWhere(auth, "connected");
    const exchange = harness.requests.find((request) => request.url.endsWith("/oauth.v2.access"));
    assert.strictEqual(exchange?.params?.get("redirect_uri"), redirectUri);
    assert.strictEqual(
      (yield* auth.receiveCallback(new URL(`${redirectUri}?code=remote-code&state=${state}`)))
        .status,
      400,
    );
    assert.isNotNull(harness.storedToken());
  }).pipe(Effect.provide(harness.layer));
});

it.effect("does not accept a cancelled remote callback", () => {
  const redirectUri = "https://t3.example.test/oauth/slack/callback";
  const harness = makeHarness({
    env: { T3CODE_SLACK_REDIRECT_URI: redirectUri },
    clientId: "client",
  });
  return Effect.gen(function* () {
    const auth = yield* SlackAuth.SlackAuth;
    const waiting = yield* auth.startLogin({});
    const state = new URL(waiting.authorizationUrl ?? "").searchParams.get("state");
    yield* auth.cancelLogin({ flowId: waiting.flowId ?? "" });
    assert.strictEqual(
      (yield* auth.receiveCallback(new URL(`${redirectUri}?code=late&state=${state}`))).status,
      400,
    );
    assert.strictEqual(harness.requests.length, 0);
  }).pipe(Effect.provide(harness.layer));
});
