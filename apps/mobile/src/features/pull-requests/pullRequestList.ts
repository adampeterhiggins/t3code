import type {
  EnvironmentId,
  PullRequestListEntry,
  PullRequestListInput,
  PullRequestListResult,
} from "@t3tools/contracts";
import { type FacetChoice, filterFacets } from "@t3tools/shared/filterFacets";
import type { PullRequestListControls } from "../../persistence/mobile-preferences";

export const PR_LIST_PAGE_SIZE = 30;
export type { PullRequestListControls } from "../../persistence/mobile-preferences";
export const DEFAULT_PR_LIST_CONTROLS: PullRequestListControls = {
  state: "open",
  involvement: "all",
  filters: {},
  sort: "updated",
};

export function pullRequestListKey(
  item: Pick<PullRequestListEntry, "host" | "repository" | "number">,
) {
  return `${item.host.toLowerCase()}:${item.repository.toLowerCase()}:${item.number}`;
}

export type EnvironmentPullRequestListEntry = PullRequestListEntry & {
  readonly environmentId: EnvironmentId;
};

export const scopedPullRequestListKey = (entry: EnvironmentPullRequestListEntry) =>
  `${entry.environmentId}:${pullRequestListKey(entry)}`;

/** Provider refreshes and diff-count batches recreate entries; unchanged rows can stay mounted. */
export function pullRequestListRowsAreEqual(
  previous: EnvironmentPullRequestListEntry,
  next: EnvironmentPullRequestListEntry,
) {
  return (
    previous === next ||
    (previous.environmentId === next.environmentId &&
      previous.projectId === next.projectId &&
      previous.host === next.host &&
      previous.repository === next.repository &&
      previous.number === next.number &&
      previous.title === next.title &&
      previous.url === next.url &&
      previous.state === next.state &&
      previous.isDraft === next.isDraft &&
      previous.updatedAt === next.updatedAt &&
      previous.additions === next.additions &&
      previous.deletions === next.deletions &&
      previous.checksState === next.checksState &&
      previous.reviewDecision === next.reviewDecision &&
      previous.viewerReviewRequested === next.viewerReviewRequested &&
      previous.author?.login === next.author?.login &&
      previous.author?.avatarUrl === next.author?.avatarUrl &&
      previous.stack?.position === next.stack?.position &&
      previous.stack?.size === next.stack?.size &&
      previous.labels.length === next.labels.length &&
      previous.labels.every(
        (label, index) =>
          label.name === next.labels[index]?.name && label.color === next.labels[index]?.color,
      ))
  );
}

/** Keep cursors and viewer identities with the environment that issued them. */
export function mergeEnvironmentPullRequestPages(
  sources: readonly { environmentId: EnvironmentId; pages: PullRequestListPages }[],
) {
  const viewers: Record<string, string> = {};
  const localSearchHosts = new Set<string>();
  const entries: EnvironmentPullRequestListEntry[] = [];
  const errors = [];
  for (const { environmentId, pages } of sources) {
    entries.push(...pages.entries.map((entry) => ({ ...entry, environmentId })));
    for (const [host, viewer] of Object.entries(pages.head.viewers))
      viewers[`${environmentId} ${host}`] = viewer;
    for (const provider of pages.head.providers)
      if (!provider.searchesOnHost) localSearchHosts.add(`${environmentId} ${provider.host}`);
    errors.push(...pages.head.errors.map((error) => ({ ...error, environmentId })));
  }
  return {
    entries,
    viewers,
    localSearchHosts,
    errors,
    continued: sources.some(({ pages }) => pages.continued),
  };
}

