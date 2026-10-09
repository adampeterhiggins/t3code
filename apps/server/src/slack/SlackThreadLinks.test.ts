import { SlackError, type SlackThreadContext, ThreadId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import { runMigrations } from "../persistence/Migrations.ts";
import { ensureThreadTabsSchema } from "../threadTabs/schema.ts";
import { SlackApi } from "./SlackApi.ts";
import * as SlackThreadLinks from "./SlackThreadLinks.ts";
import { ensureSlackThreadLinksSchema } from "./threadLinksSchema.ts";

const permalink = (ts: string) => `https://acme.slack.com/archives/C1/p${ts.replace(".", "")}`;

// `1.000100` starts a thread; `2.000200` is a reply in it, whose link omits the root.
const messages: Record<string, { readonly root: string | null; readonly text: string }> = {
  "1.000100": { root: null, text: "Deploy is stuck" },
  "2.000200": { root: "1.000100", text: "Rolling back now" },
};

const sqlLayer = NodeSqliteClient.layer({ filename: ":memory:" });
const schemaLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    yield* runMigrations();
    yield* ensureThreadTabsSchema();
    yield* ensureSlackThreadLinksSchema();
  }),
);
const apiLayer = Layer.mock(SlackApi)({
  getThread: (input) => {
    const message = messages[input.ts];
    if (message === undefined) {
      return Effect.fail(new SlackError({ reason: "not-found", detail: "Message not found" }));
    }
    return Effect.succeed({
      teamId: "T1",
      channelId: input.channelId,
      channelLabel: "#ops",
      ts: input.ts,
      threadTs: message.root,
      url: input.url,
      authorName: "Ada",
      title: message.text,
      replyCount: 0,
      scope: input.scope,
      markdown: message.text,
    } satisfies SlackThreadContext);
  },
});

const testLayer = SlackThreadLinks.layer.pipe(
  Layer.provideMerge(apiLayer),
  Layer.provideMerge(schemaLayer),
  Layer.provideMerge(sqlLayer),
);

const first = ThreadId.make("first");
const second = ThreadId.make("second");

it.layer(testLayer)("SlackThreadLinks", (it) => {
  it.effect("links a tab group to the thread a message belongs to, whichever tab links it", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const links = yield* SlackThreadLinks.SlackThreadLinks;
      yield* sql`
        INSERT INTO fork_thread_tabs (thread_id, group_id, position, created_at) VALUES
          ('first', 'first', 0, '2026-01-01T00:00:00.000Z'),
          ('second', 'first', 1, '2026-01-01T00:00:01.000Z')
      `;
      yield* links.refresh;

      // A reply links its whole thread, keyed by the root message.
      const linked = yield* links.link({
        threadId: second,
        channelId: "C1",
        ts: "2.000200",
        url: permalink("2.000200"),
      });
      assert.strictEqual(linked.groupId, first);
      assert.deepEqual(linked.threadIds, [first, second]);
      assert.strictEqual(linked.threadTs, "1.000100");
      assert.strictEqual(linked.channelLabel, "#ops");
      assert.strictEqual(linked.title, "Rolling back now");

      // Linking again from the other tab replaces the group's Slack thread.
      const relinked = yield* links.link({
        threadId: first,
        channelId: "C1",
        ts: "1.000100",
        url: permalink("1.000100"),
      });
      assert.strictEqual(relinked.threadTs, "1.000100");
      assert.strictEqual(relinked.title, "Deploy is stuck");
      const rows = yield* sql<{ readonly n: number }>`
        SELECT COUNT(*) AS n FROM fork_slack_thread_links
      `;
      assert.strictEqual(rows[0]?.n, 1);

      yield* links.unlink({ threadId: second });
      const remaining = yield* sql<{ readonly n: number }>`
        SELECT COUNT(*) AS n FROM fork_slack_thread_links
      `;
      assert.strictEqual(remaining[0]?.n, 0);
    }),
  );

  it.effect("refuses a message Slack cannot read", () =>
    Effect.gen(function* () {
      const links = yield* SlackThreadLinks.SlackThreadLinks;
      const error = yield* links
        .link({
          threadId: ThreadId.make("solo"),
          channelId: "C1",
          ts: "9.000900",
          url: permalink("9.000900"),
        })
        .pipe(Effect.flip);
      assert.strictEqual(error.reason, "not-found");
    }),
  );
});
