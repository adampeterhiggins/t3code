import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * What Linear assignment triggers have acted on. An issue row means it never starts another
 * thread; `thread_id` is null for issues already assigned when a rule was added. A rule row means
 * the issues already assigned to that Linear account and matching that rule's filters were
 * recorded. Runs after `ensureThreadTabsSchema`.
 */
export const ensureLinearAssignmentTriggerSchema = Effect.fn(
  "LinearAssignmentTriggers.ensureSchema",
)(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE IF NOT EXISTS fork_linear_assignment_issues (
      issue_id TEXT PRIMARY KEY,
      thread_id TEXT,
      recorded_at TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS fork_linear_assignment_rules (
      rule_key TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      baselined_at TEXT NOT NULL
    )
  `;
  yield* sql`INSERT OR IGNORE INTO fork_schema_migrations (feature, version) VALUES ('linear_assignment_triggers', 1)`;
});
