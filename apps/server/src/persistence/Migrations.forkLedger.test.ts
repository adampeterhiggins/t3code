import { assert, describe, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import { migrationManifest, runMigrations } from "./Migrations.ts";

describe("fork migration 55", () => {
  it.effect("runs OrchestrationV2 on a database that recorded the fork's migration 55", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 54 });
      // What the fork's 55_ProjectionThreadsCreatedBy left behind.
      yield* sql`ALTER TABLE projection_threads ADD COLUMN created_by_json TEXT`;
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES (55, 'ProjectionThreadsCreatedBy')
      `;

      // Upstream's 55 and everything after it run; the fork's 55 row is replaced.
      assert.deepStrictEqual(
        yield* runMigrations(),
        migrationManifest.filter(([id]) => id >= 55),
      );
      assert.deepStrictEqual(yield* runMigrations(), []);
      const history = yield* sql<{ readonly migration_id: number; readonly name: string }>`
        SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id
      `;
      assert.deepStrictEqual(
        history.map((row) => [row.migration_id, row.name] as const),
        migrationManifest,
      );
      const tables = yield* sql`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name = 'orchestration_v2_projection_threads'
      `;
      assert.strictEqual(tables.length, 1);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});
