import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/** One linked Discord thread per chat-tab group. Runs after `ensureThreadTabsSchema`. */
export const ensureDiscordThreadLinksSchema = Effect.fn("DiscordThreadLinks.ensureSchema")(
  function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      CREATE TABLE IF NOT EXISTS fork_discord_thread_links (
        group_id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        channel_label TEXT NOT NULL,
        author_name TEXT NOT NULL,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        linked_at TEXT NOT NULL
      )
    `;
    yield* sql`INSERT OR IGNORE INTO fork_schema_migrations (feature, version) VALUES ('discord_thread_links', 1)`;
  },
);
