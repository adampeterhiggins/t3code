import type { ThreadId } from "@t3tools/contracts";
import { collectInlineContextIds } from "../../lib/composerContextReferences";
import { readThreadTabContextRecords } from "../../threadTabContextStore";
import { readIssueContextRecords } from "../../issueContextStore";
import { readRepositoryContextRecords } from "../../repositoryContextStore";
import { readCheckoutContextRecords } from "../../checkoutContextStore";
/**
 * The fork's thread-scoped context records (chat summaries, issues, Slack/Notion, repositories)
 * whose chips appear in `text`. They live in their own stores rather than the composer draft.
 */
export function readReferencedForkContexts(threadId: ThreadId, text: string) {
  const referencedContextIds = new Set(collectInlineContextIds(text));
  const referenced = <
    T extends {
      readonly contextId: string;
    },
  >(
    records: ReadonlyArray<T>,
  ) => records.filter((record) => referencedContextIds.has(record.contextId));
  return {
    threadTabs: referenced(readThreadTabContextRecords(threadId)),
    issues: referenced(readIssueContextRecords(threadId)),
    repositories: referenced(readRepositoryContextRecords(threadId)),
    checkouts: referenced(readCheckoutContextRecords(threadId)),
  };
}
