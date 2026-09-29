import type { EnvironmentId } from "@t3tools/contracts";
import { useMemo } from "react";

import type { ComposerTrigger } from "~/composer-logic";
import { linearEnvironment } from "~/state/linear";
import { useDebouncedValue } from "~/state/queries";
import { useEnvironmentQuery } from "~/state/query";
import type { ComposerCommandItem } from "./ComposerCommandMenu";

// Linear allows 30 searches a minute, so the `#` query settles longer than pull requests do.
const LINEAR_SEARCH_DEBOUNCE_MS = 300;
const LINEAR_RESULT_LIMIT = 8;
const LINEAR_IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]*-\d+$/i;

/**
 * Linear issues for the composer's `#` menu, beside pull requests. A bare number is a pull
 * request, so it skips Linear; an identifier (`#ENG-123`) ranks its issue first.
 */
export function useComposerLinearIssueItems(
  environmentId: EnvironmentId,
  trigger: ComposerTrigger | null,
) {
  const connection = useEnvironmentQuery(
    trigger?.kind === "pull-request"
      ? linearEnvironment.connection({ environmentId, input: {} })
      : null,
  );
  const enabled = trigger?.kind === "pull-request" && connection.data?.phase === "connected";
  const query = enabled && !/^\d+$/.test(trigger.query) ? trigger.query : null;
  const debouncedQuery = useDebouncedValue(query, LINEAR_SEARCH_DEBOUNCE_MS);
  const settledQuery = query === debouncedQuery ? query : null;
  const issues = useEnvironmentQuery(
    settledQuery === null
      ? null
      : linearEnvironment.issues({ environmentId, input: { query: settledQuery } }),
  );
  const items = useMemo<ComposerCommandItem[]>(
    () =>
      settledQuery === null
        ? []
        : (issues.data?.issues ?? []).slice(0, LINEAR_RESULT_LIMIT).map((issue) => ({
            id: `linear-issue:${issue.id}`,
            type: "linear-issue",
            issueId: issue.id,
            label: issue.identifier,
            description: `${issue.title} · ${issue.stateName}`,
          })),
    [issues.data, settledQuery],
  );
  return {
    enabled,
    items,
    /** Ranks Linear ahead of pull requests when the query names an issue. */
    leadsResults: query !== null && LINEAR_IDENTIFIER_PATTERN.test(query),
    isPending: query !== null && (query !== debouncedQuery || issues.isPending),
  };
}
