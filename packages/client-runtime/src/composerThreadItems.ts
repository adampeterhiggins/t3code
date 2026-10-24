import type { EnvironmentId, ProjectId, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { foldSearchQuery, rankSearchItems, scoreThreadSearch } from "@t3tools/shared/paletteSearch";

import type { EnvironmentThreadShell } from "./state/models.ts";
import { threadSearchSubject, type ThreadSearchShell } from "./state/threadSearch.ts";

const COMPOSER_THREAD_RESULT_LIMIT = 20;

export type ComposerThreadCandidate = ThreadSearchShell &
  Pick<EnvironmentThreadShell, "archivedAt" | "lineage" | "projectId">;

export interface ComposerThreadItem {
  readonly id: string;
  readonly type: "thread";
  readonly thread: ScopedThreadRef;
  readonly label: string;
  readonly description: string;
}

/**
 * Threads to reference from the composer, matched and ranked like the command
 * palette, without subagent threads. The agent can only read threads on its
 * own server, so candidates stay within the composer's environment.
 */
export function matchComposerThreadItems(input: {
  shells: ReadonlyArray<ComposerThreadCandidate>;
  environmentId: EnvironmentId;
  excludeThreadId: ThreadId | null;
  query: string;
  /** Recency is measured against this time. */
  now: number;
  projectTitles?: ReadonlyMap<ProjectId, string>;
}): ComposerThreadItem[] {
  const query = foldSearchQuery(input.query);
  const candidates = input.shells.filter(
    (shell) =>
      shell.environmentId === input.environmentId &&
      shell.id !== input.excludeThreadId &&
      shell.archivedAt === null &&
      shell.lineage.relationshipToParent !== "subagent",
  );
  const ranked =
    query.length === 0
      ? candidates
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
          .map((item) => ({ item }))
      : rankSearchItems(candidates, (shell, options) =>
          scoreThreadSearch(query, threadSearchSubject(shell, null), input.now, {
            ...options,
            picks: false,
          }),
        );
  return ranked.slice(0, COMPOSER_THREAD_RESULT_LIMIT).map(({ item: shell }) => ({
    id: `thread:${shell.environmentId}:${shell.id}`,
    type: "thread",
    thread: { environmentId: shell.environmentId, threadId: shell.id },
    label: shell.title,
    description:
      [input.projectTitles?.get(shell.projectId), shell.branch].filter(Boolean).join(" · ") ||
      "Thread",
  }));
}
