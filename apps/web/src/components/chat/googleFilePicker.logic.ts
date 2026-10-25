import type { GoogleFileSummary } from "@t3tools/contracts";
import {
  applyFilterDimensions,
  type FilterDimension,
  filterFacets,
} from "@t3tools/shared/filterFacets";

export type GoogleFilePickerSource = "drive" | "calendar";
export type GoogleFileType = GoogleFileSummary["fileType"];

export interface GoogleFilePickerView {
  /** Drive files of any of these types. */
  readonly types: ReadonlyArray<GoogleFileType>;
  /** Files owned, or events organized, by any of these people. */
  readonly owners: ReadonlyArray<string>;
  /** Drive: modified within the last week or month. Calendar: before or after now. */
  readonly range: "all" | "week" | "month" | "upcoming" | "past";
  /** `nearest` puts the events closest to now first, whichever side of it they fall. */
  readonly sort: "nearest" | "newest" | "oldest" | "title";
}

export const DEFAULT_GOOGLE_FILE_PICKER_VIEWS = {
  drive: { types: [], owners: [], range: "all", sort: "newest" },
  calendar: { types: [], owners: [], range: "all", sort: "nearest" },
} as const satisfies Record<GoogleFilePickerSource, GoogleFilePickerView>;

export const GOOGLE_FILE_TYPE_LABELS = {
  doc: "Docs",
  sheet: "Sheets",
  slides: "Slides",
  folder: "Folders",
  drive: "Other files",
  event: "Events",
} as const satisfies Record<GoogleFileType, string>;

const DAY_MS = 24 * 60 * 60 * 1000;

/** When a file was last modified, or when an event starts. */
export function googleFileTime(file: GoogleFileSummary): number {
  const time = Date.parse(file.fileType === "event" ? (file.startsAt ?? "") : file.updatedAt);
  return Number.isNaN(time) ? 0 : time;
}

function inRange(file: GoogleFileSummary, range: GoogleFilePickerView["range"], now: number) {
  const time = googleFileTime(file);
  switch (range) {
    case "all":
      return true;
    case "week":
      return time >= now - 7 * DAY_MS;
    case "month":
      return time >= now - 30 * DAY_MS;
    case "upcoming":
      return time >= now;
    case "past":
      return time < now;
  }
}

/**
 * The picker's filters as facet dimensions. A pasted link (`pasted`) names one file or event,
 * so the date filter does not apply to it.
 */
function googleDimensions(view: GoogleFilePickerView, now: number, pasted: boolean) {
  return {
    types: {
      values: (file: GoogleFileSummary) => [file.fileType],
      selected: view.types,
    },
    owners: {
      values: (file: GoogleFileSummary) => (file.owner ? [file.owner] : []),
      selected: view.owners,
    },
    range: {
      values: (file: GoogleFileSummary) =>
        (["all", "week", "month", "upcoming", "past"] as const).filter(
          (range) => pasted || inRange(file, range, now),
        ),
      selected: [view.range],
      matches: (file: GoogleFileSummary) => pasted || inRange(file, view.range, now),
    },
  } satisfies Record<string, FilterDimension<GoogleFileSummary>>;
}

/** The files or events the picker shows for its filters, in its sort order. */
export function filterGoogleFiles(
  files: ReadonlyArray<GoogleFileSummary>,
  view: GoogleFilePickerView,
  now: number,
  pasted = false,
): GoogleFileSummary[] {
  const shown = applyFilterDimensions(files, googleDimensions(view, now, pasted));
  switch (view.sort) {
    case "nearest":
      return shown.toSorted(
        (a, b) => Math.abs(googleFileTime(a) - now) - Math.abs(googleFileTime(b) - now),
      );
    case "newest":
      return shown.toSorted((a, b) => googleFileTime(b) - googleFileTime(a));
    case "oldest":
      return shown.toSorted((a, b) => googleFileTime(a) - googleFileTime(b));
    case "title":
      return shown.toSorted((a, b) => a.title.localeCompare(b.title));
  }
}

export interface GoogleFilterOption {
  readonly value: string;
  readonly label: string;
  readonly count: number;
}

/**
 * What each filter menu offers, and how many results each choice would show under the other
 * applied filters (see `filterFacets`).
 */
export function googleFilterFacets(
  files: ReadonlyArray<GoogleFileSummary>,
  view: GoogleFilePickerView,
  now: number,
  pasted = false,
) {
  const facets = filterFacets(files, googleDimensions(view, now, pasted));
  return {
    types: facets.types.map((choice): GoogleFilterOption => ({
      ...choice,
      label: GOOGLE_FILE_TYPE_LABELS[choice.value as GoogleFileType],
    })),
    owners: facets.owners.map((choice): GoogleFilterOption => ({ ...choice, label: choice.value })),
    ranges: Object.fromEntries(
      facets.range.map((choice) => [choice.value, choice.count]),
    ) as Partial<Record<GoogleFilePickerView["range"], number>>,
  };
}

/**
 * `23 Oct` for a file's last edit, `26 Oct, 10:00` for an event's start, and the year too when
 * it is not this one. An all-day event's date-only start is a calendar date, not a UTC instant.
 */
export function googleFileTimeLabel(file: GoogleFileSummary, now: number): string {
  const iso = file.fileType === "event" ? file.startsAt : file.updatedAt;
  if (!iso) return "";
  const allDay = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  const date = allDay ? new Date(`${iso}T00:00:00`) : new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === new Date(now).getFullYear() ? {} : { year: "numeric" }),
    ...(file.fileType === "event" && !allDay ? { hour: "numeric", minute: "2-digit" } : {}),
  });
}
