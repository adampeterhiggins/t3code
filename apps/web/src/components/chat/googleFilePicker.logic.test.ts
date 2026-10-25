import type { GoogleFileSummary } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_GOOGLE_FILE_PICKER_VIEWS,
  filterGoogleFiles,
  googleFilterFacets,
  groupEventsByDay,
  localDayKey,
  startOfWeek,
  type GoogleFilePickerView,
} from "./googleFilePicker.logic";

const now = Date.parse("2026-10-25T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const file = (
  id: string,
  fileType: GoogleFileSummary["fileType"],
  daysAgo: number,
  owner?: string,
): GoogleFileSummary => ({
  id,
  title: id,
  url: `https://drive.google.com/file/d/${id}/view`,
  updatedAt: new Date(now - daysAgo * DAY_MS).toISOString(),
  fileType,
  ...(owner ? { owner } : {}),
});
const event = (id: string, daysFromNow: number, owner: string): GoogleFileSummary => ({
  id,
  title: id,
  url: `https://calendar.google.com/calendar/event?eid=${id}`,
  // An event's edit time says nothing about when it happens.
  updatedAt: new Date(now - 100 * DAY_MS).toISOString(),
  fileType: "event",
  owner,
  startsAt: new Date(now + daysFromNow * DAY_MS).toISOString(),
});

const drive = [
  file("plan", "doc", 2, "Ada"),
  file("budget", "sheet", 12, "Grace"),
  file("deck", "slides", 40, "Ada"),
];
describe("filterGoogleFiles", () => {
  it("narrows Drive files by type, owner, and how recently they changed", () => {
    const view = DEFAULT_GOOGLE_FILE_PICKER_VIEWS.drive;
    const ids = (next: Partial<GoogleFilePickerView>) =>
      filterGoogleFiles(drive, { ...view, ...next }, now).map((f) => f.id);
    expect(ids({})).toEqual(["plan", "budget", "deck"]);
    expect(ids({ types: ["sheet", "slides"] })).toEqual(["budget", "deck"]);
    expect(ids({ owners: ["Ada"] })).toEqual(["plan", "deck"]);
    expect(ids({ range: "month" })).toEqual(["plan", "budget"]);
  });

  it("shows a pasted link's file however old it is", () => {
    const view = {
      ...DEFAULT_GOOGLE_FILE_PICKER_VIEWS.drive,
      range: "week",
    } satisfies GoogleFilePickerView;
    expect(filterGoogleFiles([drive[2]!], view, now)).toEqual([]);
    expect(filterGoogleFiles([drive[2]!], view, now, true)).toEqual([drive[2]]);
  });
});

describe("googleFilterFacets", () => {
  it("counts each choice under the other applied filters", () => {
    const facets = googleFilterFacets(
      drive,
      { ...DEFAULT_GOOGLE_FILE_PICKER_VIEWS.drive, owners: ["Ada"] },
      now,
    );
    expect(facets.types).toEqual([
      { value: "doc", label: "Docs", count: 1 },
      { value: "slides", label: "Slides", count: 1 },
    ]);
    expect(facets.owners.map((o) => [o.value, o.count])).toEqual([
      ["Ada", 2],
      ["Grace", 1],
    ]);
    expect(facets.ranges.week).toBe(1);
  });
});

describe("groupEventsByDay", () => {
  // Local times, so the days hold in any time zone the tests run in.
  const at = (day: number, hour: number) => new Date(2026, 9, day, hour).toISOString();
  const timed = (id: string, day: number, hour: number): GoogleFileSummary => ({
    ...event(id, 0, "Ada"),
    startsAt: at(day, hour),
    endsAt: at(day, hour + 1),
  });

  it("lists each day in order, all-day events first and then by start", () => {
    const groups = groupEventsByDay([
      timed("review", 27, 15),
      timed("standup", 26, 9),
      { ...event("holiday", 0, "Ada"), startsAt: "2026-10-27" },
      timed("kickoff", 27, 10),
    ]);
    expect(groups.map((g) => [g.day, g.events.map((e) => e.id)])).toEqual([
      ["2026-10-26", ["standup"]],
      ["2026-10-27", ["holiday", "kickoff", "review"]],
    ]);
  });

  it("starts weeks on the local Monday", () => {
    expect(localDayKey(startOfWeek(new Date(2026, 9, 25, 23)))).toBe("2026-10-19");
    expect(localDayKey(startOfWeek(new Date(2026, 9, 26, 0)))).toBe("2026-10-26");
  });
});
