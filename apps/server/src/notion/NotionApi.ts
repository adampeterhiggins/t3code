import {
  NotionError,
  NOTION_PAGE_MARKDOWN_MAX_CHARS,
  parseNotionPageId,
  type NotionGetPageInput,
  type NotionPageContext,
  type NotionSearchPagesInput,
  type NotionPageSummary,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import { NotionAuth } from "./NotionAuth.ts";

const RichText = Schema.Struct({ plain_text: Schema.String });
const Page = Schema.Struct({
  id: Schema.String,
  url: Schema.String,
  last_edited_time: Schema.String,
  properties: Schema.Record(
    Schema.String,
    Schema.Struct({ type: Schema.String, title: Schema.optional(Schema.Array(RichText)) }),
  ),
});
const Search = Schema.Struct({ results: Schema.Array(Page), has_more: Schema.Boolean });
const Markdown = Schema.Struct({ markdown: Schema.String, truncated: Schema.Boolean });
const summary = (page: typeof Page.Type): NotionPageSummary => ({
  id: page.id,
  url: page.url,
  updatedAt: page.last_edited_time,
  title:
    Object.values(page.properties)
      .find((property) => property.type === "title")
      ?.title?.map((text) => text.plain_text)
      .join("") || "Untitled",
});

export class NotionApi extends Context.Service<
  NotionApi,
  {
    readonly searchPages: (
      input: NotionSearchPagesInput,
    ) => Effect.Effect<{ pages: NotionPageSummary[]; hasMore: boolean }, NotionError>;
    readonly getPage: (input: NotionGetPageInput) => Effect.Effect<NotionPageContext, NotionError>;
  }
>()("t3/notion/NotionApi") {}

/** @public Canonical Effect service construction. */
export const make = Effect.gen(function* () {
  const auth = yield* NotionAuth;
  const client = yield* HttpClient.HttpClient;
  const request = Effect.fn("notion.api.request")(function* <S extends Schema.Top>(
    path: string,
    data: S,
    body?: Record<string, unknown>,
  ) {
    const execute = (token: string) =>
      (body === undefined
        ? HttpClientRequest.get(`https://api.notion.com/v1/${path}`)
        : HttpClientRequest.post(`https://api.notion.com/v1/${path}`).pipe(
            HttpClientRequest.bodyJsonUnsafe(body),
          )
      ).pipe(
        HttpClientRequest.bearerToken(token),
        HttpClientRequest.setHeader("Notion-Version", "2026-03-11"),
        client.execute,
        Effect.mapError(
          () => new NotionError({ reason: "api", detail: "Could not reach Notion." }),
        ),
      );
    const token = yield* auth.accessToken;
    let response = yield* execute(token);
    if (response.status === 401) response = yield* execute(yield* auth.refreshAccessToken(token));
    if (response.status === 401) {
      yield* auth.markRevoked;
      return yield* new NotionError({
        reason: "revoked",
        detail: "Reconnect Notion in Settings → Integrations.",
      });
    }
    if (response.status === 429)
      return yield* new NotionError({
        reason: "rate-limited",
        detail: "Notion's rate limit was reached. Try again shortly.",
      });
    if (response.status === 404 || response.status === 403)
      return yield* new NotionError({
        reason: "not-found",
        detail:
          "Notion cannot read this page. Share it with the connection and enable Read content.",
      });
    if (response.status < 200 || response.status >= 300)
      return yield* new NotionError({
        reason: "api",
        detail: `Notion returned HTTP ${response.status}.`,
      });
    return yield* response.json.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(data)),
      Effect.mapError(
        () => new NotionError({ reason: "api", detail: "Notion returned an unreadable response." }),
      ),
    );
  });
  const getPage = Effect.fn("notion.get_page")(function* (input: NotionGetPageInput) {
    const id = parseNotionPageId(input.id);
    if (id === null)
      return yield* new NotionError({
        reason: "not-found",
        detail: "Use a Notion page link or page ID.",
      });
    const page = yield* request(`pages/${id}`, Page);
    const content = yield* request(`pages/${id}/markdown`, Markdown);
    const note = "\n\n[Notion page content is incomplete or truncated.]";
    const incomplete =
      content.truncated || content.markdown.length > NOTION_PAGE_MARKDOWN_MAX_CHARS;
    return {
      ...summary(page),
      markdown: incomplete
        ? content.markdown.slice(0, NOTION_PAGE_MARKDOWN_MAX_CHARS - note.length) + note
        : content.markdown,
    };
  });
  const searchPages = Effect.fn("notion.search_pages")(function* (input: NotionSearchPagesInput) {
    const id = parseNotionPageId(input.query.trim());
    if (id !== null)
      return { pages: [summary(yield* request(`pages/${id}`, Page))], hasMore: false };
    const result = yield* request("search", Search, {
      query: input.query.trim(),
      filter: { property: "object", value: "page" },
      sort: { direction: "descending", timestamp: "last_edited_time" },
      page_size: 30,
    });
    return { pages: result.results.map(summary), hasMore: result.has_more };
  });
  return NotionApi.of({ getPage, searchPages });
});
export const layer = Layer.effect(NotionApi, make);
