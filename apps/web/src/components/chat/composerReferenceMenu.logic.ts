import { looksLikeCheckoutPath } from "@t3tools/shared/checkouts";

import type { ComposerCommandItem } from "./ComposerCommandMenu";

export type ComposerReferenceTab =
  | "checkouts"
  | "pull-requests"
  | "linear-issues"
  | "notion-pages"
  | "granola-notes"
  | "slack-messages"
  | "github-issues"
  | "repositories";

/** Items offered by the `#` menu's tabs. */
export type ComposerReferenceItem = Extract<
  ComposerCommandItem,
  {
    type:
      | "pull-request"
      | "github-issue"
      | "linear-issue"
      | "slack-message"
      | "notion-page"
      | "granola-note"
      | "repository"
      | "checkout";
  }
>;

const TAB_FOR_ITEM_TYPE: Record<ComposerReferenceItem["type"], ComposerReferenceTab> = {
  "pull-request": "pull-requests",
  "github-issue": "github-issues",
  "linear-issue": "linear-issues",
  "slack-message": "slack-messages",
  "notion-page": "notion-pages",
  "granola-note": "granola-notes",
  repository: "repositories",
  checkout: "checkouts",
};

export function isComposerReferenceItem(item: ComposerCommandItem): item is ComposerReferenceItem {
  return item.type in TAB_FOR_ITEM_TYPE;
}

export function composerReferenceTabForItem(item: ComposerReferenceItem): ComposerReferenceTab {
  return TAB_FOR_ITEM_TYPE[item.type];
}

/** A reference inserted earlier, kept so the `#` menu can offer it again without a search. */
export interface ComposerReferenceRecent {
  /** Project-scoped tabs (pull requests, GitHub issues) record the project; the rest record "". */
  readonly scope: string;
  readonly item: ComposerReferenceItem;
}

/** Whether the tab's results belong to one project rather than the whole environment. */
export function isProjectScopedReferenceTab(tab: ComposerReferenceTab): boolean {
  return tab === "pull-requests" || tab === "github-issues";
}

function searchableText(item: ComposerReferenceItem): string {
  const extra = item.type === "repository" ? item.nameWithOwner : "";
  return `${item.label} ${item.description} ${extra}`.toLowerCase();
}

/** Every word of the query appears in the item's label or description, in any order. */
export function matchesComposerReferenceQuery(item: ComposerReferenceItem, query: string): boolean {
  const text = searchableText(item);
  return query
    .toLowerCase()
    .split(/\s+/u)
    .every((word) => word.length === 0 || text.includes(word));
}

function isExactReferenceMatch(item: ComposerReferenceItem, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) return false;
  const label = item.label.toLowerCase();
  return label === normalized || label === `#${normalized}`;
}

export function dedupeComposerReferenceItems<Item extends { readonly id: string }>(
  items: ReadonlyArray<Item>,
): Item[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

const RECENT_RESULT_LIMIT = 5;

/**
 * The tab's rows: an exact label match first, then recent inserts that match the query (taking
 * the fresher copy when the search returned them too), then the rest in search order.
 */
export function orderComposerReferenceItems(input: {
  readonly items: ReadonlyArray<ComposerReferenceItem>;
  readonly recents: ReadonlyArray<ComposerReferenceItem>;
  readonly query: string;
  readonly limit: number;
}): ComposerReferenceItem[] {
  const byId = new Map(input.items.map((item) => [item.id, item] as const));
  const recents = input.recents
    .filter((item) => matchesComposerReferenceQuery(item, input.query))
    .slice(0, RECENT_RESULT_LIMIT)
    .map((item) => byId.get(item.id) ?? item);
  const exact = input.items.filter((item) => isExactReferenceMatch(item, input.query));
  return dedupeComposerReferenceItems([...exact, ...recents, ...input.items]).slice(0, input.limit);
}

const LINEAR_IDENTIFIER_PATTERN = /^([a-z][a-z0-9_]*)-\d+$/i;
const LINEAR_TEAM_KEY_PATTERN = /^([a-z][a-z0-9_]*)-?$/i;
const HABIT_WINDOW = 10;

/** Team keys seen in issue identifiers like `ENG-123`, upper-cased. */
export function linearTeamKeysFromItems(
  items: ReadonlyArray<ComposerReferenceItem>,
): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const item of items) {
    if (item.type !== "linear-issue") continue;
    const match = LINEAR_IDENTIFIER_PATTERN.exec(item.label);
    if (match?.[1]) keys.add(match[1].toUpperCase());
  }
  return keys;
}

