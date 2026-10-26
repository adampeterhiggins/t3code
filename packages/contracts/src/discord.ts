import * as Schema from "effect/Schema";

import { IsoDateTime, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ChatThreadMessages } from "./chatThread.ts";

/** Longest rendered thread sent to a client or inlined into a prompt. */
export const DISCORD_THREAD_MARKDOWN_MAX_CHARS = 32_000;

/** A Discord id: a snowflake, a 64-bit integer written in decimal. */
export const DiscordSnowflake = TrimmedNonEmptyString.check(Schema.isPattern(/^\d{15,25}$/));

/**
 * What the bot needs in each server: View Channels (1024) and Read Message History (65536).
 * It never posts.
 */
const DISCORD_BOT_PERMISSIONS = "66560";

/** The page that adds the bot to a server the user manages. */
export function discordBotInviteUrl(applicationId: string): string {
  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", applicationId);
  url.searchParams.set("scope", "bot");
  url.searchParams.set("permissions", DISCORD_BOT_PERMISSIONS);
  return url.toString();
}

/** The bot the environment reads Discord as. */
export const DiscordAccount = Schema.Struct({
  botUserId: Schema.String,
  botName: Schema.String,
  applicationId: Schema.String,
});
export type DiscordAccount = typeof DiscordAccount.Type;

/**
 * The environment's Discord connection. Discord gives user sign-in no access to messages, so the
 * environment reads as a bot the user creates and adds to their servers.
 */
export const DiscordConnectionState = Schema.Struct({
  phase: Schema.Literals(["disconnected", "connected", "failed"]),
  account: Schema.NullOr(DiscordAccount),
  message: Schema.NullOr(Schema.String),
});
export type DiscordConnectionState = typeof DiscordConnectionState.Type;

export const DiscordConnectInput = Schema.Struct({
  botToken: TrimmedNonEmptyString.check(Schema.isMaxLength(256)),
});
export type DiscordConnectInput = typeof DiscordConnectInput.Type;

/** A server (guild) the bot has been added to. */
export const DiscordServer = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  iconUrl: Schema.NullOr(Schema.String),
});
export type DiscordServer = typeof DiscordServer.Type;

export const DiscordListServersResult = Schema.Struct({
  servers: Schema.Array(DiscordServer),
});
export type DiscordListServersResult = typeof DiscordListServersResult.Type;

/** `discord.leaveServer` payload: removes the bot from one server. */
export const DiscordLeaveServerInput = Schema.Struct({ guildId: DiscordSnowflake });
export type DiscordLeaveServerInput = typeof DiscordLeaveServerInput.Type;

/** One search result. */
export const DiscordMessageSummary = Schema.Struct({
  guildId: Schema.String,
  /** The channel or thread the message was posted in. */
  channelId: Schema.String,
  /** `#channel`, or `#channel › thread` for a message in a thread. */
  channelLabel: Schema.String,
  messageId: Schema.String,
  authorName: Schema.String,
  /** The message as plain text, mentions resolved, cut to a preview. */
  text: Schema.String,
  url: Schema.String,
  postedAt: IsoDateTime,
});
export type DiscordMessageSummary = typeof DiscordMessageSummary.Type;

/** `discord.searchMessages` payload: words to find in every server the bot is in. */
export const DiscordSearchMessagesInput = Schema.Struct({
  query: Schema.String.check(Schema.isMaxLength(256)),
});
export type DiscordSearchMessagesInput = typeof DiscordSearchMessagesInput.Type;

export const DiscordSearchMessagesResult = Schema.Struct({
  messages: Schema.Array(DiscordMessageSummary),
});
export type DiscordSearchMessagesResult = typeof DiscordSearchMessagesResult.Type;

/**
 * Which message to snapshot. `thread` takes the whole Discord thread the message is in (or
 * starts), with this message marked; `message` takes the message alone.
 */
