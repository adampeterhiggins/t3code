import type { EnvironmentId } from "@t3tools/contracts";
import { useMemo } from "react";

import type { ComposerTrigger } from "~/composer-logic";
import { githubIssueEnvironment } from "~/state/githubIssues";
import { useDebouncedValue } from "~/state/queries";
import { useEnvironmentQuery } from "~/state/query";
import type { ComposerCommandItem } from "./ComposerCommandMenu";

// Each search runs `gh` on the server, so the `#` query settles longer than pull requests do.
const GITHUB_SEARCH_DEBOUNCE_MS = 300;
const GITHUB_RESULT_LIMIT = 20;

/**
 * GitHub issues for the composer's `#` menu, shown on their own tab beside pull requests. `cwd`
 * is the checkout `gh` lists from, null when the project is not a GitHub repository. Only the
 * visible tab searches.
 */
export function useComposerGitHubIssueItems(
  environmentId: EnvironmentId,
  cwd: string | null,
  trigger: ComposerTrigger | null,
  active: boolean,
) {
  const enabled = trigger?.kind === "pull-request" && cwd !== null;
  const query = enabled && active ? trigger.query : null;
  const debouncedQuery = useDebouncedValue(query, GITHUB_SEARCH_DEBOUNCE_MS);
  const settledQuery = query === debouncedQuery ? query : null;
  const issues = useEnvironmentQuery(
    settledQuery === null || cwd === null
      ? null
      : githubIssueEnvironment.issues({
          environmentId,
          input: { cwd, ...(settledQuery.length > 0 ? { query: settledQuery } : {}) },
        }),
  );
  const items = useMemo<ComposerCommandItem[]>(
    () =>
      settledQuery === null
        ? []
        : (issues.data?.issues ?? []).slice(0, GITHUB_RESULT_LIMIT).map((issue) => ({
            id: `github-issue:${issue.url}`,
            type: "github-issue",
            url: issue.url,
            label: `#${issue.number}`,
            description: issue.title,
            authorLogin: issue.authorLogin,
            state: issue.state,
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
