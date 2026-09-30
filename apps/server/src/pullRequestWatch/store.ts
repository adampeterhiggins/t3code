import {
  PullRequestWatch,
  type ThreadId,
  type ThreadPullRequestKey,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import { normalizeThreadPullRequestKey } from "@t3tools/shared/threadPullRequests";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

/** Fork-owned table, versioned in `fork_schema_migrations` so upstream's numbering stays free. */
export const ensurePullRequestWatchSchema = Effect.fn("PullRequestWatch.ensureSchema")(
  function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      CREATE TABLE IF NOT EXISTS fork_schema_migrations (
        feature TEXT NOT NULL,
        version INTEGER NOT NULL,
        applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (feature, version)
      )
    `;
    yield* sql`
      CREATE TABLE IF NOT EXISTS fork_pull_request_watches (
        thread_id TEXT NOT NULL,
        host TEXT NOT NULL,
        repository TEXT NOT NULL,
        number INTEGER NOT NULL,
        status TEXT NOT NULL,
        attempts_used INTEGER NOT NULL,
        handled_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (thread_id, host, repository, number)
      )
    `;
    yield* sql`INSERT OR IGNORE INTO fork_schema_migrations (feature, version) VALUES ('pull_request_watches', 1)`;
  },
);

const WatchRow = PullRequestWatch.mapFields(
  Struct.assign({ handled: Schema.fromJsonString(Schema.Array(TrimmedNonEmptyString)) }),
);

const WATCH_COLUMNS = `
  thread_id AS "threadId",
  host,
  repository,
  number,
  status,
  attempts_used AS "attemptsUsed",
  handled_json AS "handled",
  updated_at AS "updatedAt"
`;

/** Every watch, or one thread's. */
export const listPullRequestWatches = Effect.fn("PullRequestWatch.list")(function* (
  threadId?: ThreadId,
) {
  const sql = yield* SqlClient.SqlClient;
  const query = SqlSchema.findAll({
    Request: Schema.Void,
    Result: WatchRow,
    execute: () =>
      threadId === undefined
        ? sql`SELECT ${sql.literal(WATCH_COLUMNS)} FROM fork_pull_request_watches`
        : sql`
            SELECT ${sql.literal(WATCH_COLUMNS)} FROM fork_pull_request_watches
            WHERE thread_id = ${threadId}
            ORDER BY updated_at ASC, number ASC
          `,
  });
  return yield* query(undefined);
});

export const upsertPullRequestWatch = Effect.fn("PullRequestWatch.upsert")(function* (
  watch: PullRequestWatch,
) {
  const sql = yield* SqlClient.SqlClient;
  const upsert = SqlSchema.void({
    Request: WatchRow,
    execute: (row) => sql`
      INSERT INTO fork_pull_request_watches (
        thread_id, host, repository, number, status, attempts_used, handled_json, updated_at
      )
      VALUES (
        ${row.threadId}, ${row.host}, ${row.repository}, ${row.number}, ${row.status},
        ${row.attemptsUsed}, ${row.handled}, ${row.updatedAt}
      )
      ON CONFLICT (thread_id, host, repository, number) DO UPDATE SET
        status = excluded.status,
        attempts_used = excluded.attempts_used,
        handled_json = excluded.handled_json,
        updated_at = excluded.updated_at
    `,
  });
  yield* upsert({ ...watch, ...normalizeThreadPullRequestKey(watch) });
});

export const deletePullRequestWatches = Effect.fn("PullRequestWatch.delete")(function* (
  threadId: ThreadId,
  pullRequest?: ThreadPullRequestKey,
) {
  const sql = yield* SqlClient.SqlClient;
  if (pullRequest === undefined) {
    yield* sql`DELETE FROM fork_pull_request_watches WHERE thread_id = ${threadId}`;
    return;
  }
  const key = normalizeThreadPullRequestKey(pullRequest);
  yield* sql`
    DELETE FROM fork_pull_request_watches
    WHERE thread_id = ${threadId}
      AND host = ${key.host}
      AND repository = ${key.repository}
      AND number = ${key.number}
  `;
});
