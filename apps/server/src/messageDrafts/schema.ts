import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/** Messages saved in a thread to send later. Runs after `ensureThreadTabsSchema`. */
export const ensureMessageDraftsSchema = Effect.fn("MessageDrafts.ensureSchema")(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE IF NOT EXISTS fork_message_drafts (
      draft_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      text TEXT NOT NULL,
      attachments_json TEXT NOT NULL,
      context_json TEXT,
      origin TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS fork_message_drafts_thread_id
    ON fork_message_drafts (thread_id)
  `;
  yield* sql`INSERT OR IGNORE INTO fork_schema_migrations (feature, version) VALUES ('message_drafts', 1)`;
});
