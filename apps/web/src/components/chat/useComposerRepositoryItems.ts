import {
  contextRepositoryCandidateLabels,
  contextRepositoryListInput,
  rankContextRepositoryCandidates,
  splitContextRepositoryOwnerQuery,
} from "@t3tools/client-runtime/context-repositories";
import type { EnvironmentId } from "@t3tools/contracts";
import { useMemo, useState } from "react";

import { useDebouncedValue } from "~/state/queries";
import { useEnvironmentQuery } from "~/state/query";
import { sourceControlEnvironment } from "~/state/sourceControl";
import type { ComposerReferenceItem } from "./composerReferenceMenu.logic";
import { readRepositoryRecents } from "./RepositoryAttachPicker";

// Listing owners runs `gh` on the server, so the owners settle before they are fetched.
const OWNER_DEBOUNCE_MS = 300;
const REPOSITORY_RESULT_LIMIT = 20;

/**
 * Repositories for the composer's `#` menu. A bare name filters `defaultOwners` (the repository
 * owners setting) locally; `owner/name` lists that owner. The default owners list as soon as `#`
 * opens, so a bare name never waits on `gh`, and while a typed owner settles the last listing
 * stays visible.
 */
export function useComposerRepositoryItems(
  environmentId: EnvironmentId,
  defaultOwners: ReadonlyArray<string>,
  input: { readonly enabled: boolean; readonly active: boolean; readonly query: string },
) {
  const { enabled, active } = input;
  const { owners, filter } = splitContextRepositoryOwnerQuery(
    enabled && active ? input.query : "",
    defaultOwners,
  );
  // Keyed by text so a new array with the same owners does not refetch or reset the debounce.
  const listedOwnersKey = enabled && owners.length > 0 ? owners.join("\n") : null;
  const debouncedOwnersKey = useDebouncedValue(listedOwnersKey, OWNER_DEBOUNCE_MS);
  // The default owners list without waiting, since they do not change as the user types.
  const settledOwnersKey =
    listedOwnersKey === debouncedOwnersKey || listedOwnersKey === defaultOwners.join("\n")
      ? listedOwnersKey
      : null;
  const listInput =
    settledOwnersKey === null ? null : contextRepositoryListInput(settledOwnersKey.split("\n"));
  const repositories = useEnvironmentQuery(
    listInput === null
      ? null
      : sourceControlEnvironment.contextRepositories({ environmentId, input: listInput }),
  );
  const freshCandidates =
    settledOwnersKey === null ? null : (repositories.data?.repositories ?? null);
  const [retainedCandidates, setRetainedCandidates] = useState(freshCandidates);
  if (freshCandidates !== null && freshCandidates !== retainedCandidates) {
    setRetainedCandidates(freshCandidates);
  }
  const ownersKey = owners.join("\n");
  const items = useMemo<ReadonlyArray<ComposerReferenceItem>>(() => {
    if (!enabled || !active || ownersKey.length === 0) return [];
    const ownerSet = new Set(ownersKey.toLowerCase().split("\n"));
    // A listing for other owners is still settling; keep showing rows that fit the typed owner.
    const candidates = (freshCandidates ?? retainedCandidates ?? []).filter((candidate) =>
      ownerSet.has(candidate.nameWithOwner.split("/")[0]?.toLowerCase() ?? ""),
    );
    const recentRank = new Map(
      readRepositoryRecents().map((name, index) => [name, index] as const),
    );
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
  }, [active, enabled, filter, freshCandidates, ownersKey, retainedCandidates]);
  return {
    items,
    /** Empty when neither the query nor settings name an owner to list. */
    owners,
    error: enabled && active ? repositories.error : null,
    isPending:
      enabled &&
      active &&
      listedOwnersKey !== null &&
      (freshCandidates === null || repositories.isPending),
  };
}
