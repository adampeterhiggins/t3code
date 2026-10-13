import { GranolaError, ThreadId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import { runMigrations } from "../persistence/Migrations.ts";
import { ensureThreadTabsSchema } from "../threadTabs/schema.ts";
import { GranolaApi } from "./GranolaApi.ts";
import * as GranolaThreadLinks from "./GranolaThreadLinks.ts";
import { ensureGranolaThreadLinksSchema } from "./threadLinksSchema.ts";

const notes: Record<string, string> = { "note-1": "Launch review", "note-2": "Weekly sync" };

const sqlLayer = NodeSqliteClient.layer({ filename: ":memory:" });
const schemaLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    yield* runMigrations();
    yield* ensureThreadTabsSchema();
    yield* ensureGranolaThreadLinksSchema();
  }),
);
const apiLayer = Layer.mock(GranolaApi)({
  getNoteSummary: ({ id }) => {
    const title = notes[id];
    return title === undefined
      ? Effect.fail(new GranolaError({ reason: "not-found", detail: "Note not found" }))
      : Effect.succeed({
          id,
          title,
          url: `https://notes.granola.ai/d/${id}`,
          meetingAt: "2026-09-30T09:00:00.000Z",
          participants: ["Ada"],
          creator: "Ada",
        });
  },
});

const testLayer = GranolaThreadLinks.layer.pipe(
  Layer.provideMerge(apiLayer),
  Layer.provideMerge(schemaLayer),
  Layer.provideMerge(sqlLayer),
);

const first = ThreadId.make("first");
const second = ThreadId.make("second");

it.layer(testLayer)("GranolaThreadLinks", (it) => {
  it.effect("links a tab group once, whichever tab links it", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const links = yield* GranolaThreadLinks.GranolaThreadLinks;
      yield* sql`
        INSERT INTO fork_thread_tabs (thread_id, group_id, position, created_at) VALUES
          ('first', 'first', 0, '2026-01-01T00:00:00.000Z'),
          ('second', 'first', 1, '2026-01-01T00:00:01.000Z')
      `;
      yield* links.refresh;

      const linked = yield* links.link({ threadId: second, noteId: "note-1" });
      assert.strictEqual(linked.groupId, first);
      assert.deepEqual(linked.threadIds, [first, second]);
      assert.strictEqual(linked.title, "Launch review");

      // Linking again from the other tab replaces the group's note.
      const relinked = yield* links.link({ threadId: first, noteId: "note-2" });
      assert.strictEqual(relinked.title, "Weekly sync");
      const rows = yield* sql<{ readonly n: number }>`
        SELECT COUNT(*) AS n FROM fork_granola_thread_links
      `;
      assert.strictEqual(rows[0]?.n, 1);

      yield* links.unlink({ threadId: second });
      const remaining = yield* sql<{ readonly n: number }>`
        SELECT COUNT(*) AS n FROM fork_granola_thread_links
      `;
      assert.strictEqual(remaining[0]?.n, 0);
    }),
  );

  it.effect("refuses a note Granola cannot read", () =>
    Effect.gen(function* () {
      const links = yield* GranolaThreadLinks.GranolaThreadLinks;
      const error = yield* links
        .link({ threadId: ThreadId.make("solo"), noteId: "note-404" })
        .pipe(Effect.flip);
      assert.strictEqual(error.reason, "not-found");
    }),
  );
});
