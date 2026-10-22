import {
  DISCORD_THREAD_MARKDOWN_MAX_CHARS,
  DiscordError,
  type DiscordGetThreadInput,
  type DiscordLeaveServerInput,
  type DiscordListServersResult,
  DiscordLinkPreview,
  type DiscordServer,
  type DiscordLinkPreviewInput,
  type DiscordMessageSummary,
  type DiscordSearchMessagesInput,
  type DiscordSearchMessagesResult,
  type DiscordThreadContext,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as KeyValueStore from "effect/persistence/KeyValueStore";

import { renderChatThread } from "../chatThreadMarkdown.ts";
import * as ServerConfig from "../config.ts";
import { DiscordAuth } from "./DiscordAuth.ts";
import {
  discordContentToMarkdown,
  discordMentionLabels,
  discordTimeToDisplay,
  mentionedChannelIds,
  millisToSnowflake,
} from "./discordMarkdown.ts";
import { type DiscordQuery, discordApiRequest } from "./discordRestApi.ts";

const PREVIEW_MAX_CHARS = 300;
const TITLE_MAX_CHARS = 200;
const SEARCH_RESULTS_MAX = 25;
const THREAD_PAGE = 100;
const THREAD_MESSAGES_MAX = 200;
const CHANNEL_CACHE_MAX = 5_000;
const GUILDS_TTL_MS = 5 * 60_000;
/** Text channel threads: announcement, public, private. */
const THREAD_TYPES = new Set([10, 11, 12]);
/** The placeholder a thread opens with, pointing at the message it was started from. */
const THREAD_STARTER_MESSAGE = 21;

const User = Schema.Struct({
  id: Schema.String,
  username: Schema.String,
  global_name: Schema.optional(Schema.NullOr(Schema.String)),
  avatar: Schema.optional(Schema.NullOr(Schema.String)),
});
type User = typeof User.Type;

const ChannelRef = Schema.Struct({
  id: Schema.String,
  type: Schema.Number,
  name: Schema.optional(Schema.NullOr(Schema.String)),
  guild_id: Schema.optional(Schema.String),
  parent_id: Schema.optional(Schema.NullOr(Schema.String)),
});
type ChannelRef = typeof ChannelRef.Type;

const MessageBase = Schema.Struct({
  id: Schema.String,
  channel_id: Schema.String,
  type: Schema.Number,
  content: Schema.String,
  timestamp: Schema.String,
  author: User,
  mentions: Schema.optional(Schema.Array(User)),
  attachments: Schema.optional(Schema.Array(Schema.Struct({ filename: Schema.String }))),
  thread: Schema.optional(ChannelRef),
});
const Message = Schema.Struct({
  ...MessageBase.fields,
  referenced_message: Schema.optional(Schema.NullOr(MessageBase)),
});
type Message = typeof MessageBase.Type;

const Guild = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  icon: Schema.optional(Schema.NullOr(Schema.String)),
});
const SearchData = Schema.Struct({
  messages: Schema.Array(Schema.Array(MessageBase)),
  threads: Schema.optional(Schema.Array(ChannelRef)),
});

const collapse = (text: string, maxChars: number) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= maxChars ? flat : `${flat.slice(0, maxChars - 1).trimEnd()}…`;
};

const authorName = (user: User) => user.global_name || user.username;

/** Someone with no avatar of their own gets one of Discord's six defaults, picked from their id. */
const avatarUrl = (user: User) =>
  user.avatar
    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`
    : `https://cdn.discordapp.com/embed/avatars/${(BigInt(user.id) >> 22n) % 6n}.png`;

