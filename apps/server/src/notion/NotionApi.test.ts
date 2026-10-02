import * as Schema from "effect/Schema";
import { assert, it } from "@effect/vitest";
import { NOTION_PAGE_MARKDOWN_MAX_CHARS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import * as NotionApi from "./NotionApi.ts";
import { NotionAuth } from "./NotionAuth.ts";
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeSearchBody = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({ filter: Schema.Struct({ property: Schema.String, value: Schema.String }) }),
  ),
);
const id = "914a8531-daa8-4753-aacd-f01274df8ec5";
const page = {
  id,
  url: `https://notion.so/${id}`,
  last_edited_time: "2026-10-02T00:00:00.000Z",
  properties: {
    Name: { type: "title", title: [{ plain_text: "Design" }] },
    Status: { type: "status" },
  },
};
function harness(
  options: {
    markdown?: string;
    truncated?: boolean;
    status?: number;
    rejectOldToken?: boolean;
  } = {},
) {
  const requests: Array<{ url: string; authorization: string | undefined; body: string | null }> =
    [];
  let refreshes = 0;
  const client = HttpClient.make((request) =>
    Effect.sync(() => {
      requests.push({
        url: request.url,
        authorization: request.headers.authorization,
        body:
          request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : null,
      });
      const status =
        options.rejectOldToken && request.headers.authorization === "Bearer old"
          ? 401
          : (options.status ?? 200);
      const body = request.url.endsWith("/search")
        ? { results: [page], has_more: true }
        : request.url.endsWith("/markdown")
          ? {
              markdown: options.markdown ?? "# Design\n\nNested content",
              truncated: options.truncated ?? false,
            }
          : page;
      return HttpClientResponse.fromWeb(
        request,
        new Response(encodeJson(body), {
          status,
          headers: { "content-type": "application/json" },
        }),
      );
    }),
  );
  const layer = NotionApi.layer.pipe(
    Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
    Layer.provide(
      Layer.mock(NotionAuth)({
        accessToken: Effect.succeed("old"),
        refreshAccessToken: () =>
          Effect.sync(() => {
            refreshes++;
            return "new";
          }),
        markRevoked: Effect.void,
      }),
    ),
  );
  return { layer, requests, refreshes: () => refreshes };
}
it.effect("searches accessible pages by title and looks up pasted page links directly", () => {
  const h = harness();
  return Effect.gen(function* () {
    const api = yield* NotionApi.NotionApi;
    const found = yield* api.searchPages({ query: "Design" });
    assert.strictEqual(found.pages[0]?.title, "Design");
    assert.strictEqual(found.hasMore, true);
    assert.deepStrictEqual(decodeSearchBody(h.requests[0]?.body ?? "{}").filter, {
      property: "object",
      value: "page",
    });
    yield* api.searchPages({ query: page.url });
    assert.strictEqual(h.requests[1]?.url, `https://api.notion.com/v1/pages/${id}`);
  }).pipe(Effect.provide(h.layer));
});
it.effect("snapshots markdown, refreshes a rejected token and bounds incomplete pages", () => {
  const h = harness({
    markdown: "x".repeat(NOTION_PAGE_MARKDOWN_MAX_CHARS + 1),
    rejectOldToken: true,
  });
  return Effect.gen(function* () {
    const api = yield* NotionApi.NotionApi;
    const result = yield* api.getPage({ id });
    assert.strictEqual(result.markdown.length, NOTION_PAGE_MARKDOWN_MAX_CHARS);
    assert.include(result.markdown, "incomplete or truncated");
    assert.strictEqual(h.refreshes(), 2);
    assert.strictEqual(h.requests[1]?.authorization, "Bearer new");
  }).pipe(Effect.provide(h.layer));
});
it.effect("marks incomplete Notion responses even below the snapshot size cap", () => {
  const h = harness({ truncated: true });
  return Effect.gen(function* () {
    const result = yield* (yield* NotionApi.NotionApi).getPage({ id });
    assert.include(result.markdown, "Nested content");
    assert.include(result.markdown, "incomplete or truncated");
  }).pipe(Effect.provide(h.layer));
});
for (const [status, reason] of [
  [404, "not-found"],
  [403, "not-found"],
  [429, "rate-limited"],
] as const) {
  it.effect(`reports HTTP ${status} without attaching empty content`, () => {
    const h = harness({ status });
    return Effect.gen(function* () {
      const failure = yield* (yield* NotionApi.NotionApi).getPage({ id }).pipe(Effect.flip);
      assert.strictEqual(failure.reason, reason);
    }).pipe(Effect.provide(h.layer));
  });
}
