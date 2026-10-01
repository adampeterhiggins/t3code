import {
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

// Listing an owner runs `gh` on the server, so the owner settles before it is fetched.
const OWNER_DEBOUNCE_MS = 300;
const REPOSITORY_RESULT_LIMIT = 20;

/**
 * Repositories for the composer's `#` menu, shown on their own tab beside pull requests. A bare
 * name searches `defaultOwner` (the repository owner setting); `owner/name` searches that owner.
 * Only the visible tab lists.
 */
export function useComposerRepositoryItems(
  environmentId: EnvironmentId,
  defaultOwner: string,
  trigger: ComposerTrigger | null,
  active: boolean,
) {
  const enabled = trigger?.kind === "pull-request";
  const { owner, filter } = splitContextRepositoryOwnerQuery(
    enabled && active ? trigger.query : "",
    defaultOwner,
  );
  const listedOwner = enabled && active && owner.length > 0 ? owner : null;
  const debouncedOwner = useDebouncedValue(listedOwner, OWNER_DEBOUNCE_MS);
  const settledOwner = listedOwner === debouncedOwner ? listedOwner : null;
  const repositories = useEnvironmentQuery(
    settledOwner === null
      ? null
      : sourceControlEnvironment.contextRepositories({
          environmentId,
          input: { owner: settledOwner },
        }),
  );
  const items = useMemo<ComposerCommandItem[]>(() => {
    if (settledOwner === null) return [];
    const recentRank = new Map(
      readRepositoryRecents().map((name, index) => [name, index] as const),
    );
    return rankContextRepositoryCandidates(
      repositories.data?.repositories ?? [],
      filter,
      recentRank,
    )
      .slice(0, REPOSITORY_RESULT_LIMIT)
      .map((candidate) => ({
        id: `repository:${candidate.nameWithOwner}`,
        type: "repository",
        nameWithOwner: candidate.nameWithOwner,
        remoteUrl: candidate.url,
        label: candidate.nameWithOwner,
        description: candidate.description ?? "",
      }));
  }, [filter, repositories.data, settledOwner]);
  return {
    enabled,
    items,
    /** Empty when neither the query nor settings name an owner to list. */
    owner,
    error: repositories.error,
    isPending: listedOwner !== null && (listedOwner !== debouncedOwner || repositories.isPending),
  };
}
