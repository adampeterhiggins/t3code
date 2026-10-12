// @effect-diagnostics nodeBuiltinImport:off - builds real Devin session databases with node:sqlite,
// as the reader itself does.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import { afterEach, assert, beforeEach, describe, it } from "@effect/vitest";

import { readDevinUsage } from "./devinUsageReader.ts";

let dir: string;

beforeEach(async () => {
  dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "devin-usage-reader-test-"));
});

afterEach(async () => {
  await NodeFSP.rm(dir, { recursive: true, force: true });
});

describe("readDevinUsage", () => {
  it("counts forked Devin message copies once using each message's own time and metrics", async () => {
    const db = new NodeSqlite.DatabaseSync(NodePath.join(dir, "sessions.db"));
    try {
      db.exec(
        "CREATE TABLE message_nodes (row_id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, node_id INTEGER, chat_message TEXT, created_at INTEGER)",
      );
      const assistant = (id: string, createdAt: string) =>
        JSON.stringify({
          message_id: id,
          role: "assistant",
          content: "x".repeat(1000),
          metadata: {
            created_at: createdAt,
            generation_model: "swe-2-max",
            metrics: {
              input_tokens: 156,
              output_tokens: 467,
              cache_read_tokens: 80781,
              cache_creation_tokens: null,
            },
          },
        });
      const insert = db.prepare(
        "INSERT INTO message_nodes (session_id, node_id, chat_message, created_at) VALUES (?, ?, ?, ?)",
      );
      insert.run("brave-otter", 1, JSON.stringify({ role: "user", content: "hi" }), 1780000000);
      insert.run("brave-otter", 2, assistant("msg-1", "2026-05-28T20:26:40.500Z"), 1780000000);
      // A fork written a day later copies msg-1 and adds msg-2.
      insert.run("brave-otter-fork", 1, assistant("msg-1", "2026-05-28T20:26:40.500Z"), 1780086400);
      insert.run("brave-otter-fork", 2, assistant("msg-2", "2026-05-29T20:26:41Z"), 1780086401);

      const all = await readDevinUsage(dir, 0);
      assert.isFalse(all.error);
      const records = all.files.flatMap((file) => file.records);
      assert.deepStrictEqual(
        records.map((record) => [record.dedupeKey, record.sessionId, record.timestampMs]),
        [
          ["devin:msg-1", "brave-otter", 1780000000500],
          ["devin:msg-2", "brave-otter-fork", 1780086401000],
        ],
      );
      assert.strictEqual(records[0]?.model, "swe-2-max");
      assert.deepStrictEqual(records[0]?.totals, {
        uncachedInputTokens: 156,
        cachedInputTokens: 80781,
        cacheCreationTokens: 0,
        outputTokens: 467,
        reasoningTokens: 0,
      });

      // The fork's later copy must not pull msg-1 into a window that starts after it.
      const recent = await readDevinUsage(dir, 1780086400000);
      assert.deepStrictEqual(
        recent.files.flatMap((file) => file.records).map((record) => record.dedupeKey),
        ["devin:msg-2"],
      );
    } finally {
      db.close();
    }
  });

  it("reports a missing Devin history separately from an unreadable one", async () => {
    assert.deepStrictEqual(await readDevinUsage(dir, 0), {
      files: [],
      missing: true,
      error: false,
    });
    await NodeFSP.writeFile(NodePath.join(dir, "sessions.db"), "not a database");
    const unreadable = await readDevinUsage(dir, 0);
    assert.isFalse(unreadable.missing);
    assert.isTrue(unreadable.error);
  });
});
