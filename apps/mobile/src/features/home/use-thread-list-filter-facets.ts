import { useAtomValue } from "@effect/atom-react";
import { threadSearchMatchKey } from "@t3tools/client-runtime/state/thread-search";
import { useMemo } from "react";

import { useThreadSearch } from "../../state/queries";
import { threadListEnvironmentsAtom } from "../../state/server";
import { useQueuedThreadKeys } from "../../state/use-thread-outbox";
import { useWorkspaceState } from "../../state/workspace";
import { buildThreadListFilterFacets } from "./thread-list-filter-facets";

type FacetInput = Omit<
  Parameters<typeof buildThreadListFilterFacets>[0],
  "matchedThreadKeys" | "classification"
>;

/**
 * The filter menus' choices and counts for a thread list. Searches the same environments as the
 * list does, so both read one shared search result rather than asking the server twice.
 */
export function useThreadListFilterFacets(input: FacetInput) {
  const { environments: workspaceEnvironments } = useWorkspaceState();
  const searchEnvironmentIds = useMemo(
    () =>
      workspaceEnvironments
        .filter(
          (environment) =>
            environment.connectionState === "connected" &&
            (input.environmentId === null || environment.environmentId === input.environmentId),
        )
        .map((environment) => environment.environmentId),
    [input.environmentId, workspaceEnvironments],
  );
  const threadSearch = useThreadSearch(searchEnvironmentIds, input.searchQuery);
  const matchedThreadKeys = useMemo(
    () => new Set(threadSearch.matches.map(threadSearchMatchKey)),
    [threadSearch.matches],
  );
  const listEnvironments = useAtomValue(threadListEnvironmentsAtom);
  const queuedThreadKeys = useQueuedThreadKeys();
  const {
    threads,
    projects,
    projectGroupingMode,
    organisations,
    environmentId,
    projectKey,
    organisationKeys,
    pages,
    searchQuery,
  } = input;
  return useMemo(
    () =>
      buildThreadListFilterFacets({
        threads,
        projects,
        projectGroupingMode,
        organisations,
        environmentId,
        projectKey,
        organisationKeys,
        pages,
        searchQuery,
        matchedThreadKeys,
        classification: {
          now: new Date().toISOString(),
          settlementEnvironmentIds: listEnvironments.settlementEnvironmentIds,
          snoozeEnvironmentIds: listEnvironments.snoozeEnvironmentIds,
          hidingEnvironmentIds: listEnvironments.hidingEnvironmentIds,
          groupEnvironmentIds: listEnvironments.groupEnvironmentIds,
          groupsShownInThreads: listEnvironments.groupsShownInThreads,
          queuedThreadKeys,
        },
      }),
    [
      environmentId,
      listEnvironments,
      matchedThreadKeys,
      organisationKeys,
      organisations,
      pages,
      projectGroupingMode,
      projectKey,
      projects,
      queuedThreadKeys,
      searchQuery,
      threads,
    ],
  );
}
