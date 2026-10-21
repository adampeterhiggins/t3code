import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import {
  describeSchedule,
  parseEvery,
  parseWeekdays,
  scheduleFromFlags,
  workspaceStrategyFromFlags,
  type ScheduleFlags,
} from "./schedule.ts";

const flags = (overrides: Partial<ScheduleFlags>): ScheduleFlags => ({
  every: Option.none(),
  at: Option.none(),
  weekdays: Option.none(),
  catchUp: Option.none(),
  webhook: false,
  ...overrides,
});

it.effect("--every accepts compound durations and bare minutes, with a one-minute floor", () =>
  Effect.gen(function* () {
    assert.strictEqual(yield* parseEvery("1h30m"), 5_400_000);
    assert.strictEqual(yield* parseEvery("15"), 900_000);
    assert.strictEqual(yield* parseEvery("2d"), 172_800_000);
    const tooShort = yield* Effect.flip(parseEvery("30s"));
    assert.include(tooShort.message, "at least one minute");
    const garbage = yield* Effect.flip(parseEvery("hourly"));
    assert.include(garbage.message, "not a duration");
  }),
);

it.effect("--weekdays reads numbers, names, and presets, and all seven days means daily", () =>
  Effect.gen(function* () {
    assert.deepStrictEqual(yield* parseWeekdays("3,1,1"), [1, 3]);
    assert.deepStrictEqual(yield* parseWeekdays("mon,Wednesday,fri"), [1, 3, 5]);
    assert.deepStrictEqual(yield* parseWeekdays("weekends"), [0, 6]);
    assert.strictEqual(yield* parseWeekdays("0,1,2,3,4,5,6"), undefined);
    assert.strictEqual(yield* parseWeekdays("daily"), undefined);
    yield* Effect.flip(parseWeekdays("7"));
  }),
);

it.effect("--at builds a fixed-time schedule with its weekdays and catch-up", () =>
  Effect.gen(function* () {
    const schedule = yield* scheduleFromFlags(
      flags({
        at: Option.some("9:05"),
        weekdays: Option.some("weekdays"),
        catchUp: Option.some(true),
      }),
      undefined,
    );
    assert.deepStrictEqual(Option.getOrNull(schedule), {
      type: "fixed_time",
      timeOfDay: "9:05",
      weekdays: [1, 2, 3, 4, 5],
      catchUpMissed: true,
    });
  }),
);

it.effect("an update that only retimes a fixed-time task keeps its days and catch-up", () =>
  Effect.gen(function* () {
    const existing = {
      type: "fixed_time" as const,
      timeOfDay: "09:00",
      weekdays: [1, 3],
      catchUpMissed: true,
    };
    const retimed = yield* scheduleFromFlags(flags({ at: Option.some("17:30") }), existing);
    assert.deepStrictEqual(Option.getOrNull(retimed), { ...existing, timeOfDay: "17:30" });

    const daily = yield* scheduleFromFlags(flags({ weekdays: Option.some("daily") }), existing);
    assert.deepStrictEqual(Option.getOrNull(daily), {
      type: "fixed_time",
      timeOfDay: "09:00",
      catchUpMissed: true,
    });

    assert.isTrue(Option.isNone(yield* scheduleFromFlags(flags({}), existing)));
  }),
);

it.effect("--webhook on a webhook task keeps its stored signature", () =>
  Effect.gen(function* () {
    const existing = {
      type: "webhook" as const,
      signature: { header: "x-hub-signature-256", encoding: "hex" as const, prefix: "sha256=" },
    };
    const kept = yield* scheduleFromFlags(flags({ webhook: true }), existing);
    assert.deepStrictEqual(Option.getOrNull(kept), existing);
    const fresh = yield* scheduleFromFlags(flags({ webhook: true }), undefined);
    assert.deepStrictEqual(Option.getOrNull(fresh), {
      type: "webhook",
      signature: null,
      maxDeliveryAgeMinutes: null,
    });
  }),
);

it.effect("conflicting or orphaned trigger flags are refused", () =>
  Effect.gen(function* () {
    const both = yield* Effect.flip(
      scheduleFromFlags(flags({ every: Option.some("1h"), webhook: true }), undefined),
    );
    assert.include(both.message, "only one of");
    const orphan = yield* Effect.flip(
      scheduleFromFlags(flags({ weekdays: Option.some("mon") }), {
        type: "interval",
        everyMs: 3_600_000,
      }),
    );
    assert.include(orphan.message, "need --at");
    yield* Effect.flip(scheduleFromFlags(flags({ at: Option.some("25:00") }), undefined));
  }),
);

it("describes schedules the way the settings list does", () => {
  assert.strictEqual(describeSchedule({ type: "interval", everyMs: 5_400_000 }), "Every 1h 30m");
  assert.strictEqual(
    describeSchedule(
      { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 2, 3, 4, 5] },
      "Europe/London",
    ),
    "Weekdays at 09:00 Europe/London",
  );
  assert.strictEqual(
    describeSchedule({ type: "fixed_time", timeOfDay: "07:15", weekdays: [0, 6] }, "Etc/UTC"),
    "Sun, Sat at 07:15 UTC",
  );
});

it("a task bound to a thread runs in that thread's checkout; unbinding returns to a new worktree", () => {
  const none = { baseRef: Option.none(), checkout: Option.none() };
  assert.deepStrictEqual(workspaceStrategyFromFlags(none, true, undefined), { type: "root" });
  assert.deepStrictEqual(workspaceStrategyFromFlags(none, false, undefined), {
    type: "worktree",
    baseRef: "main",
    startFromOrigin: true,
  });
  assert.deepStrictEqual(
    workspaceStrategyFromFlags({ ...none, baseRef: Option.some("develop") }, false, {
      type: "root",
    }),
    { type: "worktree", baseRef: "develop", startFromOrigin: true },
  );
  assert.deepStrictEqual(
    workspaceStrategyFromFlags({ ...none, checkout: Option.some(true) }, false, undefined),
    { type: "root" },
  );
});
