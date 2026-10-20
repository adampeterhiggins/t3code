import type { ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

interface SubscriptionLimitGuardChange {
  readonly threadId: ThreadId;
  readonly enabled: boolean;
}

/**
 * The latest Stop at subscription limit choice for each thread. A running
 * provider session keeps the model selection it started with, so this is how a
 * change made during the turn reaches that session.
 */
export class SubscriptionLimitGuards extends Context.Service<
  SubscriptionLimitGuards,
  {
    readonly set: (threadId: ThreadId, enabled: boolean) => Effect.Effect<void>;
    readonly read: (threadId: ThreadId) => Effect.Effect<boolean | undefined>;
    readonly clear: (threadId: ThreadId) => Effect.Effect<void>;
    readonly changes: (threadId: ThreadId) => Stream.Stream<boolean>;
  }
>()("@t3tools/provider-core/server/SubscriptionLimitGuards") {}

const make = Effect.gen(function* () {
  const values = yield* Ref.make(new Map<ThreadId, boolean>());
  const changes = yield* Effect.acquireRelease(
    PubSub.unbounded<SubscriptionLimitGuardChange>(),
    PubSub.shutdown,
  );
  return SubscriptionLimitGuards.of({
    set: Effect.fn("SubscriptionLimitGuards.set")(function* (threadId, enabled) {
      const changed = yield* Ref.modify(values, (current) => {
        if (current.get(threadId) === enabled) return [false, current] as const;
        const next = new Map(current);
        next.set(threadId, enabled);
        return [true, next] as const;
      });
      if (changed) yield* PubSub.publish(changes, { threadId, enabled });
    }),
    read: (threadId) => Ref.get(values).pipe(Effect.map((current) => current.get(threadId))),
    clear: (threadId) =>
      Ref.update(values, (current) => {
        if (!current.has(threadId)) return current;
        const next = new Map(current);
        next.delete(threadId);
        return next;
      }),
    changes: (threadId) =>
      Stream.fromPubSub(changes).pipe(
        Stream.filter((change) => change.threadId === threadId),
        Stream.map((change) => change.enabled),
      ),
  });
});

export const layer = Layer.effect(SubscriptionLimitGuards, make);
