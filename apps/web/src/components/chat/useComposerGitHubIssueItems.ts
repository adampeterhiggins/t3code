import type { EnvironmentId, GitHubIssueSummary } from "@t3tools/contracts";

import { githubIssueEnvironment } from "~/state/githubIssues";
import type { ComposerReferenceItem } from "./composerReferenceMenu.logic";
import { useComposerReferenceSearch } from "./useComposerReferenceSearch";

// Each search runs `gh` on the server, so the `#` query settles longer than pull requests do.
const GITHUB_SEARCH_DEBOUNCE_MS = 300;
const GITHUB_RESULT_LIMIT = 20;

function toItems(data: { readonly issues: ReadonlyArray<GitHubIssueSummary> }) {
  return data.issues.map((issue): ComposerReferenceItem => ({
    id: `github-issue:${issue.url}`,
    type: "github-issue",
    url: issue.url,
    label: `#${issue.number}`,
    description: issue.title,
    authorLogin: issue.authorLogin,
    state: issue.state,
  }));
}

/**
 * GitHub issues for the composer's `#` menu. `cwd` is the checkout `gh` lists from; the tab is
 * only enabled when the project is a GitHub repository.
 */
export function useComposerGitHubIssueItems(
  environmentId: EnvironmentId,
  cwd: string | null,
  input: { readonly enabled: boolean; readonly active: boolean; readonly query: string },
) {
  const atomFor = (query: string) =>
    githubIssueEnvironment.issues({
      environmentId,
      input: { cwd: cwd ?? "", ...(query.length > 0 ? { query } : {}) },
    });
  return useComposerReferenceSearch({
    ...input,
    enabled: input.enabled && cwd !== null,
    debounceMs: GITHUB_SEARCH_DEBOUNCE_MS,
    limit: GITHUB_RESULT_LIMIT,
    searchesEmptyQuery: true,
    atomFor,
    toItems,
  });
}
