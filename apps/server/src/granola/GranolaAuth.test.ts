import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as TestClock from "effect/testing/TestClock";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as GranolaAuth from "./GranolaAuth.ts";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

function makeHarness(input: { readonly pendingPolls: number; readonly denied?: boolean }) {
  const secrets = new Map<string, Uint8Array>();
  const requests: Array<{ url: string; body: string; authorization: string | undefined }> = [];
  let polls = 0;
  const client = HttpClient.make((request) =>
    Effect.sync(() => {
      const body =
        request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "";
      requests.push({ url: request.url, body, authorization: request.headers.authorization });
      const reply = (status: number, value: unknown, contentType = "application/json") =>
        HttpClientResponse.fromWeb(
          request,
          new Response(typeof value === "string" ? value : encodeJson(value), {
            status,
            headers: { "content-type": contentType, "mcp-session-id": "session-1" },
          }),
        );
      if (request.url.endsWith("/oauth2/register")) return reply(201, { client_id: "client-1" });
      if (request.url.endsWith("/oauth2/device_authorization"))
        return reply(200, {
          device_code: "device-1",
          user_code: "ABCD-EFGH",
          verification_uri: "https://mcp-auth.granola.ai/device",
          verification_uri_complete: "https://mcp-auth.granola.ai/device?user_code=ABCD-EFGH",
          expires_in: 300,
          interval: 5,
        });
      if (request.url.endsWith("/oauth2/token")) {
        polls++;
        if (input.denied) return reply(400, { error: "access_denied" });
        if (polls <= input.pendingPolls) return reply(400, { error: "authorization_pending" });
        return reply(200, { access_token: "access-1", refresh_token: "refresh-1" });
      }
      // Granola's MCP server: initialize, the initialized notification, then the tool call.
      if (body.includes('"tools/call"'))
        return reply(
          200,
          `event: message\ndata: ${encodeJson({
            jsonrpc: "2.0",
            id: 2,
            result: {
              content: [
                {
                  type: "text",
                  text: encodeJson({
                    email: "ada@acme.com",
                    active_workspace: { display_name: "Acme" },
                  }),
                },
              ],
            },
          })}\n\n`,
          "text/event-stream",
        );
      if (body.includes('"initialize"'))
        return reply(200, { jsonrpc: "2.0", id: 1, result: { capabilities: {} } });
      return reply(202, "");
    }),
  );
  const layer = GranolaAuth.layer.pipe(
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
  return { layer, requests, secrets };
}

const firstStateWhere = (auth: GranolaAuth.GranolaAuth["Service"], phase: "connected" | "failed") =>
  auth.state.pipe(
    Stream.filter((state) => state.phase === phase),
    Stream.runHead,
  );

it.effect("signs in with a device code and labels the account", () => {
  const harness = makeHarness({ pendingPolls: 1 });
  return Effect.gen(function* () {
    const auth = yield* GranolaAuth.GranolaAuth;
    const waiting = yield* auth.startLogin;
    assert.strictEqual(waiting.phase, "waiting");
    assert.strictEqual(waiting.userCode, "ABCD-EFGH");
    assert.strictEqual(
      waiting.verificationUrl,
      "https://mcp-auth.granola.ai/device?user_code=ABCD-EFGH",
    );
    yield* TestClock.adjust("5 seconds");
    yield* TestClock.adjust("5 seconds");
    const connected = yield* firstStateWhere(auth, "connected");
    assert.deepStrictEqual(
      Option.map(connected, (state) => state.account),
      Option.some({ email: "ada@acme.com", workspaceName: "Acme" }),
    );
    assert.strictEqual(yield* auth.accessToken, "access-1");
    // The device request names the MCP server the token is for.
    const device = harness.requests.find((request) =>
      request.url.endsWith("/device_authorization"),
    );
    assert.include(device?.body ?? "", "resource=https%3A%2F%2Fmcp.granola.ai%2Fmcp");
    assert.strictEqual(
      new TextDecoder().decode(harness.secrets.get("granola-oauth-client")),
      "client-1",
    );
  }).pipe(Effect.provide(harness.layer));
});

it.effect("reports a denied sign-in", () => {
  const harness = makeHarness({ pendingPolls: 0, denied: true });
  return Effect.gen(function* () {
    const auth = yield* GranolaAuth.GranolaAuth;
    yield* auth.startLogin;
    yield* TestClock.adjust("5 seconds");
    const failed = yield* firstStateWhere(auth, "failed");
    assert.deepStrictEqual(
      Option.map(failed, (state) => state.message),
      Option.some("Granola sign-in was cancelled."),
    );
    assert.isFalse(harness.secrets.has("granola-oauth-token"));
  }).pipe(Effect.provide(harness.layer));
});

it.effect("cancelling restores the previous state and stops polling", () => {
  const harness = makeHarness({ pendingPolls: 0 });
  return Effect.gen(function* () {
    const auth = yield* GranolaAuth.GranolaAuth;
    const waiting = yield* auth.startLogin;
    const restored = yield* auth.cancelLogin({ flowId: waiting.flowId ?? "" });
    assert.strictEqual(restored.phase, "disconnected");
    yield* TestClock.adjust("10 seconds");
    assert.isFalse(harness.requests.some((request) => request.url.endsWith("/oauth2/token")));
  }).pipe(Effect.provide(harness.layer));
});
