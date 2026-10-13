import {
  composerPullRequestRepositories,
  filterComposerPullRequestMatches,
} from "@t3tools/shared/composerPullRequestMatches";
import type {
  EnvironmentId,
  ProjectId,
  PullRequestListEntry,
  PullRequestListInput,
  ThreadPullRequestLink,
} from "@t3tools/contracts";
import { useMemo, useState } from "react";

import { pullRequestEnvironment, usePullRequestList } from "~/state/pullRequests";
import { useDebouncedValue } from "~/state/queries";
import { useAtomValue } from "@effect/atom-react";
import { createComposerPullRequestLookupAtomFamily } from "@t3tools/client-runtime/state/pull-requests";
import {
  matchesPullRequestQuery,
  rankPullRequestMatches,
} from "../pullRequest/pullRequestList.logic";
import type { ComposerReferenceItem } from "./composerReferenceMenu.logic";

const exactLookup = createComposerPullRequestLookupAtomFamily(pullRequestEnvironment.detail);

const PULL_REQUEST_SEARCH_DEBOUNCE_MS = 180;
const PULL_REQUEST_LIST_LIMIT = 99;
const PULL_REQUEST_RESULT_LIMIT = 12;

function entryKey(entry: PullRequestListEntry): string {
  return `${entry.projectId}:${entry.repository.trim().toLowerCase()}:${entry.number}`;
}

type PullRequestRow = Pick<
  PullRequestListEntry,
  | "projectId"
  | "repository"
  | "number"
  | "title"
  | "url"
  | "headBranch"
  | "baseBranch"
  | "state"
  | "isDraft"
>;

function toItem(entry: PullRequestRow): ComposerReferenceItem {
  return {
    id: `pull-request:${entry.url}`,
    type: "pull-request",
    pullRequest: {
      number: entry.number,
      title: entry.title,
      url: entry.url,
      headBranch: entry.headBranch,
      baseBranch: entry.baseBranch,
      state: entry.state,
      isDraft: entry.isDraft,
    },
    label: `#${entry.number}`,
    description: `${entry.repository} · ${entry.title}`,
  };
}

/**
 * Pull requests for the composer's `#` menu. The project's recent pull requests load as soon as
 * `#` opens and every keystroke filters them locally, so the tab never waits on the network to
 * show rows. A word also searches the host once typing settles, and a number the host does not
 * list yet is fetched directly.
 */
