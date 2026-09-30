import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/** One linked Linear issue per chat-tab group. Runs after `ensureThreadTabsSchema`. */
export const ensureLinearThreadLinksSchema = Effect.fn("LinearThreadLinks.ensureSchema")(
  function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      CREATE TABLE IF NOT EXISTS fork_linear_thread_links (
        group_id TEXT PRIMARY KEY,
        issue_id TEXT NOT NULL,
        identifier TEXT NOT NULL,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        linked_at TEXT NOT NULL
      )
    `;
    yield* sql`INSERT OR IGNORE INTO fork_schema_migrations (feature, version) VALUES ('linear_thread_links', 1)`;
  },
);
