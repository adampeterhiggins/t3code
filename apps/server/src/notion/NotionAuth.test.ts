import * as Schema from "effect/Schema";
import * as ConfigProvider from "effect/ConfigProvider";
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
import * as NotionAuth from "./NotionAuth.ts";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeParams = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.String)),
);
const SECRET = "notion-oauth-token";
const account = {
  workspaceName: "Acme",
  workspaceId: "acme",
};

interface RecordedRequest {
  readonly url: string;
  readonly params: Record<string, string> | null;
  readonly authorization: string | undefined;
}

function makeHarness(input: {
  readonly configured?: boolean;
  readonly stored?: { readonly refreshToken: string };
  readonly tokenReply?: { readonly status: number; readonly body: unknown };
}) {
  const secrets = new Map<string, Uint8Array>();
  if (input.stored) {
    secrets.set(
      SECRET,
      new TextEncoder().encode(encodeJson({ accessToken: "old-access", account, ...input.stored })),
    );
  }
  const requests: Array<RecordedRequest> = [];
  let refreshCount = 0;
  const reply = (request: HttpClientRequest.HttpClientRequest, status: number, body: unknown) =>
    HttpClientResponse.fromWeb(
      request,
      new Response(encodeJson(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
  const client = HttpClient.make((request) =>
    Effect.sync(() => {
      const params =
        request.body._tag === "Uint8Array"
          ? decodeParams(new TextDecoder().decode(request.body.body))
          : null;
      requests.push({ url: request.url, params, authorization: request.headers.authorization });
      if (request.url.endsWith("/oauth/token")) {
        if (input.tokenReply) return reply(request, input.tokenReply.status, input.tokenReply.body);
        refreshCount++;
        return reply(request, 200, {
          access_token: `access-${refreshCount}`,
          refresh_token: `refresh-${refreshCount}`,
          workspace_id: account.workspaceId,
          workspace_name: account.workspaceName,
        });
      }
      return reply(request, 200, {});
    }),
  );
  const layer = NotionAuth.layer.pipe(
    Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
    Layer.provide(
      Layer.mock(ServerSecretStore.ServerSecretStore)({
        get: (name) => Effect.sync(() => Option.fromNullishOr(secrets.get(name))),
        set: (name, value) => Effect.sync(() => void secrets.set(name, value)),
        remove: (name) => Effect.sync(() => void secrets.delete(name)),
      }),
    ),
    Layer.provide(NodeServices.layer),
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromEnv({
          env:
            input.configured === false
              ? {}
              : { T3CODE_NOTION_CLIENT_ID: "client", T3CODE_NOTION_CLIENT_SECRET: "secret" },
        }),
      ),
    ),
  );
  const storedToken = () => {
    const bytes = secrets.get(SECRET);
    return bytes === undefined ? null : JSON.parse(new TextDecoder().decode(bytes));
  };
  return { layer, requests, storedToken };
}

/** A browser-style request to the login's loopback listener, over a real socket. */
const requestLoopback = (path: string) =>
  HttpClient.get(`http://127.0.0.1:47833${path}`).pipe(
    Effect.map((response) => response.status),
    Effect.provide(FetchHttpClient.layer),
  );

const firstStateWhere = (
  auth: NotionAuth.NotionAuth["Service"],
  phase: "connected" | "failed" | "disconnected",
) =>
  auth.state.pipe(
    Stream.filter((state) => state.phase === phase),
    Stream.runHead,
  );

it.effect("finishes remote OAuth with a server-side client secret", () => {
  const harness = makeHarness({});
  return Effect.gen(function* () {
    const auth = yield* NotionAuth.NotionAuth;
    const waiting = yield* auth.startLogin;
    assert.strictEqual(waiting.phase, "waiting");
    const authorizationUrl = new URL(waiting.authorizationUrl ?? "");
    assert.strictEqual(authorizationUrl.searchParams.get("owner"), "user");
    const state = authorizationUrl.searchParams.get("state");
    yield* auth.completeLogin({
      flowId: waiting.flowId ?? "",
      callbackUrl: `http://localhost:47833/callback?code=the-code&state=${state}`,
    });
    const connected = yield* firstStateWhere(auth, "connected");
    assert.deepEqual(
      Option.map(connected, (value) => value.account),
      Option.some(account),
    );
    const exchange = harness.requests.find((request) => request.url.endsWith("/oauth/token"));
    assert.strictEqual(exchange?.params?.code, "the-code");
    assert.strictEqual(exchange?.authorization, `Basic ${btoa("client:secret")}`);
    assert.isUndefined(exchange?.params?.client_secret);
    assert.strictEqual(harness.storedToken()?.account.workspaceId, "acme");
  }).pipe(Effect.provide(harness.layer));
});

it.effect("can start another login after a finished one and after a cancelled one", () => {
  const harness = makeHarness({});
  return Effect.gen(function* () {
    const auth = yield* NotionAuth.NotionAuth;
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
    const auth = yield* NotionAuth.NotionAuth;
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

it.effect("rotates a rejected token once for concurrent callers", () => {
  const h = makeHarness({ stored: { refreshToken: "refresh-0" } });
  return Effect.gen(function* () {
    const auth = yield* NotionAuth.NotionAuth;
    const tokens = yield* Effect.all(
      [auth.refreshAccessToken("old-access"), auth.refreshAccessToken("old-access")],
      { concurrency: "unbounded" },
    );
    assert.deepStrictEqual(tokens, ["access-1", "access-1"]);
    assert.strictEqual(
      h.requests.filter((request) => request.url.endsWith("/oauth/token")).length,
      1,
    );
    assert.strictEqual(h.storedToken()?.refreshToken, "refresh-1");
    yield* auth.disconnect;
    assert.isNull(h.storedToken());
    assert.strictEqual(h.requests.at(-1)?.params?.token, "access-1");
  }).pipe(Effect.provide(h.layer));
});
it.effect("clears a revoked credential and reports reconnect", () => {
  const h = makeHarness({
    stored: { refreshToken: "refresh-0" },
    tokenReply: { status: 400, body: { error: "invalid_grant" } },
  });
  return Effect.gen(function* () {
    const auth = yield* NotionAuth.NotionAuth;
    const failure = yield* auth.refreshAccessToken("old-access").pipe(Effect.flip);
    assert.strictEqual(failure.reason, "revoked");
    assert.isNull(h.storedToken());
    const state = yield* firstStateWhere(auth, "failed");
    assert.strictEqual(Option.getOrThrow(state).authorizationUrl, null);
  }).pipe(Effect.provide(h.layer));
});

it.effect("reports missing OAuth setup before starting a login", () => {
  const h = makeHarness({ configured: false });
  return Effect.gen(function* () {
    const auth = yield* NotionAuth.NotionAuth;
    const initial = Option.getOrThrow(yield* auth.state.pipe(Stream.runHead));
    assert.isFalse(initial.configured);
    const error = yield* auth.startLogin.pipe(Effect.flip);
    assert.strictEqual(error.reason, "not-configured");
    assert.strictEqual(h.requests.length, 0);
  }).pipe(Effect.provide(h.layer));
});
