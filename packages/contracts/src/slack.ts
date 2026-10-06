import * as Schema from "effect/Schema";

import { IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas.ts";

/** Longest rendered thread sent to a client or inlined into a prompt. */
export const SLACK_THREAD_MARKDOWN_MAX_CHARS = 32_000;

const SlackId = TrimmedNonEmptyString.check(Schema.isMaxLength(64));
/** A message timestamp such as `1727779620.000100`, Slack's id for a message in a channel. */
export const SlackMessageTs = TrimmedNonEmptyString.check(Schema.isPattern(/^\d{1,12}\.\d{1,9}$/));

/**
 * Where Slack sends the browser after sign-in. Slack only treats `localhost` (not `127.0.0.1`)
 * as a desktop redirect for PKCE apps, and matches it exactly, port included, so the server's
 * loopback listener uses this fixed port and the app manifest registers this URL.
 */
export const SLACK_REDIRECT_URI = "http://localhost:47832/callback";

/** Read-only user scopes: search, read every kind of conversation, and resolve names. */
export const SLACK_USER_SCOPES = [
  "search:read",
  "channels:history",
  "groups:history",
  "im:history",
  "mpim:history",
  "channels:read",
  "groups:read",
  "im:read",
  "mpim:read",
  "users:read",
] as const;

/**
 * The Slack app manifest to create a workspace's own app from. An app used only in the
 * workspace that made it keeps Slack's normal rate limits; a distributed one without Marketplace
 * approval can read only 15 thread messages a minute.
 */
export function slackAppManifest(): string {
  return JSON.stringify(
    {
      display_information: {
        name: "T3 Code",
        description: "Attach Slack messages to T3 Code chats. Reads as you; never posts.",
      },
      oauth_config: {
        redirect_urls: [SLACK_REDIRECT_URI],
        scopes: { user: SLACK_USER_SCOPES },
        pkce_enabled: true,
      },
      settings: { org_deploy_enabled: false, socket_mode_enabled: false },
    },
    null,
    2,
  );
}

export const SlackAccount = Schema.Struct({
  userId: Schema.String,
  userName: Schema.String,
  teamId: Schema.String,
  teamName: Schema.String,
  /** Workspace URL such as `https://focaldata.slack.com/`. */
  teamUrl: Schema.String,
});
export type SlackAccount = typeof SlackAccount.Type;

/**
 * The environment's Slack connection. Each workspace connects through its own Slack app, so the
 * state carries the client ID last used to sign in, for the settings form to offer again.
 * `waiting` carries the authorization URL the client opens; as with Linear, the server completes
 * the flow when the browser reaches its loopback callback, otherwise the client pastes the
 * redirect URL back through `slack.completeLogin`.
 */
export const SlackConnectionState = Schema.Struct({
  phase: Schema.Literals(["disconnected", "waiting", "connected", "failed"]),
  account: Schema.NullOr(SlackAccount),
  clientId: Schema.NullOr(Schema.String),
  flowId: Schema.NullOr(TrimmedNonEmptyString),
  authorizationUrl: Schema.NullOr(Schema.String),
  expiresAt: Schema.NullOr(IsoDateTime),
  message: Schema.NullOr(Schema.String),
});
export type SlackConnectionState = typeof SlackConnectionState.Type;

export const SlackStartLoginInput = Schema.Struct({
  /** The Slack app's client ID. Falls back to the one last used, then `T3CODE_SLACK_CLIENT_ID`. */
  clientId: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(128))),
});
export type SlackStartLoginInput = typeof SlackStartLoginInput.Type;

export const SlackCompleteLoginInput = Schema.Struct({
  flowId: TrimmedNonEmptyString,
  callbackUrl: TrimmedNonEmptyString.check(Schema.isMaxLength(4_096)),
});
export type SlackCompleteLoginInput = typeof SlackCompleteLoginInput.Type;

