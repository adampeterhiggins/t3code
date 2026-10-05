import { CommandId, ThreadId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as Orchestrator from "./Orchestrator.ts";

interface ForkWatchRow {
  readonly threadId: string;
  readonly host: string;
  readonly repository: string;
  readonly number: number;
  readonly status: string;
}

/**
 * Moves watches from the fork's pre-v2 `fork_pull_request_watches` table onto their thread's v2
 * pull request link, then drops the table. Paused watches stay paused. The old follow-up count
 * and handled problems are not carried over: the first pass reports what is wrong now.
 * A watch whose pull request is no longer linked is dropped with the table.
 */
export const importForkPullRequestWatches = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const engine = yield* Orchestrator.OrchestratorV2;
  const table = yield* sql<{ readonly name: string }>`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'fork_pull_request_watches'
  `;
  if (table.length === 0) return;
  const rows = yield* sql<ForkWatchRow>`
    SELECT thread_id AS "threadId", host, repository, number, status
    FROM fork_pull_request_watches
  `;
  yield* Effect.forEach(
    rows,
    (row) =>
      engine
        .dispatch({
          type: "thread.pull-request.watch",
          commandId: CommandId.make(
            `server:fork-pr-watch-import:${row.threadId}:${row.host}/${row.repository}#${row.number}`,
          ),
          threadId: ThreadId.make(row.threadId),
          host: row.host,
          repository: row.repository,
          number: row.number,
          watching: true,
          ...(row.status === "paused" ? { paused: true } : {}),
        })
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("could not import a fork pull request watch", {
              threadId: row.threadId,
              cause: Cause.pretty(cause),
            }),
          ),
        ),
    { discard: true },
  );
  yield* sql`DROP TABLE fork_pull_request_watches`;
}).pipe(
  Effect.catchCause((cause) =>
    Cause.hasInterruptsOnly(cause)
      ? Effect.failCause(cause)
      : Effect.logWarning("importing fork pull request watches failed", {
          cause: Cause.pretty(cause),
        }),
  ),
  Effect.withSpan("importForkPullRequestWatches"),
);
