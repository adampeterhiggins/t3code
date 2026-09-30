import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";

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
}) {
  const query = input.query.trim().toLowerCase();
  const view = input.view ?? DEFAULT_THREAD_ATTACH_PICKER_VIEW;
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
        thread.title.toLowerCase().includes(query),
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
    }));
}
