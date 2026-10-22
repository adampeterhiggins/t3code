import {
  SLACK_THREAD_MARKDOWN_MAX_CHARS,
  SlackError,
  type SlackGetThreadInput,
  SlackLinkPreview,
  type SlackLinkPreviewInput,
  type SlackMessageSummary,
  type SlackSearchMessagesInput,
  type SlackSearchMessagesResult,
  type SlackSearchScope,
  type SlackSuggestionsResult,
  type SlackThreadContext,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
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
  mentionedGroupIds,
  mentionedUserIds,
  renderSlackThread,
  slackMarkdownToPlain,
  slackMentionLabels,
  slackTextToMarkdown,
  slackTsToIso,
} from "./slackMarkdown.ts";
import { slackApiRequest } from "./slackWebApi.ts";

const PREVIEW_MAX_CHARS = 300;
/** Slack's page maximum: enough of the account's posts to see past one busy conversation. */
const SUGGESTION_SEARCH_COUNT = 100;
const TITLE_MAX_CHARS = 200;
const NAME_CACHE_MAX = 2_000;
/** How long a user group list is trusted before an unknown group id reads it again. */
const GROUPS_TTL_MS = 10 * 60_000;

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
  bot_profile: Schema.optional(
    Schema.Struct({
      name: Schema.optional(Schema.String),
      icons: Schema.optional(Schema.Struct({ image_72: Schema.optional(Schema.String) })),
    }),
  ),
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
const UserGroupsData = Schema.Struct({
  usergroups: Schema.Array(Schema.Struct({ id: Schema.String, handle: Schema.String })),
});
const UserInfoData = Schema.Struct({
  user: Schema.Struct({
    name: Schema.String,
    real_name: Schema.optional(Schema.String),
    profile: Schema.optional(
      Schema.Struct({
        display_name: Schema.optional(Schema.String),
        real_name: Schema.optional(Schema.String),
        image_72: Schema.optional(Schema.String),
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

/** True when the message starts or sits in a thread; Slack adds `thread_ts` only then. */
function hasThread(permalink: string): boolean {
  try {
    return new URL(permalink).searchParams.has("thread_ts");
  } catch {
    return false;
  }
}

/** One of the account's own recent posts, as suggestions read it. */
interface OwnPost {
  readonly summary: SlackMessageSummary;
  readonly isDirect: boolean;
  readonly isGroupDirect: boolean;
  readonly inThread: boolean;
  readonly authorId: string | null;
  /** For a direct message, the other person. */
  readonly directUserId: string | null;
}

const SUGGESTED_THREADS_MAX = 10;
const SUGGESTED_SCOPES_PER_KIND = 4;

/**
 * Turns the account's newest posts into one row per thread and the channels and people it posts
 * with most. Direct-message chatter outside a thread is left out of the rows, since linking one
 * line of a DM is rarely what was meant; it still counts towards who the account talks to.
 */
function suggestionsFromOwnPosts(posts: ReadonlyArray<OwnPost>): SlackSuggestionsResult {
  const threads = new Map<string, SlackMessageSummary>();
  const channels = new Map<string, { scope: SlackSearchScope; count: number }>();
  const people = new Map<string, { scope: SlackSearchScope; count: number }>();
  const tally = (into: typeof channels, id: string, scope: () => SlackSearchScope) => {
    const entry = into.get(id);
    if (entry) entry.count += 1;
    else into.set(id, { scope: scope(), count: 1 });
  };
  for (const post of posts) {
    const { summary } = post;
    const inConversation = post.isDirect || post.isGroupDirect;
    const root = summary.threadTs ?? (post.inThread || !inConversation ? summary.ts : null);
    const key = `${summary.channelId}:${root}`;
    if (root !== null && !threads.has(key)) threads.set(key, summary);
    if (!inConversation) {
      tally(channels, summary.channelId, () => ({
        kind: "channel",
        label: summary.channelLabel,
        query: `in:<#${summary.channelId}>`,
      }));
    } else if (
      post.isDirect &&
      post.directUserId !== null &&
      post.directUserId !== post.authorId &&
      summary.channelLabel.startsWith("@")
    ) {
      const userId = post.directUserId;
      tally(people, userId, () => ({
        kind: "person",
        label: summary.channelLabel,
        query: `from:<@${userId}>`,
      }));
    }
  }
  // Sorting is stable, so ties keep the order of the newest post.
  const top = (tallied: typeof channels) =>
    [...tallied.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, SUGGESTED_SCOPES_PER_KIND)
      .map((entry) => entry.scope);
  return {
    threads: [...threads.values()].slice(0, SUGGESTED_THREADS_MAX),
    scopes: [...top(channels), ...top(people)],
  };
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
    /** Threads, channels, and people from the account's own recent posts: one search. */
    readonly suggestions: Effect.Effect<SlackSuggestionsResult, SlackError>;
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
  const avatars = new Map<string, string>();
  // User group id → handle. One `usergroups.list` read returns every group in the workspace.
  const groups = new Map<string, string>();
  let groupsReadAtMs: number | null = null;

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
            if (names.size > NAME_CACHE_MAX) {
              names.clear();
              avatars.clear();
            }
            names.set(
              id,
              user.profile?.display_name || user.profile?.real_name || user.real_name || user.name,
            );
            if (user.profile?.image_72) avatars.set(id, user.profile.image_72);
          }),
          Effect.ignore,
        ),
      { concurrency: 4, discard: true },
    ).pipe(Effect.as(names as ReadonlyMap<string, string>));
  };

  /**
   * Fills the group cache when `ids` has one it lacks. A failed read, such as a connection made
   * before `usergroups:read` was requested, leaves those mentions as ids.
   */
  const resolveGroups = Effect.fn("slack.resolve_groups")(function* (ids: Iterable<string>) {
    if ([...ids].every((id) => groups.has(id))) return;
    const now = yield* Clock.currentTimeMillis;
    if (groupsReadAtMs !== null && now - groupsReadAtMs < GROUPS_TTL_MS) return;
    groupsReadAtMs = now;
    yield* call("usergroups.list", {}, UserGroupsData).pipe(
      Effect.map((data) => {
        groups.clear();
        for (const group of data.usergroups) groups.set(group.id, group.handle);
      }),
      Effect.ignore,
    );
  });

  const channelLabel = (channel: ChannelRef, directUserId: string | undefined) => {
    if (channel.is_mpim) return "Group message";
    if (channel.is_im || channel.id.startsWith("D")) {
      const name = directUserId === undefined ? undefined : names.get(directUserId);
      return name === undefined ? "Direct message" : `@${name}`;
    }
    return `#${channel.name ?? channel.id}`;
  };

  // An IM's `name` in search results is the other person's user id.
  const directUserId = (channel: ChannelRef) =>
    channel.is_im || channel.id.startsWith("D") ? channel.name : undefined;

  const search = Effect.fn("slack.search")(function* (query: string, count: number) {
    const data = yield* call(
      "search.messages",
      { query, count: String(count), sort: "timestamp", sort_dir: "desc", highlight: "false" },
      SearchData,
    );
    const matches = data.messages.matches;
    yield* resolveNames(
      matches.flatMap((match) =>
        [match.user ?? undefined, directUserId(match.channel)].filter((id) => id !== undefined),
      ),
    );
    yield* resolveGroups(matches.flatMap((match) => mentionedGroupIds(match.text ?? "")));
    return matches.map((match) => ({
      match,
      summary: {
        channelId: match.channel.id,
        channelLabel: channelLabel(match.channel, directUserId(match.channel)),
        ts: match.ts,
        threadTs: threadTsFromPermalink(match.permalink, match.ts),
        authorName:
          (match.user ? names.get(match.user) : undefined) ??
          match.username ??
          match.user ??
          "Slack",
        text: collapse(
          slackMarkdownToPlain(slackTextToMarkdown(match.text ?? "", names, groups)),
          PREVIEW_MAX_CHARS,
        ),
        url: match.permalink,
        postedAt: slackTsToIso(match.ts),
      } satisfies SlackMessageSummary,
    }));
  });

  const searchMessages = Effect.fn("slack.search_messages")(function* (
    input: SlackSearchMessagesInput,
  ) {
    const query = input.query.trim();
    if (query.length === 0) return { messages: [] };
    const results = yield* search(query, 20);
    return { messages: results.map((result) => result.summary) };
  });

  const suggestions = Effect.gen(function* () {
    const results = yield* search("from:me", SUGGESTION_SEARCH_COUNT);
    return suggestionsFromOwnPosts(
      results.map(({ match, summary }) => ({
        summary,
        isDirect: match.channel.is_im === true || match.channel.id.startsWith("D"),
        isGroupDirect: match.channel.is_mpim === true,
        inThread: hasThread(match.permalink),
        authorId: match.user ?? null,
        directUserId: directUserId(match.channel) ?? null,
      })),
    );
  }).pipe(Effect.withSpan("slack.suggestions"));

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

  const avatarUrl = (message: ThreadMessage) =>
    (message.user ? avatars.get(message.user) : undefined) ??
    message.bot_profile?.icons?.image_72 ??
    null;

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
    yield* resolveGroups(messages.flatMap((message) => mentionedGroupIds(message.text ?? "")));
    const label = channelLabel(info.channel, info.channel.user);
    const linked = messages.find((message) => message.ts === input.ts) ?? messages[0]!;
    const rootTs = linked.thread_ts ?? input.threadTs;
    const linkedText = slackTextToMarkdown(linked.text ?? "", names, groups);
    const title = linkedText
      .split("\n")
      .map((line) => slackMarkdownToPlain(line).trim())
      .find((line) => line.length > 0);
    const rendered = renderSlackThread(
      {
        channelLabel: label,
        url: input.url,
        scope: input.scope,
        linkedTs: input.ts,
        messages: messages.map((message) => ({
          ts: message.ts,
          authorName: authorName(message),
          avatarUrl: avatarUrl(message),
          text: slackTextToMarkdown(message.text ?? "", names, groups),
          mentions: slackMentionLabels(message.text ?? "", names, groups),
          files: (message.files ?? []).map((file) => file.name ?? file.title ?? "file"),
        })),
      },
      SLACK_THREAD_MARKDOWN_MAX_CHARS,
    );
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
      markdown: rendered.markdown,
      messages: rendered.messages,
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

  return SlackApi.of({ searchMessages, suggestions, searchMentions, getThread, getLinkPreview });
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
