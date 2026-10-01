import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/** One linked GitHub issue per chat-tab group. Runs after `ensureThreadTabsSchema`. */
export const ensureGitHubIssueThreadLinksSchema = Effect.fn("GitHubIssueThreadLinks.ensureSchema")(
  function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
    CREATE TABLE IF NOT EXISTS fork_github_issue_thread_links (
      group_id TEXT PRIMARY KEY,
      repository TEXT NOT NULL,
      number INTEGER NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      linked_at TEXT NOT NULL
    )
  `;
    yield* sql`INSERT OR IGNORE INTO fork_schema_migrations (feature, version) VALUES ('github_issue_thread_links', 1)`;
  },
);