/**
 * The tab the user inserts from most among their recent inserts, ties going to the newest.
 * Slack needs a word to search, so it never opens an empty `#`.
 */
function habitualTab(
  recents: ReadonlyArray<ComposerReferenceItem>,
  available: ReadonlySet<ComposerReferenceTab>,
  allowSlack: boolean,
): ComposerReferenceTab | null {
  const counts = new Map<ComposerReferenceTab, number>();
  for (const item of recents.slice(0, HABIT_WINDOW)) {
    const tab = composerReferenceTabForItem(item);
    if (!available.has(tab) || (!allowSlack && tab === "slack-messages")) continue;
    counts.set(tab, (counts.get(tab) ?? 0) + 1);
  }
  let best: ComposerReferenceTab | null = null;
  for (const [tab, count] of counts) {
    // Map order is first-seen order, which is newest first, so `>` keeps the newest on a tie.
    if (best === null || count > (counts.get(best) ?? 0)) best = tab;
  }
  return best;
}

/**
 * The `#` menu's starting tab, from the shape of the query and what the user has inserted before:
 *
 * - An identifier (`#ENG-123`), or a known Linear team key (`#ENG`), names a Linear issue.
 * - A filesystem path names a checkout. `#owner/name` names a repository, and so does a
 *   hyphenated name (`#cin-questionnaire`) once a default repository owner is set, unless a
 *   local checkout already matches that name.
 * - A number names a pull request, unless a recent GitHub issue has exactly that number.
 * - Otherwise the tab whose recent inserts or preloaded rows match the query, preferring the tab
 *   the user inserts from most, then pull requests.
 */
export function predictComposerReferenceTab(input: {
  readonly query: string;
  readonly available: ReadonlySet<ComposerReferenceTab>;
  readonly hasDefaultRepositoryOwner: boolean;
  /** Recent inserts, newest first, already narrowed to the current project. */
  readonly recents: ReadonlyArray<ComposerReferenceItem>;
  /** Rows each tab has already loaded for an empty query. */
  readonly preloaded: Partial<Record<ComposerReferenceTab, ReadonlyArray<ComposerReferenceItem>>>;
}): ComposerReferenceTab {
  const query = input.query.trim();
  const has = (tab: ComposerReferenceTab) => input.available.has(tab);
  const fallback: ComposerReferenceTab = "pull-requests";

  if (LINEAR_IDENTIFIER_PATTERN.test(query) && has("linear-issues")) return "linear-issues";
  if (looksLikeCheckoutPath(query) && has("checkouts")) return "checkouts";
  if (query.includes("/") && has("repositories")) return "repositories";
  if (has("linear-issues")) {
    const teamKey = LINEAR_TEAM_KEY_PATTERN.exec(query)?.[1]?.toUpperCase();
    const knownKeys = linearTeamKeysFromItems([
      ...input.recents,
      ...(input.preloaded["linear-issues"] ?? []),
    ]);
    if (teamKey !== undefined && knownKeys.has(teamKey)) return "linear-issues";
  }
  if (
    query.length > 0 &&
    has("checkouts") &&
    [...input.recents, ...(input.preloaded.checkouts ?? [])].some(
      (item) => item.type === "checkout" && matchesComposerReferenceQuery(item, query),
    )
  ) {
    return "checkouts";
  }
  if (/^\d+$/u.test(query)) {
    const exactRecent = input.recents.find(
      (item) => has(composerReferenceTabForItem(item)) && isExactReferenceMatch(item, query),
    );
    return exactRecent ? composerReferenceTabForItem(exactRecent) : fallback;
  }

  const habit = habitualTab(input.recents, input.available, query.length > 0);
  if (query.length === 0) return habit ?? fallback;

  // Tabs with local evidence for this query: a recent insert first, then a preloaded row.
  const recentMatch = input.recents.find(
    (item) => has(composerReferenceTabForItem(item)) && matchesComposerReferenceQuery(item, query),
  );
  if (recentMatch) return composerReferenceTabForItem(recentMatch);
  if (input.hasDefaultRepositoryOwner && has("repositories")) {
    if (/[\p{L}\p{N}]-[\p{L}\p{N}]/u.test(query)) return "repositories";
  }
  const preferred = habit ?? fallback;
  const preloadedMatches = (tab: ComposerReferenceTab) =>
    (input.preloaded[tab] ?? []).some((item) => matchesComposerReferenceQuery(item, query));
  if (preloadedMatches(preferred)) return preferred;
  for (const tab of input.available) {
    if (tab !== preferred && preloadedMatches(tab)) return tab;
  }
  return preferred;
}
