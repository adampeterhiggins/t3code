import type { OrchestrationV2DomainEvent, ThreadId } from "@t3tools/contracts";
import { getModelSelectionBooleanOptionValue } from "@t3tools/shared/model";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as SubscriptionLimitGuards from "@t3tools/provider-core/server/SubscriptionLimitGuards";

import { forkParked } from "../serverActivation.ts";
import * as Orchestrator from "./Orchestrator.ts";

const SUBSCRIPTION_LIMIT_OPTION_ID = "stopAtSubscriptionLimit";

export type SubscriptionLimitGuardUpdate =
  | { readonly _tag: "set"; readonly threadId: ThreadId; readonly enabled: boolean }
  | { readonly _tag: "clear"; readonly threadId: ThreadId };

/** What a domain event changes in the live per-thread guard, if anything. */
export function subscriptionLimitGuardUpdate(
  event: OrchestrationV2DomainEvent,
): SubscriptionLimitGuardUpdate | null {
  if (event.type === "thread.deleted") return { _tag: "clear", threadId: event.threadId };
  if (
    event.type !== "thread.model-selection-updated" &&
    event.type !== "thread.provider-switched"
  ) {
    return null;
  }
  return {
    _tag: "set",
    threadId: event.threadId,
    enabled:
      getModelSelectionBooleanOptionValue(
        event.payload.modelSelection,
        SUBSCRIPTION_LIMIT_OPTION_ID,
      ) === true,
  };
}

const apply = (
  guards: {
    readonly set: (threadId: ThreadId, enabled: boolean) => Effect.Effect<void>;
    readonly clear: (threadId: ThreadId) => Effect.Effect<void>;
  },
  event: OrchestrationV2DomainEvent,
) => {
  const update = subscriptionLimitGuardUpdate(event);
  if (update === null) return Effect.void;
  return update._tag === "clear"
    ? guards.clear(update.threadId)
    : guards.set(update.threadId, update.enabled);
};

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const guards = yield* SubscriptionLimitGuards.SubscriptionLimitGuards;
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    yield* forkParked(
      Stream.runForEach(orchestrator.streamDomainEvents, (event) => apply(guards, event)).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("subscription limit guard sync failed", { cause }),
        ),
      ),
    );
  }),
);
