import { SubagentTranscriptEntry, type ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import type { SubagentTranscriptRead } from "./subagentTranscript.ts";

/**
 * Characters of entry text kept per retained transcript. Adapters already bound each read; this
 * keeps a thread with many agents from growing the database by megabytes per agent.
 */
export const RETAINED_SUBAGENT_TRANSCRIPT_CHAR_LIMIT = 200_000;

export interface RetainedSubagentTranscript extends SubagentTranscriptRead {
  readonly retainedAt: string;
}

/**
 * The last transcript read for each subagent, so the Agents panel and history tools can still
 * show it after the provider session stops. ProviderService writes it when an agent finishes and
 * on every successful live read.
 */
export class SubagentTranscriptStore extends Context.Service<
  SubagentTranscriptStore,
  {
    readonly retain: (
      threadId: ThreadId,
      taskId: string,
      transcript: SubagentTranscriptRead,
    ) => Effect.Effect<void>;
    readonly get: (
      threadId: ThreadId,
      taskId: string,
    ) => Effect.Effect<Option.Option<RetainedSubagentTranscript>>;
  }
>()("t3/provider/SubagentTranscriptStore") {}

/** Fork-owned table, versioned in `fork_schema_migrations` so upstream's numbering stays free. */
export const ensureSubagentTranscriptSchema = Effect.fn("SubagentTranscriptStore.ensureSchema")(
  function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      CREATE TABLE IF NOT EXISTS fork_schema_migrations (
        feature TEXT NOT NULL,
        version INTEGER NOT NULL,
        applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (feature, version)
      )
    `;
    yield* sql`
      CREATE TABLE IF NOT EXISTS fork_subagent_transcripts (
        thread_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        entries_json TEXT NOT NULL,
        truncated INTEGER NOT NULL,
        retained_at TEXT NOT NULL,
        PRIMARY KEY (thread_id, task_id)
      )
    `;
    yield* sql`INSERT OR IGNORE INTO fork_schema_migrations (feature, version) VALUES ('subagent_transcripts', 1)`;
  },
);

/** Keeps the newest entries whose text fits RETAINED_SUBAGENT_TRANSCRIPT_CHAR_LIMIT. */
export function boundRetainedSubagentTranscript(
  transcript: SubagentTranscriptRead,
): SubagentTranscriptRead {
  let remaining = RETAINED_SUBAGENT_TRANSCRIPT_CHAR_LIMIT;
  let start = transcript.entries.length;
  while (start > 0) {
    const entry = transcript.entries[start - 1]!;
    const size = entry.text.length + (entry.input?.length ?? 0) + (entry.output?.length ?? 0);
    if (size > remaining) break;
    remaining -= size;
    start -= 1;
  }
  return start === 0 ? transcript : { entries: transcript.entries.slice(start), truncated: true };
}

const TranscriptRow = Schema.Struct({
  entries: Schema.fromJsonString(Schema.Array(SubagentTranscriptEntry)),
  truncated: Schema.Number,
  retainedAt: Schema.String,
});

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsert = SqlSchema.void({
    Request: Schema.Struct({
      threadId: Schema.String,
      taskId: Schema.String,
      entries: Schema.fromJsonString(Schema.Array(SubagentTranscriptEntry)),
      truncated: Schema.Number,
      retainedAt: Schema.String,
    }),
    execute: (row) => sql`
      INSERT INTO fork_subagent_transcripts (thread_id, task_id, entries_json, truncated, retained_at)
      VALUES (${row.threadId}, ${row.taskId}, ${row.entries}, ${row.truncated}, ${row.retainedAt})
      ON CONFLICT (thread_id, task_id) DO UPDATE SET
        entries_json = excluded.entries_json,
        truncated = excluded.truncated,
        retained_at = excluded.retained_at
    `,
  });

  const find = SqlSchema.findOneOption({
    Request: Schema.Struct({ threadId: Schema.String, taskId: Schema.String }),
    Result: TranscriptRow,
    execute: (request) => sql`
      SELECT entries_json AS "entries", truncated, retained_at AS "retainedAt"
      FROM fork_subagent_transcripts
      WHERE thread_id = ${request.threadId} AND task_id = ${request.taskId}
    `,
  });

  return SubagentTranscriptStore.of({
    retain: (threadId, taskId, transcript) =>
      Effect.gen(function* () {
        const bounded = boundRetainedSubagentTranscript(transcript);
        yield* upsert({
          threadId,
          taskId,
          entries: bounded.entries,
          truncated: bounded.truncated ? 1 : 0,
          retainedAt: DateTime.formatIso(yield* DateTime.now),
        });
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("failed to retain subagent transcript", { threadId, taskId, cause }),
        ),
      ),
    get: (threadId, taskId) =>
      find({ threadId, taskId }).pipe(
        Effect.map(
          Option.map((row) => ({
            entries: row.entries,
            truncated: row.truncated !== 0,
            retainedAt: row.retainedAt,
          })),
        ),
        Effect.catchCause((cause) =>
          Effect.logWarning("failed to read retained subagent transcript", {
            threadId,
            taskId,
            cause,
          }).pipe(Effect.as(Option.none())),
        ),
      ),
  });
});

export const layer = Layer.effect(SubagentTranscriptStore, make);
