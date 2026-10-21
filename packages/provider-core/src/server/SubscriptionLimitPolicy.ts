import type {
  ModelSelection,
  OrchestrationV2ProviderFailure,
  ServerProviderModel,
  ServerProviderUsageLimits,
  ThreadId,
} from "@t3tools/contracts";
import { getModelSelectionBooleanOptionValue } from "@t3tools/shared/model";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Stream from "effect/Stream";

import { makeProviderFailure } from "./failure.ts";
import type * as ProviderHost from "./ProviderHost.ts";
import type * as SubscriptionLimitGuards from "./SubscriptionLimitGuards.ts";

export const SUBSCRIPTION_LIMIT_OPTION_ID = "stopAtSubscriptionLimit";

/** Adds the thread option a provider shows once its adapter enforces the guard. */
export function withSubscriptionLimitOption(
  model: ServerProviderModel,
  description: string,
): ServerProviderModel {
  return {
    ...model,
    capabilities: {
      ...model.capabilities,
      optionDescriptors: [
        ...(model.capabilities?.optionDescriptors ?? []).filter(
          (option) => option.id !== SUBSCRIPTION_LIMIT_OPTION_ID,
        ),
        {
          id: SUBSCRIPTION_LIMIT_OPTION_ID,
          label: "Stop at subscription limit",
          type: "boolean",
          description,
        },
      ],
    },
  };
}

/**
 * A guarded turn refused before its prompt reached the provider. The run fails
 * with this usage-limit failure, so it gets the usual Limited recovery.
 */
export class SubscriptionLimitStopError extends Data.TaggedError("SubscriptionLimitStopError")<{
  readonly failure: OrchestrationV2ProviderFailure;
}> {}

/** The guard's failure anywhere in a start error's cause chain. */
export function findSubscriptionLimitStop(
  error: unknown,
): OrchestrationV2ProviderFailure | undefined {
  if (Predicate.isTagged(error, "SubscriptionLimitStopError")) {
    return (error as SubscriptionLimitStopError).failure;
  }
  return Predicate.hasProperty(error, "cause") ? findSubscriptionLimitStop(error.cause) : undefined;
}

/**
 * Why a guarded turn must stop, or null when the allowance has room. Usage that
 * cannot be read stops the turn too: a spending guard fails closed.
 */
export function subscriptionLimitFailure(input: {
  readonly limits: ServerProviderUsageLimits | undefined;
  readonly nowMs: number;
  readonly provider: string;
  /** The windows that gate paid usage; every reported window when omitted. */
  readonly windowIds?: ReadonlyArray<string>;
  /**
   * "any" when each counted window is its own allowance; "all" when the provider falls back
   * from one counted window to the next and reaches paid usage only once every one is used up.
   */
  readonly stopWhen?: "any" | "all";
}): OrchestrationV2ProviderFailure | null {
  const { limits, windowIds, stopWhen = "any" } = input;
  const windows =
    limits?.windows.filter((window) => windowIds === undefined || windowIds.includes(window.id)) ??
    [];
  const exhausted = windows.filter(
    (window) =>
      window.usedPercent >= 100 &&
      (window.resetsAt === undefined || Date.parse(window.resetsAt) > input.nowMs),
  );
  // A fallback pool missing from the report could be the one still holding room, or not.
  const counted =
    windows.length > 0 &&
    (stopWhen === "any" ||
      windowIds === undefined ||
      windowIds.every((id) => windows.some((window) => window.id === id)));
  const stops =
    stopWhen === "any" ? exhausted.length > 0 : counted && exhausted.length === windows.length;
  if (limits !== undefined && limits.unavailable === undefined && counted && !stops) {
    return null;
  }
  if (!stops) {
    const detail = limits?.unavailable?.message;
    return makeProviderFailure({
      class: "provider_error",
      retryable: false,
      code: "subscription_limit_guard",
      message: `${input.provider} subscription usage could not be checked${detail === undefined ? "" : ` (${detail})`}. Retry the turn, or disable Stop at subscription limit in application and thread settings to continue without this check.`,
    });
  }
  return makeProviderFailure({
    class: "usage_limit",
    retryable: false,
    code: "subscription_limit_guard",
    message: `${input.provider} subscription limit reached. This thread stopped because Stop at subscription limit is enabled.`,
    resetAt: stopWhen === "any" ? latestReset(exhausted) : earliestReset(exhausted),
  });
}

/**
 * With "any", the turn can run again only once every exhausted window has reset, and one
 * with no reset time leaves that unknown.
 */
function latestReset(windows: ServerProviderUsageLimits["windows"]): string | null {
  const times = windows.map((window) => window.resetsAt);
  return times.every((time) => time !== undefined)
    ? times.reduce((latest, time) => (time > latest ? time : latest))
    : null;
}

/** With "all", the first window to reset gives the turn included usage again. */
function earliestReset(windows: ServerProviderUsageLimits["windows"]): string | null {
  const times = windows.flatMap((window) =>
    window.resetsAt === undefined ? [] : [window.resetsAt],
  );
  return times.length === 0
    ? null
    : times.reduce((earliest, time) => (time < earliest ? time : earliest));
}

/** Whether the guard applies to a thread, and when that may have changed. */
export interface SubscriptionLimitPolicy {
  /** `selection` is the one the turn started with; a newer thread choice wins over it. */
  readonly enabled: (
    threadId: ThreadId,
    selection: ModelSelection | undefined,
  ) => Effect.Effect<boolean>;
  /** Emits each time the guard is switched on for the thread or the application. */
  readonly enabledChanges: (threadId: ThreadId) => Stream.Stream<void>;
}

export function makeSubscriptionLimitPolicy(input: {
  readonly settings: Pick<ProviderHost.ProviderHost["Service"]["settings"], "get" | "changes">;
  readonly guards: Option.Option<SubscriptionLimitGuards.SubscriptionLimitGuards["Service"]>;
}): SubscriptionLimitPolicy {
  const appEnabled = input.settings.get.pipe(
    Effect.map((settings) => settings.stopAtSubscriptionLimit),
    // Unreadable settings must not let a guarded thread spend.
    Effect.orElseSucceed(() => true),
  );
  return {
    enabled: Effect.fnUntraced(function* (threadId, selection) {
      if (yield* appEnabled) return true;
      if (Option.isSome(input.guards)) {
        const live = yield* input.guards.value.read(threadId);
        if (live !== undefined) return live;
      }
      return getModelSelectionBooleanOptionValue(selection, SUBSCRIPTION_LIMIT_OPTION_ID) === true;
    }),
    enabledChanges: (threadId) =>
      Stream.merge(
        input.settings.changes.pipe(Stream.map((settings) => settings.stopAtSubscriptionLimit)),
        Option.isSome(input.guards) ? input.guards.value.changes(threadId) : Stream.empty,
      ).pipe(
        Stream.changes,
        Stream.filter((enabled) => enabled),
        Stream.as(undefined),
      ),
  };
}
