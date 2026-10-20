import { useAtomValue } from "@effect/atom-react";
import {
  createMessageDraftEnvironmentAtoms,
  messageDraftsForThread,
} from "@t3tools/client-runtime/state/message-drafts";
import type {
  EnvironmentId,
  MessageDraft,
  MessageDraftOrigin,
  ScopedThreadRef,
  ThreadId,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { isElectron } from "../env";

export const messageDraftEnvironment = createMessageDraftEnvironmentAtoms(connectionAtomRuntime);

export const LOCAL_MESSAGE_DRAFT_ORIGIN: MessageDraftOrigin = isElectron ? "desktop" : "web";

const EMPTY_DRAFTS: ReadonlyArray<MessageDraft> = [];
const EMPTY_DRAFTS_ATOM = Atom.make(EMPTY_DRAFTS).pipe(Atom.withLabel("web-message-drafts:empty"));

/**
 * One thread's drafts, cut from the environment's single stream. The list keeps its identity
 * while the thread's draft ids do not change, so a sidebar row re-renders only for its own
 * thread's drafts, not for every save anywhere in the environment.
 */
const threadDraftsAtom = Atom.family((key: string) => {
  const { environmentId, threadId } = JSON.parse(key) as {
    readonly environmentId: EnvironmentId;
    readonly threadId: ThreadId;
  };
  let previous = EMPTY_DRAFTS;
  return Atom.make((get) => {
    const all = Option.getOrUndefined(
      AsyncResult.value(get(messageDraftEnvironment.drafts({ environmentId, input: {} }))),
    );
    const next = messageDraftsForThread(all, threadId);
    if (
      next.length === previous.length &&
      next.every((draft, index) => draft.id === previous[index]?.id)
    ) {
      return previous;
    }
    previous = next.length === 0 ? EMPTY_DRAFTS : next;
    return previous;
  }).pipe(Atom.withLabel(`web-message-drafts:${key}`));
});

/** The thread's saved drafts, newest first. Empty until the environment answers. */
export function useThreadMessageDrafts(
  threadRef: ScopedThreadRef | null,
): ReadonlyArray<MessageDraft> {
  return useAtomValue(
    threadRef === null
      ? EMPTY_DRAFTS_ATOM
      : threadDraftsAtom(
          JSON.stringify({ environmentId: threadRef.environmentId, threadId: threadRef.threadId }),
        ),
  );
}
