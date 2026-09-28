import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/** Fork-owned schema history. Upstream's numbered migration sequence stays untouched. */
export const ensureThreadTabsSchema = Effect.fn("ThreadTabs.ensureSchema")(function* () {
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
    CREATE TABLE IF NOT EXISTS fork_thread_tabs (
      thread_id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      created_at TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_fork_thread_tabs_group ON fork_thread_tabs (group_id, position)`;
  yield* sql`INSERT OR IGNORE INTO fork_schema_migrations (feature, version) VALUES ('thread_tabs', 1)`;
});
