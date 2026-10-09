import {
  contextRepositoryCandidateLabels,
  contextRepositoryListInput,
  rankContextRepositoryCandidates,
  splitContextRepositoryOwnerQuery,
} from "@t3tools/client-runtime/context-repositories";
import type { EnvironmentId } from "@t3tools/contracts";
import { useMemo } from "react";

import type { ComposerTrigger } from "~/composer-logic";
import { useDebouncedValue } from "~/state/queries";
import { useEnvironmentQuery } from "~/state/query";
import { sourceControlEnvironment } from "~/state/sourceControl";
import type { ComposerCommandItem } from "./ComposerCommandMenu";
import { readRepositoryRecents } from "./RepositoryAttachPicker";

// Listing owners runs `gh` on the server, so the owners settle before they are fetched.
const OWNER_DEBOUNCE_MS = 300;
const REPOSITORY_RESULT_LIMIT = 20;

/**
 * Repositories for the composer's `#` menu, shown on their own tab beside pull requests. A bare
 * name searches `defaultOwners` (the repository owners setting) in their order; `owner/name`
 * searches that owner. Only the visible tab lists.
 */
export function useComposerRepositoryItems(
  environmentId: EnvironmentId,
  defaultOwners: ReadonlyArray<string>,
  trigger: ComposerTrigger | null,
  active: boolean,
) {
  const enabled = trigger?.kind === "pull-request";
  const { owners, filter } = splitContextRepositoryOwnerQuery(
    enabled && active ? trigger.query : "",
    defaultOwners,
  );
  // Keyed by text so a new array with the same owners does not refetch or reset the debounce.
  const listedOwnersKey = enabled && active && owners.length > 0 ? owners.join("\n") : null;
  const debouncedOwnersKey = useDebouncedValue(listedOwnersKey, OWNER_DEBOUNCE_MS);
  const settledOwnersKey = listedOwnersKey === debouncedOwnersKey ? listedOwnersKey : null;
  const listInput =
    settledOwnersKey === null ? null : contextRepositoryListInput(settledOwnersKey.split("\n"));
  const repositories = useEnvironmentQuery(
    listInput === null
      ? null
      : sourceControlEnvironment.contextRepositories({ environmentId, input: listInput }),
  );
  const items = useMemo<ComposerCommandItem[]>(() => {
    if (settledOwnersKey === null) return [];
    const recentRank = new Map(
      readRepositoryRecents().map((name, index) => [name, index] as const),
    );
    const candidates = repositories.data?.repositories ?? [];
    const labels = contextRepositoryCandidateLabels(candidates);
    return rankContextRepositoryCandidates(candidates, filter, recentRank)
      .slice(0, REPOSITORY_RESULT_LIMIT)
      .map((candidate) => ({
        id: `repository:${candidate.nameWithOwner}`,
        type: "repository",
        nameWithOwner: candidate.nameWithOwner,
        remoteUrl: candidate.url,
        label: labels.get(candidate.nameWithOwner) ?? candidate.nameWithOwner,
        description: candidate.description ?? "",
      }));
  }, [filter, repositories.data, settledOwnersKey]);
  return {
    enabled,
    items,
    /** Empty when neither the query nor settings name an owner to list. */
    owners,
    error: repositories.error,
    isPending:
      listedOwnersKey !== null &&
      (listedOwnersKey !== debouncedOwnersKey || repositories.isPending),
  };
}
