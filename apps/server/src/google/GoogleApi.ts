import {
  GoogleError,
  GOOGLE_FILE_MARKDOWN_MAX_CHARS,
  parseGoogleFileLink,
  type GoogleGetFileInput,
  type GoogleFileContext,
  type GoogleFileSummary,
  type GoogleSearchFilesInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as GoogleAuth from "./GoogleAuth.ts";
import { boundedGoogleRange, googleDocumentMarkdown, googleGridMarkdown } from "./googleContent.ts";

const File = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  mimeType: Schema.String,
  modifiedTime: Schema.String,
});
const Search = Schema.Struct({
  files: Schema.Array(File),
  nextPageToken: Schema.optional(Schema.String),
});
const Spreadsheet = Schema.Struct({
  sheets: Schema.Array(
    Schema.Struct({ properties: Schema.Struct({ sheetId: Schema.Number, title: Schema.String }) }),
  ),
});
const Values = Schema.Struct({
  values: Schema.optional(
    Schema.Array(Schema.Array(Schema.Union([Schema.String, Schema.Number, Schema.Boolean]))),
  ),
});
const Comments = Schema.Struct({
  comments: Schema.Array(
    Schema.Struct({
      content: Schema.optional(Schema.String),
      modifiedTime: Schema.String,
      author: Schema.optional(Schema.Struct({ displayName: Schema.optional(Schema.String) })),
      replies: Schema.optional(
        Schema.Array(
          Schema.Struct({ content: Schema.optional(Schema.String), modifiedTime: Schema.String }),
        ),
      ),
    }),
  ),
  nextPageToken: Schema.optional(Schema.String),
});
const fields = "id,name,mimeType,modifiedTime";
const summary = (file: typeof File.Type): GoogleFileSummary => ({
  id: file.id,
  title: file.name,
  updatedAt: file.modifiedTime,
  fileType: file.mimeType === "application/vnd.google-apps.spreadsheet" ? "sheet" : "doc",
  url: `https://docs.google.com/${file.mimeType === "application/vnd.google-apps.spreadsheet" ? "spreadsheets" : "document"}/d/${file.id}/edit`,
});
export class GoogleApi extends Context.Service<
  GoogleApi,
  {
    readonly searchFiles: (
      input: GoogleSearchFilesInput,
    ) => Effect.Effect<{ files: GoogleFileSummary[]; hasMore: boolean }, GoogleError>;
    readonly getFile: (input: GoogleGetFileInput) => Effect.Effect<GoogleFileContext, GoogleError>;
    readonly getFileSummary: (
      input: GoogleGetFileInput,
    ) => Effect.Effect<GoogleFileSummary, GoogleError>;
  }
>()("t3/google/GoogleApi") {}

