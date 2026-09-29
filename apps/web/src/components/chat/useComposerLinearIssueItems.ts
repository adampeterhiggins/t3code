import type { EnvironmentId } from "@t3tools/contracts";
import { useMemo } from "react";

import type { ComposerTrigger } from "~/composer-logic";
import { linearEnvironment } from "~/state/linear";
import { useDebouncedValue } from "~/state/queries";
import { useEnvironmentQuery } from "~/state/query";
import type { ComposerCommandItem } from "./ComposerCommandMenu";

// Linear allows 30 searches a minute, so the `#` query settles longer than pull requests do.
const LINEAR_SEARCH_DEBOUNCE_MS = 300;
const LINEAR_RESULT_LIMIT = 20;
const LINEAR_IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]*-\d+$/i;

export type ComposerReferenceTab = "pull-requests" | "linear-issues";

/** The `#` menu's starting tab: an identifier (`#ENG-123`) names an issue, anything else a PR. */
export function defaultComposerReferenceTab(query: string): ComposerReferenceTab {
  return LINEAR_IDENTIFIER_PATTERN.test(query) ? "linear-issues" : "pull-requests";
}

/**
 * Linear issues for the composer's `#` menu, shown on their own tab beside pull requests. Only
 * the visible tab searches, which keeps typing within Linear's search limit.
 */
export function useComposerLinearIssueItems(
  environmentId: EnvironmentId,
  trigger: ComposerTrigger | null,
  active: boolean,
) {
  const connection = useEnvironmentQuery(
    trigger?.kind === "pull-request"
      ? linearEnvironment.connection({ environmentId, input: {} })
      : null,
  );
  const enabled = trigger?.kind === "pull-request" && connection.data?.phase === "connected";
  const query = enabled && active ? trigger.query : null;
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
            description: issue.title,
            assigneeName: issue.assigneeName,
            stateName: issue.stateName,
          })),
    [issues.data, settledQuery],
  );
  return {
    enabled,
    items,
    error: issues.error,
    isPending: query !== null && (query !== debouncedQuery || issues.isPending),
  };
}
