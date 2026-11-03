import {
  NotionError,
  NOTION_PAGE_MARKDOWN_MAX_CHARS,
  parseNotionBlockId,
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
import * as HttpClient from "effect/http/HttpClient";
import type * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { NotionAuth } from "./NotionAuth.ts";

const RichText = Schema.Struct({ plain_text: Schema.String });
const SelectOption = Schema.Struct({ name: Schema.String });
const Page = Schema.Struct({
  id: Schema.String,
  url: Schema.String,
  last_edited_time: Schema.String,
  properties: Schema.Record(
    Schema.String,
    Schema.Struct({
      type: Schema.String,
      title: Schema.optional(Schema.Array(RichText)),
      select: Schema.optional(Schema.NullOr(SelectOption)),
      status: Schema.optional(Schema.NullOr(SelectOption)),
      multi_select: Schema.optional(Schema.Array(SelectOption)),
    }),
  ),
});
const Database = Schema.Struct({
  id: Schema.String,
  url: Schema.String,
  last_edited_time: Schema.String,
  title: Schema.Array(RichText),
  description: Schema.optional(Schema.Array(RichText)),
  data_sources: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })),
});
const Search = Schema.Struct({ results: Schema.Array(Page), has_more: Schema.Boolean });
const Markdown = Schema.Struct({ markdown: Schema.String, truncated: Schema.Boolean });
// Every block type that holds text keeps it in `<type>.rich_text`.
const Block = Schema.Record(Schema.String, Schema.Unknown);
const decodeBlockText = Schema.decodeUnknownOption(
  Schema.Struct({ rich_text: Schema.Array(RichText) }),
);
const blockText = (block: typeof Block.Type) => {
  const type = typeof block.type === "string" ? block.type : "";
  const text = decodeBlockText(block[type]);
  return text._tag === "Some" ? text.value.rich_text.map((part) => part.plain_text).join("") : "";
};
const plainText = (text: ReadonlyArray<typeof RichText.Type> | undefined) =>
  text?.map((part) => part.plain_text).join("") ?? "";
const pageTitle = (page: typeof Page.Type) =>
  plainText(Object.values(page.properties).find((property) => property.type === "title")?.title) ||
  "Untitled";
const summary = (page: typeof Page.Type): NotionPageSummary => ({
  id: page.id,
  url: page.url,
  updatedAt: page.last_edited_time,
  title: pageTitle(page),
});
const databaseSummary = (database: typeof Database.Type): NotionPageSummary => ({
  id: database.id,
  url: database.url,
  updatedAt: database.last_edited_time,
  title: plainText(database.title) || "Untitled",
});
const DATABASE_ROW_LIMIT = 100;
const rowLine = (row: typeof Page.Type) => {
  const fields = Object.entries(row.properties).flatMap(([name, property]) => {
    const values =
      property.multi_select?.map((option) => option.name) ??
      [property.select?.name ?? property.status?.name].filter((value) => value !== undefined);
    return values.length > 0 ? [`${name}: ${values.join(", ")}`] : [];
  });
  return [`- [${pageTitle(row)}](${row.url})`, ...fields].join(" · ");
};

export class NotionApi extends Context.Service<
  NotionApi,
  {
    readonly searchPages: (
      input: NotionSearchPagesInput,
    ) => Effect.Effect<{ pages: NotionPageSummary[]; hasMore: boolean }, NotionError>;
    /** A page's Markdown, or a database's rows as a Markdown list. */
    readonly getPage: (input: NotionGetPageInput) => Effect.Effect<NotionPageContext, NotionError>;
    /** The page's or database's title and link, without reading its content. */
    readonly getPageSummary: (
      input: NotionGetPageInput,
    ) => Effect.Effect<NotionPageSummary, NotionError>;
  }
>()("t3/notion/NotionApi") {}

