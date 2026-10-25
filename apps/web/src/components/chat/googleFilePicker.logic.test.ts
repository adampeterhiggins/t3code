import type { GoogleFileSummary } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_GOOGLE_FILE_PICKER_VIEWS,
  filterGoogleFiles,
  googleFilterFacets,
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
const events = [
  event("offsite", 20, "Ada"),
  event("standup", -1, "Grace"),
  event("retro", 3, "Ada"),
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

  it("orders events by their start, closest to now first by default", () => {
    const view = DEFAULT_GOOGLE_FILE_PICKER_VIEWS.calendar;
    const ids = (next: Partial<GoogleFilePickerView>) =>
      filterGoogleFiles(events, { ...view, ...next }, now).map((f) => f.id);
    expect(ids({})).toEqual(["standup", "retro", "offsite"]);
    expect(ids({ range: "upcoming", sort: "oldest" })).toEqual(["retro", "offsite"]);
    expect(ids({ range: "past" })).toEqual(["standup"]);
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
