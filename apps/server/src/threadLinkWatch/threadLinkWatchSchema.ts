import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * One watch per thread and link kind. `baseline` is what the thread was last told about, as
 * JSON. Runs after `ensureThreadTabsSchema`, which creates `fork_schema_migrations`.
 */
export const ensureThreadLinkWatchesSchema = Effect.fn("ThreadLinkWatches.ensureSchema")(
  function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      CREATE TABLE IF NOT EXISTS fork_thread_link_watches (
        thread_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        url TEXT NOT NULL,
        started_at TEXT NOT NULL,
        wakes INTEGER NOT NULL,
        baseline TEXT NOT NULL,
        PRIMARY KEY (thread_id, kind)
      )
    `;
    yield* sql`INSERT OR IGNORE INTO fork_schema_migrations (feature, version) VALUES ('thread_link_watches', 1)`;
  },
);
