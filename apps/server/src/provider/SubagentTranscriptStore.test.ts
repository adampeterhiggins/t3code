import { ThreadId } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import {
  boundRetainedSubagentTranscript,
  ensureSubagentTranscriptSchema,
  layer,
  RETAINED_SUBAGENT_TRANSCRIPT_CHAR_LIMIT,
  SubagentTranscriptStore,
} from "./SubagentTranscriptStore.ts";

const sqlite = NodeSqliteClient.layer({ filename: ":memory:" });
const storeLayer = Layer.provideMerge(
  layer,
  Layer.provideMerge(Layer.effectDiscard(ensureSubagentTranscriptSchema()), sqlite),
);

it.layer(storeLayer)("SubagentTranscriptStore", (it) => {
  it.effect("replaces an agent's transcript and keeps threads apart", () =>
    Effect.gen(function* () {
      const store = yield* SubagentTranscriptStore;
      const threadId = ThreadId.make("thread-store");
      yield* store.retain(threadId, "agent-1", {
        entries: [{ kind: "assistant", text: "Looking." }],
        truncated: false,
      });
      yield* store.retain(threadId, "agent-1", {
        entries: [{ kind: "tool", text: "Read", toolName: "Read", output: "ok" }],
        truncated: true,
      });

      const retained = yield* store.get(threadId, "agent-1");
      assert.isTrue(Option.isSome(retained));
      const value = Option.getOrThrow(retained);
      assert.deepStrictEqual(value.entries, [
        { kind: "tool", text: "Read", toolName: "Read", output: "ok" },
      ]);
      assert.isTrue(value.truncated);
      assert.isString(value.retainedAt);

      assert.isTrue(Option.isNone(yield* store.get(ThreadId.make("other-thread"), "agent-1")));
    }),
  );
});

it("keeps the newest entries within the retained character budget", () => {
  const half = "x".repeat(RETAINED_SUBAGENT_TRANSCRIPT_CHAR_LIMIT / 2);
  const bounded = boundRetainedSubagentTranscript({
    entries: [
      { kind: "user", text: half },
      { kind: "assistant", text: half },
      { kind: "assistant", text: "done" },
    ],
    truncated: false,
  });
  assert.deepStrictEqual(
    bounded.entries.map((entry) => entry.text.length),
    [half.length, 4],
  );
  assert.isTrue(bounded.truncated);

  const small = { entries: [{ kind: "assistant" as const, text: "done" }], truncated: false };
  assert.strictEqual(boundRetainedSubagentTranscript(small), small);
});