export function mergePullRequestListEntries(
  previous: readonly PullRequestListEntry[],
  incoming: readonly PullRequestListEntry[],
) {
  const entries = new Map(previous.map((entry) => [pullRequestListKey(entry), entry]));
  for (const entry of incoming) {
    const key = pullRequestListKey(entry);
    const held = entries.get(key);
    if (!held || (entry.observedAt ?? 0) >= (held.observedAt ?? 0)) entries.set(key, entry);
  }
  return [...entries.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export interface PullRequestListPages {
  readonly head: PullRequestListResult;
  readonly entries: readonly PullRequestListEntry[];
  readonly nextCursors: PullRequestListResult["nextCursors"];
  readonly truncated: boolean;
  readonly limit: number;
  readonly continued: boolean;
}

export function pullRequestListHead(
  previous: PullRequestListPages | null,
  head: PullRequestListResult,
): PullRequestListPages {
  if (previous?.head === head) return previous;
  return previous?.continued
    ? { ...previous, head, entries: mergePullRequestListEntries(previous.entries, head.entries) }
    : {
        head,
        entries: head.entries,
        nextCursors: head.nextCursors,
        truncated: head.truncated,
        limit: PR_LIST_PAGE_SIZE,
        continued: false,
      };
}

export function nextPullRequestListInput(
  pages: PullRequestListPages,
  input: PullRequestListInput,
): PullRequestListInput | null {
  if (Object.keys(pages.nextCursors).length)
    return { ...input, limit: PR_LIST_PAGE_SIZE, cursors: pages.nextCursors };
  return pages.truncated && pages.limit < 500
    ? { ...input, limit: Math.min(pages.limit + PR_LIST_PAGE_SIZE, 500) }
    : null;
}

export function appendPullRequestListPage(
  previous: PullRequestListPages,
  page: PullRequestListResult,
  input: PullRequestListInput,
): PullRequestListPages {
  return {
    ...previous,
    entries: mergePullRequestListEntries(previous.entries, page.entries),
    nextCursors: page.nextCursors,
    truncated: page.truncated,
    limit: input.limit ?? PR_LIST_PAGE_SIZE,
    continued: true,
  };
}

type ScopedPullRequestListEntry = PullRequestListEntry & { environmentId?: string };

/** Whether a row passes the controls, the search, and the hosts that searched it themselves. */
function pullRequestListPredicate(
  controls: PullRequestListControls,
  viewers: PullRequestListResult["viewers"],
  query: string,
  localSearchHosts: ReadonlySet<string>,
) {
  const normalize = (value: string) => value.toLowerCase();
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const { filters } = controls;
  return (entry: ScopedPullRequestListEntry) => {
    if (controls.state !== "all" && entry.state !== controls.state) return false;
    if (controls.projectId && entry.projectId !== controls.projectId) return false;
    if (controls.projectEnvironmentId && entry.environmentId !== controls.projectEnvironmentId)
      return false;
    const viewerKey = entry.environmentId ? `${entry.environmentId} ${entry.host}` : entry.host;
    const viewer = viewers[viewerKey];
    if (controls.involvement === "reviewing" && !entry.viewerReviewRequested) return false;
    if (
      controls.involvement === "authored" &&
      (!viewer || normalize(entry.author?.login ?? "") !== normalize(viewer))
    )
      return false;
    if ((filters.draft === "only" && !entry.isDraft) || (filters.draft === "hide" && entry.isDraft))
      return false;
    if (filters.author) {
      const author = filters.author === "me" ? viewer : filters.author;
      if (!author || normalize(entry.author?.login ?? "") !== normalize(author)) return false;
    }
    // Hosts without a review rollup still perform their own review filtering.
    if (filters.review && entry.reviewDecision && entry.reviewDecision !== filters.review)
      return false;
    if (filters.review === "none" && entry.reviewDecision) return false;
    if (filters.checks && entry.checksState && entry.checksState !== filters.checks) return false;
    const labels = new Set(entry.labels.map((label) => normalize(label.name)));
    if (filters.labels?.some((group) => !group.some((label) => labels.has(normalize(label)))))
      return false;
    if (filters.excludedLabels?.some((label) => labels.has(normalize(label)))) return false;
    if (words.length && localSearchHosts.has(viewerKey)) {
      const text =
        `${entry.repository} #${entry.number} ${entry.title} ${entry.author?.login ?? ""} ${entry.headBranch} ${entry.baseBranch} ${entry.labels.map((label) => label.name).join(" ")}`.toLowerCase();
      if (!words.every((word) => text.includes(word))) return false;
    }
    return true;
  };
}

export function filterPullRequestList<Entry extends ScopedPullRequestListEntry>(
  entries: readonly Entry[],
  controls: PullRequestListControls,
  viewers: PullRequestListResult["viewers"],
  query: string,
  localSearchHosts: ReadonlySet<string>,
  connectedEnvironmentIds?: ReadonlySet<string>,
) {
  const filtered = entries.filter(
    pullRequestListPredicate(controls, viewers, query, localSearchHosts),
  );
  // The same repository can be available on multiple machines. Pick its first matching source,
  // unless that machine is unreachable and another one can answer: its rows may only be cached.
  const reachable = (entry: Entry) =>
    !connectedEnvironmentIds ||
    (entry.environmentId !== undefined && connectedEnvironmentIds.has(entry.environmentId));
  const unique = new Map<string, Entry>();
  for (const entry of filtered) {
    const key = pullRequestListKey(entry);
    const held = unique.get(key);
    if (!held || (!reachable(held) && reachable(entry))) unique.set(key, entry);
  }
  return [...unique.values()].sort((a, b) =>
    controls.sort === "created"
      ? b.createdAt.localeCompare(a.createdAt)
      : controls.sort === "oldest"
        ? a.updatedAt.localeCompare(b.updatedAt)
        : b.updatedAt.localeCompare(a.updatedAt),
  );
}

/** The fixed menus count `all` as one more value every row holds; no filter ever picks it. */
const ALL_CHOICE = "all";

/**
 * What each filter menu offers and how many loaded rows each choice would show under every
 * *other* applied filter (see `filterFacets`), so no menu narrows itself and a picked value the
 * other filters now exclude stays listed at 0. The fixed menus are keyed by value, with `all`
 * counting every row the other filters leave. Counts cover the rows passed in, not the host.
 */
export function pullRequestListFacets<Entry extends ScopedPullRequestListEntry>(
  entries: readonly Entry[],
  controls: PullRequestListControls,
  viewers: PullRequestListResult["viewers"],
  query: string,
  localSearchHosts: ReadonlySet<string>,
) {
  const open: PullRequestListControls = {
    state: "all",
    involvement: "all",
    filters: {},
    sort: controls.sort,
  };
  /** One menu's own narrowing, alone. */
  const only = (patch: Partial<PullRequestListControls>) =>
    pullRequestListPredicate({ ...open, ...patch }, viewers, "", new Set());
  const { filters } = controls;
  // The project, the search, and the narrowings no menu counts apply to every menu alike.
  const rows = filterPullRequestList(
    entries,
    {
      ...controls,
      state: "all",
      involvement: "all",
      filters: {
        ...(filters.checks ? { checks: filters.checks } : {}),
        ...(filters.excludedLabels ? { excludedLabels: filters.excludedLabels } : {}),
      },
    },
    viewers,
    query,
    localSearchHosts,
  );
  const authored = only({ involvement: "authored" });
  const selectedLabels = filters.labels?.flat() ?? [];
  const facets = filterFacets(rows, {
    state: {
      values: (entry) => [ALL_CHOICE, entry.state],
      selected: controls.state === "all" ? [] : [controls.state],
    },
    involvement: {
      values: (entry) => [
        ALL_CHOICE,
        ...(entry.viewerReviewRequested ? ["reviewing"] : []),
        ...(authored(entry) ? ["authored"] : []),
      ],
      selected: controls.involvement === "all" ? [] : [controls.involvement],
    },
    draft: {
      values: (entry) => [ALL_CHOICE, entry.isDraft ? "only" : "hide"],
      selected: filters.draft ? [filters.draft] : [],
    },
    review: {
      values: (entry) => [ALL_CHOICE, entry.reviewDecision ?? "none"],
      selected: filters.review ? [filters.review] : [],
      ...(filters.review ? { matches: only({ filters: { review: filters.review } }) } : {}),
    },
    author: {
      values: (entry) => (entry.author ? [entry.author.login] : []),
      // `me` is a different login on every host, so it is matched per row and never listed.
      selected: filters.author && filters.author !== "me" ? [filters.author] : [],
      ...(filters.author ? { matches: only({ filters: { author: filters.author } }) } : {}),
    },
    labels: {
      values: (entry) => entry.labels.map((label) => label.name),
      selected: selectedLabels,
      ...(filters.labels ? { matches: only({ filters: { labels: filters.labels } }) } : {}),
    },
  });
  const counts = (choices: readonly FacetChoice[]): Readonly<Record<string, number>> =>
    Object.fromEntries(choices.map((choice) => [choice.value, choice.count]));
  return {
    loaded: rows.length,
    state: counts(facets.state),
    involvement: counts(facets.involvement),
    draft: counts(facets.draft),
    review: counts(facets.review),
    authors: facets.author,
    labels: facets.labels,
  };
}

export type PullRequestListFacets = ReturnType<typeof pullRequestListFacets>;

export function pullRequestListReviewStatus(
  entry: Pick<PullRequestListEntry, "reviewDecision" | "viewerReviewRequested">,
) {
  if (entry.reviewDecision === "changes-requested")
    return {
      label: "Changes",
      accessibleLabel: "Changes requested",
      icon: "person.fill.xmark",
      tint: "accent-danger-foreground",
    } as const;
  if (entry.reviewDecision === "approved")
    return {
      label: "Approved",
      accessibleLabel: "Reviews approved",
      icon: "person.fill.checkmark",
      tint: "accent-adaptive-emerald-600-400",
    } as const;
  if (entry.viewerReviewRequested)
    return {
      label: "Your review",
      accessibleLabel: "Your review requested",
      icon: "person.badge.clock",
      tint: "accent-warning-foreground",
    } as const;
  if (entry.reviewDecision === "review-required")
    return {
      label: "Review",
      accessibleLabel: "Review required",
      icon: "person.badge.clock",
      tint: "accent-icon-muted",
    } as const;
  return null;
}

export function pullRequestLabelColor(color: string | null) {
  const hex = color?.replace(/^#/, "");
  return hex && /^[\da-f]{6}$/i.test(hex) ? `#${hex}` : null;
}
