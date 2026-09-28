// node:sqlite reads the live Devin CLI session database.
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import * as NodeTimersPromises from "node:timers/promises";

import { totalTokens, type UsageRecord } from "./usageTranscripts.ts";

function tokens(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export interface DevinUsageReadResult {
  readonly files: readonly { readonly path: string; readonly records: readonly UsageRecord[] }[];
  readonly missing: boolean;
  readonly error: boolean;
}

/**
 * Reads per-request usage from Devin's `sessions.db`, which holds every CLI
 * session including the ones T3 drives over ACP.
 *
 * Each assistant message records its own request metrics, and `input_tokens`
 * already excludes cache reads. Forked sessions copy nodes, so the same
 * message appears in many rows; its `message_id` identifies it once. Only the
 * usage fields are extracted in SQL so large tool outputs never reach JS.
 */
export async function readDevinUsage(root: string, sinceMs: number): Promise<DevinUsageReadResult> {
  const path = NodePath.join(root, "sessions.db");
  try {
    if (!(await NodeFSP.stat(path)).isFile()) return { files: [], missing: true, error: false };
  } catch (cause) {
    const missing = (cause as { code?: unknown }).code === "ENOENT";
    return { files: [], missing, error: !missing };
  }

  const records: UsageRecord[] = [];
  const seen = new Set<string>();
  let error = false;
  let database: NodeSqlite.DatabaseSync | undefined;
  try {
    database = new NodeSqlite.DatabaseSync(path, { readOnly: true });
    // A busy live provider should fail this source promptly rather than
    // stalling the server while SQLite waits for its writer.
    database.exec("PRAGMA busy_timeout = 100");
    // Row `created_at` is Unix seconds and is never earlier than the message
    // itself (fork copies are written later), so it safely bounds the scan.
    const statement = database.prepare(`
      SELECT
        session_id,
        created_at,
        json_extract(chat_message, '$.message_id') AS id,
        json_extract(chat_message, '$.metadata.created_at') AS message_created_at,
        json_extract(chat_message, '$.metadata.generation_model') AS model,
        json_extract(chat_message, '$.metadata.metrics.input_tokens') AS input_tokens,
        json_extract(chat_message, '$.metadata.metrics.output_tokens') AS output_tokens,
        json_extract(chat_message, '$.metadata.metrics.cache_read_tokens') AS cache_read_tokens,
        json_extract(chat_message, '$.metadata.metrics.cache_creation_tokens') AS cache_creation_tokens
      FROM message_nodes
      WHERE created_at >= ? AND json_extract(chat_message, '$.role') = 'assistant'
      ORDER BY row_id
    `);
    let count = 0;
    for (const row of statement.iterate(Math.floor(sinceMs / 1000))) {
      if (++count % 256 === 0) await NodeTimersPromises.setImmediate();
      const id = text(row.id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const parsedAt = Date.parse(text(row.message_created_at));
      const timestampMs = Number.isFinite(parsedAt)
        ? parsedAt
        : typeof row.created_at === "number"
          ? row.created_at * 1000
          : Number.NaN;
      if (!Number.isFinite(timestampMs) || timestampMs < sinceMs) continue;
      const totals = {
        uncachedInputTokens: tokens(row.input_tokens),
        cachedInputTokens: tokens(row.cache_read_tokens),
        cacheCreationTokens: tokens(row.cache_creation_tokens),
        outputTokens: tokens(row.output_tokens),
        reasoningTokens: 0,
      };
      if (totalTokens(totals) === 0) continue;
      records.push({
        provider: "devin",
        timestampMs,
        model: text(row.model) || "devin",
        sessionId: text(row.session_id),
        totals,
        reportedCostUsd: null,
        fast: false,
        dedupeKey: `devin:${id}`,
      });
    }
  } catch {
    error = true;
  } finally {
    database?.close();
  }
  return { files: [{ path, records }], missing: false, error };
}
