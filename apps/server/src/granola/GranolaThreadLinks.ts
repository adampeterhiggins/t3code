import {
  GranolaError,
  type GranolaLinkThreadInput,
  type GranolaThreadLink,
  type GranolaThreadLinks as GranolaThreadLinksList,
  type GranolaUnlinkThreadInput,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as SqlClient from "effect/sql/SqlClient";

import { GranolaApi } from "./GranolaApi.ts";

interface LinkRow {
  readonly groupId: string;
  readonly noteId: string;
  readonly title: string;
  readonly url: string;
  readonly linkedAt: string;
  readonly threadId: string | null;
}

/** Folds the joined rows into one link per group; the group's own id is always a member. */
export function groupLinkRows(rows: ReadonlyArray<LinkRow>): GranolaThreadLinksList {
  const links = new Map<string, GranolaThreadLink & { threadIds: ThreadId[] }>();
  for (const row of rows) {
    let link = links.get(row.groupId);
    if (link === undefined) {
      link = {
        groupId: ThreadId.make(row.groupId),
        threadIds: [ThreadId.make(row.groupId)],
        noteId: row.noteId,
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
  new GranolaError({ reason: "api", detail: "Could not save the Granola note link." });

export class GranolaThreadLinks extends Context.Service<
  GranolaThreadLinks,
  {
    /** Every link in the environment, re-emitted whenever a link or tab group changes. */
    readonly links: Stream.Stream<GranolaThreadLinksList>;
    readonly link: (
      input: GranolaLinkThreadInput,
    ) => Effect.Effect<GranolaThreadLink, GranolaError>;
    readonly unlink: (input: GranolaUnlinkThreadInput) => Effect.Effect<void, GranolaError>;
    /** Re-reads group membership after a tab joins a group. */
    readonly refresh: Effect.Effect<void>;
  }
>()("t3/granola/GranolaThreadLinks") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const api = yield* GranolaApi;

  const read = sql<LinkRow>`
    SELECT l.group_id AS "groupId", l.note_id AS "noteId", l.title, l.url,
      l.linked_at AS "linkedAt", t.thread_id AS "threadId"
    FROM fork_granola_thread_links l
    LEFT JOIN fork_thread_tabs t ON t.group_id = l.group_id
    ORDER BY l.linked_at, t.position, t.created_at
  `.pipe(Effect.map(groupLinkRows));

  const state = yield* SubscriptionRef.make(yield* read.pipe(Effect.orDie));
  const refresh = read.pipe(
    Effect.flatMap((links) => SubscriptionRef.set(state, links)),
    Effect.catch((cause) => Effect.logWarning("Could not re-read Granola thread links", cause)),
  );

  const groupIdFor = (threadId: ThreadId) =>
    sql<{ readonly groupId: string }>`
      SELECT group_id AS "groupId" FROM fork_thread_tabs WHERE thread_id = ${threadId}
    `.pipe(Effect.map((rows) => rows[0]?.groupId ?? threadId));

  const link = Effect.fn("granola.link_thread")(function* (input: GranolaLinkThreadInput) {
    // Validates the note and copies what identifies it.
    const note = yield* api.getNoteSummary({ id: input.noteId });
    const groupId = yield* groupIdFor(input.threadId).pipe(Effect.mapError(storageError));
    const linkedAt = DateTime.formatIso(yield* DateTime.now);
    yield* sql`
      INSERT INTO fork_granola_thread_links (group_id, note_id, title, url, linked_at)
      VALUES (${groupId}, ${note.id}, ${note.title}, ${note.url}, ${linkedAt})
      ON CONFLICT (group_id) DO UPDATE SET note_id = excluded.note_id, title = excluded.title,
        url = excluded.url, linked_at = excluded.linked_at
    `.pipe(Effect.mapError(storageError));
    yield* refresh;
    const links = yield* SubscriptionRef.get(state);
    const linked = links.find((entry) => entry.groupId === groupId);
    if (linked === undefined) return yield* storageError();
    return linked;
  });

  const unlink = Effect.fn("granola.unlink_thread")(function* (input: GranolaUnlinkThreadInput) {
    const groupId = yield* groupIdFor(input.threadId).pipe(Effect.mapError(storageError));
    yield* sql`DELETE FROM fork_granola_thread_links WHERE group_id = ${groupId}`.pipe(
      Effect.mapError(storageError),
    );
    yield* refresh;
  });

  return GranolaThreadLinks.of({
    links: SubscriptionRef.changes(state),
    link,
    unlink,
    refresh,
  });
});

export const layer = Layer.effect(GranolaThreadLinks, make);
