import * as Schema from "effect/Schema";
import { IsoDateTime, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const NOTION_PAGE_MARKDOWN_MAX_CHARS = 64_000;
/** Notion rejects IP-address redirect URIs, so this uses `localhost`. */
export const NOTION_REDIRECT_URI = "http://localhost:47833/callback";
export const NotionAccount = Schema.Struct({
  workspaceId: Schema.String,
  workspaceName: Schema.String,
});
export type NotionAccount = typeof NotionAccount.Type;
export const NotionConnectionState = Schema.Struct({
  phase: Schema.Literals(["disconnected", "waiting", "connected", "failed"]),
  /** Whether the environment has a client ID and secret to sign in with. */
  configured: Schema.Boolean,
  /** The client ID it signs in with; the secret never leaves the server. */
  clientId: Schema.NullOr(Schema.String),
  /**
   * The redirect URI the connection must register: `NOTION_REDIRECT_URI`, or
   * the server's own callback when `T3CODE_NOTION_REDIRECT_URI` is set. Older
   * servers omit it and always use `NOTION_REDIRECT_URI`.
   */
  redirectUri: Schema.optional(Schema.String),
  account: Schema.NullOr(NotionAccount),
  flowId: Schema.NullOr(TrimmedNonEmptyString),
  authorizationUrl: Schema.NullOr(Schema.String),
  expiresAt: Schema.NullOr(IsoDateTime),
  message: Schema.NullOr(Schema.String),
});
export type NotionConnectionState = typeof NotionConnectionState.Type;
export const NotionClientCredentials = Schema.Struct({
  clientId: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  clientSecret: TrimmedNonEmptyString.check(Schema.isMaxLength(512)),
});
export type NotionClientCredentials = typeof NotionClientCredentials.Type;
/** Without credentials, sign-in reuses the saved ones, then the environment's. */
export const NotionStartLoginInput = Schema.Struct({
  credentials: Schema.optional(NotionClientCredentials),
});
export type NotionStartLoginInput = typeof NotionStartLoginInput.Type;
export const NotionCompleteLoginInput = Schema.Struct({
  flowId: TrimmedNonEmptyString,
  callbackUrl: TrimmedNonEmptyString.check(Schema.isMaxLength(4096)),
});
export type NotionCompleteLoginInput = typeof NotionCompleteLoginInput.Type;
export const NotionCancelLoginInput = Schema.Struct({ flowId: TrimmedNonEmptyString });
export type NotionCancelLoginInput = typeof NotionCancelLoginInput.Type;
export const NotionPageSummary = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  url: Schema.String,
  updatedAt: IsoDateTime,
});
export type NotionPageSummary = typeof NotionPageSummary.Type;
export const NotionSearchPagesInput = Schema.Struct({
  query: Schema.String.check(Schema.isMaxLength(256)),
});
export type NotionSearchPagesInput = typeof NotionSearchPagesInput.Type;
export const NotionSearchPagesResult = Schema.Struct({
  pages: Schema.Array(NotionPageSummary),
  hasMore: Schema.Boolean,
});
export const NotionGetPageInput = Schema.Struct({
  id: TrimmedNonEmptyString.check(Schema.isMaxLength(2048)),
});
export type NotionGetPageInput = typeof NotionGetPageInput.Type;
export const NotionPageContext = Schema.Struct({
  ...NotionPageSummary.fields,
  markdown: Schema.String.check(Schema.isMaxLength(NOTION_PAGE_MARKDOWN_MAX_CHARS)),
});
export type NotionPageContext = typeof NotionPageContext.Type;
/**
 * A Notion page linked to a thread and its chat tabs, the same way a Linear issue is. `groupId`
 * is the tab group's id (the thread itself when it has no tabs). The title and url are copied
 * when linked.
 */
export const NotionThreadLink = Schema.Struct({
  groupId: ThreadId,
  threadIds: Schema.Array(ThreadId),
  pageId: Schema.String,
  title: Schema.String,
  url: Schema.String,
  linkedAt: IsoDateTime,
});
export type NotionThreadLink = typeof NotionThreadLink.Type;
export const NotionThreadLinks = Schema.Array(NotionThreadLink);
export type NotionThreadLinks = typeof NotionThreadLinks.Type;
/** Links the thread's tab group to a page (id or link), replacing any page it was linked to. */
export const NotionLinkThreadInput = Schema.Struct({
  threadId: ThreadId,
  pageId: TrimmedNonEmptyString.check(Schema.isMaxLength(2048)),
});
export type NotionLinkThreadInput = typeof NotionLinkThreadInput.Type;
export const NotionUnlinkThreadInput = Schema.Struct({ threadId: ThreadId });
export type NotionUnlinkThreadInput = typeof NotionUnlinkThreadInput.Type;
export class NotionError extends Schema.TaggedError<NotionError>()("NotionError", {
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
}) {
  override get message(): string {
    return this.detail;
  }
}

/** Notion page URLs end in a UUID, with or without a title slug and UUID hyphens. */
export function parseNotionPageId(value: string): string | null {
  const uuid = /^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/iu;
  let id = value;
  if (!uuid.test(id)) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return null;
    }
    const host = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !(
        host === "notion.so" ||
        host.endsWith(".notion.so") ||
        host === "notion.com" ||
        host.endsWith(".notion.com") ||
        host === "notion.site" ||
        host.endsWith(".notion.site")
      )
    )
      return null;
    const segment = url.pathname.split("/").findLast(Boolean) ?? "";
    id =
      segment.match(
        /(?:^|-)([a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/iu,
      )?.[1] ?? "";
  }
  if (!uuid.test(id)) return null;
  const compact = id.replaceAll("-", "").toLowerCase();
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}
