import { GoogleError, ThreadId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import { runMigrations } from "../persistence/Migrations.ts";
import { ensureThreadTabsSchema } from "../threadTabs/schema.ts";
import { GoogleApi } from "./GoogleApi.ts";
import * as GoogleThreadLinks from "./GoogleThreadLinks.ts";
import { ensureGoogleThreadLinksSchema } from "./threadLinksSchema.ts";

const files: Record<string, string> = { "page-1": "Launch plan", "page-2": "Runbook" };

const sqlLayer = NodeSqliteClient.layer({ filename: ":memory:" });
const schemaLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    yield* runMigrations();
    yield* ensureThreadTabsSchema();
    yield* ensureGoogleThreadLinksSchema();
  }),
);
const apiLayer = Layer.mock(GoogleApi)({
  getFileSummary: ({ id }) => {
    const title = files[id];
    return title === undefined
      ? Effect.fail(new GoogleError({ reason: "not-found", detail: "Page not shared" }))
      : Effect.succeed({
          id,
          title,
          url: `https://www.google.so/${id}`,
          fileType: "doc" as const,
          updatedAt: "2026-09-30T00:00:00.000Z",
        });
  },
});

const testLayer = GoogleThreadLinks.layer.pipe(
  Layer.provideMerge(apiLayer),
  Layer.provideMerge(schemaLayer),
  Layer.provideMerge(sqlLayer),
);

const first = ThreadId.make("first");
const second = ThreadId.make("second");

it.layer(testLayer)("GoogleThreadLinks", (it) => {
  it.effect("links a tab group once, whichever tab links it", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const links = yield* GoogleThreadLinks.GoogleThreadLinks;
      yield* sql`
        INSERT INTO fork_thread_tabs (thread_id, group_id, position, created_at) VALUES
          ('first', 'first', 0, '2026-01-01T00:00:00.000Z'),
          ('second', 'first', 1, '2026-01-01T00:00:01.000Z')
      `;
      yield* links.refresh;

      const linked = yield* links.link({ threadId: second, fileId: "page-1" });
      assert.strictEqual(linked.groupId, first);
      assert.deepEqual(linked.threadIds, [first, second]);
      assert.strictEqual(linked.title, "Launch plan");

      // Linking again from the other tab replaces the group's page.
      const relinked = yield* links.link({ threadId: first, fileId: "page-2" });
      assert.strictEqual(relinked.title, "Runbook");
      const rows = yield* sql<{ readonly n: number }>`
        SELECT COUNT(*) AS n FROM fork_google_thread_links
      `;
      assert.strictEqual(rows[0]?.n, 1);

      yield* links.unlink({ threadId: second });
      const remaining = yield* sql<{ readonly n: number }>`
        SELECT COUNT(*) AS n FROM fork_google_thread_links
      `;
      assert.strictEqual(remaining[0]?.n, 0);
    }),
  );

  it.effect("refuses a page Google cannot read", () =>
    Effect.gen(function* () {
      const links = yield* GoogleThreadLinks.GoogleThreadLinks;
      const error = yield* links
        .link({ threadId: ThreadId.make("solo"), fileId: "page-404" })
        .pipe(Effect.flip);
      assert.strictEqual(error.reason, "not-found");
    }),
  );
});
