import { GitHubIssueError, ThreadId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import { runMigrations } from "../persistence/Migrations.ts";
import { ensureThreadTabsSchema } from "../threadTabs/schema.ts";
import { GitHubIssues } from "./GitHubIssues.ts";
import * as GitHubIssueThreadLinks from "./GitHubIssueThreadLinks.ts";
import { ensureGitHubIssueThreadLinksSchema } from "./threadLinksSchema.ts";

const issueUrl = (number: number) => `https://github.com/acme/app/issues/${number}`;
const issue = (number: number) => ({
  repository: "acme/app",
  number,
  title: `Issue ${number}`,
  url: issueUrl(number),
  state: "open" as const,
  stateReason: null,
  authorLogin: "ada",
  assigneeLogins: [],
  labels: [],
  updatedAt: "2026-09-30T00:00:00.000Z",
});

const sqlLayer = NodeSqliteClient.layer({ filename: ":memory:" });
const schemaLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    yield* runMigrations();
    yield* ensureThreadTabsSchema();
    yield* ensureGitHubIssueThreadLinksSchema();
  }),
);
const issuesLayer = Layer.mock(GitHubIssues)({
  getIssueSummary: ({ url }) =>
    url === issueUrl(1) || url === issueUrl(2)
      ? Effect.succeed(issue(Number(url.split("/").at(-1))))
      : Effect.fail(new GitHubIssueError({ reason: "not-found", detail: "Issue not found" })),
});

const testLayer = GitHubIssueThreadLinks.layer.pipe(
  Layer.provideMerge(issuesLayer),
  Layer.provideMerge(schemaLayer),
  Layer.provideMerge(sqlLayer),
);

const first = ThreadId.make("first");
const second = ThreadId.make("second");

it.layer(testLayer)("GitHubIssueThreadLinks", (it) => {
  it.effect("links a tab group once, whichever tab links it", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const links = yield* GitHubIssueThreadLinks.GitHubIssueThreadLinks;
      yield* sql`
        INSERT INTO fork_thread_tabs (thread_id, group_id, position, created_at) VALUES
          ('first', 'first', 0, '2026-01-01T00:00:00.000Z'),
          ('second', 'first', 1, '2026-01-01T00:00:01.000Z')
      `;
      yield* links.refresh;

      const initial = yield* links.linkWithReplacement({ threadId: second, url: issueUrl(1) });
      const linked = initial.link;
      assert.strictEqual(initial.replacedUrl, null);
      const sameIssue = yield* links.linkWithReplacement({ threadId: first, url: issueUrl(1) });
      assert.strictEqual(sameIssue.replacedUrl, null);
      assert.strictEqual(linked.groupId, first);
      assert.deepEqual(linked.threadIds, [first, second]);
      assert.strictEqual(linked.repository, "acme/app");
      assert.strictEqual(linked.number, 1);

      // Linking again from the other tab replaces the group's issue.
      const relinked = yield* links.linkWithReplacement({ threadId: first, url: issueUrl(2) });
      assert.strictEqual(relinked.link.number, 2);
      assert.strictEqual(relinked.replacedUrl, linked.url);
      const rows = yield* sql<{ readonly n: number }>`
        SELECT COUNT(*) AS n FROM fork_github_issue_thread_links
      `;
      assert.strictEqual(rows[0]?.n, 1);
      // Either tab reads the group's link.
      assert.strictEqual((yield* links.forThread(second))?.number, 2);

      assert.strictEqual(yield* links.unlink({ threadId: second }), true);
      assert.strictEqual(yield* links.forThread(first), undefined);
      assert.strictEqual(yield* links.unlink({ threadId: first }), false);
      const remaining = yield* sql<{ readonly n: number }>`
        SELECT COUNT(*) AS n FROM fork_github_issue_thread_links
      `;
      assert.strictEqual(remaining[0]?.n, 0);
    }),
  );

  it.effect("refuses an issue GitHub does not know", () =>
    Effect.gen(function* () {
      const links = yield* GitHubIssueThreadLinks.GitHubIssueThreadLinks;
      const threadId = ThreadId.make("solo");
      const original = yield* links.link({ threadId, url: issueUrl(1) });
      const error = yield* links
        .linkWithReplacement({ threadId, url: issueUrl(404) })
        .pipe(Effect.flip);
      assert.strictEqual(error.reason, "not-found");
      assert.deepEqual(yield* links.forThread(threadId), original);
    }),
  );
});
