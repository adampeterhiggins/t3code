import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  type LinearIssueReferences,
  mayHaveLinearIssueReference,
} from "@t3tools/shared/linearIssueReferences";
import { Atom } from "effect/reactivity";
import { createContext, useContext, useMemo } from "react";

import {
  markdownWithGitHubIssueLinks,
  markdownWithLinearIssueLinks,
} from "../lib/markdownDocument";
import { linearEnvironment } from "./linear";

/** The web URL of the feed's thread's GitHub repository, so `#123` can link; null otherwise. */
export const ThreadGitHubRepositoryContext = createContext<string | null>(null);

const NO_LINEAR_ISSUE_REFERENCES_ATOM = Atom.make<LinearIssueReferences | null>(null).pipe(
  Atom.withLabel("mobile-reference-links:no-linear-issue-references"),
);

/**
 * The markdown with bare Linear and GitHub issue references linked, as on the web. A bare `#123`
 * links only in the user's own text; an agent's can mean any repository it works in.
 */
export function useReferenceLinks(
  markdown: string,
  environmentId: EnvironmentId,
  options?: { readonly linkBareGitHubReferences?: boolean },
): string {
  const threadRepositoryUrl = useContext(ThreadGitHubRepositoryContext);
  const repositoryUrl = options?.linkBareGitHubReferences === true ? threadRepositoryUrl : null;
  const linear = useAtomValue(
    mayHaveLinearIssueReference(markdown)
      ? linearEnvironment.issueReferences(environmentId)
      : NO_LINEAR_ISSUE_REFERENCES_ATOM,
  );
  return useMemo(
    () =>
      markdownWithGitHubIssueLinks(markdownWithLinearIssueLinks(markdown, linear), repositoryUrl),
    [markdown, linear, repositoryUrl],
  );
}
