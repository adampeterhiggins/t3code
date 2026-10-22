import type { ManagedWorktree, ManagedWorktreeState } from "@t3tools/contracts";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";

import {
  formatDateLabel,
  formatDateTimeLabel,
  formatRelativeTimeLabel,
} from "../../timestampFormat";

/** Whether the checkout can be removed now, and why not when it cannot. */
export type WorktreeCheckout = "clean" | "dirty" | "running" | "unknown";

export function worktreeCheckout(entry: ManagedWorktree): WorktreeCheckout {
  if (entry.threads.some((thread) => thread.running)) return "running";
  if (entry.dirty === null) return "unknown";
  return entry.dirty ? "dirty" : "clean";
}

export const worktreeRemovable = (entry: ManagedWorktree) => worktreeCheckout(entry) === "clean";

type WorktreePullRequestState = "open" | "closed" | "merged" | "unsynced" | "none";

function worktreePullRequestState(entry: ManagedWorktree): WorktreePullRequestState {
  if (entry.pullRequest === null) return "none";
  return entry.pullRequest.state ?? "unsynced";
}

export interface WorktreeFilters {
  readonly state: ManagedWorktreeState | "all";
  readonly checkout: WorktreeCheckout | "all";
  readonly pullRequest: WorktreePullRequestState | "all";
  /** A repository folder name, the column the table labels Project. */
  readonly project: string;
}

export const ALL_WORKTREE_FILTERS: WorktreeFilters = {
  state: "all",
  checkout: "all",
  pullRequest: "all",
  project: "all",
};

/** Each filter's value for one worktree, so the menu's counts and the filter agree. */
function worktreeFacets(entry: ManagedWorktree): WorktreeFilters {
  return {
    state: entry.state,
    checkout: worktreeCheckout(entry),
    pullRequest: worktreePullRequestState(entry),
    project: entry.repositoryName,
  };
}

export function filterWorktrees(
  entries: ReadonlyArray<ManagedWorktree>,
  filters: WorktreeFilters,
  query: string,
): ManagedWorktree[] {
  const needle = query.trim().toLowerCase();
  return entries.filter((entry) => {
    const facets = worktreeFacets(entry);
    for (const key of Object.keys(filters) as Array<keyof WorktreeFilters>) {
      if (filters[key] !== "all" && filters[key] !== facets[key]) return false;
    }
    if (needle.length === 0) return true;
    return [
      entry.branch ?? "",
      entry.path,
      entry.repositoryName,
      ...entry.threads.map((t) => t.title),
    ]
      .join("\n")
      .toLowerCase()
      .includes(needle);
  });
}

/** How many worktrees each value of one filter would show, keyed by value. */
export function countWorktreeFacet(
  entries: ReadonlyArray<ManagedWorktree>,
  key: keyof WorktreeFilters,
): Record<string, number> {
  const counts: Record<string, number> = { all: entries.length };
  for (const entry of entries) {
    const value = worktreeFacets(entry)[key];
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

export type WorktreeSortColumn =
  | "worktree"
  | "project"
  | "pullRequest"
  | "state"
  | "checkout"
  | "created"
  | "updated"
  | "size";

export interface WorktreeSort {
  readonly column: WorktreeSortColumn;
  readonly direction: "asc" | "desc";
}

/** Numbers and dates read best biggest or newest first; names read best A to Z. */
export function defaultSortDirection(column: WorktreeSortColumn): WorktreeSort["direction"] {
  return column === "worktree" || column === "project" ? "asc" : "desc";
}

const STATE_RANK: Record<ManagedWorktreeState, number> = {
  active: 3,
  settled: 2,
  archived: 1,
  none: 0,
};
// Most protected first when descending, matching State's liveliest-first order.
const CHECKOUT_RANK: Record<WorktreeCheckout, number> = {
  running: 3,
  dirty: 2,
  unknown: 1,
  clean: 0,
};

const epochMillis = (value: DateTime.Utc | null | undefined) =>
  value ? DateTime.toEpochMillis(value) : null;

/**
 * Sorted by one column. Rows without a value (unmeasured sizes, unknown dates, no pull request)
 * stay at the end in both directions, so flipping the order never buries the known ones.
 */
export function sortWorktrees(
  entries: ReadonlyArray<ManagedWorktree>,
  sort: WorktreeSort,
  sizes: Readonly<Record<string, number | null>>,
): ManagedWorktree[] {
  const key = (entry: ManagedWorktree): string | number | null => {
    switch (sort.column) {
      case "worktree":
        return (entry.branch ?? entry.path).toLowerCase();
      case "project":
        return entry.repositoryName.toLowerCase();
      case "pullRequest":
        return entry.pullRequest?.number ?? null;
      case "state":
        return STATE_RANK[entry.state];
      case "checkout":
        return CHECKOUT_RANK[worktreeCheckout(entry)];
      case "created":
        return epochMillis(entry.createdAt);
      case "updated":
        return epochMillis(entry.updatedAt);
      case "size":
        return sizes[entry.path] ?? null;
    }
  };
  const sign = sort.direction === "asc" ? 1 : -1;
  return entries.toSorted((left, right) => {
    const a = key(left);
    const b = key(right);
    if (a === b) return left.path.localeCompare(right.path);
    if (a === null) return 1;
    if (b === null) return -1;
    return (a < b ? -1 : 1) * sign;
  });
}

export const WorktreeDateFormat = Schema.Literals(["relative", "date", "datetime"]);
export type WorktreeDateFormat = typeof WorktreeDateFormat.Type;

export const WorktreeDateFormats = Schema.Struct({
  created: WorktreeDateFormat,
  updated: WorktreeDateFormat,
});
export type WorktreeDateFormats = typeof WorktreeDateFormats.Type;

export const DEFAULT_WORKTREE_DATE_FORMATS: WorktreeDateFormats = {
  created: "relative",
  updated: "relative",
};

export function formatWorktreeDate(
  value: DateTime.Utc | null | undefined,
  format: WorktreeDateFormat,
  timestampFormat: TimestampFormat,
  nowMs: number,
): string {
  if (!value) return "—";
  const iso = DateTime.formatIso(value);
  switch (format) {
    case "relative":
      return formatRelativeTimeLabel(iso, nowMs);
    case "date":
      return formatDateLabel(iso);
    case "datetime":
      return formatDateTimeLabel(iso, timestampFormat);
  }
}
