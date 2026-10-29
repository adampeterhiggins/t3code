import {
  findPastedComposerObjectLinks,
  findTypedComposerObjectLink,
  type ComposerObjectLink,
  parseComposerObjectLink,
} from "@t3tools/source-control-definitions/composerObjectLinks";

import {
  objectLinkChipDestination,
  type ObjectLinkDrafts,
  OBJECT_LINK_TIMEOUT_MS,
  objectLinkChipEdit,
  resolveObjectLinkWithin,
  unreadLinkChip,
} from "./composerObjectLinkChip";

import type { ComposerPromptEditorHandle } from "../ComposerPromptEditor";
import type { RefObject } from "react";
import { useLayoutEffect, useRef, useState } from "react";
import type { ScopedThreadRef, UnreadLinkContextRecord } from "@t3tools/contracts";
import { type ComposerThreadTarget, useComposerDraftStore } from "~/composerDraftStore";
import { collectComposerContextReferences } from "@t3tools/shared/composerContextReferences";
import { unreadLinkContextRecord } from "@t3tools/source-control-definitions/integrationContextRecords";
import { useStableCallback } from "~/hooks/useStableCallback";
import {
  type ResolvedComposerObjectLink,
  useResolveComposerObjectLink,
} from "./useResolveComposerObjectLink";
import { pendingDraftWork } from "./pendingDraftWork";

export type ComposerUnreadLinkActions = {
  retry: (record: UnreadLinkContextRecord) => void;
  keepAsText: (record: UnreadLinkContextRecord) => void;
};

