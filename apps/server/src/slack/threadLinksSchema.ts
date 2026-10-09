import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/** One linked Slack thread per chat-tab group. Runs after `ensureThreadTabsSchema`. */
export const ensureSlackThreadLinksSchema = Effect.fn("SlackThreadLinks.ensureSchema")(
  function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      CREATE TABLE IF NOT EXISTS fork_slack_thread_links (
        group_id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        thread_ts TEXT NOT NULL,
        channel_label TEXT NOT NULL,
        author_name TEXT NOT NULL,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        linked_at TEXT NOT NULL
      )
    `;
    yield* sql`INSERT OR IGNORE INTO fork_schema_migrations (feature, version) VALUES ('slack_thread_links', 1)`;
  },
);
