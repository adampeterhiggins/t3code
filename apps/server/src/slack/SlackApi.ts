import {
  SLACK_THREAD_MARKDOWN_MAX_CHARS,
  SlackError,
  type SlackGetThreadInput,
  type SlackMessageSummary,
  type SlackSearchMessagesInput,
  type SlackSearchMessagesResult,
  type SlackThreadContext,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";

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

export class SlackApi extends Context.Service<
  SlackApi,
  {
    readonly searchMessages: (
      input: SlackSearchMessagesInput,
    ) => Effect.Effect<SlackSearchMessagesResult, SlackError>;
    readonly getThread: (
      input: SlackGetThreadInput,
    ) => Effect.Effect<SlackThreadContext, SlackError>;
  }
>()("t3/slack/SlackApi") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const auth = yield* SlackAuth;
  const services = Context.make(HttpClient.HttpClient, yield* HttpClient.HttpClient);
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

  return SlackApi.of({ searchMessages, getThread });
});

export const layer = Layer.effect(SlackApi, make);
