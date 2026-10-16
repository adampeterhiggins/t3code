import type {
  CheckoutContextRecord,
  RepositoryContextRecord,
  ThreadId,
  ThreadTabContextRecord,
} from "@t3tools/contracts";
import { useCheckoutContextStore } from "~/checkoutContextStore";
import { randomUUID } from "~/lib/utils";
import { useIssueContextStore, type IssueContextRecord } from "~/issueContextStore";
import { useRepositoryContextStore } from "~/repositoryContextStore";
import { useThreadTabContextStore } from "~/threadTabContextStore";
import { toKindScopedComposerContextId } from "@t3tools/shared/composerContextReferences";

/** Imports a captured snapshot for paste or stash restore, preserving conflicting payloads. */
export function importComposerSnapshotRecord(
  threadId: ThreadId,
  record:
    | RepositoryContextRecord
    | ThreadTabContextRecord
    | CheckoutContextRecord
    | IssueContextRecord,
  conflicts: boolean,
) {
  const imported = conflicts
    ? { ...record, contextId: toKindScopedComposerContextId(record.kind, randomUUID()) }
    : record;
  if (imported.kind === "repository") {
    useRepositoryContextStore.getState().upsert(threadId, imported);
  } else if (imported.kind === "checkout") {
    useCheckoutContextStore.getState().upsert(threadId, imported);
  } else if (imported.kind === "thread-tab") {
    useThreadTabContextStore.getState().upsert(threadId, imported);
  } else {
    useIssueContextStore.getState().upsert(threadId, imported);
  }
  return imported.contextId;
}

/** Releases snapshots after their prompt has been safely moved to the stash. */
export function clearComposerSnapshotRecords(threadId: ThreadId) {
  useRepositoryContextStore.getState().clear(threadId);
  useThreadTabContextStore.getState().clear(threadId);
  useCheckoutContextStore.getState().clear(threadId);
  useIssueContextStore.getState().clear(threadId);
}
