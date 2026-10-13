import type { ProjectId, PullRequestRef } from "@t3tools/contracts";
import { parseChangeRequestUrl } from "./changeRequestUrl.ts";
import { normalizeGitRemoteUrl } from "./git.ts";

export interface ComposerPullRequestMatch {
  readonly number: number;
  readonly projectId: string;
  readonly repository: string;
  readonly updatedAt: string;
  readonly host?: string;
  readonly url?: string;
}

/**
 * Pull requests matching the numeric fragment typed after `#`, de-duplicated. An exact number
 * match always outranks a substring match so the result limit can never drop the pull request
 * the user typed in full; the rest stay newest first.
 */
export function filterComposerPullRequestMatches<Entry extends ComposerPullRequestMatch>(input: {
  readonly entries: ReadonlyArray<Entry>;
  readonly projectId: string;
  readonly repository: string;
  readonly repositories?: ReadonlyArray<Pick<PullRequestRef, "projectId" | "repository" | "host">>;
  readonly query: string;
  readonly limit: number;
}): ReadonlyArray<Entry> {
  const repository = input.repository.trim().toLowerCase();
  const hostOf = (entry: Entry) => {
    if (entry.host !== undefined) return entry.host.toLowerCase();
    const link = parseChangeRequestUrl(entry.url ?? "");
    return link?.authority ?? link?.host;
  };
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
  const uniqueEntries = new Map<string, Entry>();
  for (const entry of matchingEntries) {
    const key = `${hostOf(entry) ?? ""}:${entry.repository.trim().toLowerCase()}:${entry.number}`;
    if (!uniqueEntries.has(key)) {
      uniqueEntries.set(key, entry);
    }
  }
  const isExactMatch = (entry: Entry) => String(entry.number) === input.query;
  // `.sort()` on a copy, not `.toSorted()`: this runs on Hermes, which has no ES2023 array
  // methods, and reaching for one here crashed the composer as the suggestions loaded.
  return [...uniqueEntries.values()]
    .sort((left, right) => {
      const exactness = Number(isExactMatch(right)) - Number(isExactMatch(left));
      return exactness !== 0 ? exactness : right.updatedAt.localeCompare(left.updatedAt);
    })
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