const make = Effect.gen(function* () {
  const auth = yield* GoogleAuth.GoogleAuth;
  const client = yield* HttpClient.HttpClient;
  const request = Effect.fn("google.api.request")(function* <S extends Schema.Top>(
    url: string,
    schema: S,
  ) {
    const execute = (token: string) =>
      HttpClientRequest.get(url).pipe(
        HttpClientRequest.bearerToken(token),
        client.execute,
        Effect.mapError(
          () => new GoogleError({ reason: "api", detail: "Could not reach Google." }),
        ),
      );
    const token = yield* auth.accessToken;
    let response = yield* execute(token);
    if (response.status === 401) response = yield* execute(yield* auth.refreshAccessToken(token));
    if (response.status === 401) {
      yield* auth.markRevoked;
      return yield* new GoogleError({
        reason: "revoked",
        detail: "Reconnect Google in Settings → Integrations.",
      });
    }
    if (response.status === 429)
      return yield* new GoogleError({
        reason: "rate-limited",
        detail: "Google's rate limit was reached. Try again shortly.",
      });
    if (response.status === 403 || response.status === 404)
      return yield* new GoogleError({
        reason: "not-found",
        detail:
          "Google cannot read this document. Check this account's access and that the Drive, Docs and Sheets APIs are enabled.",
      });
    if (response.status < 200 || response.status >= 300)
      return yield* new GoogleError({
        reason: "api",
        detail: `Google returned HTTP ${response.status}.`,
      });
    return yield* response.json.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(schema)),
      Effect.mapError(
        () => new GoogleError({ reason: "api", detail: "Google returned an unreadable response." }),
      ),
    );
  });
  const resolve = (input: GoogleGetFileInput) => {
    const location = parseGoogleFileLink(input.id);
    const id = location?.fileId ?? (/^[\w-]+$/.test(input.id) ? input.id : null);
    return id
      ? Effect.succeed({ id, location })
      : Effect.fail(
          new GoogleError({
            reason: "not-found",
            detail: "Use a Google Docs or Sheets link or file ID.",
          }),
        );
  };
  const metadata = Effect.fn("google.file_metadata")(function* (id: string) {
    const file = yield* request(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=${fields}&supportsAllDrives=true`,
      File,
    );
    if (
      !["application/vnd.google-apps.document", "application/vnd.google-apps.spreadsheet"].includes(
        file.mimeType,
      )
    )
      return yield* new GoogleError({
        reason: "not-found",
        detail: "Choose a native Google Doc or Sheet.",
      });
    return summary(file);
  });
  const getFileSummary = Effect.fn("google.get_file_summary")(function* (
    input: GoogleGetFileInput,
  ) {
    const { id, location } = yield* resolve(input);
    const file = yield* metadata(id);
    if (location && location.fileType !== file.fileType)
      return yield* new GoogleError({
        reason: "not-found",
        detail: "The Google link does not match the document type.",
      });
    return { ...file, ...(location ? { url: input.id } : {}) };
  });
  const getFile = Effect.fn("google.get_file")(function* (input: GoogleGetFileInput) {
    const { id, location: selector } = yield* resolve(input);
    const file = yield* metadata(id);
    if (selector && selector.fileType !== file.fileType)
      return yield* new GoogleError({
        reason: "not-found",
        detail: "The Google link does not match the document type.",
      });
    const location = selector ?? { fileId: id, fileType: file.fileType };
    const url = selector ? input.id : file.url;
    let markdown = "";
    let grid: string[][] | undefined;
    let label: string | undefined;
    if (file.fileType === "doc") {
      const doc = yield* request(
        `https://docs.googleapis.com/v1/documents/${id}?includeTabsContent=true`,
        Schema.Unknown,
      );
      const text = googleDocumentMarkdown(doc, location, file.url);
      if (text === null)
        return yield* new GoogleError({
          reason: "not-found",
          detail: "The cited document tab or heading no longer exists.",
        });
      markdown = text;
      label = location.heading
        ? (text.match(/^#+ \[([^\]]+)\]/)?.[1] ?? location.heading)
        : undefined;
    } else {
      const data = yield* request(
        `https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=sheets.properties`,
        Spreadsheet,
      );
      const tabs = location.gid
        ? data.sheets.filter((s) => String(s.properties.sheetId) === location.gid)
        : data.sheets.slice(0, 10);
      if (!tabs.length)
        return yield* new GoogleError({
          reason: "not-found",
          detail: "The cited sheet tab no longer exists.",
        });
      const sections: string[] = [];
      for (const tab of tabs) {
        const name = tab.properties.title;
        const range = boundedGoogleRange(location.range ?? "A1:Z100");
        if (range === null)
          return yield* new GoogleError({
            reason: "not-found",
            detail: "Use a cell range such as B4:D6.",
          });
        const a1 = range.includes("!") ? range : `'${name.replaceAll("'", "''")}'!${range}`;
        const values = yield* request(
          `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(a1)}?valueRenderOption=FORMATTED_VALUE`,
          Values,
        );
        const rows = (values.values ?? [])
          .slice(0, 100)
          .map((r) => r.slice(0, 26).map((value) => String(value).slice(0, 256)));
        grid ??= rows
          .slice(0, 20)
          .map((row) => row.slice(0, 10).map((value) => value.slice(0, 100)));
        label ??= `${name}!${range}`;
        const citationUrl = `${file.url}#gid=${tab.properties.sheetId}&range=${encodeURIComponent(range)}`;
        sections.push(`## [${name}!${range}](${citationUrl})\n\n${googleGridMarkdown(rows)}`);
      }
      markdown =
        sections.join("\n\n") +
        (location.range
          ? ""
          : "\n\n[Preview includes at most 10 tabs, 100 rows and 26 columns per tab. Read a specific range for other cells.]");
    }
    const comments: string[] = [];
    const commentVersions: string[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < 5; page++) {
      const params = new URLSearchParams({
        fields:
          "comments(content,modifiedTime,author(displayName),replies(content,modifiedTime)),nextPageToken",
        pageSize: "100",
        ...(pageToken ? { pageToken } : {}),
      });
      const result = yield* request(
        `https://www.googleapis.com/drive/v3/files/${id}/comments?${params}`,
        Comments,
      );
      for (const c of result.comments) {
        commentVersions.push(
          c.modifiedTime,
          ...(c.replies ?? []).map((reply) => reply.modifiedTime),
        );
        comments.push(
          `${c.author?.displayName ?? "Comment"} (${c.modifiedTime}): ${c.content ?? ""}${(c.replies ?? []).map((r) => `\n  Reply (${r.modifiedTime}): ${r.content ?? ""}`).join("")}`,
        );
      }
      pageToken = result.nextPageToken;
      if (!pageToken) break;
    }
    if (comments.length)
      markdown += `\n\n## Comments\n\n${comments.join("\n\n")}${pageToken ? "\n[Additional comments omitted.]" : ""}`;
    const note = "\n\n[Google content truncated.]";
    if (markdown.length > GOOGLE_FILE_MARKDOWN_MAX_CHARS)
      markdown = markdown.slice(0, GOOGLE_FILE_MARKDOWN_MAX_CHARS - note.length) + note;
    return {
      ...file,
      url,
      markdown,
      revision: `${file.updatedAt}/${comments.length}/${commentVersions.length}/${commentVersions.reduce((latest, next) => (next > latest ? next : latest), "")}`,
      ...(grid ? { grid } : {}),
      ...(label ? { location: label } : {}),
    };
  });
  const searchFiles = Effect.fn("google.search_files")(function* (input: GoogleSearchFilesInput) {
    if (parseGoogleFileLink(input.query.trim()))
      return { files: [yield* getFileSummary({ id: input.query.trim() })], hasMore: false };
    const term = input.query.trim().replaceAll("\\", "\\\\").replaceAll("'", "\\'");
    const params = new URLSearchParams({
      q: `trashed = false and (mimeType = 'application/vnd.google-apps.document' or mimeType = 'application/vnd.google-apps.spreadsheet')${term ? ` and name contains '${term}'` : ""}`,
      fields: `files(${fields}),nextPageToken`,
      pageSize: "30",
      orderBy: "modifiedTime desc",
      includeItemsFromAllDrives: "true",
      supportsAllDrives: "true",
    });
    const result = yield* request(`https://www.googleapis.com/drive/v3/files?${params}`, Search);
    return { files: result.files.map(summary), hasMore: Boolean(result.nextPageToken) };
  });
  return GoogleApi.of({ getFile, getFileSummary, searchFiles });
});
export const layer = Layer.effect(GoogleApi, make);
