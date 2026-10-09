import {
  SLACK_THREAD_MARKDOWN_MAX_CHARS,
  SlackError,
  type SlackGetThreadInput,
  SlackLinkPreview,
  type SlackLinkPreviewInput,
  type SlackMessageSummary,
  type SlackSearchMessagesInput,
  type SlackSearchMessagesResult,
  type SlackThreadContext,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as KeyValueStore from "effect/persistence/KeyValueStore";

import * as ServerConfig from "../config.ts";

import { SlackAuth } from "./SlackAuth.ts";
import {
  mentionedUserIds,
  renderSlackThreadMarkdown,
  slackTextToMarkdown,
  slackTsToIso,
} from "./slackMarkdown.ts";
import { slackApiRequest } from "./slackWebApi.ts";

const PREVIEW_MAX_CHARS = 300;
const TITLE_MAX_CHARS = 200;
const NAME_CACHE_MAX = 2_000;

const ChannelRef = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.String),
  is_im: Schema.optional(Schema.Boolean),
  is_mpim: Schema.optional(Schema.Boolean),
  /** For a direct message, the other person. */
  user: Schema.optional(Schema.String),
});
type ChannelRef = typeof ChannelRef.Type;

const SearchData = Schema.Struct({
  messages: Schema.Struct({
    matches: Schema.Array(
      Schema.Struct({
        ts: Schema.String,
        text: Schema.optional(Schema.String),
        user: Schema.optional(Schema.NullOr(Schema.String)),
        username: Schema.optional(Schema.String),
        permalink: Schema.String,
        channel: ChannelRef,
      }),
    ),
  }),
});

const ThreadMessage = Schema.Struct({
  ts: Schema.String,
  thread_ts: Schema.optional(Schema.String),
  user: Schema.optional(Schema.String),
  username: Schema.optional(Schema.String),
  bot_profile: Schema.optional(Schema.Struct({ name: Schema.optional(Schema.String) })),
  text: Schema.optional(Schema.String),
  files: Schema.optional(
    Schema.Array(
      Schema.Struct({
        name: Schema.optional(Schema.String),
        title: Schema.optional(Schema.String),
      }),
    ),
  ),
});
type ThreadMessage = typeof ThreadMessage.Type;

const RepliesData = Schema.Struct({ messages: Schema.Array(ThreadMessage) });
const ChannelInfoData = Schema.Struct({ channel: ChannelRef });
const UserInfoData = Schema.Struct({
  user: Schema.Struct({
    name: Schema.String,
    real_name: Schema.optional(Schema.String),
    profile: Schema.optional(
      Schema.Struct({
        display_name: Schema.optional(Schema.String),
        real_name: Schema.optional(Schema.String),
      }),
    ),
  }),
});

const collapse = (text: string, maxChars: number) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= maxChars ? flat : `${flat.slice(0, maxChars - 1).trimEnd()}…`;
};

/** The thread a permalink points into, when the message is a reply. */
function threadTsFromPermalink(permalink: string, ts: string): string | null {
  try {
    const threadTs = new URL(permalink).searchParams.get("thread_ts");
    return threadTs && threadTs !== ts ? threadTs : null;
  } catch {
    return null;
  }
}

/** A message that @mentions a user, as the mention trigger reads it. */
export interface SlackMention {
  readonly channelId: string;
  /** The channel's name without `#`; null for a direct or group message. */
  readonly channelName: string | null;
  readonly ts: string;
  readonly threadTs: string | null;
  /** The author, when a person wrote it. */
  readonly userId: string | null;
  /** Slack's own text, mentions unresolved. */
  readonly text: string;
  readonly url: string;
}

export class SlackApi extends Context.Service<
  SlackApi,
  {
    readonly searchMessages: (
      input: SlackSearchMessagesInput,
    ) => Effect.Effect<SlackSearchMessagesResult, SlackError>;
    readonly getThread: (
      input: SlackGetThreadInput,
    ) => Effect.Effect<SlackThreadContext, SlackError>;
    /** The newest messages that @mention `userId`, posted on or after `afterDay` (`YYYY-MM-DD`). */
    readonly searchMentions: (input: {
      readonly userId: string;
      readonly afterDay: string;
    }) => Effect.Effect<ReadonlyArray<SlackMention>, SlackError>;
    /** Who and where a bare link points, read once and kept. Needs a connected account. */
    readonly getLinkPreview: (
      input: SlackLinkPreviewInput,
    ) => Effect.Effect<SlackLinkPreview, SlackError>;
  }
