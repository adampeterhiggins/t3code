import type { OrchestrationThreadShell, VcsRef } from "@t3tools/contracts";
import { deriveLocalBranchNameFromRemoteRef } from "@t3tools/shared/git";

import type { DraftThreadEnvMode } from "~/composerDraftStore";

type ThreadCandidate = Pick<
  OrchestrationThreadShell,
  "branch" | "archivedAt" | "updatedAt" | "pullRequests" | "linkedPullRequest" | "branchPullRequest"
>;

function newestFirst<T extends ThreadCandidate>(threads: ReadonlyArray<T>): T[] {
  return threads.toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * Live threads already working on a pull request: linked to it, or on its head branch. The
 * picker asks before starting another one beside them.
 */
export function threadsForPullRequest<T extends ThreadCandidate>(
  threads: ReadonlyArray<T>,
  pullRequest: { readonly url: string; readonly headBranch: string },
): T[] {
  return newestFirst(
    threads.filter(
      (thread) =>
        thread.archivedAt === null &&
        (thread.branch === pullRequest.headBranch ||
          thread.linkedPullRequest?.url === pullRequest.url ||
          thread.branchPullRequest?.url === pullRequest.url ||
          thread.pullRequests.some(
            (link) => link.url === pullRequest.url && link.source !== "stack-dismissed",
          )),
    ),
  );
}

/** The local name a branch is worked on under; `origin/foo` is worked on as `foo`. */
export function localBranchName(ref: Pick<VcsRef, "name" | "isRemote">): string {
  return ref.isRemote ? deriveLocalBranchNameFromRemoteRef(ref.name) : ref.name;
}

/**
 * Live threads already on a branch. The default branch is where most threads start, so it never
 * counts as taken.
 */
export function threadsForBranch<T extends ThreadCandidate>(
  threads: ReadonlyArray<T>,
  ref: Pick<VcsRef, "name" | "isRemote" | "isDefault">,
): T[] {
  if (ref.isDefault) return [];
  const branch = localBranchName(ref);
  return newestFirst(
    threads.filter((thread) => thread.archivedAt === null && thread.branch === branch),
  );
}

/**
 * Where a thread started from a branch runs. A branch already checked out somewhere is worked on
 * in that checkout; any other branch becomes the base of a new worktree, so the project's own
 * checkout is never switched out from under other threads.
 */
export function resolveBranchStart(
  ref: Pick<VcsRef, "name" | "worktreePath">,
  workspaceRoot: string,
): { branch: string; worktreePath: string | null; envMode: DraftThreadEnvMode } {
  if (ref.worktreePath === workspaceRoot) {
    return { branch: ref.name, worktreePath: null, envMode: "local" };
  }
  if (ref.worktreePath !== null) {
    return { branch: ref.name, worktreePath: ref.worktreePath, envMode: "worktree" };
  }
  return { branch: ref.name, worktreePath: null, envMode: "worktree" };
}
