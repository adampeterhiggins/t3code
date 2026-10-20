import {
  createMessageDraftEnvironmentAtoms,
  messageDraftsForThread,
} from "@t3tools/client-runtime/state/message-drafts";
import type { EnvironmentId, MessageDraft, ThreadId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { useAtomValue } from "@effect/atom-react";

import { connectionAtomRuntime } from "../connection/runtime";
import { scopedThreadKey } from "../lib/scopedEntities";
import { environmentPresentations } from "./presentation";
import { useEnvironmentQuery } from "./query";

export const messageDraftEnvironment = createMessageDraftEnvironmentAtoms(connectionAtomRuntime);

const EMPTY_COUNTS: ReadonlyMap<string, number> = new Map();

/** Draft count per scoped thread key, for every connected environment. */
export function countMessageDraftsByThread(
  environments: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly drafts: ReadonlyArray<Pick<MessageDraft, "threadId">> | null;
  }>,
): ReadonlyMap<string, number> {
  let counts: Map<string, number> | null = null;
  for (const { environmentId, drafts } of environments) {
    for (const draft of drafts ?? []) {
      counts ??= new Map();
      const key = scopedThreadKey(environmentId, draft.threadId);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts ?? EMPTY_COUNTS;
}

// One drafts stream per connected environment, shared with the thread tray's reader.
export const messageDraftCountsAtom = Atom.make((get) => {
  const environments: Array<{
    environmentId: EnvironmentId;
    drafts: ReadonlyArray<MessageDraft> | null;
  }> = [];
  for (const [environmentId, presentation] of get(environmentPresentations.presentationsAtom)) {
    if (presentation.connection.phase !== "connected") continue;
    const result = get(messageDraftEnvironment.drafts({ environmentId, input: {} }));
    environments.push({ environmentId, drafts: Option.getOrNull(AsyncResult.value(result)) });
  }
  return countMessageDraftsByThread(environments);
}).pipe(Atom.withLabel("mobile-message-drafts:counts"));

export function useMessageDraftCounts(): ReadonlyMap<string, number> {
  return useAtomValue(messageDraftCountsAtom);
}

/** The thread's drafts, newest first; null until the stream answers, and on older servers. */
export function useThreadMessageDraftList(
  environmentId: EnvironmentId,
  threadId: ThreadId,
): ReadonlyArray<MessageDraft> | null {
  const drafts = useEnvironmentQuery(
    messageDraftEnvironment.drafts({ environmentId, input: {} }),
  ).data;
  return drafts === null ? null : messageDraftsForThread(drafts, threadId);
}

/** Opening and sending race other devices; say so instead of a raw server message. */
export function messageDraftFailureMessage(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    error._tag === "MessageDraftError" &&
    "reason" in error &&
    error.reason === "not-found"
  ) {
    return "This draft was already opened or sent on another device.";
  }
  return error instanceof Error && error.message.trim().length > 0 ? error.message : "Try again.";
}
