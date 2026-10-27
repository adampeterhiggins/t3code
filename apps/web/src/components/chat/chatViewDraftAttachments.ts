import type { ComposerThreadTarget } from "../../composerDraftStore";
import { type ScopedThreadRef, type ThreadId } from "@t3tools/contracts";
import { cloneComposerImageForRetry } from "../ChatView.logic";
import { randomUUID } from "~/lib/utils";
import { readCheckoutContextRecords, useCheckoutContextStore } from "../../checkoutContextStore";
import { readIssueContextRecords } from "../../issueContextStore";
import {
  readRepositoryContextRecords,
  useRepositoryContextStore,
} from "../../repositoryContextStore";
import { readThreadTabContextRecords, useThreadTabContextStore } from "../../threadTabContextStore";
import { useIssueContextStore } from "~/issueContextStore";
import { type ChatMessage } from "../../types";
import {
  type ComposerFileAttachment,
  type ComposerImageAttachment,
  useComposerDraftStore,
  DraftId,
} from "../../composerDraftStore";

/** Puts a sent message's downloaded attachments back into a composer draft, in their order. */
export function restoreMessageAttachments(
  target: ScopedThreadRef | DraftId,
  message: ChatMessage,
  files: ReadonlyArray<File>,
) {
  const images: ComposerImageAttachment[] = [];
  const restoredFiles: ComposerFileAttachment[] = [];
  files.forEach((file, index) => {
    const attachment = {
      id: randomUUID(),
      name: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      file,
    };
    if (message.attachments?.[index]?.type === "image") {
      images.push({ ...attachment, type: "image", previewUrl: URL.createObjectURL(file) });
    } else {
      restoredFiles.push({ ...attachment, type: "file" });
    }
  });
  const store = useComposerDraftStore.getState();
  store.addImages(target, images, { allowDuplicates: true });
  store.addFiles(target, restoredFiles, { allowDuplicates: true });
}
// Copies everything of this tab's draft but its text into `tabRef`: the records its chips
// resolve against, with ids kept, and its images, files, and other attached context.
export function copyChatViewDraftAttachments(
  sourceThreadId: ThreadId,
  composerDraftTarget: ComposerThreadTarget,
  tabRef: ScopedThreadRef,
) {
  const store = useComposerDraftStore.getState();
  const draft = store.getComposerDraft(composerDraftTarget);
  for (const record of readThreadTabContextRecords(sourceThreadId)) {
    useThreadTabContextStore.getState().upsert(tabRef.threadId, record);
  }
  for (const record of readIssueContextRecords(sourceThreadId)) {
    useIssueContextStore.getState().upsert(tabRef.threadId, record);
  }
  for (const record of readRepositoryContextRecords(sourceThreadId)) {
    useRepositoryContextStore.getState().upsert(tabRef.threadId, record);
  }
  for (const record of readCheckoutContextRecords(sourceThreadId)) {
    useCheckoutContextStore.getState().upsert(tabRef.threadId, record);
  }
  if (draft) {
    store.addImages(tabRef, draft.images.map(cloneComposerImageForRetry), {
      allowDuplicates: true,
    });
    store.addFiles(tabRef, draft.files, { allowDuplicates: true });
    store.setTerminalContexts(tabRef, draft.terminalContexts);
    store.setPreviewAnnotations(tabRef, draft.previewAnnotations);
    store.setReviewComments(tabRef, draft.reviewComments);
  }
}
