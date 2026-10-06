import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as HttpRouter from "effect/http/HttpRouter";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as LinearAuth from "./LinearAuth.ts";

const SECRET = "linear-oauth-token";
const account = {
  name: "Ada",
  email: "ada@example.test",
  workspaceName: "Acme",
  workspaceUrlKey: "acme",
};

interface RecordedRequest {
  readonly url: string;
  readonly params: URLSearchParams | null;
}

function makeHarness(input: {
  readonly stored?: { readonly refreshToken: string; readonly expiresAtEpochMs: number };
  readonly tokenReply?: { readonly status: number; readonly body: unknown };
}) {
  const secrets = new Map<string, Uint8Array>();
  if (input.stored) {
    secrets.set(
      SECRET,
      new TextEncoder().encode(
        JSON.stringify({ accessToken: "old-access", account, ...input.stored }),
      ),
    );
  }
  const requests: Array<RecordedRequest> = [];
  let refreshCount = 0;
  const reply = (request: HttpClientRequest.HttpClientRequest, status: number, body: unknown) =>
    HttpClientResponse.fromWeb(
      request,
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
  const client = HttpClient.make((request) =>
    Effect.sync(() => {
      const params =
        request.body._tag === "Uint8Array"
          ? new URLSearchParams(new TextDecoder().decode(request.body.body))
          : null;
      requests.push({ url: request.url, params });
      if (request.url.endsWith("/oauth/token")) {
        if (input.tokenReply) return reply(request, input.tokenReply.status, input.tokenReply.body);
        refreshCount++;
        return reply(request, 200, {
          access_token: `access-${refreshCount}`,
          refresh_token: `refresh-${refreshCount}`,
          expires_in: 86_399,
        });
      }
      if (request.url.endsWith("/graphql")) {
        return reply(request, 200, {
          data: {
            viewer: {
              name: account.name,
              email: account.email,
              organization: { name: account.workspaceName, urlKey: account.workspaceUrlKey },
            },
          },
        });
      }
      return reply(request, 200, {});
    }),
  );
  const layer = LinearAuth.layer.pipe(
    Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
    Layer.provide(
      Layer.mock(ServerSecretStore.ServerSecretStore)({
        get: (name) => Effect.sync(() => Option.fromNullishOr(secrets.get(name))),
        set: (name, value) => Effect.sync(() => void secrets.set(name, value)),
        remove: (name) => Effect.sync(() => void secrets.delete(name)),
      }),
    ),
    Layer.provide(NodeServices.layer),
  );
  const storedToken = () => {
    const bytes = secrets.get(SECRET);
    return bytes === undefined ? null : JSON.parse(new TextDecoder().decode(bytes));
  };
  return { layer, requests, storedToken };
}

/** A browser-style request to the login's loopback listener, over a real socket. */
const requestLoopback = (path: string) =>
  HttpClient.get(`http://127.0.0.1:47831${path}`).pipe(
    Effect.map((response) => response.status),
    Effect.provide(FetchHttpClient.layer),
  );

const firstStateWhere = (
  auth: LinearAuth.LinearAuth["Service"],
  phase: "connected" | "failed" | "disconnected",
) =>
  auth.state.pipe(
    Stream.filter((state) => state.phase === phase),
    Stream.runHead,
  );

it.effect(
  "refreshes an expiring token once for concurrent callers and stores the rotated one",
  () => {
    const harness = makeHarness({ stored: { refreshToken: "refresh-0", expiresAtEpochMs: 0 } });
    return Effect.gen(function* () {
      const auth = yield* LinearAuth.LinearAuth;
      const tokens = yield* Effect.all([auth.accessToken, auth.accessToken, auth.accessToken], {
        concurrency: "unbounded",
      });
      assert.deepEqual(tokens, ["access-1", "access-1", "access-1"]);
      const refreshes = harness.requests.filter((request) => request.url.endsWith("/oauth/token"));
      assert.strictEqual(refreshes.length, 1);
      assert.strictEqual(refreshes[0]?.params?.get("refresh_token"), "refresh-0");
      assert.isFalse(refreshes[0]?.params?.has("client_secret"));
      assert.strictEqual(harness.storedToken()?.refreshToken, "refresh-1");
    }).pipe(Effect.provide(harness.layer));
  },
);

it.effect("drops the credential and asks to reconnect when Linear rejects the refresh", () => {
  const harness = makeHarness({
    stored: { refreshToken: "refresh-0", expiresAtEpochMs: 0 },
    tokenReply: { status: 400, body: { error: "invalid_grant" } },
  });
  return Effect.gen(function* () {
    const auth = yield* LinearAuth.LinearAuth;
    const error = yield* Effect.flip(auth.accessToken);
    assert.strictEqual(error.reason, "revoked");
    assert.isNull(harness.storedToken());
    const state = yield* firstStateWhere(auth, "failed");
    assert.isTrue(Option.isSome(state));
  }).pipe(Effect.provide(harness.layer));
});

it.effect("revokes the refresh token and forgets the account on disconnect", () => {
  const harness = makeHarness({
    stored: { refreshToken: "refresh-0", expiresAtEpochMs: Number.MAX_SAFE_INTEGER },
  });
  return Effect.gen(function* () {
    const auth = yield* LinearAuth.LinearAuth;
    const connected = yield* firstStateWhere(auth, "connected");
    assert.deepEqual(
      Option.map(connected, (state) => state.account),
      Option.some(account),
    );
    const state = yield* auth.disconnect;
    assert.strictEqual(state.phase, "disconnected");
    assert.isNull(harness.storedToken());
    const revoke = harness.requests.find((request) => request.url.endsWith("/oauth/revoke"));
    assert.strictEqual(revoke?.params?.get("token"), "refresh-0");
  }).pipe(Effect.provide(harness.layer));
});

it.effect("finishes a login from a pasted redirect URL without a client secret", () => {
  const harness = makeHarness({});
  return Effect.gen(function* () {
    const auth = yield* LinearAuth.LinearAuth;
    const waiting = yield* auth.startLogin;
    assert.strictEqual(waiting.phase, "waiting");
    const authorizationUrl = new URL(waiting.authorizationUrl ?? "");
    assert.strictEqual(authorizationUrl.searchParams.get("code_challenge_method"), "S256");
    const state = authorizationUrl.searchParams.get("state");
    yield* auth.completeLogin({
      flowId: waiting.flowId ?? "",
      callbackUrl: `http://127.0.0.1:47831/callback?code=the-code&state=${state}`,
    });
    const connected = yield* firstStateWhere(auth, "connected");
    assert.deepEqual(
      Option.map(connected, (value) => value.account),
      Option.some(account),
    );
    const exchange = harness.requests.find((request) => request.url.endsWith("/oauth/token"));
    assert.strictEqual(exchange?.params?.get("code"), "the-code");
    assert.isTrue(exchange?.params?.has("code_verifier"));
    assert.isFalse(exchange?.params?.has("client_secret"));
    assert.strictEqual(harness.storedToken()?.account.workspaceUrlKey, "acme");
  }).pipe(Effect.provide(harness.layer));
});

it.effect("can start another login after a finished one and after a cancelled one", () => {
  const harness = makeHarness({});
  return Effect.gen(function* () {
    const auth = yield* LinearAuth.LinearAuth;
    const first = yield* auth.startLogin;
    const state = new URL(first.authorizationUrl ?? "").searchParams.get("state");
    // A real browser redirect, over a kept-alive connection like a browser's.
    assert.strictEqual(yield* requestLoopback(`/callback?code=the-code&state=${state}`), 200);
    yield* firstStateWhere(auth, "connected");
    yield* auth.disconnect;
    const second = yield* auth.startLogin.pipe(Effect.timeout("5 seconds"));
    assert.strictEqual(second.phase, "waiting");
    yield* auth.cancelLogin({ flowId: second.flowId ?? "" });
    const third = yield* auth.startLogin.pipe(Effect.timeout("5 seconds"));
    assert.strictEqual(third.phase, "waiting");
  }).pipe(Effect.provide(harness.layer));
});

it.effect("keeps its callback listener apart from a router the host server already built", () => {
  const harness = makeHarness({});
  return Effect.gen(function* () {
    const auth = yield* LinearAuth.LinearAuth;
    // Inside the real server, requests run with the app's memo map, which
    // already holds the app's own HttpRouter.
    const memoMap = yield* Layer.makeMemoMap;
    yield* Layer.buildWithMemoMap(HttpRouter.layer, memoMap, yield* Effect.scope);
    const inHost = <A, E>(effect: Effect.Effect<A, E>) =>
      effect.pipe(Effect.provideService(Layer.CurrentMemoMap, memoMap));
    const first = yield* inHost(auth.startLogin);
    yield* inHost(auth.cancelLogin({ flowId: first.flowId ?? "" }));
    const second = yield* inHost(auth.startLogin).pipe(Effect.timeout("5 seconds"));
    assert.strictEqual(second.phase, "waiting");
    assert.strictEqual(yield* requestLoopback("/api/auth/session"), 404);
  }).pipe(Effect.scoped, Effect.provide(harness.layer));
});
