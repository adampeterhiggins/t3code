import type { GoogleFileSummary } from "@t3tools/contracts";
import {
  applyFilterDimensions,
  type FilterDimension,
  filterFacets,
} from "@t3tools/shared/filterFacets";

export type GoogleFilePickerSource = "drive" | "calendar" | "gmail";
export type GoogleFileType = GoogleFileSummary["fileType"];

export interface GoogleFilePickerView {
  /** Drive files of any of these types. */
  readonly types: ReadonlyArray<GoogleFileType>;
  /** Files owned, or events organized, by any of these people. */
  readonly owners: ReadonlyArray<string>;
  /** Drive files modified within the last week or month. The calendar picks dates instead. */
  readonly range: "all" | "week" | "month";
  readonly sort: "newest" | "oldest" | "title";
}

export const DEFAULT_GOOGLE_FILE_PICKER_VIEWS = {
  drive: { types: [], owners: [], range: "all", sort: "newest" },
  gmail: { types: [], owners: [], range: "all", sort: "newest" },
  calendar: { types: [], owners: [], range: "all", sort: "oldest" },
} as const satisfies Record<GoogleFilePickerSource, GoogleFilePickerView>;

export const GOOGLE_FILE_TYPE_LABELS = {
  doc: "Docs",
  sheet: "Sheets",
  slides: "Slides",
  folder: "Folders",
  drive: "Other files",
  event: "Events",
  email: "Gmail conversations",
} as const satisfies Record<GoogleFileType, string>;

const DAY_MS = 24 * 60 * 60 * 1000;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** An all-day event's date-only time is a local calendar date, not a UTC instant. */
function parseGoogleTime(iso: string | undefined): Date | null {
  if (!iso) return null;
  const date = DATE_ONLY.test(iso) ? new Date(`${iso}T00:00:00`) : new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** When a file was last modified, or when an event starts. */
function googleFileTime(file: GoogleFileSummary): number {
  return (
    parseGoogleTime(file.fileType === "event" ? file.startsAt : file.updatedAt)?.getTime() ?? 0
  );
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
        (["all", "week", "month"] as const).filter((range) => pasted || inRange(file, range, now)),
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

/** `23 Oct` for a file's last edit, with the year too when it is not this one. */
export function googleFileTimeLabel(file: GoogleFileSummary, now: number): string {
  const date = parseGoogleTime(file.updatedAt);
  if (date === null) return "";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === new Date(now).getFullYear() ? {} : { year: "numeric" }),
  });
}

/** `2026-10-25`: a local calendar day, the key the calendar strip and agenda share. */
export function localDayKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function dayFromKey(day: string): Date {
  return new Date(`${day}T00:00:00`);
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** Local midnight on the Monday of the week holding `date`. */
export function startOfWeek(date: Date): Date {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return addDays(start, -((start.getDay() + 6) % 7));
}

/** The local day an event starts on. Multi-day events are listed on their first day. */
export function eventDayKey(event: GoogleFileSummary): string | null {
  const start = parseGoogleTime(event.startsAt);
  return start === null ? null : localDayKey(start);
}

function isAllDay(event: GoogleFileSummary) {
  return event.startsAt !== undefined && DATE_ONLY.test(event.startsAt);
}

/** Events by the day they start, days in order, all-day events first and then by start. */
export function groupEventsByDay(
  events: ReadonlyArray<GoogleFileSummary>,
): Array<{ readonly day: string; readonly events: GoogleFileSummary[] }> {
  const days = new Map<string, GoogleFileSummary[]>();
  for (const event of events) {
    const day = eventDayKey(event);
    if (day === null) continue;
    days.set(day, [...(days.get(day) ?? []), event]);
  }
  return [...days]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([day, dayEvents]) => ({
      day,
      events: dayEvents.toSorted(
        (a, b) =>
          Number(isAllDay(b)) - Number(isAllDay(a)) || googleFileTime(a) - googleFileTime(b),
      ),
    }));
}

/** `All day` or `10:00 – 11:00`, in local time. */
export function eventTimeLabel(event: GoogleFileSummary): string {
  if (isAllDay(event)) return "All day";
  const time = (date: Date | null) =>
    date?.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) ?? "";
  const start = time(parseGoogleTime(event.startsAt));
  const end = time(parseGoogleTime(event.endsAt));
  return end ? `${start} – ${end}` : start;
}

/** `Today · Sun 25 Oct`, `Tomorrow · …`, or `Mon 27 Oct`, with the year when not this one. */
export function dayHeading(day: string, now: number): string {
  const date = dayFromKey(day);
  const today = new Date(now);
  const label = date.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(date.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
  });
  const relative = {
    [localDayKey(today)]: "Today",
    [localDayKey(addDays(today, 1))]: "Tomorrow",
    [localDayKey(addDays(today, -1))]: "Yesterday",
  }[day];
  return relative ? `${relative} · ${label}` : label;
}
