import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/** One linked Notion page per chat-tab group. Runs after `ensureThreadTabsSchema`. */
export const ensureNotionThreadLinksSchema = Effect.fn("NotionThreadLinks.ensureSchema")(
  function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      CREATE TABLE IF NOT EXISTS fork_notion_thread_links (
        group_id TEXT PRIMARY KEY,
        page_id TEXT NOT NULL,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        linked_at TEXT NOT NULL
      )
    `;
    yield* sql`INSERT OR IGNORE INTO fork_schema_migrations (feature, version) VALUES ('notion_thread_links', 1)`;
  },
);
