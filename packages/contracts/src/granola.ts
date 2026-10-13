import * as Schema from "effect/Schema";
import { IsoDateTime, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const GRANOLA_NOTE_MARKDOWN_MAX_CHARS = 64_000;

export const GranolaAccount = Schema.Struct({
  email: Schema.String,
  /** The Granola workspace whose notes the connection reads. */
  workspaceName: Schema.NullOr(Schema.String),
});
export type GranolaAccount = typeof GranolaAccount.Type;

/**
 * Granola signs in with the OAuth device flow: the user opens `verificationUrl` on any device
 * and approves `userCode`, so no redirect has to reach the environment.
 */
export const GranolaConnectionState = Schema.Struct({
  phase: Schema.Literals(["disconnected", "waiting", "connected", "failed"]),
  account: Schema.NullOr(GranolaAccount),
  flowId: Schema.NullOr(TrimmedNonEmptyString),
  verificationUrl: Schema.NullOr(Schema.String),
  userCode: Schema.NullOr(Schema.String),
  expiresAt: Schema.NullOr(IsoDateTime),
  message: Schema.NullOr(Schema.String),
});
export type GranolaConnectionState = typeof GranolaConnectionState.Type;

export const GranolaCancelLoginInput = Schema.Struct({ flowId: TrimmedNonEmptyString });
export type GranolaCancelLoginInput = typeof GranolaCancelLoginInput.Type;

export const GranolaNoteSummary = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  url: Schema.String,
  /** When the meeting happened, or the note was created when it had no event. */
  meetingAt: Schema.NullOr(IsoDateTime),
  /** Who was in the meeting, by name, as Granola lists them. */
  participants: Schema.Array(Schema.String),
  /** Who took the note in Granola, when Granola says. */
  creator: Schema.NullOr(Schema.String),
});
export type GranolaNoteSummary = typeof GranolaNoteSummary.Type;

export const GranolaSearchNotesInput = Schema.Struct({
  query: Schema.String.check(Schema.isMaxLength(256)),
});
export type GranolaSearchNotesInput = typeof GranolaSearchNotesInput.Type;
export const GranolaSearchNotesResult = Schema.Struct({
  notes: Schema.Array(GranolaNoteSummary),
});
export type GranolaSearchNotesResult = typeof GranolaSearchNotesResult.Type;

export const GranolaGetNoteInput = Schema.Struct({
  id: TrimmedNonEmptyString.check(Schema.isMaxLength(2048)),
});
export type GranolaGetNoteInput = typeof GranolaGetNoteInput.Type;
export const GranolaNoteContext = Schema.Struct({
  ...GranolaNoteSummary.fields,
  markdown: Schema.String.check(Schema.isMaxLength(GRANOLA_NOTE_MARKDOWN_MAX_CHARS)),
});
export type GranolaNoteContext = typeof GranolaNoteContext.Type;

/**
 * A Granola note linked to a thread and its chat tabs, the same way a Notion page is. `groupId`
 * is the tab group's id (the thread itself when it has no tabs). The title and url are copied
 * when linked.
 */
export const GranolaThreadLink = Schema.Struct({
  groupId: ThreadId,
  threadIds: Schema.Array(ThreadId),
  noteId: Schema.String,
  title: Schema.String,
  url: Schema.String,
  linkedAt: IsoDateTime,
});
export type GranolaThreadLink = typeof GranolaThreadLink.Type;
export const GranolaThreadLinks = Schema.Array(GranolaThreadLink);
export type GranolaThreadLinks = typeof GranolaThreadLinks.Type;
/** Links the thread's tab group to a note (id or link), replacing any note it was linked to. */
export const GranolaLinkThreadInput = Schema.Struct({
  threadId: ThreadId,
  noteId: TrimmedNonEmptyString.check(Schema.isMaxLength(2048)),
});
export type GranolaLinkThreadInput = typeof GranolaLinkThreadInput.Type;
export const GranolaUnlinkThreadInput = Schema.Struct({ threadId: ThreadId });
export type GranolaUnlinkThreadInput = typeof GranolaUnlinkThreadInput.Type;

export class GranolaError extends Schema.TaggedError<GranolaError>()("GranolaError", {
  reason: Schema.Literals([
    "not-connected",
    "revoked",
    "rate-limited",
    "not-found",
    "login",
    "api",
  ]),
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu;
const NOTE_ID = /^not_[a-zA-Z0-9]{14}$/u;
const LINK_SEGMENT =
  /^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})(?:-[a-z0-9]+)?$/iu;

/**
 * The meeting a Granola note link names (`https://notes.granola.ai/d/<uuid>`, or a shared
 * `/t/<uuid>-<code>` link), or a bare meeting
 * UUID or `not_…` note id. Granola's MCP server reads either form.
 */
export function parseGranolaNoteId(value: string): string | null {
  const trimmed = value.trim();
  if (UUID.test(trimmed)) return trimmed.toLowerCase();
  if (NOTE_ID.test(trimmed)) return trimmed;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !(host === "granola.ai" || host.endsWith(".granola.ai"))
  )
    return null;
  // Shared links (`/t/<uuid>-<share code>`) append a code to the meeting UUID.
  const segment = url.pathname.split("/").findLast(Boolean) ?? "";
  return LINK_SEGMENT.exec(segment)?.[1]?.toLowerCase() ?? null;
}