>()("t3/slack/SlackApi") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const auth = yield* SlackAuth;
  const services = Context.make(HttpClient.HttpClient, yield* HttpClient.HttpClient);
  const previews = KeyValueStore.toSchemaStore(
    yield* KeyValueStore.KeyValueStore,
    SlackLinkPreview,
  );
  // User id → display name. Names rarely change; the cap keeps a long-lived
  // server from growing it without bound.
  const names = new Map<string, string>();

  const call = <S extends Schema.Top>(method: string, params: Record<string, string>, data: S) =>
    auth.accessToken.pipe(
      Effect.flatMap((token) => slackApiRequest(token, method, params, data)),
      Effect.tapError((error) => (error.reason === "revoked" ? auth.markRevoked : Effect.void)),
      Effect.provide(services),
    );

  /** Fills the name cache for `ids`; a user Slack will not describe keeps their id. */
  const resolveNames = (ids: Iterable<string>) => {
    const missing = [...new Set(ids)].filter((id) => !names.has(id));
    return Effect.forEach(
      missing,
      (id) =>
        call("users.info", { user: id }, UserInfoData).pipe(
          Effect.map(({ user }) => {
            if (names.size > NAME_CACHE_MAX) names.clear();
            names.set(
              id,
              user.profile?.display_name || user.profile?.real_name || user.real_name || user.name,
            );
          }),
          Effect.ignore,
        ),
      { concurrency: 4, discard: true },
    ).pipe(Effect.as(names as ReadonlyMap<string, string>));
  };

  const channelLabel = (channel: ChannelRef, directUserId: string | undefined) => {
    if (channel.is_mpim) return "Group message";
    if (channel.is_im || channel.id.startsWith("D")) {
      const name = directUserId === undefined ? undefined : names.get(directUserId);
      return name === undefined ? "Direct message" : `@${name}`;
    }
    return `#${channel.name ?? channel.id}`;
  };

  const searchMessages = Effect.fn("slack.search_messages")(function* (
    input: SlackSearchMessagesInput,
  ) {
    const query = input.query.trim();
    if (query.length === 0) return { messages: [] };
    const data = yield* call(
      "search.messages",
      { query, count: "20", sort: "timestamp", sort_dir: "desc", highlight: "false" },
      SearchData,
    );
    const matches = data.messages.matches;
    // An IM's `name` in search results is the other person's user id.
    const directUserId = (channel: ChannelRef) =>
      channel.is_im || channel.id.startsWith("D") ? channel.name : undefined;
    yield* resolveNames(
      matches.flatMap((match) =>
        [match.user ?? undefined, directUserId(match.channel)].filter((id) => id !== undefined),
      ),
    );
    return {
      messages: matches.map((match): SlackMessageSummary => ({
        channelId: match.channel.id,
        channelLabel: channelLabel(match.channel, directUserId(match.channel)),
        ts: match.ts,
        threadTs: threadTsFromPermalink(match.permalink, match.ts),
        authorName:
          (match.user ? names.get(match.user) : undefined) ??
          match.username ??
          match.user ??
          "Slack",
        text: collapse(slackTextToMarkdown(match.text ?? "", names), PREVIEW_MAX_CHARS),
        url: match.permalink,
        postedAt: slackTsToIso(match.ts),
      })),
    };
  });

  const searchMentions = Effect.fn("slack.search_mentions")(function* (input: {
    readonly userId: string;
    readonly afterDay: string;
  }) {
    // Slack's `after:` is exclusive, so search from the day before.
    const after = DateTime.formatIsoDateUtc(
      DateTime.subtract(DateTime.makeUnsafe(`${input.afterDay}T00:00:00Z`), { days: 1 }),
    );
    const data = yield* call(
      "search.messages",
      {
        query: `<@${input.userId}> after:${after}`,
        count: "50",
        sort: "timestamp",
        sort_dir: "desc",
        highlight: "false",
      },
      SearchData,
    );
    return data.messages.matches.map((match): SlackMention => ({
      channelId: match.channel.id,
      channelName:
        match.channel.is_im || match.channel.is_mpim || match.channel.id.startsWith("D")
          ? null
          : (match.channel.name ?? null),
      ts: match.ts,
      threadTs: threadTsFromPermalink(match.permalink, match.ts),
      userId: match.user ?? null,
      text: match.text ?? "",
      url: match.permalink,
    }));
  });

  const authorName = (message: ThreadMessage) =>
    (message.user ? names.get(message.user) : undefined) ??
    message.bot_profile?.name ??
    message.username ??
    message.user ??
    "Slack";

  const getThread = Effect.fn("slack.get_thread")(function* (input: SlackGetThreadInput) {
    const readReplies = (ts: string) =>
      call(
        "conversations.replies",
        { channel: input.channelId, ts, limit: "200", inclusive: "true" },
        RepliesData,
      );
    const [firstRead, info, account] = yield* Effect.all(
      [
        readReplies(input.threadTs ?? input.ts),
        call("conversations.info", { channel: input.channelId }, ChannelInfoData),
        auth.account,
      ],
      { concurrency: "unbounded" },
    );
    // A reply's link may omit `thread_ts`; reading from the reply returns only the reply, so
    // read again from the root it names.
    const root = firstRead.messages.find((message) => message.ts === input.ts)?.thread_ts;
    const replies =
      input.scope === "thread" && input.threadTs === undefined && root && root !== input.ts
        ? yield* readReplies(root)
        : firstRead;
    const messages =
      input.scope === "message"
        ? replies.messages.filter((message) => message.ts === input.ts)
        : replies.messages;
    if (messages.length === 0) {
      return yield* new SlackError({
        reason: "not-found",
        detail: "That Slack message no longer exists, or your account can't see it.",
      });
    }
    yield* resolveNames([
      ...messages.flatMap((message) => [
        ...(message.user ? [message.user] : []),
        ...mentionedUserIds(message.text ?? ""),
      ]),
      ...(info.channel.is_im && info.channel.user ? [info.channel.user] : []),
    ]);
    const label = channelLabel(info.channel, info.channel.user);
    const linked = messages.find((message) => message.ts === input.ts) ?? messages[0]!;
    const rootTs = linked.thread_ts ?? input.threadTs;
    const linkedText = slackTextToMarkdown(linked.text ?? "", names);
    const title = linkedText
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    return {
      teamId: account.teamId,
      channelId: input.channelId,
      channelLabel: label,
      ts: input.ts,
      threadTs: rootTs !== undefined && rootTs !== linked.ts ? rootTs : null,
      url: input.url,
      authorName: authorName(linked),
      title: title === undefined ? "Slack message" : title.slice(0, TITLE_MAX_CHARS),
      replyCount: input.scope === "thread" ? messages.length - 1 : 0,
      scope: input.scope,
      markdown: renderSlackThreadMarkdown(
        {
          channelLabel: label,
          url: input.url,
          scope: input.scope,
          linkedTs: input.ts,
          messages: messages.map((message) => ({
            ts: message.ts,
            authorName: authorName(message),
            text: slackTextToMarkdown(message.text ?? "", names),
            files: (message.files ?? []).map((file) => file.name ?? file.title ?? "file"),
          })),
        },
        SLACK_THREAD_MARKDOWN_MAX_CHARS,
      ),
    } satisfies SlackThreadContext;
  });

  const getLinkPreview = Effect.fn("slack.get_link_preview")(function* (
    input: SlackLinkPreviewInput,
  ) {
    const account = yield* auth.account;
    // A message's ts is unique within its channel, and the team scopes the channel.
    const key = `${account.teamId}_${input.channelId}_${input.ts}`;
    const stored = yield* previews.get(key).pipe(Effect.orElseSucceed(() => Option.none()));
    if (Option.isSome(stored)) return stored.value;
    const thread = yield* getThread({ ...input, scope: "message" });
    const preview: SlackLinkPreview = {
      channelLabel: thread.channelLabel,
      authorName: thread.authorName,
      title: thread.title,
    };
    yield* Effect.ignore(previews.set(key, preview));
    return preview;
  });

  return SlackApi.of({ searchMessages, searchMentions, getThread, getLinkPreview });
});

/** Link previews persist under the caches directory, or in memory when it cannot be used. */
const previewStoreLayer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const path = yield* Path.Path;
    return KeyValueStore.layerFileSystem(
      path.join(config.providerStatusCacheDir, "slack-link-previews"),
    ).pipe(
      Layer.catch(() =>
        Layer.effectDiscard(
          Effect.logWarning("Slack link preview directory unavailable; using memory"),
        ).pipe(Layer.provideMerge(KeyValueStore.layerMemory)),
      ),
    );
  }),
);

export const layer = Layer.effect(SlackApi, make).pipe(Layer.provide(previewStoreLayer));
