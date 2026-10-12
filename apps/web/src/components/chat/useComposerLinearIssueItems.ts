import type { EnvironmentId, LinearIssueSummary } from "@t3tools/contracts";
import { useCallback } from "react";

import { linearEnvironment } from "~/state/linear";
import type { ComposerReferenceItem } from "./composerReferenceMenu.logic";
import { useComposerReferenceSearch } from "./useComposerReferenceSearch";

// Linear allows 30 searches a minute, so the `#` query settles longer than pull requests do.
const LINEAR_SEARCH_DEBOUNCE_MS = 300;
const LINEAR_RESULT_LIMIT = 20;

function toItems(data: { readonly issues: ReadonlyArray<LinearIssueSummary> }) {
  return data.issues.map((issue): ComposerReferenceItem => ({
    id: `linear-issue:${issue.id}`,
    type: "linear-issue",
    issueId: issue.id,
    label: issue.identifier,
    description: issue.title,
    assigneeName: issue.assigneeName,
    stateName: issue.stateName,
  }));
}

/** Linear issues for the composer's `#` menu; an empty query lists the user's assigned issues. */
export function useComposerLinearIssueItems(
  environmentId: EnvironmentId,
  input: { readonly enabled: boolean; readonly active: boolean; readonly query: string },
) {
  const atomFor = useCallback(
    (query: string) => linearEnvironment.issues({ environmentId, input: { query } }),
    [environmentId],
  );
  return useComposerReferenceSearch({
    ...input,
    debounceMs: LINEAR_SEARCH_DEBOUNCE_MS,
    limit: LINEAR_RESULT_LIMIT,
    searchesEmptyQuery: true,
    atomFor,
    toItems,
  });
}
