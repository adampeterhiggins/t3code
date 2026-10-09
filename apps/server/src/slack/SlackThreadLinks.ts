import {
  SlackError,
  type SlackLinkThreadInput,
  type SlackThreadLink,
  type SlackThreadLinks as SlackThreadLinksList,
  type SlackUnlinkThreadInput,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as SqlClient from "effect/sql/SqlClient";

import { SlackApi } from "./SlackApi.ts";

interface LinkRow {
  readonly groupId: string;
  readonly channelId: string;
  readonly threadTs: string;
  readonly channelLabel: string;
  readonly authorName: string;
  readonly title: string;
  readonly url: string;
  readonly linkedAt: string;
  readonly threadId: string | null;
}

/** Folds the joined rows into one link per group; the group's own id is always a member. */
export function groupLinkRows(rows: ReadonlyArray<LinkRow>): SlackThreadLinksList {
  const links = new Map<string, SlackThreadLink & { threadIds: ThreadId[] }>();
  for (const row of rows) {
    let link = links.get(row.groupId);
    if (link === undefined) {
      link = {
        groupId: ThreadId.make(row.groupId),
        threadIds: [ThreadId.make(row.groupId)],
        channelId: row.channelId,
        threadTs: row.threadTs,
        channelLabel: row.channelLabel,
        authorName: row.authorName,
        title: row.title,
        url: row.url,
        linkedAt: row.linkedAt,
      };
      links.set(row.groupId, link);
    }
    if (row.threadId !== null && !link.threadIds.includes(row.threadId as ThreadId)) {
      link.threadIds.push(ThreadId.make(row.threadId));
    }
  }
  return [...links.values()];
}

const storageError = (cause: unknown) =>
  new SlackError({ reason: "api", detail: "Could not save the Slack thread link.", cause });

export class SlackThreadLinks extends Context.Service<
  SlackThreadLinks,
  {
    /** Every link in the environment, re-emitted whenever a link or tab group changes. */
    readonly links: Stream.Stream<SlackThreadLinksList>;
    readonly link: (input: SlackLinkThreadInput) => Effect.Effect<SlackThreadLink, SlackError>;
    readonly unlink: (input: SlackUnlinkThreadInput) => Effect.Effect<void, SlackError>;
    /** Re-reads group membership after a tab joins a group. */
    readonly refresh: Effect.Effect<void>;
  }
>()("t3/slack/SlackThreadLinks") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const api = yield* SlackApi;

  const read = sql<LinkRow>`
    SELECT l.group_id AS "groupId", l.channel_id AS "channelId", l.thread_ts AS "threadTs",
      l.channel_label AS "channelLabel", l.author_name AS "authorName", l.title, l.url,
      l.linked_at AS "linkedAt", t.thread_id AS "threadId"
    FROM fork_slack_thread_links l
    LEFT JOIN fork_thread_tabs t ON t.group_id = l.group_id
    ORDER BY l.linked_at, t.position, t.created_at
  `.pipe(Effect.map(groupLinkRows));

  const state = yield* SubscriptionRef.make(yield* read.pipe(Effect.orDie));
  const refresh = read.pipe(
    Effect.flatMap((links) => SubscriptionRef.set(state, links)),
    Effect.catch((cause) => Effect.logWarning("Could not re-read Slack thread links", cause)),
  );

  const groupIdFor = (threadId: ThreadId) =>
    sql<{ readonly groupId: string }>`
      SELECT group_id AS "groupId" FROM fork_thread_tabs WHERE thread_id = ${threadId}
    `.pipe(Effect.map((rows) => rows[0]?.groupId ?? threadId));

  const link = Effect.fn("slack.link_thread")(function* (input: SlackLinkThreadInput) {
    // Validates the message and copies what identifies it. The thread is the one the message
    // belongs to, or starts; Slack resolves the root when the link names a reply alone.
    const message = yield* api.getThread({
      channelId: input.channelId,
      ts: input.ts,
      ...(input.threadTs === undefined ? {} : { threadTs: input.threadTs }),
      url: input.url,
      scope: "message",
    });
    const groupId = yield* groupIdFor(input.threadId).pipe(Effect.mapError(storageError));
    const linkedAt = DateTime.formatIso(yield* DateTime.now);
    const threadTs = message.threadTs ?? message.ts;
    yield* sql`
      INSERT INTO fork_slack_thread_links
        (group_id, channel_id, thread_ts, channel_label, author_name, title, url, linked_at)
      VALUES (${groupId}, ${message.channelId}, ${threadTs}, ${message.channelLabel},
        ${message.authorName}, ${message.title}, ${message.url}, ${linkedAt})
      ON CONFLICT (group_id) DO UPDATE SET channel_id = excluded.channel_id,
        thread_ts = excluded.thread_ts, channel_label = excluded.channel_label,
        author_name = excluded.author_name, title = excluded.title, url = excluded.url,
        linked_at = excluded.linked_at
    `.pipe(Effect.mapError(storageError));
    yield* refresh;
    const links = yield* SubscriptionRef.get(state);
    const linked = links.find((entry) => entry.groupId === groupId);
    if (linked === undefined) return yield* storageError("The link was not saved");
    return linked;
  });

  const unlink = Effect.fn("slack.unlink_thread")(function* (input: SlackUnlinkThreadInput) {
    const groupId = yield* groupIdFor(input.threadId).pipe(Effect.mapError(storageError));
    yield* sql`DELETE FROM fork_slack_thread_links WHERE group_id = ${groupId}`.pipe(
      Effect.mapError(storageError),
    );
    yield* refresh;
  });

  return SlackThreadLinks.of({
    links: SubscriptionRef.changes(state),
    link,
    unlink,
    refresh,
  });
});

export const layer = Layer.effect(SlackThreadLinks, make);
