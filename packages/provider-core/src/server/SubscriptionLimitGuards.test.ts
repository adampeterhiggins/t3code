import { describe, it, assert } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import * as SubscriptionLimitGuards from "./SubscriptionLimitGuards.ts";

describe("SubscriptionLimitGuards", () => {
  it.effect("publishes a thread's own changes once", () =>
    Effect.gen(function* () {
      const guards = yield* SubscriptionLimitGuards.SubscriptionLimitGuards;
      const threadId = ThreadId.make("thread-guarded");
      const otherThreadId = ThreadId.make("thread-other");
      const first = yield* Deferred.make<boolean>();
      yield* guards.changes(threadId).pipe(
        Stream.take(1),
        Stream.runForEach((enabled) => Deferred.succeed(first, enabled)),
        Effect.forkScoped,
      );
      yield* Effect.yieldNow;
      yield* guards.set(threadId, true);
      yield* guards.set(threadId, true);
      yield* guards.set(otherThreadId, false);
      assert.strictEqual(yield* Deferred.await(first), true);
      assert.strictEqual(yield* guards.read(threadId), true);
      assert.strictEqual(yield* guards.read(otherThreadId), false);

      const second = yield* Deferred.make<boolean>();
      yield* guards.changes(threadId).pipe(
        Stream.take(1),
        Stream.runForEach((enabled) => Deferred.succeed(second, enabled)),
        Effect.forkScoped,
      );
      yield* Effect.yieldNow;
      yield* guards.set(threadId, false);
      assert.strictEqual(yield* Deferred.await(second), false);
      yield* guards.clear(threadId);
      assert.strictEqual(yield* guards.read(threadId), undefined);
    }).pipe(Effect.provide(SubscriptionLimitGuards.layer)),
  );
});