/** @public Canonical Effect service construction. */
export const make = Effect.gen(function* () {
  const auth = yield* NotionAuth;
  const client = yield* HttpClient.HttpClient;
  const send = Effect.fn("notion.api.send")(function* (
    path: string,
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
    return response;
  });
  const decode = Effect.fn("notion.api.decode")(function* <S extends Schema.Top>(
    response: HttpClientResponse.HttpClientResponse,
    data: S,
  ) {
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
  const request = <S extends Schema.Top>(path: string, data: S, body?: Record<string, unknown>) =>
    send(path, body).pipe(Effect.flatMap((response) => decode(response, data)));
  const pageId = (value: string) => {
    const id = parseNotionPageId(value);
    return id === null
      ? Effect.fail(
          new NotionError({ reason: "not-found", detail: "Use a Notion page link or page ID." }),
        )
      : Effect.succeed(id);
  };
  // Database links share page link syntax; Notion answers them on `pages/` with HTTP 400.
  const retrieve = Effect.fn("notion.retrieve")(function* (id: string) {
    const response = yield* send(`pages/${id}`);
    return response.status === 400
      ? { kind: "database" as const, database: yield* request(`databases/${id}`, Database) }
      : { kind: "page" as const, page: yield* decode(response, Page) };
  });
  const retrieveSummary = (id: string) =>
    retrieve(id).pipe(
      Effect.map((found) =>
        found.kind === "page" ? summary(found.page) : databaseSummary(found.database),
      ),
    );
  const databaseMarkdown = Effect.fn("notion.database_markdown")(function* (
    database: typeof Database.Type,
  ) {
    const sources = yield* Effect.forEach(database.data_sources, (source) =>
      request(`data_sources/${source.id}/query`, Search, {
        page_size: DATABASE_ROW_LIMIT,
        sorts: [{ timestamp: "last_edited_time", direction: "descending" }],
      }).pipe(Effect.map((rows) => ({ ...source, ...rows }))),
    );
    const sections = sources.map((source) =>
      [
        ...(sources.length > 1 ? [`## ${source.name || "Untitled"}`, ""] : []),
        source.has_more
          ? `The ${source.results.length} most recently edited rows:`
          : `${source.results.length} rows:`,
        "",
        ...source.results.map(rowLine),
      ].join("\n"),
    );
    const description = plainText(database.description);
    return [
      `# ${databaseSummary(database).title}`,
      "",
      "A Notion database. Attach a row's link to read that page.",
      ...(description ? ["", description] : []),
      "",
      ...sections,
    ].join("\n");
  });
  const getPageSummary = Effect.fn("notion.get_page_summary")(function* (
    input: NotionGetPageInput,
  ) {
    return yield* retrieveSummary(yield* pageId(input.id));
  });
  const getPage = Effect.fn("notion.get_page")(function* (input: NotionGetPageInput) {
    const id = yield* pageId(input.id);
    const found = yield* retrieve(id);
    const content =
      found.kind === "page"
        ? yield* request(`pages/${id}/markdown`, Markdown)
        : { markdown: yield* databaseMarkdown(found.database), truncated: false };
    const blockId = found.kind === "page" ? parseNotionBlockId(input.id) : null;
    // A block that cannot be read still leaves the page and the link's anchor.
    const block =
      blockId === null
        ? undefined
        : {
            id: blockId,
            text: yield* request(`blocks/${blockId}`, Block).pipe(
              Effect.map((block) => blockText(block).slice(0, 2048)),
              Effect.catchTags({
                NotionError: (error) =>
                  error.reason === "not-found" ? Effect.succeed("") : Effect.fail(error),
              }),
            ),
          };
    const note = "\n\n[Notion page content is incomplete or truncated.]";
    const incomplete =
      content.truncated || content.markdown.length > NOTION_PAGE_MARKDOWN_MAX_CHARS;
    const pageSummary =
      found.kind === "page" ? summary(found.page) : databaseSummary(found.database);
    return {
      ...pageSummary,
      ...(block === undefined
        ? {}
        : { url: `${pageSummary.url.split("#")[0]}#${block.id.replaceAll("-", "")}`, block }),
      markdown: incomplete
        ? content.markdown.slice(0, NOTION_PAGE_MARKDOWN_MAX_CHARS - note.length) + note
        : content.markdown,
    };
  });
  const searchPages = Effect.fn("notion.search_pages")(function* (input: NotionSearchPagesInput) {
    const id = parseNotionPageId(input.query.trim());
    if (id !== null) return { pages: [yield* retrieveSummary(id)], hasMore: false };
    const result = yield* request("search", Search, {
      query: input.query.trim(),
      filter: { property: "object", value: "page" },
      sort: { direction: "descending", timestamp: "last_edited_time" },
      page_size: 30,
    });
    return { pages: result.results.map(summary), hasMore: result.has_more };
  });
  return NotionApi.of({ getPage, getPageSummary, searchPages });
});
export const layer = Layer.effect(NotionApi, make);
