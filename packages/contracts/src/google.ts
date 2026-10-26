import * as Schema from "effect/Schema";
import { IsoDateTime, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const GOOGLE_FILE_MARKDOWN_MAX_CHARS = 64_000;
/** Default loopback callback for a locally hosted Google OAuth client. */
export const GOOGLE_REDIRECT_URI = "http://localhost:47834/callback";
export const GoogleAccount = Schema.Struct({
  email: Schema.String,
  name: Schema.String,
});
export type GoogleAccount = typeof GoogleAccount.Type;
export const GoogleConnectionState = Schema.Struct({
  phase: Schema.Literals(["disconnected", "waiting", "connected", "failed"]),
  /** Whether the environment has a client ID and secret to sign in with. */
  configured: Schema.Boolean,
  /** The client ID it signs in with; the secret never leaves the server. */
  clientId: Schema.NullOr(Schema.String),
  /**
   * The redirect URI the connection must register: `GOOGLE_REDIRECT_URI`, or
   * the server's own callback when `T3CODE_GOOGLE_REDIRECT_URI` is set. Older
   * servers omit it and always use `GOOGLE_REDIRECT_URI`.
   */
  redirectUri: Schema.optional(Schema.String),
  account: Schema.NullOr(GoogleAccount),
  flowId: Schema.NullOr(TrimmedNonEmptyString),
  authorizationUrl: Schema.NullOr(Schema.String),
  expiresAt: Schema.NullOr(IsoDateTime),
  message: Schema.NullOr(Schema.String),
});
export type GoogleConnectionState = typeof GoogleConnectionState.Type;
export const GoogleClientCredentials = Schema.Struct({
  clientId: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  clientSecret: TrimmedNonEmptyString.check(Schema.isMaxLength(512)),
});
export type GoogleClientCredentials = typeof GoogleClientCredentials.Type;
/** Without credentials, sign-in reuses the saved ones, then the environment's. */
export const GoogleStartLoginInput = Schema.Struct({
  credentials: Schema.optional(GoogleClientCredentials),
});
export type GoogleStartLoginInput = typeof GoogleStartLoginInput.Type;
export const GoogleCompleteLoginInput = Schema.Struct({
  flowId: TrimmedNonEmptyString,
  callbackUrl: TrimmedNonEmptyString.check(Schema.isMaxLength(4096)),
});
export type GoogleCompleteLoginInput = typeof GoogleCompleteLoginInput.Type;
export const GoogleCancelLoginInput = Schema.Struct({ flowId: TrimmedNonEmptyString });
export type GoogleCancelLoginInput = typeof GoogleCancelLoginInput.Type;
export const GoogleFileSummary = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  url: Schema.String,
  updatedAt: IsoDateTime,
  fileType: Schema.Literals(["doc", "sheet", "drive", "folder", "slides", "event", "email"]),
  /** The Drive file's owner, event organizer, or latest email sender. */
  owner: Schema.optional(Schema.String),
  /** When an event starts: a date-time, or a date for all-day events. */
  startsAt: Schema.optional(Schema.String),
  /** When an event ends, in the same form as `startsAt`. */
  endsAt: Schema.optional(Schema.String),
});
export type GoogleFileSummary = typeof GoogleFileSummary.Type;
/** How many calendars one search reads at most. */
export const GOOGLE_CALENDAR_SEARCH_LIMIT = 20;
export const GoogleSearchFilesInput = Schema.Struct({
  query: Schema.String.check(Schema.isMaxLength(2048)),
  source: Schema.optional(Schema.Literals(["all", "drive", "calendar", "gmail"])),
  calendarId: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(512))),
  /**
   * The calendars to search, in place of the ones ticked in Google Calendar. A colleague's
   * calendar id is their email address.
   */
  calendarIds: Schema.optional(
    Schema.Array(TrimmedNonEmptyString.check(Schema.isMaxLength(512))).check(
      Schema.isMaxLength(GOOGLE_CALENDAR_SEARCH_LIMIT),
    ),
  ),
  timeMin: Schema.optional(IsoDateTime),
  timeMax: Schema.optional(IsoDateTime),
});
export type GoogleSearchFilesInput = typeof GoogleSearchFilesInput.Type;
export const GoogleSearchFilesResult = Schema.Struct({
  files: Schema.Array(GoogleFileSummary),
  hasMore: Schema.Boolean,
});
/** A calendar the account can read, and whether it is ticked in Google Calendar. */
export const GoogleCalendarSummary = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  primary: Schema.Boolean,
  selected: Schema.Boolean,
});
export type GoogleCalendarSummary = typeof GoogleCalendarSummary.Type;
export const GoogleListCalendarsResult = Schema.Struct({
  calendars: Schema.Array(GoogleCalendarSummary),
});
export type GoogleListCalendarsResult = typeof GoogleListCalendarsResult.Type;
export const GoogleSearchPeopleInput = Schema.Struct({
  query: TrimmedNonEmptyString.check(Schema.isMaxLength(256)),
});
export type GoogleSearchPeopleInput = typeof GoogleSearchPeopleInput.Type;
/** Someone in the account's Workspace directory. Their calendar id is their email. */
export const GooglePerson = Schema.Struct({
  name: Schema.String,
  email: Schema.String,
});
export type GooglePerson = typeof GooglePerson.Type;
export const GoogleSearchPeopleResult = Schema.Struct({
  people: Schema.Array(GooglePerson),
  /** False when the connection predates directory access and needs reconnecting. */
  directoryAvailable: Schema.Boolean,
});
export type GoogleSearchPeopleResult = typeof GoogleSearchPeopleResult.Type;
export const GoogleGetFileInput = Schema.Struct({
  id: TrimmedNonEmptyString.check(Schema.isMaxLength(2048)),
});
export type GoogleGetFileInput = typeof GoogleGetFileInput.Type;
export const GoogleFileContext = Schema.Struct({
  ...GoogleFileSummary.fields,
  /** Watches still detect edits beyond the bounded content preview. */
  revision: Schema.optional(Schema.String.check(Schema.isMaxLength(256))),
  location: Schema.optional(Schema.String),
  grid: Schema.optional(Schema.Array(Schema.Array(Schema.String))),
  markdown: Schema.String.check(Schema.isMaxLength(GOOGLE_FILE_MARKDOWN_MAX_CHARS)),
});
export type GoogleFileContext = typeof GoogleFileContext.Type;
/**
 * A Google page linked to a thread and its chat tabs, the same way a Linear issue is. `groupId`
 * is the tab group's id (the thread itself when it has no tabs). The title and url are copied
 * when linked.
 */
