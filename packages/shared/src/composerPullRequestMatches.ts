import type { ProjectId, PullRequestRef, ThreadPullRequestLink } from "@t3tools/contracts";
import { parseChangeRequestUrl } from "./changeRequestUrl.ts";
import { normalizeGitRemoteUrl } from "./git.ts";
import { visibleThreadPullRequests } from "./threadPullRequests.ts";

export interface ComposerPullRequestMatch {
  readonly number: number;
  readonly projectId: string;
  readonly repository: string;
  readonly updatedAt: string;
  readonly host?: string;
  readonly url?: string;
}

export function composerPullRequestsFromLinks(
  links: ReadonlyArray<ThreadPullRequestLink>,
  projectId: ProjectId,
) {
  return visibleThreadPullRequests(links).flatMap((link) =>
    link.snapshot === null
      ? []
      : [
          {
            projectId,
            host: link.host,
            repository: link.repository,
            number: link.number,
            url: link.url,
            title: link.snapshot.title,
            headBranch: link.snapshot.headBranch,
            baseBranch: link.snapshot.baseBranch,
            state: link.snapshot.state,
            isDraft: link.snapshot.isDraft,
            updatedAt: link.snapshot.updatedAt ?? link.linkedAt,
          },
        ],
  );
}

export function filterComposerPullRequestMatches<
  Entry extends ComposerPullRequestMatch,
  Linked extends ComposerPullRequestMatch = never,
>(input: {
  readonly entries: ReadonlyArray<Entry>;
  readonly linked?: ReadonlyArray<Linked>;
  readonly projectId: string;
  readonly repository: string;
  readonly repositories?: ReadonlyArray<Pick<PullRequestRef, "projectId" | "repository" | "host">>;
  readonly query: string;
  readonly limit: number;
}): ReadonlyArray<Entry | Linked> {
  const repository = input.repository.trim().toLowerCase();
  const hostOf = (entry: ComposerPullRequestMatch) => {
    if (entry.host !== undefined) return entry.host.toLowerCase();
    const link = parseChangeRequestUrl(entry.url ?? "");
    return link?.authority ?? link?.host;
  };
  const keyOf = (entry: ComposerPullRequestMatch) =>
    `${hostOf(entry) ?? ""}:${entry.repository.trim().toLowerCase()}#${entry.number}`;
  const linked = (input.linked ?? []).filter((entry) => String(entry.number).includes(input.query));
  const linkedKeys = new Set(linked.map(keyOf));
  const matchingEntries = input.entries.filter(
    (entry) =>
      ((entry.projectId === input.projectId &&
        entry.repository.trim().toLowerCase() === repository) ||
        // Hosted reads can be routed through another project's checkout for credentials.
        input.repositories?.some(
          (scope) =>
            (scope.host !== undefined || entry.projectId === scope.projectId) &&
            entry.repository.trim().toLowerCase() === scope.repository.trim().toLowerCase() &&
            (scope.host === undefined || hostOf(entry) === scope.host.toLowerCase()),
        )) &&
      String(entry.number).includes(input.query),
  );
  const uniqueEntries = new Map<string, Entry | Linked>();
  for (const entry of [...matchingEntries, ...linked]) {
    if (!uniqueEntries.has(keyOf(entry))) {
      uniqueEntries.set(keyOf(entry), entry);
    }
  }
  const isExactMatch = (entry: ComposerPullRequestMatch) => String(entry.number) === input.query;
  const isLinked = (entry: ComposerPullRequestMatch) => linkedKeys.has(keyOf(entry));
  // `.sort()` on a copy, not `.toSorted()`: this runs on Hermes, which has no ES2023 array
  // methods, and reaching for one here crashed the composer as the suggestions loaded.
  return [...uniqueEntries.values()]
    .sort(
      (left, right) =>
        Number(isExactMatch(right)) - Number(isExactMatch(left)) ||
        Number(isLinked(right)) - Number(isLinked(left)) ||
        right.updatedAt.localeCompare(left.updatedAt),
    )
    .slice(0, input.limit);
}

/** Repository scopes already linked to this thread; no workspace-wide searches. */
export function composerPullRequestRepositories(input: {
  readonly projectId: ProjectId;
  readonly repository: string;
  readonly remoteUrls: ReadonlyArray<string>;
  readonly pullRequests: ReadonlyArray<{
    readonly host: string;
    readonly repository: string;
    readonly source?: string;
  }>;
}): ReadonlyArray<Pick<PullRequestRef, "projectId" | "repository" | "host">> {
  const scopes: Array<Pick<PullRequestRef, "projectId" | "repository" | "host">> = [
    { projectId: input.projectId, repository: input.repository },
  ];
  for (const remote of input.remoteUrls) {
    const key = normalizeGitRemoteUrl(remote);
    const slash = key.indexOf("/");
    if (slash > 0)
      scopes.push({
        projectId: input.projectId,
        host: key.slice(0, slash),
        repository: key.slice(slash + 1),
      });
  }
  for (const link of input.pullRequests) {
    if (link.source !== "stack-dismissed")
      scopes.push({ projectId: input.projectId, host: link.host, repository: link.repository });
  }
  const seen = new Set<string>();
  return scopes.filter((scope) => {
    const key = `${scope.host ?? ""}/${scope.repository}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
