import type { ThreadId } from "@t3tools/contracts";
import { collectInlineContextIds } from "../../lib/composerContextReferences";
import { buildMessageContext } from "../../lib/composerContextRecords";
import { readThreadTabContextRecords, useThreadTabContextStore } from "../../threadTabContextStore";
import { readIssueContextRecords, useIssueContextStore } from "../../issueContextStore";
import {
  readRepositoryContextRecords,
  useRepositoryContextStore,
} from "../../repositoryContextStore";
import { readCheckoutContextRecords, useCheckoutContextStore } from "../../checkoutContextStore";
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

/** The `context` field of a message carrying only `text`, such as a citation sent on its own. */
export function referencedForkMessageContext(threadId: ThreadId, text: string) {
  const context = buildMessageContext({
    terminalContexts: [],
    reviewComments: [],
    previewAnnotations: [],
    ...readReferencedForkContexts(threadId, text),
  });
  return context === undefined ? {} : { context };
}

/** Gives `to` the records behind `text`'s chips, so they still resolve in its composer. */
export function copyReferencedForkContexts(from: ThreadId, to: ThreadId, text: string) {
  const { threadTabs, issues, repositories, checkouts } = readReferencedForkContexts(from, text);
  for (const record of threadTabs) useThreadTabContextStore.getState().upsert(to, record);
  for (const record of issues) useIssueContextStore.getState().upsert(to, record);
  for (const record of repositories) useRepositoryContextStore.getState().upsert(to, record);
  for (const record of checkouts) useCheckoutContextStore.getState().upsert(to, record);
}
