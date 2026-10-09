import {
  NotionError,
  type NotionLinkThreadInput,
  type NotionThreadLink,
  type NotionThreadLinks as NotionThreadLinksList,
  type NotionUnlinkThreadInput,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as SqlClient from "effect/sql/SqlClient";

import { NotionApi } from "./NotionApi.ts";

interface LinkRow {
  readonly groupId: string;
  readonly pageId: string;
  readonly title: string;
  readonly url: string;
  readonly linkedAt: string;
  readonly threadId: string | null;
}

/** Folds the joined rows into one link per group; the group's own id is always a member. */
export function groupLinkRows(rows: ReadonlyArray<LinkRow>): NotionThreadLinksList {
  const links = new Map<string, NotionThreadLink & { threadIds: ThreadId[] }>();
  for (const row of rows) {
    let link = links.get(row.groupId);
    if (link === undefined) {
      link = {
        groupId: ThreadId.make(row.groupId),
        threadIds: [ThreadId.make(row.groupId)],
        pageId: row.pageId,
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

const storageError = () =>
  new NotionError({ reason: "api", detail: "Could not save the Notion page link." });

export class NotionThreadLinks extends Context.Service<
  NotionThreadLinks,
  {
    /** Every link in the environment, re-emitted whenever a link or tab group changes. */
    readonly links: Stream.Stream<NotionThreadLinksList>;
    readonly link: (input: NotionLinkThreadInput) => Effect.Effect<NotionThreadLink, NotionError>;
    readonly unlink: (input: NotionUnlinkThreadInput) => Effect.Effect<void, NotionError>;
    /** Re-reads group membership after a tab joins a group. */
    readonly refresh: Effect.Effect<void>;
  }
>()("t3/notion/NotionThreadLinks") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const api = yield* NotionApi;

  const read = sql<LinkRow>`
    SELECT l.group_id AS "groupId", l.page_id AS "pageId", l.title, l.url,
      l.linked_at AS "linkedAt", t.thread_id AS "threadId"
    FROM fork_notion_thread_links l
    LEFT JOIN fork_thread_tabs t ON t.group_id = l.group_id
    ORDER BY l.linked_at, t.position, t.created_at
  `.pipe(Effect.map(groupLinkRows));

  const state = yield* SubscriptionRef.make(yield* read.pipe(Effect.orDie));
  const refresh = read.pipe(
    Effect.flatMap((links) => SubscriptionRef.set(state, links)),
    Effect.catch((cause) => Effect.logWarning("Could not re-read Notion thread links", cause)),
  );

  const groupIdFor = (threadId: ThreadId) =>
    sql<{ readonly groupId: string }>`
      SELECT group_id AS "groupId" FROM fork_thread_tabs WHERE thread_id = ${threadId}
    `.pipe(Effect.map((rows) => rows[0]?.groupId ?? threadId));

  const link = Effect.fn("notion.link_thread")(function* (input: NotionLinkThreadInput) {
    // Validates the page and copies what identifies it.
    const page = yield* api.getPageSummary({ id: input.pageId });
    const groupId = yield* groupIdFor(input.threadId).pipe(Effect.mapError(storageError));
    const linkedAt = DateTime.formatIso(yield* DateTime.now);
    yield* sql`
      INSERT INTO fork_notion_thread_links (group_id, page_id, title, url, linked_at)
      VALUES (${groupId}, ${page.id}, ${page.title}, ${page.url}, ${linkedAt})
      ON CONFLICT (group_id) DO UPDATE SET page_id = excluded.page_id, title = excluded.title,
        url = excluded.url, linked_at = excluded.linked_at
    `.pipe(Effect.mapError(storageError));
    yield* refresh;
    const links = yield* SubscriptionRef.get(state);
    const linked = links.find((entry) => entry.groupId === groupId);
    if (linked === undefined) return yield* storageError();
    return linked;
  });

  const unlink = Effect.fn("notion.unlink_thread")(function* (input: NotionUnlinkThreadInput) {
    const groupId = yield* groupIdFor(input.threadId).pipe(Effect.mapError(storageError));
    yield* sql`DELETE FROM fork_notion_thread_links WHERE group_id = ${groupId}`.pipe(
      Effect.mapError(storageError),
    );
    yield* refresh;
  });

  return NotionThreadLinks.of({
    links: SubscriptionRef.changes(state),
    link,
    unlink,
    refresh,
  });
});

export const layer = Layer.effect(NotionThreadLinks, make);