export const DiscordGetThreadInput = Schema.Struct({
  guildId: DiscordSnowflake,
  channelId: DiscordSnowflake,
  messageId: DiscordSnowflake,
  url: TrimmedNonEmptyString.check(Schema.isMaxLength(2_048)),
  scope: Schema.Literals(["thread", "message"]),
});
export type DiscordGetThreadInput = typeof DiscordGetThreadInput.Type;

/** A thread or message snapshot: who and where, plus a server-rendered markdown body. */
export const DiscordThreadContext = Schema.Struct({
  guildId: Schema.String,
  channelId: Schema.String,
  channelLabel: Schema.String,
  messageId: Schema.String,
  /** The Discord thread the message is in or starts; null for a plain channel message. */
  threadId: Schema.NullOr(Schema.String),
  url: Schema.String,
  authorName: Schema.String,
  /** The linked message's first line, for previews. */
  title: Schema.String,
  /** Messages in the thread besides its first; 0 when only the message was taken. */
  replyCount: Schema.Number,
  scope: Schema.Literals(["thread", "message"]),
  markdown: Schema.String.check(Schema.isMaxLength(DISCORD_THREAD_MARKDOWN_MAX_CHARS)),
  /** The messages the markdown kept, for clients to draw. */
  messages: ChatThreadMessages,
});
export type DiscordThreadContext = typeof DiscordThreadContext.Type;

/** `discord.getLinkPreview` payload: the message a bare link in a chat message names. */
export const DiscordLinkPreviewInput = Schema.Struct({
  guildId: DiscordSnowflake,
  channelId: DiscordSnowflake,
  messageId: DiscordSnowflake,
  url: TrimmedNonEmptyString.check(Schema.isMaxLength(2_048)),
});
export type DiscordLinkPreviewInput = typeof DiscordLinkPreviewInput.Type;

/** What a bare Discord link shows in place of its URL. The server reads it once and keeps it. */
export const DiscordLinkPreview = Schema.Struct({
  channelLabel: Schema.String,
  authorName: Schema.String,
  /** The linked message's first line. */
  title: Schema.String,
});
export type DiscordLinkPreview = typeof DiscordLinkPreview.Type;

/**
 * A Discord thread or message linked to a T3 thread and its chat tabs, the same way a Slack
 * thread is. `groupId` is the tab group's id (the thread itself when it has no tabs). The
 * channel, author, and first line are copied when linked and shown as they were.
 */
export const DiscordThreadLink = Schema.Struct({
  groupId: ThreadId,
  threadIds: Schema.Array(ThreadId),
  guildId: Schema.String,
  channelId: Schema.String,
  messageId: Schema.String,
  channelLabel: Schema.String,
  authorName: Schema.String,
  /** The picked message's first line. */
  title: Schema.String,
  url: Schema.String,
  linkedAt: IsoDateTime,
});
export type DiscordThreadLink = typeof DiscordThreadLink.Type;

export const DiscordThreadLinks = Schema.Array(DiscordThreadLink);
export type DiscordThreadLinks = typeof DiscordThreadLinks.Type;

/** Links the thread's tab group to a Discord message and its thread, replacing any earlier link. */
export const DiscordLinkThreadInput = Schema.Struct({
  threadId: ThreadId,
  guildId: DiscordSnowflake,
  channelId: DiscordSnowflake,
  messageId: DiscordSnowflake,
  url: TrimmedNonEmptyString.check(Schema.isMaxLength(2_048)),
});
export type DiscordLinkThreadInput = typeof DiscordLinkThreadInput.Type;

export const DiscordUnlinkThreadInput = Schema.Struct({ threadId: ThreadId });
export type DiscordUnlinkThreadInput = typeof DiscordUnlinkThreadInput.Type;

export const DiscordErrorReason = Schema.Literals([
  "not-connected",
  "revoked",
  "rate-limited",
  "not-found",
  "login",
  "api",
]);
export type DiscordErrorReason = typeof DiscordErrorReason.Type;

export class DiscordError extends Schema.TaggedError<DiscordError>()("DiscordError", {
  reason: DiscordErrorReason,
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return this.detail;
  }
}