export function useComposerObjectLinks({
  routeThreadRef,
  composerDraftTarget,
  composerDraftTargetKeyRef,
  attachmentTargetKeyRef,
  promptRef,
  composerEditorRef,
  composerFormRef,
  unreadLinkActionsRef,
  readComposerSnapshot,
  applyPromptReplacement,
}: {
  routeThreadRef: ScopedThreadRef;
  composerDraftTarget: ComposerThreadTarget;
  composerDraftTargetKeyRef: RefObject<string>;
  attachmentTargetKeyRef: RefObject<string>;
  promptRef: RefObject<string>;
  composerEditorRef: RefObject<ComposerPromptEditorHandle | null>;
  composerFormRef: RefObject<HTMLFormElement | null>;
  unreadLinkActionsRef: RefObject<ComposerUnreadLinkActions | null>;
  readComposerSnapshot: () => { expandedCursor: number };
  applyPromptReplacement: (
    start: number,
    end: number,
    text: string,
    options?: {
      expandedCursorAfterReplace?: number;
      focusEditorAfterReplace?: boolean;
    },
  ) => boolean;
}) {
  const resolveComposerObjectLink = useResolveComposerObjectLink({
    threadRef: routeThreadRef,
    draftTarget: composerDraftTarget,
  });
  const setComposerDraftPrompt = useComposerDraftStore((store) => store.setPrompt);
  // Links already converted or tried, per draft. Typing never retries them, so undoing a chip or
  // deleting one stays as text. Pasting is explicit and does.
  const handledObjectLinksRef = useRef(new Map<string, Set<string>>());
  // Links whose objects are loading, and the draft each was written in, for placeholder chips.
  const [loadingObjectLinks, setLoadingObjectLinks] = useState<
    ReadonlyArray<{ readonly url: string; readonly workKey: string }>
  >([]);
  const handledObjectLinks = () => {
    const key = composerDraftTargetKeyRef.current;
    let handled = handledObjectLinksRef.current.get(key);
    if (handled === undefined) {
      handled = new Set();
      handledObjectLinksRef.current.set(key, handled);
    }
    return handled;
  };
  // Runs when the object loads, so it reads the composer as it is then, not as it was at paste.
  const applyResolvedObjectLink = (
    started: ObjectLinkDrafts & { draftTarget: ComposerThreadTarget },
    url: string,
    index: number,
    resolved: ResolvedComposerObjectLink,
  ) => {
    const destination = objectLinkChipDestination(
      started,
      composerEditorRef.current === null
        ? null
        : { draftKey: composerDraftTargetKeyRef.current, workKey: attachmentTargetKeyRef.current },
    );
    if (destination === "drop") return;
    if (destination === "stored-draft") {
      const prompt =
        useComposerDraftStore.getState().getComposerDraft(started.draftTarget)?.prompt ?? "";
      const edit = objectLinkChipEdit(prompt, url, index, resolved.reference);
      if (edit === null) return;
      setComposerDraftPrompt(
        started.draftTarget,
        `${prompt.slice(0, edit.start)}${edit.text}${prompt.slice(edit.end)}`,
      );
      resolved.commit();
      return;
    }
    const edit = objectLinkChipEdit(promptRef.current, url, index, resolved.reference);
    if (edit === null) return;
    // Keep the caret where the user left it, shifted past the chip if it was after the link.
    const cursor = readComposerSnapshot().expandedCursor;
    const cursorAfter =
      cursor <= edit.start
        ? cursor
        : cursor >= edit.end
          ? cursor + edit.text.length - (edit.end - edit.start)
          : edit.start + edit.text.length;
    const activeElement = document.activeElement;
    const applied = applyPromptReplacement(edit.start, edit.end, edit.text, {
      expandedCursorAfterReplace: cursorAfter,
      focusEditorAfterReplace:
        activeElement instanceof Node && composerFormRef.current?.contains(activeElement) === true,
    });
    if (applied) resolved.commit();
  };
  const applyResolvedObjectLinkStable = useStableCallback(applyResolvedObjectLink);
  /** Turns a broken chip back into its link; where the link now starts, or null if there is none. */
  const unreadLinkChipToText = (record: Pick<UnreadLinkContextRecord, "contextId" | "url">) => {
    const occurrence = collectComposerContextReferences(promptRef.current).find(
      (candidate) => candidate.contextId === record.contextId,
    );
    if (occurrence === undefined) return null;
    const applied = applyPromptReplacement(occurrence.start, occurrence.end, record.url, {
      expandedCursorAfterReplace: occurrence.start + record.url.length,
    });
    return applied ? occurrence.start : null;
  };
  /** Swaps links to issues, pull requests, and repositories for the chips their attach pickers make. */
  const convertObjectLinks = (
    links: ReadonlyArray<{
      link: ComposerObjectLink;
      index: number;
    }>,
  ) => {
    const started = {
      draftTarget: composerDraftTarget,
      draftKey: composerDraftTargetKeyRef.current,
      workKey: attachmentTargetKeyRef.current,
    };
    const threadId = routeThreadRef.threadId;
    const handled = handledObjectLinks();
    for (const { link, index } of links) {
      handled.add(link.url);
      const loading = { url: link.url, workKey: started.workKey };
      setLoadingObjectLinks((current) => [...current, loading]);
      const retry = () => {
        if (composerDraftTargetKeyRef.current !== started.draftKey) return;
        unreadLinkActionsRef.current?.retry(unreadLinkContextRecord(link, "unreadable"));
      };
      pendingDraftWork.begin(started.workKey);
      void resolveObjectLinkWithin(
        resolveComposerObjectLink(link, { retry }),
        OBJECT_LINK_TIMEOUT_MS,
      )
        .then((result) => {
          if (result === "skipped") return;
          // A link that was tried and failed becomes a broken chip, so it reads differently
          // from a link nobody tried. The agent still receives the link.
          const resolved =
            typeof result === "string" ? unreadLinkChip(threadId, link, result) : result;
          applyResolvedObjectLinkStable(started, link.url, index, resolved);
        })
        .finally(() => {
          pendingDraftWork.end(started.workKey);
          setLoadingObjectLinks((current) => current.filter((entry) => entry !== loading));
        });
    }
  };
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Publish retry actions for context chips after each commit.
  useLayoutEffect(() => {
    unreadLinkActionsRef.current = {
      // Starts from the link its broken chip holds, or the link itself if it is still text.
      retry: (record) => {
        const link = parseComposerObjectLink(record.url);
        if (link === null) return;
        convertObjectLinks([{ link, index: unreadLinkChipToText(record) ?? 0 }]);
      },
      keepAsText: (record) => {
        handledObjectLinks().add(record.url);
        unreadLinkChipToText(record);
      },
    };
  });
  /** `pasteStart` is where the paste lands, so offsets into the pasted text are offsets from it. */
  const convertPastedObjectLinks = (
    pastedText: string,
    keepAsText: boolean,
    pasteStart: number,
  ) => {
    const links = findPastedComposerObjectLinks(promptRef.current, pastedText, pasteStart);
    if (links.length === 0) return;
    if (keepAsText) {
      for (const { link } of links) handledObjectLinks().add(link.url);
      return;
    }
    convertObjectLinks(links);
  };
  // Read by `onPromptChange`, which is declared before the replacement helpers this needs.
  const convertTypedObjectLink = (
    previousPrompt: string,
    nextPrompt: string,
    expandedCursor: number,
  ) => {
    // One typed character, so pastes, chip insertions, and caret moves never count.
    if (nextPrompt.length !== previousPrompt.length + 1) return;
    const typed = findTypedComposerObjectLink(nextPrompt, expandedCursor);
    if (typed === null || handledObjectLinks().has(typed.link.url)) return;
    convertObjectLinks([typed]);
  };

  return { loadingObjectLinks, convertTypedObjectLink, convertPastedObjectLinks };
}
