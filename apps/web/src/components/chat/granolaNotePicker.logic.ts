import type { GranolaNoteSummary } from "@t3tools/contracts";
import {
  applyFilterDimensions,
  type FacetChoice,
  type FilterDimension,
  filterFacets,
} from "@t3tools/shared/filterFacets";

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
 * The picker's filters as facet dimensions. The server already matched the query; a pasted note
 * link (`pasted`) names one note, however old, so the date filter does not apply to it.
 */
function granolaDimensions(view: GranolaNotePickerView, now: number, pasted: boolean) {
  const inRange = (note: GranolaNoteSummary, range: GranolaNotePickerView["range"]) =>
    pasted ||
    note.meetingAt === null ||
    meetingTime(note) >= now - (range === "week" ? 7 : 30) * DAY_MS;
  return {
    attendees: {
      values: (note: GranolaNoteSummary) => note.participants,
      selected: view.participants,
    },
    creators: {
      values: (note: GranolaNoteSummary) => (note.creator ? [note.creator] : []),
      selected: view.creators,
    },
    range: {
      values: (note: GranolaNoteSummary) =>
        (["week", "month"] as const).filter((range) => inRange(note, range)),
      selected: [view.range],
      matches: (note: GranolaNoteSummary) => inRange(note, view.range),
    },
  } satisfies Record<string, FilterDimension<GranolaNoteSummary>>;
}

/** The notes the picker shows for its filters, in its sort order. */
export function filterGranolaNotes(
  notes: ReadonlyArray<GranolaNoteSummary>,
  view: GranolaNotePickerView,
  now: number,
  pasted = false,
): GranolaNoteSummary[] {
  const shown = applyFilterDimensions(notes, granolaDimensions(view, now, pasted));
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

/**
 * What each filter menu offers, and how many notes each choice would show under the other
 * applied filters (see `filterFacets`).
 */
export function granolaFilterFacets(
  notes: ReadonlyArray<GranolaNoteSummary>,
  view: GranolaNotePickerView,
  now: number,
  pasted = false,
) {
  const facets = filterFacets(notes, granolaDimensions(view, now, pasted));
  const people = (choices: ReadonlyArray<FacetChoice>): GranolaFilterOption[] =>
    choices.map((choice) => ({ ...choice, label: choice.value }));
  const rangeCount = (range: GranolaNotePickerView["range"]) =>
    facets.range.find((choice) => choice.value === range)?.count ?? 0;
  return {
    attendees: people(facets.attendees),
    creators: people(facets.creators),
    ranges: {
      week: rangeCount("week"),
      month: rangeCount("month"),
    } satisfies Record<GranolaNotePickerView["range"], number>,
  };
}

/** `Ada, Grace +3`: the first attendees and how many more, for a narrow column. */
export function granolaAttendeesLabel(participants: ReadonlyArray<string>, shown = 2): string {
  const first = participants.slice(0, shown).join(", ");
  const rest = participants.length - shown;
  return rest > 0 ? `${first} +${rest}` : first;
}
