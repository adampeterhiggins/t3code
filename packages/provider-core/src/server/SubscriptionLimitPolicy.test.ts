import { assert, describe, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  ProviderInstanceId,
  ThreadId,
  type ServerProviderUsageLimits,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import * as SubscriptionLimitGuards from "./SubscriptionLimitGuards.ts";
import {
  SubscriptionLimitStopError,
  findSubscriptionLimitStop,
  makeSubscriptionLimitPolicy,
  subscriptionLimitFailure,
} from "./SubscriptionLimitPolicy.ts";

const nowMs = Date.parse("2026-10-21T08:00:00.000Z");
const limits = (
  windows: ReadonlyArray<{ id: string; usedPercent: number; resetsAt?: string }>,
): ServerProviderUsageLimits => ({
  checkedAt: "2026-10-21T08:00:00.000Z",
  windows: windows.map((window) => ({ ...window, kind: "weekly", label: window.id })),
});

describe("subscriptionLimitFailure", () => {
  it("lets a turn run while every counted window has room", () => {
    const failure = subscriptionLimitFailure({
      limits: limits([
        { id: "five_hour", usedPercent: 99 },
        { id: "seven_day_opus", usedPercent: 100, resetsAt: "2026-10-22T00:00:00.000Z" },
      ]),
      nowMs,
      provider: "Claude",
      windowIds: ["five_hour"],
    });
    assert.isNull(failure);
  });

  it("stops at the latest reset of the exhausted windows, ignoring ones already reset", () => {
    const failure = subscriptionLimitFailure({
      limits: limits([
        { id: "primary", usedPercent: 100, resetsAt: "2026-10-21T10:00:00.000Z" },
        { id: "secondary", usedPercent: 100, resetsAt: "2026-10-25T00:00:00.000Z" },
        { id: "individual", usedPercent: 100, resetsAt: "2026-10-21T07:00:00.000Z" },
      ]),
      nowMs,
      provider: "Codex",
    });
    assert.equal(failure?.class, "usage_limit");
    assert.equal(failure?.code, "subscription_limit_guard");
    assert.equal(failure?.resetAt, "2026-10-25T00:00:00.000Z");
    assert.include(failure?.message ?? "", "Codex subscription limit reached");
  });

  it("with stopWhen all, stops only once every counted window is used up, at the earliest reset", () => {
    const oneLeft = subscriptionLimitFailure({
      limits: limits([
        { id: "included", usedPercent: 100, resetsAt: "2026-10-25T00:00:00.000Z" },
        { id: "fallback", usedPercent: 40 },
      ]),
      nowMs,
      provider: "Cursor",
      windowIds: ["included", "fallback"],
      stopWhen: "all",
    });
    assert.isNull(oneLeft);

    const failure = subscriptionLimitFailure({
      limits: limits([
        { id: "included", usedPercent: 100, resetsAt: "2026-10-25T00:00:00.000Z" },
        { id: "fallback", usedPercent: 100, resetsAt: "2026-10-22T00:00:00.000Z" },
        { id: "other", usedPercent: 100 },
      ]),
      nowMs,
      provider: "Cursor",
      windowIds: ["included", "fallback"],
      stopWhen: "all",
    });
    assert.equal(failure?.class, "usage_limit");
    assert.equal(failure?.resetAt, "2026-10-22T00:00:00.000Z");
  });

  it("with stopWhen all, fails closed when a counted window is missing", () => {
    const failure = subscriptionLimitFailure({
      limits: limits([{ id: "fallback", usedPercent: 100 }]),
      nowMs,
      provider: "Cursor",
      windowIds: ["included", "fallback"],
      stopWhen: "all",
    });
    assert.equal(failure?.class, "provider_error");
  });

  it("fails closed with the reader's reason when usage is unavailable", () => {
    const failure = subscriptionLimitFailure({
      limits: {
        ...limits([]),
        unavailable: { reason: "unsupported", message: "Enable Cursor account usage" },
      },
      nowMs,
      provider: "Cursor",
    });
    assert.equal(failure?.class, "provider_error");
    assert.include(failure?.message ?? "", "(Enable Cursor account usage)");
    assert.equal(
      subscriptionLimitFailure({ limits: undefined, nowMs, provider: "Cursor" })?.class,
      "provider_error",
    );
  });
});

it("finds the guard's failure through wrapping start errors", () => {
  const failure = subscriptionLimitFailure({
    limits: limits([{ id: "primary", usedPercent: 100 }]),
    nowMs,
    provider: "Codex",
  });
  assert.isNotNull(failure);
  if (failure === null) return;
  const wrapped = {
    _tag: "ProviderAdapterTurnStartError",
    cause: new SubscriptionLimitStopError({ failure }),
  };
  assert.strictEqual(findSubscriptionLimitStop(wrapped), failure);
  assert.isUndefined(findSubscriptionLimitStop({ cause: new Error("other") }));
});

describe("makeSubscriptionLimitPolicy", () => {
  const threadId = ThreadId.make("thread-policy");
  const selection = (enabled: boolean) => ({
    instanceId: ProviderInstanceId.make("codex"),
    model: "gpt-5.4",
    options: [{ id: "stopAtSubscriptionLimit", value: enabled }],
  });

  it.effect("applies the application setting over a thread's Off", () =>
    Effect.gen(function* () {
      const policy = makeSubscriptionLimitPolicy({
        settings: {
          get: Effect.succeed({ ...DEFAULT_SERVER_SETTINGS, stopAtSubscriptionLimit: true }),
          changes: Stream.empty,
        },
        guards: Option.none(),
      });
      assert.isTrue(yield* policy.enabled(threadId, selection(false)));
    }),
  );

  it.effect("prefers the thread's latest choice to the selection its turn started with", () =>
    Effect.gen(function* () {
      const guards = yield* SubscriptionLimitGuards.SubscriptionLimitGuards;
      const policy = makeSubscriptionLimitPolicy({
        settings: { get: Effect.succeed(DEFAULT_SERVER_SETTINGS), changes: Stream.empty },
        guards: Option.some(guards),
      });
      assert.isTrue(yield* policy.enabled(threadId, selection(true)));
      yield* guards.set(threadId, false);
      assert.isFalse(yield* policy.enabled(threadId, selection(true)));
    }).pipe(Effect.provide(SubscriptionLimitGuards.layer)),
  );
});
