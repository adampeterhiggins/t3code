import { LinearError, ThreadId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import { runMigrations } from "../persistence/Migrations.ts";
import { ensureThreadTabsSchema } from "../threadTabs/schema.ts";
import { LinearApi } from "./LinearApi.ts";
import * as LinearThreadLinks from "./LinearThreadLinks.ts";
import { ensureLinearThreadLinksSchema } from "./threadLinksSchema.ts";

const issue = (id: string, identifier: string) => ({
  id,
  identifier,
  title: `Issue ${identifier}`,
  url: `https://linear.app/acme/issue/${identifier}`,
  stateName: "In Progress",
  stateType: "started",
  stateColor: "#f2c94c",
  priorityLabel: null,
  assigneeName: null,
  updatedAt: "2026-09-30T00:00:00.000Z",
});

const ISSUES = new Map([
  ["ENG-1", issue("uuid-1", "ENG-1")],
  ["ENG-2", issue("uuid-2", "ENG-2")],
]);

const sqlLayer = NodeSqliteClient.layer({ filename: ":memory:" });
const schemaLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    yield* runMigrations();
    yield* ensureThreadTabsSchema();
    yield* ensureLinearThreadLinksSchema();
  }),
);
const apiLayer = Layer.mock(LinearApi)({
  getIssueSummary: ({ id }) => {
    const found = ISSUES.get(id);
    return found
      ? Effect.succeed(found)
      : Effect.fail(new LinearError({ reason: "not-found", detail: "Issue not found" }));
  },
});

const testLayer = LinearThreadLinks.layer.pipe(
  Layer.provideMerge(apiLayer),
  Layer.provideMerge(schemaLayer),
  Layer.provideMerge(sqlLayer),
);

const first = ThreadId.make("first");
const second = ThreadId.make("second");

it.layer(testLayer)("LinearThreadLinks", (it) => {
  it.effect("links a tab group once, whichever tab links it", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const links = yield* LinearThreadLinks.LinearThreadLinks;
      yield* sql`
        INSERT INTO fork_thread_tabs (thread_id, group_id, position, created_at) VALUES
          ('first', 'first', 0, '2026-01-01T00:00:00.000Z'),
          ('second', 'first', 1, '2026-01-01T00:00:01.000Z')
      `;
      yield* links.refresh;

      const linked = yield* links.link({ threadId: second, issueId: "ENG-1" });
      assert.strictEqual(linked.groupId, first);
      assert.deepEqual(linked.threadIds, [first, second]);
      assert.strictEqual(linked.issueId, "uuid-1");

      // Linking again from the other tab replaces the group's issue.
      const relinked = yield* links.link({ threadId: first, issueId: "ENG-2" });
      assert.strictEqual(relinked.identifier, "ENG-2");
      const rows = yield* sql<{ readonly n: number }>`
        SELECT COUNT(*) AS n FROM fork_linear_thread_links
      `;
      assert.strictEqual(rows[0]?.n, 1);

      yield* links.unlink({ threadId: second });
      const remaining = yield* sql<{ readonly n: number }>`
        SELECT COUNT(*) AS n FROM fork_linear_thread_links
      `;
      assert.strictEqual(remaining[0]?.n, 0);
    }),
  );

  it.effect("refuses an issue Linear does not know", () =>
    Effect.gen(function* () {
      const links = yield* LinearThreadLinks.LinearThreadLinks;
      const error = yield* links
        .link({ threadId: ThreadId.make("solo"), issueId: "ENG-404" })
        .pipe(Effect.flip);
      assert.strictEqual(error.reason, "not-found");
    }),
  );
});

it("groupLinkRows lists a solo thread as its own group", () => {
  const [link] = LinearThreadLinks.groupLinkRows([
    {
      groupId: "solo",
      issueId: "uuid-1",
      identifier: "ENG-1",
      title: "Issue",
      url: "https://linear.app/acme/issue/ENG-1",
      linkedAt: "2026-09-30T00:00:00.000Z",
      threadId: null,
    },
  ]);
  assert.deepEqual(link?.threadIds, [ThreadId.make("solo")]);
});
