import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";

import { isSameSchedule, missedRunCatchUpAt, nextScheduledRunAt } from "./Schedule.ts";

const LONDON = "Europe/London";

function londonAt(year: number, month: number, day: number, hour: number, minute: number) {
  return DateTime.makeZonedUnsafe(
    { year, month, day, hour, minute, second: 0, millisecond: 0 },
    { timeZone: LONDON, adjustForTimeZone: true },
  );
}

function isoOrNull(value: DateTime.DateTime | null) {
  return value === null ? null : DateTime.formatIso(DateTime.toUtc(value));
}

describe("missed fixed-time run catch-up", () => {
  const eodBrief = {
    type: "fixed_time",
    timeOfDay: "16:57",
    weekdays: [1, 2, 3, 4, 5],
    catchUpMissed: true,
  } as const;

  it("catches up a run missed earlier the same local day", () => {
    // Tuesday 2026-10-20, 16:57 BST is 15:57Z.
    const dueAt = londonAt(2026, 10, 20, 16, 57);
    expect(isoOrNull(missedRunCatchUpAt(eodBrief, dueAt, londonAt(2026, 10, 20, 19, 0)))).toBe(
      "2026-10-20T15:57:00.000Z",
    );
    expect(isoOrNull(missedRunCatchUpAt(eodBrief, dueAt, londonAt(2026, 10, 20, 23, 59)))).toBe(
      "2026-10-20T15:57:00.000Z",
    );
  });

  it("does not catch up once the local day has ended", () => {
    const dueAt = londonAt(2026, 10, 20, 16, 57);
    expect(missedRunCatchUpAt(eodBrief, dueAt, londonAt(2026, 10, 21, 8, 0))).toBeNull();
    // Even a short delay over midnight is a different day.
    const lateNight = { type: "fixed_time", timeOfDay: "23:50", catchUpMissed: true } as const;
    expect(
      missedRunCatchUpAt(lateNight, londonAt(2026, 10, 20, 23, 50), londonAt(2026, 10, 21, 0, 20)),
    ).toBeNull();
  });

  it("runs only the most recent missed occurrence after a long sleep", () => {
    // Asleep from Monday's run until Wednesday evening: one run for Wednesday.
    const dueAt = londonAt(2026, 10, 19, 16, 57);
    expect(isoOrNull(missedRunCatchUpAt(eodBrief, dueAt, londonAt(2026, 10, 21, 19, 0)))).toBe(
      "2026-10-21T15:57:00.000Z",
    );
  });

  it("does not catch up a weekday run on a day the task does not run", () => {
    // Friday's run missed, noticed on Saturday evening.
    const dueAt = londonAt(2026, 10, 23, 16, 57);
    expect(missedRunCatchUpAt(eodBrief, dueAt, londonAt(2026, 10, 24, 19, 0))).toBeNull();
  });

  it("uses local wall-clock time across a daylight-saving change", () => {
    // London leaves BST at 02:00 on Sunday 2026-10-25; 16:57 that day is GMT.
    const daily = { type: "fixed_time", timeOfDay: "16:57", catchUpMissed: true } as const;
    const caughtUp = missedRunCatchUpAt(
      daily,
      londonAt(2026, 10, 24, 16, 57),
      londonAt(2026, 10, 25, 17, 30),
    );
    expect(isoOrNull(caughtUp)).toBe("2026-10-25T16:57:00.000Z");
    expect(caughtUp === null ? null : DateTime.toParts(caughtUp).hour).toBe(16);
  });

  it("skips missed runs unless the task opts in", () => {
    const dueAt = londonAt(2026, 10, 20, 16, 57);
    const now = londonAt(2026, 10, 20, 19, 0);
    expect(missedRunCatchUpAt({ ...eodBrief, catchUpMissed: false }, dueAt, now)).toBeNull();
    expect(missedRunCatchUpAt({ type: "fixed_time", timeOfDay: "16:57" }, dueAt, now)).toBeNull();
    expect(missedRunCatchUpAt({ type: "interval", everyMs: 60_000 }, dueAt, now)).toBeNull();
  });

  it("ignores the catch-up flag when comparing schedules", () => {
    expect(isSameSchedule(eodBrief, { ...eodBrief, catchUpMissed: false })).toBe(true);
  });
});

describe("scheduled task schedule calculation", () => {
  it("skips to the next matching fixed-time weekday", () => {
    const next = nextScheduledRunAt(
      { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 2, 3, 4, 5] },
      DateTime.makeZonedUnsafe(
        {
          year: 2026,
          month: 7,
          day: 3,
          hour: 10,
          minute: 0,
          second: 0,
          millisecond: 0,
        },
        { timeZone: "America/Los_Angeles", adjustForTimeZone: true },
      ),
    );
    const parts = next ? DateTime.toParts(next) : null;
    expect(parts?.weekDay).toBe(1);
    expect(parts?.hour).toBe(9);
    expect(parts?.minute).toBe(0);
  });

  it("compares schedules structurally", () => {
    expect(
      isSameSchedule({ type: "interval", everyMs: 60_000 }, { type: "interval", everyMs: 60_000 }),
    ).toBe(true);
    expect(
      isSameSchedule({ type: "interval", everyMs: 60_000 }, { type: "interval", everyMs: 30_000 }),
    ).toBe(false);
    expect(
      isSameSchedule(
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 2] },
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 2] },
      ),
    ).toBe(true);
    expect(
      isSameSchedule(
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [5, 1] },
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 5, 5] },
      ),
    ).toBe(true);
    expect(
      isSameSchedule(
        { type: "fixed_time", timeOfDay: "09:00" },
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [0, 1, 2, 3, 4, 5, 6] },
      ),
    ).toBe(true);
    expect(
      isSameSchedule(
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [] },
        { type: "fixed_time", timeOfDay: "09:00" },
      ),
    ).toBe(true);
    expect(
      isSameSchedule(
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 2] },
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 3] },
      ),
    ).toBe(false);
    expect(
      isSameSchedule(
        { type: "fixed_time", timeOfDay: "09:00" },
        { type: "fixed_time", timeOfDay: "09:30" },
      ),
    ).toBe(false);
    expect(
      isSameSchedule(
        { type: "interval", everyMs: 60_000 },
        { type: "fixed_time", timeOfDay: "09:00" },
      ),
    ).toBe(false);
  });
});
