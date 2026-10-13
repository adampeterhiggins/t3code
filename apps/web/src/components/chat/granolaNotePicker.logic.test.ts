import type { GranolaNoteSummary } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_GRANOLA_NOTE_PICKER_VIEW,
  filterGranolaNotes,
  granolaAttendeesLabel,
  granolaFilterFacets,
} from "./granolaNotePicker.logic";

const now = Date.parse("2026-10-13T12:00:00.000Z");
const note = (
  id: string,
  daysAgo: number,
  participants: string[],
  creator: string | null = participants[0] ?? null,
): GranolaNoteSummary => ({
  id,
  title: id,
  url: `https://notes.granola.ai/d/${id}`,
  meetingAt: new Date(now - daysAgo * 24 * 60 * 60 * 1000).toISOString(),
  participants,
  creator,
});
const notes = [
  note("standup", 1, ["Ada", "Grace"]),
  note("retro", 10, ["Grace", "Linus"], "Grace"),
  note("kickoff", 3, ["Ada", "Linus"]),
];

describe("filterGranolaNotes", () => {
  it("lists the last 30 days newest first by default", () => {
    expect(
      filterGranolaNotes(notes, DEFAULT_GRANOLA_NOTE_PICKER_VIEW, now).map((n) => n.id),
    ).toEqual(["standup", "kickoff", "retro"]);
  });

  it("narrows by time range, attendee, and note creator", () => {
    const view = DEFAULT_GRANOLA_NOTE_PICKER_VIEW;
    expect(filterGranolaNotes(notes, { ...view, range: "week" }, now).map((n) => n.id)).toEqual([
      "standup",
      "kickoff",
    ]);
    expect(
      filterGranolaNotes(notes, { ...view, participants: ["Linus"] }, now).map((n) => n.id),
    ).toEqual(["kickoff", "retro"]);
    expect(
      filterGranolaNotes(notes, { ...view, creators: ["Grace"] }, now).map((n) => n.id),
    ).toEqual(["retro"]);
  });

  it("shows a pasted link's note however old it is", () => {
    const old = note("offsite", 90, ["Ada"]);
    expect(filterGranolaNotes([old], DEFAULT_GRANOLA_NOTE_PICKER_VIEW, now)).toEqual([]);
    expect(filterGranolaNotes([old], DEFAULT_GRANOLA_NOTE_PICKER_VIEW, now, true)).toEqual([old]);
  });

  it("sorts oldest first or by title", () => {
    const view = DEFAULT_GRANOLA_NOTE_PICKER_VIEW;
    expect(filterGranolaNotes(notes, { ...view, sort: "oldest" }, now).map((n) => n.id)).toEqual([
      "retro",
      "kickoff",
      "standup",
    ]);
    expect(filterGranolaNotes(notes, { ...view, sort: "title" }, now).map((n) => n.id)).toEqual([
      "kickoff",
      "retro",
      "standup",
    ]);
  });
});

describe("granolaFilterFacets", () => {
  it("counts each menu's choices under the other applied filters", () => {
    const view = DEFAULT_GRANOLA_NOTE_PICKER_VIEW;
    const unfiltered = granolaFilterFacets(notes, view, now);
    expect(unfiltered.attendees.map((p) => [p.value, p.count])).toEqual([
      ["Ada", 2],
      ["Grace", 2],
      ["Linus", 2],
    ]);
    expect(unfiltered.ranges).toEqual({ week: 2, month: 3 });

    // Picking Linus narrows the note takers and dates, but not the attendee menu itself.
    const linus = granolaFilterFacets(notes, { ...view, participants: ["Linus"] }, now);
    expect(linus.attendees.map((p) => [p.value, p.count])).toEqual([
      ["Ada", 2],
      ["Grace", 2],
      ["Linus", 2],
    ]);
    expect(linus.creators.map((p) => [p.value, p.count])).toEqual([
      ["Ada", 1],
      ["Grace", 1],
    ]);
    expect(linus.ranges).toEqual({ week: 1, month: 2 });

    // The last 7 days leave out the retro, so Linus appears once and Grace's retro goes.
    const week = granolaFilterFacets(notes, { ...view, range: "week" }, now);
    expect(week.attendees.map((p) => [p.value, p.count])).toEqual([
      ["Ada", 2],
      ["Grace", 1],
      ["Linus", 1],
    ]);
    expect(week.creators.map((p) => [p.value, p.count])).toEqual([["Ada", 2]]);
  });

  it("keeps a picked person listed when the other filters exclude them", () => {
    const facets = granolaFilterFacets(
      notes,
      { ...DEFAULT_GRANOLA_NOTE_PICKER_VIEW, range: "week", creators: ["Grace"] },
      now,
    );
    expect(facets.creators.map((p) => [p.value, p.count])).toEqual([
      ["Ada", 2],
      ["Grace", 0],
    ]);
  });
});

it("abbreviates long attendee lists", () => {
  expect(granolaAttendeesLabel(["Ada", "Grace", "Linus", "Ken"])).toBe("Ada, Grace +2");
  expect(granolaAttendeesLabel(["Ada"])).toBe("Ada");
});
