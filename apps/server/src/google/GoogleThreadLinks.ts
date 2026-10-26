import {
  GoogleError,
  type GoogleLinkThreadInput,
  type GoogleThreadLink,
  type GoogleThreadLinks as GoogleThreadLinksList,
  type GoogleUnlinkThreadInput,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as SqlClient from "effect/sql/SqlClient";

import { GoogleApi } from "./GoogleApi.ts";

interface LinkRow {
  readonly groupId: string;
  readonly fileId: string;
  readonly fileType: GoogleThreadLink["fileType"];
  readonly title: string;
  readonly url: string;
  readonly linkedAt: string;
  readonly threadId: string | null;
}

/** Folds the joined rows into one link per group; the group's own id is always a member. */
function groupLinkRows(rows: ReadonlyArray<LinkRow>): GoogleThreadLinksList {
  const links = new Map<string, GoogleThreadLink & { threadIds: ThreadId[] }>();
  for (const row of rows) {
    let link = links.get(row.groupId);
    if (link === undefined) {
      link = {
        groupId: ThreadId.make(row.groupId),
        threadIds: [ThreadId.make(row.groupId)],
        fileId: row.fileId,
        fileType: row.fileType,
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
  new GoogleError({ reason: "api", detail: "Could not save the Google page link." });

export class GoogleThreadLinks extends Context.Service<
  GoogleThreadLinks,
  {
    /** Every link in the environment, re-emitted whenever a link or tab group changes. */
    readonly links: Stream.Stream<GoogleThreadLinksList>;
    readonly link: (input: GoogleLinkThreadInput) => Effect.Effect<GoogleThreadLink, GoogleError>;
    readonly unlink: (input: GoogleUnlinkThreadInput) => Effect.Effect<void, GoogleError>;
    /** Re-reads group membership after a tab joins a group. */
    readonly forThread: (threadId: ThreadId) => Effect.Effect<GoogleThreadLink | undefined>;
    readonly refresh: Effect.Effect<void>;
  }
>()("t3/google/GoogleThreadLinks") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const api = yield* GoogleApi;

  const read = sql<LinkRow>`
    SELECT l.group_id AS "groupId", l.file_id AS "fileId", l.file_type AS "fileType", l.title, l.url,
      l.linked_at AS "linkedAt", t.thread_id AS "threadId"
    FROM fork_google_thread_links l
    LEFT JOIN fork_thread_tabs t ON t.group_id = l.group_id
    ORDER BY l.linked_at, t.position, t.created_at
  `.pipe(Effect.map(groupLinkRows));

  const state = yield* SubscriptionRef.make(yield* read.pipe(Effect.orDie));
  const refresh = read.pipe(
    Effect.flatMap((links) => SubscriptionRef.set(state, links)),
    Effect.catch((cause) => Effect.logWarning("Could not re-read Google thread links", cause)),
  );

  const groupIdFor = (threadId: ThreadId) =>
    sql<{ readonly groupId: string }>`
      SELECT group_id AS "groupId" FROM fork_thread_tabs WHERE thread_id = ${threadId}
    `.pipe(Effect.map((rows) => rows[0]?.groupId ?? threadId));

  const link = Effect.fn("google.link_thread")(function* (input: GoogleLinkThreadInput) {
    // Validates the page and copies what identifies it.
    const page = yield* api.getFileSummary({ id: input.fileId });
    const groupId = yield* groupIdFor(input.threadId).pipe(Effect.mapError(storageError));
    const linkedAt = DateTime.formatIso(yield* DateTime.now);
    yield* sql`
      INSERT INTO fork_google_thread_links (group_id, file_id, file_type, title, url, linked_at)
      VALUES (${groupId}, ${page.id}, ${page.fileType}, ${page.title}, ${page.url}, ${linkedAt})
      ON CONFLICT (group_id) DO UPDATE SET file_id = excluded.file_id, file_type = excluded.file_type, title = excluded.title,
        url = excluded.url, linked_at = excluded.linked_at
    `.pipe(Effect.mapError(storageError));
    yield* refresh;
    const links = yield* SubscriptionRef.get(state);
    const linked = links.find((entry) => entry.groupId === groupId);
    if (linked === undefined) return yield* storageError();
    return linked;
  });

  const unlink = Effect.fn("google.unlink_thread")(function* (input: GoogleUnlinkThreadInput) {
    const groupId = yield* groupIdFor(input.threadId).pipe(Effect.mapError(storageError));
    yield* sql`DELETE FROM fork_google_thread_links WHERE group_id = ${groupId}`.pipe(
      Effect.mapError(storageError),
    );
    yield* refresh;
  });

  return GoogleThreadLinks.of({
    links: SubscriptionRef.changes(state),
    forThread: Effect.fn("GoogleThreadLinks.forThread")((threadId) =>
      SubscriptionRef.get(state).pipe(
        Effect.map((links) => links.find((entry) => entry.threadIds.includes(threadId))),
      ),
    ),
    link,
    unlink,
    refresh,
  });
});

export const layer = Layer.effect(GoogleThreadLinks, make);
