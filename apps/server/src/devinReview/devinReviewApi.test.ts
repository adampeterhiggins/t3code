import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as UrlParams from "effect/http/UrlParams";

import { devinCliToken, devinPrReviewRequest, devinSelf } from "./devinReviewApi.ts";

const credentials = { method: "service-key", apiKey: "cog_test", orgId: "org-acme" } as const;
const ref = { repository: "acme/app", number: 7 };

const replying = (status: number, body: unknown, seen: Array<string> = []) =>
  HttpClient.make((request) =>
    Effect.sync(() => {
      seen.push(
        `${request.method} ${request.url}?${UrlParams.toString(request.urlParams)} ${request.headers.authorization}`,
      );
      return HttpClientResponse.fromWeb(
        request,
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/problem+json" },
        }),
      );
    }),
  );

const call = (method: "GET" | "POST", client: HttpClient.HttpClient) =>
  devinPrReviewRequest(credentials, method, ref).pipe(
    Effect.provideService(HttpClient.HttpClient, client),
  );

it.effect("reads a review's status, and none when Devin has no review of the head commit", () =>
  Effect.gen(function* () {
    const seen: Array<string> = [];
    const review = yield* call(
      "GET",
      replying(
        200,
        {
          status: "running",
          repo_path: "github.com/acme/app",
          pr_number: 7,
          commit_sha: "abc",
          created_at: "2026-11-01T00:00:00Z",
        },
        seen,
      ),
    );
    assert.deepStrictEqual(review, {
      status: "running",
      commit_sha: "abc",
      created_at: "2026-11-01T00:00:00Z",
    });
    assert.deepStrictEqual(seen, [
      "GET https://api.devin.ai/v3/organizations/org-acme/pr-reviews?pr_url=https%3A%2F%2Fgithub.com%2Facme%2Fapp%2Fpull%2F7 Bearer cog_test",
    ]);
    assert.isNull(yield* call("GET", replying(404, { title: "Not Found", status: 404 })));
  }),
);

it.effect("maps Devin's problem responses to error reasons", () =>
  Effect.gen(function* () {
    const reason = (method: "GET" | "POST", status: number, detail: string) =>
      call(method, replying(status, { title: "Error", status, detail })).pipe(
        Effect.flip,
        Effect.map((error) => error.reason),
      );
    assert.deepStrictEqual(
      [
        yield* reason("GET", 401, "Unauthorized"),
        // Devin answers an unknown key with 403 Unauthorized.
        yield* reason("GET", 403, "Unauthorized"),
        yield* reason("POST", 403, "Missing permission UseReviewManual"),
        yield* reason("GET", 429, "Slow down"),
        yield* reason("POST", 404, "Repository not found"),
        yield* reason("GET", 422, "Invalid pr_url"),
      ],
      ["revoked", "revoked", "forbidden", "rate-limited", "not-found", "api"],
    );
  }),
);

it.effect("reads who a Devin token belongs to, and null for a token Devin refuses", () =>
  Effect.gen(function* () {
    const self = (status: number, body: unknown) =>
      devinSelf("devin-session-token$x").pipe(
        Effect.provideService(HttpClient.HttpClient, replying(status, body)),
      );
    assert.deepStrictEqual(yield* self(200, { org_id: "org-acme", user_name: "ada" }), {
      orgId: "org-acme",
      userName: "ada",
    });
    assert.strictEqual(yield* self(403, { detail: "Unauthorized" }), null);
    assert.strictEqual(yield* self(401, {}), null);
  }),
);

it("reads the login token from the Devin CLI's credentials file", () => {
  assert.strictEqual(
    devinCliToken('windsurf_api_key = "devin-session-token$abc"\napi_server_url = "x"\n'),
    "devin-session-token$abc",
  );
  assert.strictEqual(devinCliToken('api_server_url = "x"\n'), null);
});