export const SlackCancelLoginInput = Schema.Struct({
  flowId: TrimmedNonEmptyString,
});
export type SlackCancelLoginInput = typeof SlackCancelLoginInput.Type;

/** One search result. `threadTs` is set when the message is a reply in a thread. */
export const SlackMessageSummary = Schema.Struct({
  channelId: Schema.String,
  /** `#name` for a channel, `@Name` for a direct message, as the user would recognise it. */
  channelLabel: Schema.String,
  ts: Schema.String,
  threadTs: Schema.NullOr(Schema.String),
  authorName: Schema.String,
  /** The message as plain text, mentions resolved, cut to a preview. */
  text: Schema.String,
  url: Schema.String,
  postedAt: IsoDateTime,
});
export type SlackMessageSummary = typeof SlackMessageSummary.Type;

/** `slack.searchMessages` payload: Slack's own search syntax (`in:#channel`, `from:@name`). */
export const SlackSearchMessagesInput = Schema.Struct({
  query: Schema.String.check(Schema.isMaxLength(256)),
});
export type SlackSearchMessagesInput = typeof SlackSearchMessagesInput.Type;

export const SlackSearchMessagesResult = Schema.Struct({
  messages: Schema.Array(SlackMessageSummary),
});
export type SlackSearchMessagesResult = typeof SlackSearchMessagesResult.Type;

/**
 * Which message to snapshot. `thread` takes the whole thread the message belongs to (or starts),
 * with this message marked; `message` takes the message alone.
 */
export const SlackGetThreadInput = Schema.Struct({
  channelId: SlackId,
  ts: SlackMessageTs,
  threadTs: Schema.optional(SlackMessageTs),
  url: TrimmedNonEmptyString.check(Schema.isMaxLength(2_048)),
  scope: Schema.Literals(["thread", "message"]),
});
export type SlackGetThreadInput = typeof SlackGetThreadInput.Type;

/** A thread or message snapshot: who and where, plus a server-rendered markdown body. */
export const SlackThreadContext = Schema.Struct({
  teamId: Schema.String,
  channelId: Schema.String,
  channelLabel: Schema.String,
  ts: Schema.String,
  threadTs: Schema.NullOr(Schema.String),
  url: Schema.String,
  authorName: Schema.String,
  /** The linked message's first line, for previews. */
  title: Schema.String,
  /** Replies in the thread; 0 for a message that started none, or when only the message was taken. */
  replyCount: Schema.Number,
  scope: Schema.Literals(["thread", "message"]),
  markdown: Schema.String.check(Schema.isMaxLength(SLACK_THREAD_MARKDOWN_MAX_CHARS)),
});
export type SlackThreadContext = typeof SlackThreadContext.Type;

/** `slack.getLinkPreview` payload: the message a bare permalink in a chat message names. */
export const SlackLinkPreviewInput = Schema.Struct({
  channelId: SlackId,
  ts: SlackMessageTs,
  threadTs: Schema.optional(SlackMessageTs),
  url: TrimmedNonEmptyString.check(Schema.isMaxLength(2_048)),
});
export type SlackLinkPreviewInput = typeof SlackLinkPreviewInput.Type;

/** What a bare Slack link shows in place of its URL. The server reads it once and keeps it. */
export const SlackLinkPreview = Schema.Struct({
  channelLabel: Schema.String,
  authorName: Schema.String,
  /** The linked message's first line. */
  title: Schema.String,
});
export type SlackLinkPreview = typeof SlackLinkPreview.Type;

export const SlackErrorReason = Schema.Literals([
  "not-configured",
  "not-connected",
  "revoked",
  "rate-limited",
  "not-found",
  "login",
  "api",
]);
export type SlackErrorReason = typeof SlackErrorReason.Type;

export class SlackError extends Schema.TaggedError<SlackError>()("SlackError", {
  reason: SlackErrorReason,
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return this.detail;
  }
}
