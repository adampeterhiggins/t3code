import {
  LinearError,
  type LinearLinkThreadInput,
  type LinearThreadLink,
  type LinearThreadLinks as LinearThreadLinksList,
  type LinearUnlinkThreadInput,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { LinearApi } from "./LinearApi.ts";

interface LinkRow {
  readonly groupId: string;
  readonly issueId: string;
  readonly identifier: string;
  readonly title: string;
  readonly url: string;
  readonly linkedAt: string;
  readonly threadId: string | null;
}

/** Folds the joined rows into one link per group; the group's own id is always a member. */
export function groupLinkRows(rows: ReadonlyArray<LinkRow>): LinearThreadLinksList {
  const links = new Map<string, LinearThreadLink & { threadIds: ThreadId[] }>();
  for (const row of rows) {
    let link = links.get(row.groupId);
    if (link === undefined) {
      link = {
        groupId: ThreadId.make(row.groupId),
        threadIds: [ThreadId.make(row.groupId)],
        issueId: row.issueId,
        identifier: row.identifier,
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
  new LinearError({ reason: "api", detail: "Could not save the Linear issue link.", cause });

export class LinearThreadLinks extends Context.Service<
  LinearThreadLinks,
  {
    /** Every link in the environment, re-emitted whenever a link or tab group changes. */
    readonly links: Stream.Stream<LinearThreadLinksList>;
    readonly link: (input: LinearLinkThreadInput) => Effect.Effect<LinearThreadLink, LinearError>;
    readonly unlink: (input: LinearUnlinkThreadInput) => Effect.Effect<void, LinearError>;
    /** Re-reads group membership after a tab joins a group. */
    readonly refresh: Effect.Effect<void>;
  }
>()("t3/linear/LinearThreadLinks") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const api = yield* LinearApi;

  const read = sql<LinkRow>`
    SELECT l.group_id AS "groupId", l.issue_id AS "issueId", l.identifier, l.title, l.url,
      l.linked_at AS "linkedAt", t.thread_id AS "threadId"
    FROM fork_linear_thread_links l
    LEFT JOIN fork_thread_tabs t ON t.group_id = l.group_id
    ORDER BY l.linked_at, t.position, t.created_at
  `.pipe(Effect.map(groupLinkRows));

  const state = yield* SubscriptionRef.make(yield* read.pipe(Effect.orDie));
  const refresh = read.pipe(
    Effect.flatMap((links) => SubscriptionRef.set(state, links)),
    Effect.catch((cause) => Effect.logWarning("Could not re-read Linear thread links", cause)),
  );

  const groupIdFor = (threadId: ThreadId) =>
    sql<{ readonly groupId: string }>`
      SELECT group_id AS "groupId" FROM fork_thread_tabs WHERE thread_id = ${threadId}
    `.pipe(Effect.map((rows) => rows[0]?.groupId ?? threadId));

  const link = Effect.fn("linear.link_thread")(function* (input: LinearLinkThreadInput) {
    // Validates the issue and copies what identifies it; the status stays live.
    const issue = yield* api.getIssueSummary({ id: input.issueId });
    const groupId = yield* groupIdFor(input.threadId).pipe(Effect.mapError(storageError));
    const linkedAt = DateTime.formatIso(yield* DateTime.now);
    yield* sql`
      INSERT INTO fork_linear_thread_links (group_id, issue_id, identifier, title, url, linked_at)
      VALUES (${groupId}, ${issue.id}, ${issue.identifier}, ${issue.title}, ${issue.url}, ${linkedAt})
      ON CONFLICT (group_id) DO UPDATE SET issue_id = excluded.issue_id,
        identifier = excluded.identifier, title = excluded.title, url = excluded.url,
        linked_at = excluded.linked_at
    `.pipe(Effect.mapError(storageError));
    yield* refresh;
    const links = yield* SubscriptionRef.get(state);
    const linked = links.find((entry) => entry.groupId === groupId);
    if (linked === undefined) return yield* storageError("The link was not saved");
    return linked;
  });

  const unlink = Effect.fn("linear.unlink_thread")(function* (input: LinearUnlinkThreadInput) {
    const groupId = yield* groupIdFor(input.threadId).pipe(Effect.mapError(storageError));
    yield* sql`DELETE FROM fork_linear_thread_links WHERE group_id = ${groupId}`.pipe(
      Effect.mapError(storageError),
    );
    yield* refresh;
  });

  return LinearThreadLinks.of({
    links: SubscriptionRef.changes(state),
    link,
    unlink,
    refresh,
  });
});

export const layer = Layer.effect(LinearThreadLinks, make);
