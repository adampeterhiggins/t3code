import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as GoogleApi from "./GoogleApi.ts";
import * as GoogleAuth from "./GoogleAuth.ts";

const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
function harness(
  options: {
    sheet?: boolean;
    cancelled?: boolean;
    mimeType?: string;
    reject?: boolean;
    missing?: boolean;
    docText?: string;
    commentAt?: string;
    commentsForbidden?: boolean;
    noDirectory?: boolean;
    noGmail?: boolean;
    mailReply?: boolean;
  } = {},
) {
  const urls: string[] = [];
  let refreshes = 0;
  const file = {
    id: "file_123",
    name: "Launch plan",
    modifiedTime: "2026-10-01T00:00:00.000Z",
    description: "Shared source",
    size: "42",
    owners: [{ displayName: "Ada" }],
    mimeType:
      options.mimeType ??
      (options.sheet
        ? "application/vnd.google-apps.spreadsheet"
        : "application/vnd.google-apps.document"),
  };
  const client = HttpClient.make((request) =>
    Effect.sync(() => {
      urls.push(request.url);
      let body: unknown = file;
      const url = new URL(request.url);
      if (url.pathname.endsWith("/files")) body = { files: [file], nextPageToken: "more" };
      if (url.hostname === "docs.googleapis.com")
        body = {
          tabs: [
            {
              tabProperties: { tabId: "t.one" },
              documentTab: {
                body: {
                  content: [
                    {
                      paragraph: {
                        paragraphStyle: { headingId: "h.price", namedStyleType: "HEADING_1" },
                        elements: [{ textRun: { content: "Pricing" } }],
                      },
                    },
                    {
                      paragraph: {
                        elements: [{ textRun: { content: options.docText ?? "£18 per seat" } }],
                      },
                    },
                  ],
                },
              },
            },
          ],
        };
      if (url.hostname === "sheets.googleapis.com")
        body = url.pathname.includes("/values/")
          ? {
              values: [
                ["Q4", "MRR"],
                ["18", "152"],
              ],
            }
          : {
              sheets: [
                { properties: { sheetId: 7, title: "Chart", sheetType: "OBJECT" } },
                {
                  properties: {
                    sheetId: 42,
                    title: "Forecast",
                    gridProperties: { rowCount: 40, columnCount: 6 },
                  },
                },
              ],
            };
      if (url.pathname.endsWith("/comments"))
        body = {
          comments: [
            {
              content: "Review the tax rollout",
              modifiedTime: options.commentAt ?? "2026-10-02T00:00:00.000Z",
              author: { displayName: "Priya" },
              replies: [{ content: "Approved", modifiedTime: "2026-10-03T00:00:00.000Z" }],
            },
          ],
        };
      if (url.pathname.endsWith("people:searchDirectoryPeople"))
        body = {
          people: [
            {
              names: [{ displayName: "Priya Shah" }],
              emailAddresses: [{ value: "priya@example.com" }],
            },
            { names: [{ displayName: "No email" }] },
          ],
        };
      if (url.pathname.endsWith("/calendarList"))
        body = {
          items: [
            { id: "team@example.com", summary: "Team", selected: true },
            { id: "room@resource.calendar.google.com", summary: "Room 4" },
          ],
        };
      const event = {
        id: "event123",
        summary: "Launch review",
        updated: "2026-10-01T00:00:00.000Z",
        status: options.cancelled ? "cancelled" : "confirmed",
        description: "Review the plan",
        start: options.cancelled
          ? { date: "2026-10-26" }
          : { dateTime: "2026-10-26T10:00:00Z", timeZone: "Europe/London" },
        end: { dateTime: "2026-10-26T11:00:00Z" },
        organizer: { email: "priya@example.com", displayName: "Priya" },
        attendees: [{ email: "priya@example.com", responseStatus: "accepted" }],
        location: "Meeting room",
      };
      if (url.pathname.endsWith("/events")) body = { items: [event] };
      if (url.pathname.endsWith("/events/event123")) body = event;
      if (url.searchParams.get("alt") === "media" || url.pathname.endsWith("/export"))
        return HttpClientResponse.fromWeb(request, new Response("A plain text source"));
      if (url.hostname === "gmail.googleapis.com") {
        body = url.pathname.endsWith("/threads")
          ? { threads: [{ id: "18abcdef12345678" }], nextPageToken: "more" }
          : {
              id: "18abcdef12345678",
              historyId: options.mailReply ? "102" : "101",
              messages: [
                {
                  id: "m1",
                  internalDate: "1790812800000",
                  labelIds: ["INBOX"],
                  payload: {
                    mimeType: "multipart/alternative",
                    headers: [
                      { name: "Subject", value: "Launch mail" },
                      { name: "From", value: "Ada <ada@example.com>" },
                    ],
                    parts: [
                      {
                        mimeType: "text/plain",
                        body: { data: Buffer.from("Hello £18 per seat").toString("base64url") },
                      },
                      {
                        mimeType: "text/html",
                        body: { data: Buffer.from("<b>Duplicate HTML</b>").toString("base64url") },
                      },
                    ],
                  },
                },
                ...(options.mailReply
                  ? [
                      {
                        id: "m2",
                        internalDate: "1790899200000",
                        snippet: "Approved",
                        payload: { headers: [{ name: "From", value: "Priya" }] },
                      },
                    ]
                  : []),
              ],
            };
      }
      const status =
        options.missing ||
        (options.noGmail && url.hostname === "gmail.googleapis.com") ||
        (options.commentsForbidden && url.pathname.endsWith("/comments")) ||
        url.pathname.includes("nobody%40example.com") ||
        (options.noDirectory && url.hostname === "people.googleapis.com")
          ? 403
          : options.reject && request.headers.authorization === "Bearer old"
            ? 401
            : 200;
      return HttpClientResponse.fromWeb(
        request,
        new Response(encode(body), { status, headers: { "content-type": "application/json" } }),
      );
    }),
  );
  const layer = GoogleApi.layer.pipe(
    Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
    Layer.provide(
      Layer.mock(GoogleAuth.GoogleAuth)({
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
  return { layer, urls, refreshes: () => refreshes };
}
it.effect("searches Docs and Sheets, escaping Drive queries and recognizing pasted links", () => {
  const h = harness();
  return Effect.gen(function* () {
    const api = yield* GoogleApi.GoogleApi;
    const result = yield* api.searchFiles({ query: "owner's launch" });
    assert.equal(result.files[0]?.fileType, "doc");
    assert.equal(result.files[0]?.owner, "Ada");
    assert.equal(result.hasMore, true);
    assert.include(new URL(h.urls[0]!).searchParams.get("q"), "owner\\'s launch");
    yield* api.searchFiles({
      query: "https://docs.google.com/document/d/file_123/edit#heading=h.price",
    });
    assert.include(h.urls[1], "/files/file_123?");
  }).pipe(Effect.provide(h.layer));
});
it.effect("reads cited headings, refreshes rejected access, and includes comment replies", () => {
  const h = harness({ reject: true });
  return Effect.gen(function* () {
    const api = yield* GoogleApi.GoogleApi;
    const result = yield* api.getFile({
      id: "https://docs.google.com/document/d/file_123/edit?tab=t.one#heading=h.price",
    });
    assert.include(result.markdown, "£18 per seat");
    assert.include(result.markdown, "Review the tax rollout");
    assert.include(result.markdown, "Approved");
    assert.equal(result.location, "Pricing");
    assert.isAbove(h.refreshes(), 0);
  }).pipe(Effect.provide(h.layer));
});
it.effect("reads the selected sheet and cell range, rather than the first sheet", () => {
  const h = harness({ sheet: true });
  return Effect.gen(function* () {
    const result = yield* (yield* GoogleApi.GoogleApi).getFile({
      id: "https://docs.google.com/spreadsheets/d/file_123/edit#gid=42&range=B4:D6",
    });
    assert.equal(result.location, "Forecast!B4:D6");
    assert.deepEqual(result.grid, [
      ["Q4", "MRR"],
      ["18", "152"],
    ]);
    assert.include(
      decodeURIComponent(h.urls.find((url) => url.includes("/values/"))!),
      "'Forecast'!B4:D6",
    );
    const failure = yield* (yield* GoogleApi.GoogleApi)
      .getFile({ id: "https://docs.google.com/spreadsheets/d/file_123/edit#gid=99" })
      .pipe(Effect.flip);
    assert.equal(failure.reason, "not-found");
  }).pipe(Effect.provide(h.layer));
});
it.effect("previews every grid tab within its own bounds, skipping chart tabs", () => {
  const h = harness({ sheet: true });
  return Effect.gen(function* () {
    yield* (yield* GoogleApi.GoogleApi).getFile({ id: "file_123" });
    const ranges = h.urls
      .filter((url) => url.includes("/values/"))
      .map((url) => decodeURIComponent(new URL(url).pathname.split("/values/")[1]!));
    assert.deepEqual(ranges, ["'Forecast'!A1:F40"]);
  }).pipe(Effect.provide(h.layer));
});
it.effect("previews a file whose comments Drive will not list to this viewer", () => {
  const h = harness({ commentsForbidden: true });
  return Effect.gen(function* () {
    const file = yield* (yield* GoogleApi.GoogleApi).getFile({ id: "file_123" });
    assert.include(file.markdown, "£18 per seat");
    assert.notInclude(file.markdown, "## Comments");
  }).pipe(Effect.provide(h.layer));
});
it.effect("reports revoked file access without inventing an empty document", () => {
  const h = harness({ missing: true });
  return Effect.gen(function* () {
    const error = yield* (yield* GoogleApi.GoogleApi).getFile({ id: "file_123" }).pipe(Effect.flip);
    assert.equal(error.reason, "not-found");
  }).pipe(Effect.provide(h.layer));
});

it.effect("keeps comment changes observable when a long document preview is truncated", () => {
  const options = { docText: "x".repeat(80_000), commentAt: "2026-10-03T00:00:00.000Z" };
  const h = harness(options);
  return Effect.gen(function* () {
    const api = yield* GoogleApi.GoogleApi;
    const before = yield* api.getFile({ id: "file_123" });
    options.commentAt = "2026-10-04T00:00:00.000Z";
    const after = yield* api.getFile({ id: "file_123" });
    assert.strictEqual(before.markdown, after.markdown);
    assert.notStrictEqual(before.revision, after.revision);
  }).pipe(Effect.provide(h.layer));
});

it.effect("reads Drive text and preserves Drive links to native Docs", () => {
  const h = harness({ mimeType: "text/plain" });
  return Effect.gen(function* () {
    const api = yield* GoogleApi.GoogleApi;
    const file = yield* api.getFile({ id: "https://drive.google.com/file/d/file_123/view" });
    assert.strictEqual(file.fileType, "drive");
    assert.ok(file.markdown.includes("A plain text source"));
  }).pipe(Effect.provide(h.layer));
});
it.effect("summarizes folder children without downloading binary content", () => {
  const h = harness({ mimeType: "application/vnd.google-apps.folder" });
  return Effect.gen(function* () {
    const api = yield* GoogleApi.GoogleApi;
    const file = yield* api.getFile({ id: "file_123" });
    assert.strictEqual(file.fileType, "folder");
    assert.ok(file.markdown.includes("Launch plan"));
    assert.ok(h.urls.some((url) => new URL(url).searchParams.get("q")?.includes("in parents")));
  }).pipe(Effect.provide(h.layer));
});
it.effect("searches Calendar and reads event details with native citations", () => {
  const h = harness();
  return Effect.gen(function* () {
    const api = yield* GoogleApi.GoogleApi;
    const result = yield* api.searchFiles({ query: "Launch", source: "calendar" });
    const event = result.files[0]!;
    assert.strictEqual(event.fileType, "event");
    assert.strictEqual(event.owner, "Priya");
    assert.strictEqual(event.startsAt, "2026-10-26T10:00:00Z");
    assert.strictEqual(event.endsAt, "2026-10-26T11:00:00Z");
    const context = yield* api.getFile({ id: event.url });
    assert.ok(context.markdown.includes("priya@example.com"));
    assert.ok(context.markdown.includes("Europe/London"));
    assert.ok(context.markdown.includes("Meeting room"));
    assert.strictEqual(context.url, event.url);
    assert.ok(h.urls.some((url) => url.includes("/calendars/team%40example.com/events/event123")));
    assert.notOk(h.urls.some((url) => url.includes("room%40resource")));
  }).pipe(Effect.provide(h.layer));
});

it.effect(
  "lists every readable calendar, and searches the ones picked over the ticked ones",
  () => {
    const h = harness();
    return Effect.gen(function* () {
      const api = yield* GoogleApi.GoogleApi;
      const { calendars } = yield* api.listCalendars;
      assert.deepEqual(
        calendars.map((c) => [c.name, c.selected]),
        [
          ["Team", true],
          ["Room 4", false],
        ],
      );
      // A colleague's calendar that is not shared is skipped rather than failing the search.
      const result = yield* api.searchFiles({
        query: "",
        source: "calendar",
        calendarIds: ["room@resource.calendar.google.com", "nobody@example.com"],
      });
      assert.equal(result.files.length, 1);
      assert.ok(h.urls.some((url) => url.includes("/calendars/room%40resource")));
      assert.notOk(h.urls.some((url) => url.includes("/calendars/team%40example.com/events")));
    }).pipe(Effect.provide(h.layer));
  },
);
it.effect("finds colleagues in the directory", () =>
  Effect.gen(function* () {
    const found = yield* (yield* GoogleApi.GoogleApi).searchPeople({ query: "pri" });
    assert.deepEqual(found, {
      directoryAvailable: true,
      people: [{ name: "Priya Shah", email: "priya@example.com" }],
    });
  }).pipe(Effect.provide(harness().layer)),
);
it.effect("asks to reconnect when the connection cannot read the directory", () =>
  Effect.gen(function* () {
    const hidden = yield* (yield* GoogleApi.GoogleApi).searchPeople({ query: "pri" });
    assert.deepEqual(hidden, { directoryAvailable: false, people: [] });
  }).pipe(Effect.provide(harness({ noDirectory: true }).layer)),
);
it.effect("keeps binary Drive files as metadata and comments without downloading bytes", () => {
  const h = harness({ mimeType: "application/pdf" });
  return Effect.gen(function* () {
    const api = yield* GoogleApi.GoogleApi;
    const file = yield* api.getFile({ id: "file_123" });
    assert.strictEqual(file.fileType, "drive");
    assert.ok(file.markdown.includes("Binary file: metadata and comments only"));
    assert.ok(file.markdown.includes("Review the tax rollout"));
    assert.ok(
      !h.urls.some((url) => url.includes("alt=media") || url.includes("sheets.googleapis.com")),
    );
  }).pipe(Effect.provide(h.layer));
});
it.effect("exports Slides as text through Drive", () => {
  const h = harness({ mimeType: "application/vnd.google-apps.presentation" });
  return Effect.gen(function* () {
    const api = yield* GoogleApi.GoogleApi;
    const file = yield* api.getFile({ id: "file_123" });
    assert.strictEqual(file.fileType, "slides");
    assert.ok(file.markdown.includes("A plain text source"));
    assert.ok(h.urls.some((url) => url.includes("/export?mimeType=text%2Fplain")));
  }).pipe(Effect.provide(h.layer));
});

it.effect("makes all-day event cancellation visible to a linked-source watch", () => {
  const options = { cancelled: false };
  const h = harness(options);
  return Effect.gen(function* () {
    const api = yield* GoogleApi.GoogleApi;
    const url = `https://calendar.google.com/calendar/event?eid=${btoa("event123 team@example.com")}`;
    const before = yield* api.getFile({ id: url });
    options.cancelled = true;
    const after = yield* api.getFile({ id: url });
    assert.ok(after.markdown.includes("Status: cancelled"));
    assert.ok(after.markdown.includes("Start: 2026-10-26"));
    assert.notStrictEqual(before.markdown, after.markdown);
  }).pipe(Effect.provide(h.layer));
});

it.effect("searches Gmail with native queries and reads a bounded conversation snapshot", () => {
  const h = harness();
  return Effect.gen(function* () {
    const api = yield* GoogleApi.GoogleApi;
    const result = yield* api.searchFiles({
      source: "gmail",
      query: "from:ada@example.com is:unread",
    });
    assert.equal(result.files[0]?.fileType, "email");
    assert.equal(result.files[0]?.title, "Launch mail");
    assert.notProperty(result.files[0], "markdown");
    assert.equal(result.hasMore, true);
    assert.equal(new URL(h.urls[0]!).searchParams.get("q"), "from:ada@example.com is:unread");
    assert.include(h.urls[1], "format=metadata");
    const file = yield* api.getFile({ id: result.files[0]!.url });
    assert.include(file.markdown, "Hello £18 per seat");
    assert.notInclude(file.markdown, "Duplicate HTML");
    assert.equal(file.revision, "101");
    assert.equal(file.updatedAt, "2026-10-01T00:00:00.000Z");
    assert.isFalse(h.urls.some((url) => url.includes("/drive/")));
    const pasted = yield* api.searchFiles({ query: file.url });
    assert.equal(pasted.files[0]?.fileType, "email");
    const mixed = yield* api.searchFiles({ source: "all", query: "Launch" });
    assert.deepEqual(
      mixed.files.map((f) => f.fileType),
      ["doc", "event", "email"],
    );
  }).pipe(Effect.provide(h.layer));
});
it.effect("keeps Drive and Calendar searchable before Gmail permission is granted", () => {
  const h = harness({ noGmail: true });
  return Effect.gen(function* () {
    const api = yield* GoogleApi.GoogleApi;
    const result = yield* api.searchFiles({ source: "all", query: "Launch" });
    assert.deepEqual(
      result.files.map((f) => f.fileType),
      ["doc", "event"],
    );
    const error = yield* api.searchFiles({ source: "gmail", query: "Launch" }).pipe(Effect.flip);
    assert.equal(error.reason, "not-found");
    assert.include(error.message, "Gmail permission");
  }).pipe(Effect.provide(h.layer));
});
it.effect("includes replies in Gmail snapshots and watch revisions", () => {
  const h = harness({ mailReply: true });
  return Effect.gen(function* () {
    const file = yield* (yield* GoogleApi.GoogleApi).getFile({
      id: "https://mail.google.com/mail/u/1/#inbox/18abcdef12345678",
    });
    assert.include(file.markdown, "Approved");
    assert.equal(file.owner, "Priya");
    assert.equal(file.revision, "102");
    assert.equal(file.updatedAt, "2026-10-02T00:00:00.000Z");
  }).pipe(Effect.provide(h.layer));
});
