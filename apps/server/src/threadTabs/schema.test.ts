import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

import { runMigrations } from "../persistence/Migrations.ts";
import { ensureThreadTabsSchema } from "./schema.ts";

it.layer(NodeSqliteClient.layer({ filename: ":memory:" }))("fork thread tab schema", (it) => {
  it.effect("persists grouping without taking an upstream migration number", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations();
      yield* ensureThreadTabsSchema();
      yield* sql`
        INSERT INTO fork_thread_tabs (thread_id, group_id, position, created_at)
        VALUES ('second', 'first', 1, '2026-01-01T00:00:00.000Z')
      `;
      yield* ensureThreadTabsSchema();
      const tabs = yield* sql<{ readonly threadId: string }>`
        SELECT thread_id AS "threadId" FROM fork_thread_tabs WHERE group_id = 'first'
      `;
      const forkVersions = yield* sql<{ readonly version: number }>`
        SELECT version FROM fork_schema_migrations WHERE feature = 'thread_tabs'
      `;
      assert.deepEqual(tabs, [{ threadId: "second" }]);
      assert.deepEqual(forkVersions, [{ version: 1 }]);
    }),
  );
});