export const GoogleThreadLink = Schema.Struct({
  groupId: ThreadId,
  threadIds: Schema.Array(ThreadId),
  fileId: Schema.String,
  fileType: Schema.Literals(["doc", "sheet", "drive", "folder", "slides", "event", "email"]),
  title: Schema.String,
  url: Schema.String,
  linkedAt: IsoDateTime,
});
export type GoogleThreadLink = typeof GoogleThreadLink.Type;
export const GoogleThreadLinks = Schema.Array(GoogleThreadLink);
export type GoogleThreadLinks = typeof GoogleThreadLinks.Type;
/** Links the thread's tab group to a page (id or link), replacing any page it was linked to. */
export const GoogleLinkThreadInput = Schema.Struct({
  threadId: ThreadId,
  fileId: TrimmedNonEmptyString.check(Schema.isMaxLength(2048)),
});
export type GoogleLinkThreadInput = typeof GoogleLinkThreadInput.Type;
export const GoogleUnlinkThreadInput = Schema.Struct({ threadId: ThreadId });
export type GoogleUnlinkThreadInput = typeof GoogleUnlinkThreadInput.Type;
export class GoogleError extends Schema.TaggedError<GoogleError>()("GoogleError", {
  reason: Schema.Literals([
    "not-configured",
    "not-connected",
    "revoked",
    "rate-limited",
    "not-found",
    "login",
    "api",
  ]),
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  static login(detail: string, cause?: unknown): GoogleError {
    return new GoogleError({ reason: "login", detail, ...(cause === undefined ? {} : { cause }) });
  }
  override get message(): string {
    return this.detail;
  }
}

export interface GoogleFileLocation {
  readonly fileId: string;
  readonly fileType: "doc" | "sheet" | "drive" | "folder" | "slides" | "event" | "email";
  readonly gmailThreadId?: string;
  readonly calendarId?: string;
  readonly eventId?: string;
  readonly tab?: string;
  readonly heading?: string;
  readonly gid?: string;
  readonly range?: string;
}

/** Native Google links carry the same location when pasted, cited, linked, or watched. */
export function parseGoogleFileLink(value: string): GoogleFileLocation | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !["docs.google.com", "drive.google.com", "calendar.google.com", "mail.google.com"].includes(
        url.hostname,
      ) ||
      url.username ||
      url.password ||
      url.port
    )
      return null;
    if (url.hostname === "mail.google.com") {
      if (!/^\/mail(?:\/u\/\d+)?\/?$/.test(url.pathname)) return null;
      const id =
        /^(?:inbox|all|sent|trash|spam|starred|snoozed|important|search\/[^/]+|label\/[^/]+)\/([a-f0-9]{10,32})$/i.exec(
          url.hash.slice(1),
        )?.[1];
      return id ? { fileId: value, fileType: "email", gmailThreadId: id } : null;
    }
    if (url.hostname === "calendar.google.com") {
      const encoded = url.searchParams.getAll("eid");
      if (encoded.length > 1) return null;
      const eid = encoded[0] ?? /\/eventedit\/([\w=-]+)/.exec(url.pathname)?.[1];
      if (!eid || !/^[\w=-]+$/.test(eid)) return null;
      const decoded = atob(eid.replaceAll("-", "+").replaceAll("_", "/"));
      const parts = /^([\w-]+) ([^\s]+)$/.exec(decoded);
      if (!parts) return null;
      return { fileId: value, fileType: "event", eventId: parts[1]!, calendarId: parts[2]! };
    }
    if (url.hostname === "drive.google.com") {
      const folder = /\/folders\/([\w-]+)/.exec(url.pathname)?.[1];
      const ids = url.searchParams.getAll("id");
      if (ids.length > 1) return null;
      const fileId = folder ?? /\/file\/d\/([\w-]+)/.exec(url.pathname)?.[1] ?? ids[0];
      return fileId && /^[\w-]+$/.test(fileId)
        ? { fileId, fileType: folder ? "folder" : "drive" }
        : null;
    }
    const match = /^\/(document|spreadsheets|presentation)\/(?:u\/\d+\/)?d\/([\w-]+)(?:\/|$)/.exec(
      url.pathname,
    );
    if (!match) return null;
    const fileType =
      match[1] === "document" ? "doc" : match[1] === "presentation" ? "slides" : "sheet";
    const fragment = new URLSearchParams(url.hash.slice(1));
    const result: GoogleFileLocation = { fileId: match[2]!, fileType };
    const selectors: Record<string, string> = {};
    for (const key of fileType === "doc" ? ["tab", "heading"] : ["gid", "range"]) {
      const values = [...url.searchParams.getAll(key), ...fragment.getAll(key)];
      if (values.length > 1 || values.some((v) => !v || v.length > 256)) return null;
      if (values[0]) selectors[key] = values[0];
    }
    if (selectors.gid && !/^\d+$/.test(selectors.gid)) return null;
    if (selectors.range && !/^[A-Z]+[1-9]\d*(?::[A-Z]+[1-9]\d*)?$/i.test(selectors.range))
      return null;
    return { ...result, ...selectors };
  } catch {
    return null;
  }
}
