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

/**
 * References to unarchived threads in the same environment, excluding the supplied IDs.
 * The `@` menu defaults to recent title matches; the attach picker supplies filters and sort.
 */
export function composerThreadReferenceItems(input: {
  threads: ReadonlyArray<EnvironmentThreadShell>;
  projects: ReadonlyArray<EnvironmentProject>;
  environmentId: EnvironmentId;
  excludeThreadIds: ReadonlySet<ThreadId>;
  query: string;
  /** Dedicated pickers can show more results than the inline mention menu. */
  limit?: number;
  view?: ThreadAttachPickerView;
  /** Memberships belong to `environmentId`; omitted by the inline mention menu. */
  tabMemberships?: ReadonlyArray<ThreadTabMembership>;
}) {
  const query = input.query.trim().toLowerCase();
  const view = input.view ?? DEFAULT_THREAD_ATTACH_PICKER_VIEW;
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
  const groupIdByThreadId = new Map(
    memberships.map((membership) => [membership.threadId, membership.groupId]),
  );
  const projectTitles = new Map(
    input.projects
      .filter((project) => project.environmentId === input.environmentId)
      .map((project) => [project.id, project.title]),
  );
  return input.threads
    .filter(
      (thread) =>
        thread.environmentId === input.environmentId &&
        thread.archivedAt === null &&
        !input.excludeThreadIds.has(thread.id) &&
        (view.projectIds.length === 0 || view.projectIds.includes(thread.projectId)) &&
        (view.providerInstanceIds.length === 0 ||
          view.providerInstanceIds.includes(thread.modelSelection.instanceId)) &&
        (thread.title.toLowerCase().includes(query) ||
          parentByThreadId.get(thread.id)?.title.toLowerCase().includes(query) === true),
    )
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

/** Keeps matching tabs together, with groups ordered by their highest-ranked matching tab. */
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
    return first
      ? [{ id, parentTitle: first.parentThreadTitle, projectTitle: first.description, entries }]
      : [];
  });
}
