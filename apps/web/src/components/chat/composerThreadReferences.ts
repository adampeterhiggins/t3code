import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import type {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  ThreadTabMembership,
} from "@t3tools/contracts";
import {
  applyFilterDimensions,
  type FilterDimension,
  filterFacets,
} from "@t3tools/shared/filterFacets";

export interface ThreadAttachPickerView {
  readonly projectIds: ReadonlyArray<ProjectId>;
  readonly providerInstanceIds: ReadonlyArray<ProviderInstanceId>;
  readonly sort: "updated" | "newest" | "oldest" | "title";
}

export const DEFAULT_THREAD_ATTACH_PICKER_VIEW: ThreadAttachPickerView = {
  projectIds: [],
  providerInstanceIds: [],
  sort: "updated",
};

/** How many other threads the `@` menu lists, with and without a query. */
const THREAD_REFERENCE_LIMIT = 6;
const THREAD_REFERENCE_EMPTY_QUERY_LIMIT = 3;

interface ThreadReferenceInput {
  threads: ReadonlyArray<EnvironmentThreadShell>;
  projects: ReadonlyArray<EnvironmentProject>;
  environmentId: EnvironmentId;
  excludeThreadIds: ReadonlySet<ThreadId>;
  query: string;
  /** Memberships belong to `environmentId`; omitted by the inline mention menu. */
  tabMemberships?: ReadonlyArray<ThreadTabMembership>;
}

/**
 * The unarchived threads of the environment that match the query, by their own title or their
 * tab group's, before the picker's project and provider filters.
 */
function threadReferenceCandidates(input: ThreadReferenceInput) {
  const query = input.query.trim().toLowerCase();
  const memberships = input.tabMemberships ?? [];
  const threadsById = new Map(
    memberships.length === 0
      ? []
      : input.threads
          .filter(
            (thread) => thread.environmentId === input.environmentId && thread.archivedAt === null,
          )
          .map((thread) => [thread.id, thread]),
  );
  const parentByThreadId = new Map<ThreadId, EnvironmentThreadShell>();
  const parentsByGroupId = new Map<ThreadId, EnvironmentThreadShell>();
  for (const membership of memberships) {
    const parent = threadsById.get(membership.groupId) ?? threadsById.get(membership.threadId);
    if (parent && !parentsByGroupId.has(membership.groupId))
      parentsByGroupId.set(membership.groupId, parent);
  }
  for (const membership of memberships) {
    const parent = parentsByGroupId.get(membership.groupId);
    if (parent) parentByThreadId.set(membership.threadId, parent);
  }
  const candidates = input.threads.filter(
    (thread) =>
      thread.environmentId === input.environmentId &&
      thread.archivedAt === null &&
      !input.excludeThreadIds.has(thread.id) &&
      (thread.title.toLowerCase().includes(query) ||
        parentByThreadId.get(thread.id)?.title.toLowerCase().includes(query) === true),
  );
  return { query, memberships, parentByThreadId, candidates };
}

/** The attach picker's project and provider filters as facet dimensions. */
function threadAttachDimensions(view: ThreadAttachPickerView) {
  return {
    projects: {
      values: (thread: EnvironmentThreadShell) => [thread.projectId],
      selected: view.projectIds,
    },
    providers: {
      values: (thread: EnvironmentThreadShell) => [thread.modelSelection.instanceId],
      selected: view.providerInstanceIds,
    },
  } satisfies Record<string, FilterDimension<EnvironmentThreadShell>>;
}

/**
 * References to unarchived threads in the same environment, excluding the supplied IDs.
 * The `@` menu defaults to recent title matches; the attach picker supplies filters and sort.
 */
export function composerThreadReferenceItems(
  input: ThreadReferenceInput & {
    /** Dedicated pickers can show more results than the inline mention menu. */
    limit?: number;
    view?: ThreadAttachPickerView;
  },
) {
  const view = input.view ?? DEFAULT_THREAD_ATTACH_PICKER_VIEW;
  const { query, memberships, parentByThreadId, candidates } = threadReferenceCandidates(input);
  const groupIdByThreadId = new Map(
    memberships.map((membership) => [membership.threadId, membership.groupId]),
  );
  const projectTitles = new Map(
    input.projects
      .filter((project) => project.environmentId === input.environmentId)
      .map((project) => [project.id, project.title]),
  );
  return applyFilterDimensions(candidates, threadAttachDimensions(view))
    .toSorted((left, right) => {
      const order =
        view.sort === "title"
          ? left.title.localeCompare(right.title)
          : view.sort === "oldest"
            ? left.createdAt.localeCompare(right.createdAt)
            : view.sort === "newest"
              ? right.createdAt.localeCompare(left.createdAt)
              : right.updatedAt.localeCompare(left.updatedAt);
      return order || left.id.localeCompare(right.id);
    })
    .slice(0, input.limit ?? (query ? THREAD_REFERENCE_LIMIT : THREAD_REFERENCE_EMPTY_QUERY_LIMIT))
    .map((thread) => ({
      id: `thread-tab:${thread.id}`,
      type: "thread-tab" as const,
      threadId: thread.id,
      label: thread.title,
      description: projectTitles.get(thread.projectId) ?? "Thread",
      parentThreadId: groupIdByThreadId.get(thread.id) ?? null,
      parentThreadTitle: parentByThreadId.get(thread.id)?.title ?? null,
    }));
}

/**
 * The attach picker's project and provider choices, each with how many threads picking it would
 * show under the query and the other filter (see `filterFacets`). Projects without a record are
 * left out unless picked.
 */
export function threadAttachPickerFacets(
  input: ThreadReferenceInput & { view: ThreadAttachPickerView },
) {
  const facets = filterFacets(
    threadReferenceCandidates(input).candidates,
    threadAttachDimensions(input.view),
  );
  const projectTitles = new Map(
    input.projects
      .filter((project) => project.environmentId === input.environmentId)
      .map((project) => [project.id as string, project.title]),
  );
  return {
    projects: facets.projects.flatMap((choice) => {
      const value = choice.value as ProjectId;
      const title = projectTitles.get(value);
      if (title === undefined && !input.view.projectIds.includes(value)) return [];
      return [{ value, label: title ?? "Unknown project", count: choice.count }];
    }),
    providers: facets.providers.map((choice) => ({
      value: choice.value as ProviderInstanceId,
      count: choice.count,
    })),
  };
}

/**
 * Keeps matching tabs together, with groups ordered by their highest-ranked matching tab.
 * The original tab leads its group so the group reads as one thread.
 */
export function groupThreadAttachPickerItems(
  items: ReturnType<typeof composerThreadReferenceItems>,
) {
  const grouped = new Map<ThreadId, typeof items>();
  for (const item of items) {
    const id = item.parentThreadId ?? item.threadId;
    const entries = grouped.get(id);
    if (entries) entries.push(item);
    else grouped.set(id, [item]);
  }
  return [...grouped].flatMap(([id, entries]) => {
    const first = entries[0];
    if (!first) return [];
    const original = entries.findIndex((entry) => entry.threadId === id);
    if (original > 0) entries.unshift(...entries.splice(original, 1));
    return [{ id, parentTitle: first.parentThreadTitle, projectTitle: first.description, entries }];
  });
}