export function useComposerPullRequestItems(input: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId | null;
  readonly repository: string | null;
  readonly remoteUrls: ReadonlyArray<string>;
  readonly pullRequests: ReadonlyArray<ThreadPullRequestLink>;
  readonly enabled: boolean;
  readonly active: boolean;
  readonly query: string;
}) {
  const { environmentId, projectId, repository, query } = input;
  const enabled = input.enabled && projectId !== null && repository !== null;
  const isNumberQuery = /^\d*$/u.test(query);
  const textQuery = enabled && input.active && !isNumberQuery ? query : null;
  const debouncedTextQuery = useDebouncedValue(textQuery, PULL_REQUEST_SEARCH_DEBOUNCE_MS);
  const settledTextQuery = textQuery === debouncedTextQuery ? textQuery : null;

  const baseTargets = useMemo(
    () =>
      enabled && projectId !== null
        ? [
            {
              environmentId,
              input: {
                state: "all",
                projectId,
                limit: PULL_REQUEST_LIST_LIMIT,
              } satisfies PullRequestListInput,
            },
          ]
        : [],
    [enabled, environmentId, projectId],
  );
  const searchTargets = useMemo(
    () =>
      settledTextQuery !== null && projectId !== null
        ? [
            {
              environmentId,
              input: {
                state: "all",
                projectId,
                limit: PULL_REQUEST_LIST_LIMIT,
                query: settledTextQuery,
              } satisfies PullRequestListInput,
            },
          ]
        : [],
    [environmentId, projectId, settledTextQuery],
  );
  const base = usePullRequestList(baseTargets);
  const search = usePullRequestList(searchTargets);

  const number =
    enabled && input.active && query.length > 0 && isNumberQuery ? Number(query) : null;
  const debouncedNumber = useDebouncedValue(number, PULL_REQUEST_SEARCH_DEBOUNCE_MS);
  const settledNumber =
    number !== null && number === debouncedNumber && Number.isSafeInteger(number) && number > 0
      ? number
      : null;
  const repositories = useMemo(
    () =>
      projectId !== null && repository !== null
        ? composerPullRequestRepositories({
            projectId,
            repository,
            remoteUrls: input.remoteUrls,
            pullRequests: input.pullRequests,
          })
        : [],
    [projectId, repository, input.remoteUrls, input.pullRequests],
  );
  const exactTargets =
    settledNumber === null
      ? []
      : repositories
          .filter(
            (scope) =>
              !base.data?.entries.some(
                (entry) =>
                  entry.projectId === scope.projectId &&
                  entry.repository.toLowerCase() === scope.repository.toLowerCase() &&
                  (scope.host === undefined ||
                    entry.host.toLowerCase() === scope.host.toLowerCase()) &&
                  entry.number === settledNumber,
              ),
          )
          .map((scope) => ({ environmentId, input: { ...scope, number: settledNumber } }));
  const exact = useAtomValue(exactLookup(JSON.stringify(exactTargets)));

  // The last host search, kept so the next keystroke narrows it instead of dropping it.
  const freshSearch = settledTextQuery === null ? null : search.data;
  const [retainedSearch, setRetainedSearch] = useState(freshSearch);
  if (freshSearch !== null && freshSearch !== retainedSearch) setRetainedSearch(freshSearch);

  const items = useMemo<ReadonlyArray<ComposerReferenceItem>>(() => {
    if (!enabled || !input.active || projectId === null || repository === null) return [];
    const baseEntries = base.data?.entries ?? [];
    if (isNumberQuery) {
      const exactEntries = exact.entries.filter((entry) => entry.number === number);
      return filterComposerPullRequestMatches({
        entries: [...exactEntries, ...baseEntries],
        projectId,
        repository,
        repositories,
        query,
        limit: PULL_REQUEST_RESULT_LIMIT,
      }).map(toItem);
    }
    const normalizedRepository = repository.trim().toLowerCase();
    const inScope = (entry: PullRequestListEntry) =>
      entry.projectId === projectId &&
      entry.repository.trim().toLowerCase() === normalizedRepository;
    const searchData = freshSearch ?? retainedSearch;
    // A host that searches on its side may match on text the entry does not carry.
    const hostSearched = (entry: PullRequestListEntry) =>
      freshSearch !== null &&
      freshSearch.providers.some(
        (provider) => provider.host === entry.host && provider.searchesOnHost,
      );
    const seen = new Set<string>();
    const candidates = [...(searchData?.entries ?? []), ...baseEntries].filter((entry) => {
      const key = entryKey(entry);
      if (seen.has(key) || !inScope(entry)) return false;
      seen.add(key);
      return hostSearched(entry) || matchesPullRequestQuery(entry, query);
    });
    return rankPullRequestMatches(candidates, query)
      .slice(0, PULL_REQUEST_RESULT_LIMIT)
      .map(toItem);
  }, [
    base.data,
    enabled,
    exact.entries,
    repositories,
    freshSearch,
    input.active,
    isNumberQuery,
    number,
    projectId,
    query,
    repository,
    retainedSearch,
  ]);

  const failed =
    base.error !== null ||
    base.data?.errors.some((error) => error.projectId === projectId) === true;
  return {
    items,
    /** The project's recent pull requests, for tab prediction. */
    preloaded: useMemo(
      () =>
        enabled
          ? (base.data?.entries ?? []).filter((entry) => entry.projectId === projectId).map(toItem)
          : [],
      [base.data, enabled, projectId],
    ),
    available: projectId !== null && repository !== null,
    failed,
    isPending:
      enabled &&
      input.active &&
      (base.isPending ||
        (textQuery !== null && (settledTextQuery === null || search.isPending)) ||
        (number !== null && number !== debouncedNumber) ||
        exact.isPending),
  };
}
