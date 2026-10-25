import {
  GoogleError,
  GOOGLE_FILE_MARKDOWN_MAX_CHARS,
  parseGoogleFileLink,
  type GoogleGetFileInput,
  type GoogleFileContext,
  type GoogleFileSummary,
  type GoogleSearchFilesInput,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Clock from "effect/Clock";
import * as Stream from "effect/Stream";
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
  description: Schema.optional(Schema.String),
  size: Schema.optional(Schema.String),
  owners: Schema.optional(
    Schema.Array(Schema.Struct({ displayName: Schema.optional(Schema.String) })),
  ),
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
const EventTime = Schema.Struct({
  dateTime: Schema.optional(Schema.String),
  date: Schema.optional(Schema.String),
  timeZone: Schema.optional(Schema.String),
});
const CalendarEvent = Schema.Struct({
  id: Schema.String,
  summary: Schema.optional(Schema.String),
  updated: Schema.String,
  status: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  location: Schema.optional(Schema.String),
  start: Schema.optional(EventTime),
  end: Schema.optional(EventTime),
  organizer: Schema.optional(
    Schema.Struct({
      email: Schema.optional(Schema.String),
      displayName: Schema.optional(Schema.String),
    }),
  ),
  attendees: Schema.optional(
    Schema.Array(
      Schema.Struct({
        email: Schema.optional(Schema.String),
        responseStatus: Schema.optional(Schema.String),
      }),
    ),
  ),
  hangoutLink: Schema.optional(Schema.String),
  attachments: Schema.optional(
    Schema.Array(
      Schema.Struct({
        title: Schema.optional(Schema.String),
        fileUrl: Schema.optional(Schema.String),
      }),
    ),
  ),
});
const fields = "id,name,mimeType,modifiedTime,description,size,owners(displayName)";
const summary = (file: typeof File.Type): GoogleFileSummary => {
  const fileType =
    file.mimeType === "application/vnd.google-apps.spreadsheet"
      ? "sheet"
      : file.mimeType === "application/vnd.google-apps.document"
        ? "doc"
        : file.mimeType === "application/vnd.google-apps.presentation"
          ? "slides"
          : file.mimeType === "application/vnd.google-apps.folder"
            ? "folder"
            : "drive";
  const owner = file.owners?.[0]?.displayName;
  return {
    id: file.id,
    title: file.name,
    updatedAt: file.modifiedTime,
    fileType,
    ...(owner ? { owner } : {}),
    url:
      fileType === "doc" || fileType === "sheet" || fileType === "slides"
        ? `https://docs.google.com/${fileType === "doc" ? "document" : fileType === "sheet" ? "spreadsheets" : "presentation"}/d/${file.id}/edit`
        : fileType === "folder"
          ? `https://drive.google.com/drive/folders/${file.id}`
          : `https://drive.google.com/file/d/${file.id}/view`,
  };
};
const eventSummary = (event: typeof CalendarEvent.Type, calendarId: string): GoogleFileSummary => {
  const eid = btoa(`${event.id} ${calendarId}`)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  const url = `https://calendar.google.com/calendar/event?eid=${eid}`;
  const owner = event.organizer?.displayName || event.organizer?.email;
  const startsAt = event.start?.dateTime || event.start?.date;
  return {
    id: url,
    title: event.summary ?? "Untitled event",
    url,
    updatedAt: event.updated,
    fileType: "event",
    ...(owner ? { owner } : {}),
    ...(startsAt ? { startsAt } : {}),
  };
};
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
  const requestResponse = Effect.fn("google.api.request")(function* (url: string) {
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
          "Google cannot read this document. Check this account's access, enable the relevant Google API, and reconnect Google if Calendar permission was added.",
      });
    if (response.status < 200 || response.status >= 300)
      return yield* new GoogleError({
        reason: "api",
        detail: `Google returned HTTP ${response.status}.`,
      });
    return response;
  });
  const request = Effect.fn("google.api.decode")(function* <S extends Schema.Top>(
    url: string,
    schema: S,
  ) {
    const response = yield* requestResponse(url);
    return yield* response.json.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(schema)),
      Effect.mapError(
        () => new GoogleError({ reason: "api", detail: "Google returned an unreadable response." }),
      ),
    );
  });
  const readText = Effect.fn("google.api.read_text")(function* (url: string) {
    const response = yield* requestResponse(url);
    return yield* response.stream.pipe(
      Stream.decodeText(),
      Stream.mapAccum(
        () => 0,
        (length, text): readonly [number, ReadonlyArray<{ length: number; text: string }>] => [
          length + text.length,
          [{ length: length + text.length, text }],
        ],
      ),
      Stream.takeUntil((chunk) => chunk.length > GOOGLE_FILE_MARKDOWN_MAX_CHARS),
      Stream.map((chunk) => chunk.text),
      Stream.mkString,
      Effect.map((text) => text.slice(0, GOOGLE_FILE_MARKDOWN_MAX_CHARS + 1)),
      Effect.mapError(
        () => new GoogleError({ reason: "api", detail: "Could not read this Drive file." }),
      ),
    );
  });
  const readEvent = Effect.fn("google.calendar.get_event")(function* (url: string) {
    const location = parseGoogleFileLink(url);
    if (!location?.eventId || !location.calendarId)
      return yield* new GoogleError({
        reason: "not-found",
        detail: "Use a Google Calendar event link.",
      });
    const event = yield* request(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(location.calendarId)}/events/${encodeURIComponent(location.eventId)}`,
      CalendarEvent,
    );
    const when = (time: typeof EventTime.Type | undefined) =>
      time
        ? `${time.dateTime ?? time.date ?? ""}${time.timeZone ? ` (${time.timeZone})` : ""}`
        : "";
    const markdown = [
      `# ${event.summary ?? "Untitled event"}`,
      `Status: ${event.status ?? "confirmed"}`,
      `Start: ${when(event.start)}`,
      `End: ${when(event.end)}`,
      `Calendar: ${location.calendarId}`,
      `Location: ${event.location ?? ""}`,
      `Organizer: ${event.organizer?.email ?? ""}`,
      `Attendees:\n${(event.attendees ?? []).map((a) => `- ${a.email ?? "Guest"}: ${a.responseStatus ?? "unknown"}`).join("\n")}`,
      event.description ?? "",
      event.hangoutLink ? `Meeting: ${event.hangoutLink}` : "",
      ...(event.attachments ?? []).map((a) => `${a.title ?? "Attachment"}: ${a.fileUrl ?? ""}`),
    ]
      .join("\n\n")
      .slice(0, GOOGLE_FILE_MARKDOWN_MAX_CHARS);
    return { ...eventSummary(event, location.calendarId), url, markdown, revision: event.updated };
  });
  const searchEvents = Effect.fn("google.calendar.search")(function* (
    input: GoogleSearchFilesInput,
  ) {
    const calendars = input.calendarId
      ? { items: [{ id: input.calendarId }], nextPageToken: undefined }
      : yield* request(
          "https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=10&minAccessRole=reader",
          Schema.Struct({
            items: Schema.Array(Schema.Struct({ id: Schema.String })),
            nextPageToken: Schema.optional(Schema.String),
          }),
        );
    const now = yield* Clock.currentTimeMillis;
    const timeMin = input.timeMin ?? DateTime.formatIso(DateTime.makeUnsafe(now - 30 * 86400000));
    const timeMax = input.timeMax ?? DateTime.formatIso(DateTime.makeUnsafe(now + 365 * 86400000));
    if (
      DateTime.toEpochMillis(DateTime.makeUnsafe(timeMin)) >=
      DateTime.toEpochMillis(DateTime.makeUnsafe(timeMax))
    )
      return yield* new GoogleError({
        reason: "api",
        detail: "Calendar search needs timeMin before timeMax.",
      });
    const pages = yield* Effect.forEach(
      calendars.items,
      (calendar) =>
        Effect.gen(function* () {
          const params = new URLSearchParams({
            maxResults: "30",
            singleEvents: "true",
            orderBy: "startTime",
            timeMin,
            timeMax,
            ...(input.query.trim() ? { q: input.query.trim() } : {}),
          });
          const result = yield* request(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.id)}/events?${params}`,
            Schema.Struct({
              items: Schema.Array(CalendarEvent),
              nextPageToken: Schema.optional(Schema.String),
            }),
          );
          return {
            files: result.items.map((event) => eventSummary(event, calendar.id)),
            hasMore: Boolean(result.nextPageToken),
          };
        }),
      { concurrency: 3 },
    );
    const files = pages.flatMap((page) => page.files);
    return {
      files: files.slice(0, 30),
      hasMore:
        files.length > 30 || Boolean(calendars.nextPageToken) || pages.some((p) => p.hasMore),
    };
  });
  const resolve = (input: GoogleGetFileInput) => {
    const location = parseGoogleFileLink(input.id);
    const id = location?.fileId ?? (/^[\w-]+$/.test(input.id) ? input.id : null);
    return id
      ? Effect.succeed({ id, location })
      : Effect.fail(
          new GoogleError({
            reason: "not-found",
            detail:
              "Use a Google Drive, Docs, Sheets, Slides or Calendar link, or a Drive file ID.",
          }),
        );
  };
  const metadata = Effect.fn("google.file_metadata")(function* (id: string) {
    const file = yield* request(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=${fields}&supportsAllDrives=true`,
      File,
    );
    return {
      ...summary(file),
      mimeType: file.mimeType,
      description: file.description,
      size: file.size,
    };
  });
  const getFileSummary = Effect.fn("google.get_file_summary")(function* (
    input: GoogleGetFileInput,
  ) {
    if (parseGoogleFileLink(input.id)?.fileType === "event") return yield* readEvent(input.id);
    const { id, location } = yield* resolve(input);
    const file = yield* metadata(id);
    if (location && location.fileType !== "drive" && location.fileType !== file.fileType)
      return yield* new GoogleError({
        reason: "not-found",
        detail: "The Google link does not match the document type.",
      });
    return { ...file, ...(location ? { url: input.id } : {}) };
  });
  const getFile = Effect.fn("google.get_file")(function* (input: GoogleGetFileInput) {
    if (parseGoogleFileLink(input.id)?.fileType === "event") return yield* readEvent(input.id);
    const { id, location: selector } = yield* resolve(input);
    const file = yield* metadata(id);
    if (selector && selector.fileType !== "drive" && selector.fileType !== file.fileType)
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
    } else if (file.fileType === "sheet") {
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
    if (file.fileType === "folder") {
      const params = new URLSearchParams({
        q: `trashed = false and '${id}' in parents`,
        fields: `files(${fields}),nextPageToken`,
        pageSize: "100",
        supportsAllDrives: "true",
        includeItemsFromAllDrives: "true",
        orderBy: "name",
      });
      const children = yield* request(
        `https://www.googleapis.com/drive/v3/files?${params}`,
        Search,
      );
      markdown = `# ${file.title}\n\n${children.files.map((child) => `- [${child.name}](${summary(child).url}) · ${child.mimeType} · ${child.modifiedTime}`).join("\n")}${children.nextPageToken ? "\n[Additional folder entries omitted.]" : ""}`;
    } else if (file.fileType === "slides") {
      markdown = yield* readText(
        `https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=text%2Fplain`,
      );
    } else if (file.fileType === "drive") {
      markdown = `# ${file.title}\n\nType: ${file.mimeType}\nSize: ${file.size ?? "unknown"} bytes\n\n${file.description ?? ""}\n\n`;
      if (
        file.mimeType.startsWith("text/") ||
        ["application/json", "application/xml", "application/javascript"].includes(file.mimeType)
      )
        markdown += yield* readText(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`);
      else
        markdown +=
          "[Binary file: metadata and comments only. Open the Drive link to view its contents.]";
    }
    const comments: string[] = [];
    const commentVersions: string[] = [];
    let pageToken: string | undefined;
    for (let page = 0; file.fileType !== "folder" && page < 5; page++) {
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
    if (input.source === "calendar") return yield* searchEvents(input);
    const term = input.query.trim().replaceAll("\\", "\\\\").replaceAll("'", "\\'");
    const params = new URLSearchParams({
      q: `trashed = false${term ? ` and name contains '${term}'` : ""}`,
      fields: `files(${fields}),nextPageToken`,
      pageSize: "30",
      orderBy: "modifiedTime desc",
      includeItemsFromAllDrives: "true",
      supportsAllDrives: "true",
    });
    const result = yield* request(`https://www.googleapis.com/drive/v3/files?${params}`, Search);
    const calendar =
      input.source === "all" ? yield* searchEvents(input) : { files: [], hasMore: false };
    const drive = result.files.map(summary);
    const files = Array.from({ length: Math.max(drive.length, calendar.files.length) }, (_, i) => [
      drive[i],
      calendar.files[i],
    ])
      .flat()
      .filter((file): file is GoogleFileSummary => file !== undefined);
    return {
      files: files.slice(0, 60),
      hasMore: Boolean(result.nextPageToken) || calendar.hasMore,
    };
  });
  return GoogleApi.of({ getFile, getFileSummary, searchFiles });
});
export const layer = Layer.effect(GoogleApi, make);