export const discordMessageUrl = (guildId: string, channelId: string, messageId: string) =>
  `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;

/** A message that @mentions a user, as the mention trigger reads it. */
export interface DiscordMention {
  readonly guildId: string;
  readonly channelId: string;
  /** The channel's name, or a thread's own name. */
  readonly channelName: string | null;
  /** For a message in a thread, the channel the thread is under. */
  readonly parentId: string | null;
  readonly parentName: string | null;
  readonly messageId: string;
  readonly authorId: string;
  /** Discord's own content, mentions unresolved. */
  readonly content: string;
  readonly url: string;
}

export class DiscordApi extends Context.Service<
  DiscordApi,
  {
    /** Every server the bot is in, read fresh each time. */
    readonly listServers: Effect.Effect<DiscordListServersResult, DiscordError>;
    /** Removes the bot from a server; reading it again needs a new invite. */
    readonly leaveServer: (input: DiscordLeaveServerInput) => Effect.Effect<void, DiscordError>;
    readonly searchMessages: (
      input: DiscordSearchMessagesInput,
    ) => Effect.Effect<DiscordSearchMessagesResult, DiscordError>;
    readonly getThread: (
      input: DiscordGetThreadInput,
    ) => Effect.Effect<DiscordThreadContext, DiscordError>;
    /** The newest messages that @mention `userId`, posted after `afterMs`, in every server. */
    readonly searchMentions: (input: {
      readonly userId: string;
      readonly afterMs: number;
    }) => Effect.Effect<ReadonlyArray<DiscordMention>, DiscordError>;
    /** Who and where a bare link points, read once and kept. Needs a connected bot. */
    readonly getLinkPreview: (
      input: DiscordLinkPreviewInput,
    ) => Effect.Effect<DiscordLinkPreview, DiscordError>;
  }
>()("t3/discord/DiscordApi") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const auth = yield* DiscordAuth;
  const services = Context.make(HttpClient.HttpClient, yield* HttpClient.HttpClient);
  const previews = KeyValueStore.toSchemaStore(
    yield* KeyValueStore.KeyValueStore,
    DiscordLinkPreview,
  );
  // Channel names rarely change; the cap keeps a long-lived server from growing it without bound.
  const channels = new Map<string, ChannelRef>();
  let guildsCache: { readonly atMs: number; readonly ids: ReadonlyArray<string> } | null = null;

  const call = <S extends Schema.Top>(
    path: string,
    query: DiscordQuery,
    data: S,
    method: "GET" | "DELETE" = "GET",
  ) =>
    auth.botToken.pipe(
      Effect.flatMap((token) => discordApiRequest(token, path, query, data, method)),
      Effect.tapError((error) => (error.reason === "revoked" ? auth.markRevoked : Effect.void)),
      Effect.provide(services),
    );

  const remember = (channel: ChannelRef) => {
    if (channels.size > CHANNEL_CACHE_MAX) channels.clear();
    channels.set(channel.id, channel);
  };

  const channelInfo = (id: string) => {
    const cached = channels.get(id);
    return cached === undefined
      ? call(`/channels/${id}`, [], ChannelRef).pipe(
          Effect.tap((channel) => Effect.sync(() => remember(channel))),
        )
      : Effect.succeed(cached);
  };

  /** Fills the channel cache for `ids` and their parents; one Discord will not describe stays out. */
  const resolveChannels = Effect.fn("discord.resolve_channels")(function* (ids: Iterable<string>) {
    const load = (wanted: Iterable<string>) =>
      Effect.forEach(
        [...new Set(wanted)].filter((id) => !channels.has(id)),
        (id) => Effect.ignore(channelInfo(id)),
        { concurrency: 4, discard: true },
      );
    yield* load(ids);
    yield* load(
      [...new Set(ids)].flatMap((id) => {
        const parent = channels.get(id)?.parent_id;
        return parent ? [parent] : [];
      }),
    );
  });

  const channelName = (id: string) => channels.get(id)?.name ?? null;

  /** `#channel`, or `#channel › thread` inside a thread. */
  const channelLabel = (id: string) => {
    const channel = channels.get(id);
    if (channel === undefined) return "#channel";
    if (THREAD_TYPES.has(channel.type) && channel.parent_id) {
      return `#${channelName(channel.parent_id) ?? "channel"} › ${channel.name ?? "thread"}`;
    }
    return `#${channel.name ?? channel.id}`;
  };

  const readGuilds = Effect.gen(function* () {
    const guilds = yield* call("/users/@me/guilds", [["limit", "200"]], Schema.Array(Guild));
    guildsCache = { atMs: yield* Clock.currentTimeMillis, ids: guilds.map((guild) => guild.id) };
    return guilds;
  });

  const guildIds = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    if (guildsCache !== null && now - guildsCache.atMs < GUILDS_TTL_MS) return guildsCache.ids;
    return (yield* readGuilds).map((guild) => guild.id);
  });

  /** Always read fresh, so a server the bot just joined shows up, and search sees it too. */
  const listServers = Effect.fn("discord.list_servers")(function* () {
    const guilds = yield* readGuilds;
    return {
      servers: guilds
        .map((guild): DiscordServer => ({
          id: guild.id,
          name: guild.name,
          iconUrl: guild.icon
            ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=64`
            : null,
        }))
        .toSorted((a, b) => a.name.localeCompare(b.name)),
    };
  });

  const leaveServer = Effect.fn("discord.leave_server")(function* (input: DiscordLeaveServerInput) {
    yield* call(`/users/@me/guilds/${input.guildId}`, [], Schema.Null, "DELETE");
    guildsCache = null;
  });

  /**
   * Searches every server the bot is in. A server that is still indexing or hides its channels
   * from the bot is skipped; a revoked token or the rate limit fails the whole search, as does
   * every server failing.
   */
  const searchGuilds = Effect.fn("discord.search_guilds")(function* (query: DiscordQuery) {
    const ids = yield* guildIds;
    if (ids.length === 0) {
      return yield* new DiscordError({
        reason: "not-found",
        detail: "The T3 Code bot isn't in any server yet. Add it from Settings → Integrations.",
      });
    }
    const results = yield* Effect.forEach(
      ids,
      (guildId) =>
        call(`/guilds/${guildId}/messages/search`, query, SearchData).pipe(
          Effect.map((data) => ({ guildId, data })),
          Effect.result,
        ),
      { concurrency: 4 },
    );
    const fatal = results.find(
      (result) =>
        Result.isFailure(result) &&
        (result.failure.reason === "revoked" || result.failure.reason === "rate-limited"),
    );
    if (fatal !== undefined && Result.isFailure(fatal)) return yield* fatal.failure;
    const found = results.flatMap((result) => (Result.isSuccess(result) ? [result.success] : []));
    const firstFailure = results.find(Result.isFailure);
    if (found.length === 0 && firstFailure !== undefined) return yield* firstFailure.failure;
    for (const { data } of found) for (const thread of data.threads ?? []) remember(thread);
    const messages = found
      .flatMap(({ guildId, data }) =>
        data.messages.flatMap((group) => group.map((message) => ({ guildId, message }))),
      )
      .toSorted((a, b) => (BigInt(b.message.id) > BigInt(a.message.id) ? 1 : -1));
    yield* resolveChannels(messages.map(({ message }) => message.channel_id));
    return messages;
  });

  const namesFor = (messages: ReadonlyArray<Message>) => {
    const users = new Map<string, string>();
    for (const message of messages) {
      users.set(message.author.id, authorName(message.author));
      for (const user of message.mentions ?? []) users.set(user.id, authorName(user));
    }
    const channelNames = new Map<string, string>();
    for (const [id, channel] of channels) if (channel.name) channelNames.set(id, channel.name);
    return { users, channels: channelNames };
  };

  const searchMessages = Effect.fn("discord.search_messages")(function* (
    input: DiscordSearchMessagesInput,
  ) {
    const query = input.query.trim();
    if (query.length === 0) return { messages: [] };
    const found = yield* searchGuilds([
      ["content", query],
      ["limit", String(SEARCH_RESULTS_MAX)],
    ]);
    const top = found.slice(0, SEARCH_RESULTS_MAX);
    yield* resolveChannels(top.flatMap(({ message }) => mentionedChannelIds(message.content)));
    const names = namesFor(top.map(({ message }) => message));
    return {
      messages: top.map(({ guildId, message }): DiscordMessageSummary => ({
        guildId,
        channelId: message.channel_id,
        channelLabel: channelLabel(message.channel_id),
        messageId: message.id,
        authorName: authorName(message.author),
        text: collapse(discordContentToMarkdown(message.content, names), PREVIEW_MAX_CHARS),
        url: discordMessageUrl(guildId, message.channel_id, message.id),
        postedAt: message.timestamp,
      })),
    };
  });

  const searchMentions = Effect.fn("discord.search_mentions")(function* (input: {
    readonly userId: string;
    readonly afterMs: number;
  }) {
    const found = yield* searchGuilds([
      ["mentions", input.userId],
      ["min_id", millisToSnowflake(input.afterMs)],
      ["limit", String(SEARCH_RESULTS_MAX)],
    ]);
    return found.map(({ guildId, message }): DiscordMention => {
      const channel = channels.get(message.channel_id);
      const parentId =
        channel !== undefined && THREAD_TYPES.has(channel.type)
          ? (channel.parent_id ?? null)
          : null;
      return {
        guildId,
        channelId: message.channel_id,
        channelName: channel?.name ?? null,
        parentId,
        parentName: parentId === null ? null : channelName(parentId),
        messageId: message.id,
        authorId: message.author.id,
        content: message.content,
        url: discordMessageUrl(guildId, message.channel_id, message.id),
      };
    });
  });

  /** Up to `THREAD_MESSAGES_MAX` of the thread's newest messages, oldest first. */
  const readThreadMessages = Effect.fn("discord.read_thread_messages")(function* (
    threadId: string,
  ) {
    const collected: Array<Message> = [];
    let before: string | null = null;
    while (collected.length < THREAD_MESSAGES_MAX) {
      const query: DiscordQuery = [
        ["limit", String(THREAD_PAGE)],
        ...(before === null ? [] : ([["before", before]] as const)),
      ];
      const page = yield* call(`/channels/${threadId}/messages`, query, Schema.Array(Message));
      collected.push(...page);
      if (page.length < THREAD_PAGE) break;
      before = page.at(-1)!.id;
    }
    return collected.toReversed();
  });

  const getThread = Effect.fn("discord.get_thread")(function* (input: DiscordGetThreadInput) {
    const [channel, linked] = yield* Effect.all(
      [
        channelInfo(input.channelId),
        call(`/channels/${input.channelId}/messages/${input.messageId}`, [], Message),
      ],
      { concurrency: "unbounded" },
    );
    const threadId = THREAD_TYPES.has(channel.type)
      ? channel.id
      : linked.thread !== undefined
        ? linked.thread.id
        : null;
    if (linked.thread !== undefined) remember(linked.thread);

    let messages: ReadonlyArray<Message> = [linked];
    if (input.scope === "thread" && threadId !== null) {
      const thread = yield* channelInfo(threadId);
      const inThread = (yield* readThreadMessages(threadId)).filter(
        (message) => message.type !== THREAD_STARTER_MESSAGE,
      );
      // A thread started from a message keeps that message in the parent channel, under the
      // thread's id; a forum post keeps it in the thread.
      const starter =
        inThread.some((message) => message.id === threadId) || !thread.parent_id
          ? null
          : yield* call(`/channels/${thread.parent_id}/messages/${threadId}`, [], Message).pipe(
              Effect.option,
              Effect.map(Option.getOrNull),
            );
      const all = [...(starter === null ? [] : [starter]), ...inThread];
      if (!all.some((message) => message.id === linked.id)) all.push(linked);
      messages = all.toSorted((a, b) => (BigInt(a.id) > BigInt(b.id) ? 1 : -1));
    } else if (input.scope === "thread" && linked.referenced_message) {
      // A channel has no threads, so a reply carries the message it answers as its context.
      messages = [linked.referenced_message, linked];
    }

    yield* resolveChannels([
      input.channelId,
      ...messages.flatMap((message) => mentionedChannelIds(message.content)),
    ]);
    const names = namesFor(messages);
    const label = channelLabel(input.channelId);
    const linkedText = discordContentToMarkdown(linked.content, names);
    const title = linkedText
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    const rendered = renderChatThread(
      {
        service: "Discord",
        channelLabel: label,
        url: input.url,
        scope: input.scope,
        linkedId: input.messageId,
        messages: messages.map((message) => ({
          id: message.id,
          authorName: authorName(message.author),
          avatarUrl: avatarUrl(message.author),
          postedAt: discordTimeToDisplay(message.timestamp),
          postedAtIso: DateTime.formatIso(DateTime.makeUnsafe(message.timestamp)),
          text: discordContentToMarkdown(message.content, names),
          mentions: discordMentionLabels(message.content, names),
          files: (message.attachments ?? []).map((file) => file.filename),
        })),
      },
      DISCORD_THREAD_MARKDOWN_MAX_CHARS,
    );
    return {
      guildId: input.guildId,
      channelId: input.channelId,
      channelLabel: label,
      messageId: input.messageId,
      threadId,
      url: input.url,
      authorName: authorName(linked.author),
      title: title === undefined ? "Discord message" : title.slice(0, TITLE_MAX_CHARS),
      replyCount: input.scope === "thread" ? messages.length - 1 : 0,
      scope: input.scope,
      markdown: rendered.markdown,
      messages: rendered.messages,
    } satisfies DiscordThreadContext;
  });

  const getLinkPreview = Effect.fn("discord.get_link_preview")(function* (
    input: DiscordLinkPreviewInput,
  ) {
    yield* auth.account;
    // Message ids are unique across Discord.
    const key = input.messageId;
    const stored = yield* previews.get(key).pipe(Effect.orElseSucceed(() => Option.none()));
    if (Option.isSome(stored)) return stored.value;
    const thread = yield* getThread({ ...input, scope: "message" });
    const preview: DiscordLinkPreview = {
      channelLabel: thread.channelLabel,
      authorName: thread.authorName,
      title: thread.title,
    };
    yield* Effect.ignore(previews.set(key, preview));
    return preview;
  });

  return DiscordApi.of({
    listServers: listServers(),
    leaveServer,
    searchMessages,
    searchMentions,
    getThread,
    getLinkPreview,
  });
});

/** Link previews persist under the caches directory, or in memory when it cannot be used. */
const previewStoreLayer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const path = yield* Path.Path;
    return KeyValueStore.layerFileSystem(
      path.join(config.providerStatusCacheDir, "discord-link-previews"),
    ).pipe(
      Layer.catch(() =>
        Layer.effectDiscard(
          Effect.logWarning("Discord link preview directory unavailable; using memory"),
        ).pipe(Layer.provideMerge(KeyValueStore.layerMemory)),
      ),
    );
  }),
);

export const layer = Layer.effect(DiscordApi, make).pipe(Layer.provide(previewStoreLayer));
