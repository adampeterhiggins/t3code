import type { GranolaNoteSummary } from "@t3tools/contracts";

export interface GranolaNotePickerView {
  /** Notes with any of these attendees. */
  readonly participants: ReadonlyArray<string>;
  /** Notes taken by any of these people. */
  readonly creators: ReadonlyArray<string>;
  readonly range: "week" | "month";
  readonly sort: "newest" | "oldest" | "title";
}

export const DEFAULT_GRANOLA_NOTE_PICKER_VIEW: GranolaNotePickerView = {
  participants: [],
  creators: [],
  range: "month",
  sort: "newest",
};

const DAY_MS = 24 * 60 * 60 * 1000;

function meetingTime(note: GranolaNoteSummary): number {
  const time = note.meetingAt === null ? Number.NaN : Date.parse(note.meetingAt);
  return Number.isNaN(time) ? 0 : time;
}

/**
 * The notes the picker shows for its filters and sort. The server already matched the query; a
 * pasted note link (`pasted`) names one note, however old, so the date filter does not apply.
 */
export function filterGranolaNotes(
  notes: ReadonlyArray<GranolaNoteSummary>,
  view: GranolaNotePickerView,
  now: number,
  pasted = false,
): GranolaNoteSummary[] {
  const since = now - (view.range === "week" ? 7 : 30) * DAY_MS;
  const shown = notes.filter(
    (note) =>
      (pasted || note.meetingAt === null || meetingTime(note) >= since) &&
      (view.participants.length === 0 ||
        note.participants.some((name) => view.participants.includes(name))) &&
      (view.creators.length === 0 ||
        (note.creator !== null && view.creators.includes(note.creator))),
  );
  switch (view.sort) {
    case "newest":
      return shown.toSorted((a, b) => meetingTime(b) - meetingTime(a));
    case "oldest":
      return shown.toSorted((a, b) => meetingTime(a) - meetingTime(b));
    case "title":
      return shown.toSorted((a, b) => a.title.localeCompare(b.title));
  }
}

export interface GranolaFilterOption {
  readonly value: string;
  readonly label: string;
  readonly count: number;
}

/** Everyone who appears in the notes and in how many, most frequent first. */
function countPeople(
  notes: ReadonlyArray<GranolaNoteSummary>,
  pick: (note: GranolaNoteSummary) => ReadonlyArray<string>,
  selected: ReadonlyArray<string>,
): GranolaFilterOption[] {
  const counts = new Map<string, number>();
  for (const note of notes) {
    for (const name of pick(note)) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  // A picked person the other filters exclude stays listed, so it can still be unpicked.
  for (const name of selected) if (!counts.has(name)) counts.set(name, 0);
  return [...counts]
    .toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, count]) => ({ value: name, label: name, count }));
}

/**
 * What each filter menu offers, and how many notes each choice would show. Every dimension is
 * counted under the other applied filters, so a choice's number is what picking it adds.
 */
export function granolaFilterFacets(
  notes: ReadonlyArray<GranolaNoteSummary>,
  view: GranolaNotePickerView,
  now: number,
  pasted = false,
) {
  return {
    attendees: countPeople(
      filterGranolaNotes(notes, { ...view, participants: [] }, now, pasted),
      (note) => note.participants,
      view.participants,
    ),
    creators: countPeople(
      filterGranolaNotes(notes, { ...view, creators: [] }, now, pasted),
      (note) => (note.creator ? [note.creator] : []),
      view.creators,
    ),
    ranges: {
      week: filterGranolaNotes(notes, { ...view, range: "week" }, now, pasted).length,
      month: filterGranolaNotes(notes, { ...view, range: "month" }, now, pasted).length,
    } satisfies Record<GranolaNotePickerView["range"], number>,
  };
}

/** `Ada, Grace +3`: the first attendees and how many more, for a narrow column. */
export function granolaAttendeesLabel(participants: ReadonlyArray<string>, shown = 2): string {
  const first = participants.slice(0, shown).join(", ");
  const rest = participants.length - shown;
  return rest > 0 ? `${first} +${rest}` : first;
}
