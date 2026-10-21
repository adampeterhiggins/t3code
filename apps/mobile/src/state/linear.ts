import { useAtomValue } from "@effect/atom-react";
import { createLinearEnvironmentAtoms } from "@t3tools/client-runtime/state/linear";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  type LinearIssueReferences,
  mayHaveLinearIssueReference,
} from "@t3tools/shared/linearIssueReferences";
import { Atom } from "effect/reactivity";
import { useMemo } from "react";

import { connectionAtomRuntime } from "../connection/runtime";
import { markdownWithLinearIssueLinks } from "../lib/markdownDocument";

export const linearEnvironment = createLinearEnvironmentAtoms(connectionAtomRuntime);

const NO_LINEAR_ISSUE_REFERENCES_ATOM = Atom.make<LinearIssueReferences | null>(null).pipe(
  Atom.withLabel("mobile-linear:no-issue-references"),
);

/** The markdown with bare issue identifiers linked, once the environment's Linear teams load. */
export function useLinearIssueLinks(markdown: string, environmentId: EnvironmentId): string {
  const references = useAtomValue(
    mayHaveLinearIssueReference(markdown)
      ? linearEnvironment.issueReferences(environmentId)
      : NO_LINEAR_ISSUE_REFERENCES_ATOM,
  );
  return useMemo(() => markdownWithLinearIssueLinks(markdown, references), [markdown, references]);
}
