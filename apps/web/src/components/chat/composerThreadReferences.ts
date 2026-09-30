import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

/** How many other threads the `@` menu lists, with and without a query. */
const THREAD_REFERENCE_LIMIT = 6;
const THREAD_REFERENCE_EMPTY_QUERY_LIMIT = 3;

/**
 * `@` menu rows for threads outside the current tab group: unarchived threads of the same
 * environment whose title contains `query`, most recently updated first.
 */
export function composerThreadReferenceItems(input: {
  threads: ReadonlyArray<EnvironmentThreadShell>;
  projects: ReadonlyArray<EnvironmentProject>;
  environmentId: EnvironmentId;
  excludeThreadIds: ReadonlySet<ThreadId>;
  query: string;
  /** Dedicated pickers can show more results than the inline mention menu. */
  limit?: number;
}) {
  const query = input.query.trim().toLowerCase();
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
        thread.title.toLowerCase().includes(query),
    )
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, input.limit ?? (query ? THREAD_REFERENCE_LIMIT : THREAD_REFERENCE_EMPTY_QUERY_LIMIT))
    .map((thread) => ({
      id: `thread-tab:${thread.id}`,
      type: "thread-tab" as const,
      threadId: thread.id,
      label: thread.title,
      description: projectTitles.get(thread.projectId) ?? "Thread",
    }));
}
