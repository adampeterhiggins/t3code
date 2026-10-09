import { NotionError, ThreadId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import { runMigrations } from "../persistence/Migrations.ts";
import { ensureThreadTabsSchema } from "../threadTabs/schema.ts";
import { NotionApi } from "./NotionApi.ts";
import * as NotionThreadLinks from "./NotionThreadLinks.ts";
import { ensureNotionThreadLinksSchema } from "./threadLinksSchema.ts";

const pages: Record<string, string> = { "page-1": "Launch plan", "page-2": "Runbook" };

const sqlLayer = NodeSqliteClient.layer({ filename: ":memory:" });
const schemaLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    yield* runMigrations();
    yield* ensureThreadTabsSchema();
    yield* ensureNotionThreadLinksSchema();
  }),
);
const apiLayer = Layer.mock(NotionApi)({
  getPageSummary: ({ id }) => {
    const title = pages[id];
    return title === undefined
      ? Effect.fail(new NotionError({ reason: "not-found", detail: "Page not shared" }))
      : Effect.succeed({
          id,
          title,
          url: `https://www.notion.so/${id}`,
          updatedAt: "2026-09-30T00:00:00.000Z",
        });
  },
});

const testLayer = NotionThreadLinks.layer.pipe(
  Layer.provideMerge(apiLayer),
  Layer.provideMerge(schemaLayer),
  Layer.provideMerge(sqlLayer),
);

const first = ThreadId.make("first");
const second = ThreadId.make("second");

it.layer(testLayer)("NotionThreadLinks", (it) => {
  it.effect("links a tab group once, whichever tab links it", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const links = yield* NotionThreadLinks.NotionThreadLinks;
      yield* sql`
        INSERT INTO fork_thread_tabs (thread_id, group_id, position, created_at) VALUES
          ('first', 'first', 0, '2026-01-01T00:00:00.000Z'),
          ('second', 'first', 1, '2026-01-01T00:00:01.000Z')
      `;
      yield* links.refresh;

      const linked = yield* links.link({ threadId: second, pageId: "page-1" });
      assert.strictEqual(linked.groupId, first);
      assert.deepEqual(linked.threadIds, [first, second]);
      assert.strictEqual(linked.title, "Launch plan");

      // Linking again from the other tab replaces the group's page.
      const relinked = yield* links.link({ threadId: first, pageId: "page-2" });
      assert.strictEqual(relinked.title, "Runbook");
      const rows = yield* sql<{ readonly n: number }>`
        SELECT COUNT(*) AS n FROM fork_notion_thread_links
      `;
      assert.strictEqual(rows[0]?.n, 1);

      yield* links.unlink({ threadId: second });
      const remaining = yield* sql<{ readonly n: number }>`
        SELECT COUNT(*) AS n FROM fork_notion_thread_links
      `;
      assert.strictEqual(remaining[0]?.n, 0);
    }),
  );

  it.effect("refuses a page Notion cannot read", () =>
    Effect.gen(function* () {
      const links = yield* NotionThreadLinks.NotionThreadLinks;
      const error = yield* links
        .link({ threadId: ThreadId.make("solo"), pageId: "page-404" })
        .pipe(Effect.flip);
      assert.strictEqual(error.reason, "not-found");
    }),
  );
});
