import type {
  EnvironmentContextRecord,
  EnvironmentId,
  PreviewAnnotationPayload,
  ThreadContextRecord,
  ThreadId,
} from "@t3tools/contracts";
import { collectInlineContextIds } from "../../lib/composerContextReferences";
import {
  buildMessageContext,
  fileContextReference,
  imageContextReference,
  previewAnnotationContextId,
  reviewCommentContextId,
  terminalContextReference,
} from "../../lib/composerContextRecords";
import { releaseDraftAttachments } from "../../lib/attachmentUploadQueue";
import type { TerminalContextDraft } from "../../lib/terminalContext";
import {
  type ComposerFileAttachment,
  type ComposerImageAttachment,
  type ComposerThreadTarget,
  useComposerDraftStore,
} from "../../composerDraftStore";
import type { ReviewCommentContext } from "../../reviewCommentContext";
import { readThreadTabContextRecords, useThreadTabContextStore } from "../../threadTabContextStore";
import { readIssueContextRecords, useIssueContextStore } from "../../issueContextStore";
import {
  readRepositoryContextRecords,
  useRepositoryContextStore,
} from "../../repositoryContextStore";
import { readCheckoutContextRecords, useCheckoutContextStore } from "../../checkoutContextStore";
import { uploadComposerAttachments } from "./composerAttachmentUploads";

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

/** What a composer draft holds besides its prompt. */
export interface ComposerDraftContent {
  readonly images: ReadonlyArray<ComposerImageAttachment>;
  readonly files: ReadonlyArray<ComposerFileAttachment>;
  readonly terminalContexts: ReadonlyArray<TerminalContextDraft>;
  readonly previewAnnotations: ReadonlyArray<PreviewAnnotationPayload>;
  readonly reviewComments: ReadonlyArray<ReviewCommentContext>;
  readonly threadContexts: ReadonlyArray<ThreadContextRecord>;
  readonly environmentContexts: ReadonlyArray<EnvironmentContextRecord>;
}

/** The part of `draft` whose chips appear in `text`, such as one citation and its comment. */
export function referencedDraftContent(
  draft: ComposerDraftContent,
  text: string,
): ComposerDraftContent {
  const ids = new Set(collectInlineContextIds(text));
  const previewAnnotations = draft.previewAnnotations.filter((annotation) =>
    ids.has(previewAnnotationContextId(annotation.id)),
  );
  // An annotation's screenshot is the image that shares its id.
  const screenshotIds = new Set(previewAnnotations.map((annotation) => annotation.id));
  return {
    images: draft.images.filter(
      (image) => ids.has(imageContextReference(image).contextId) || screenshotIds.has(image.id),
    ),
    files: draft.files.filter((file) => ids.has(fileContextReference(file).contextId)),
    terminalContexts: draft.terminalContexts.filter((context) =>
      ids.has(terminalContextReference(context).contextId),
    ),
    previewAnnotations,
    reviewComments: draft.reviewComments.filter((comment) =>
      ids.has(reviewCommentContextId(comment.id)),
    ),
    threadContexts: draft.threadContexts.filter((record) => ids.has(record.contextId)),
    environmentContexts: draft.environmentContexts.filter((record) => ids.has(record.contextId)),
  };
}

/**
 * A message carrying only `text`, such as a citation sent on its own: the attachments its chips
 * name, uploaded, and the records behind its other chips. Throws an error fit to show.
 */
export async function prepareTextMessage(input: {
  readonly environmentId: EnvironmentId;
  readonly sourceThreadId: ThreadId;
  readonly draftTarget: ComposerThreadTarget;
  readonly draft: ComposerDraftContent | undefined;
  readonly text: string;
}) {
  const content = input.draft ? referencedDraftContent(input.draft, input.text) : null;
  const attachments = content ? [...content.images, ...content.files] : [];
  const uploads = await uploadComposerAttachments({
    environmentId: input.environmentId,
    attachments,
    draftTarget: input.draftTarget,
    failedUploadMessage: "Retry or remove failed uploads before sending.",
  });
  const context = buildMessageContext({
    terminalContexts: content?.terminalContexts ?? [],
    reviewComments: content?.reviewComments ?? [],
    previewAnnotations: content?.previewAnnotations ?? [],
    threadContexts: content?.threadContexts ?? [],
    environmentContexts: content?.environmentContexts ?? [],
    ...readReferencedForkContexts(input.sourceThreadId, input.text),
    attachments: attachments.map((attachment, index) => ({
      attachment,
      attachmentId: uploads[index]?.id ?? attachment.id,
    })),
  });
  return {
    attachments,
    message: { attachments: [...uploads], ...(context === undefined ? {} : { context }) },
  };
}

/**
 * Once `text` left a composer whose prompt is now `remainingPrompt`, removes the attachments only
 * it named. A send also releases their uploads; a move leaves them for the destination.
 */
export function dropTextAttachments(input: {
  readonly draftTarget: ComposerThreadTarget;
  readonly attachments: ReadonlyArray<ComposerImageAttachment | ComposerFileAttachment>;
  readonly remainingPrompt: string;
  readonly release: boolean;
}) {
  const stillReferenced = new Set(collectInlineContextIds(input.remainingPrompt));
  const dropped = input.attachments.filter(
    (attachment) =>
      !stillReferenced.has(
        attachment.type === "image"
          ? imageContextReference(attachment).contextId
          : fileContextReference(attachment).contextId,
      ),
  );
  if (input.release) releaseDraftAttachments(dropped);
  const store = useComposerDraftStore.getState();
  for (const attachment of dropped) {
    if (attachment.type === "image") store.removeImage(input.draftTarget, attachment.id);
    else store.removeFile(input.draftTarget, attachment.id);
  }
}

/** Gives another composer the records and attachments behind `text`'s chips. */
export function copyTextContent(input: {
  readonly from: { readonly threadId: ThreadId; readonly draft: ComposerDraftContent | undefined };
  readonly to: { readonly threadId: ThreadId; readonly draftTarget: ComposerThreadTarget };
  readonly text: string;
}) {
  const { from, to, text } = input;
  const { threadTabs, issues, repositories, checkouts } = readReferencedForkContexts(
    from.threadId,
    text,
  );
  for (const record of threadTabs) useThreadTabContextStore.getState().upsert(to.threadId, record);
  for (const record of issues) useIssueContextStore.getState().upsert(to.threadId, record);
  for (const record of repositories) {
    useRepositoryContextStore.getState().upsert(to.threadId, record);
  }
  for (const record of checkouts) useCheckoutContextStore.getState().upsert(to.threadId, record);
  if (!from.draft) return;
  const content = referencedDraftContent(from.draft, text);
  const store = useComposerDraftStore.getState();
  const append = { appendReference: false };
  // Each draft revokes its own preview URLs.
  store.addImages(
    to.draftTarget,
    content.images.map((image) => ({ ...image, previewUrl: URL.createObjectURL(image.file) })),
  );
  store.addFiles(to.draftTarget, [...content.files], append);
  store.addTerminalContexts(to.draftTarget, [...content.terminalContexts], append);
  for (const annotation of content.previewAnnotations) {
    store.addPreviewAnnotation(to.draftTarget, annotation, append);
  }
  for (const comment of content.reviewComments) {
    store.addReviewComment(to.draftTarget, comment, append);
  }
  store.addThreadContexts(to.draftTarget, content.threadContexts, append);
  store.addEnvironmentContexts(to.draftTarget, content.environmentContexts, append);
}

/** The `context` field of a message carrying only `text`, from the fork's thread-scoped records. */
export function referencedForkMessageContext(threadId: ThreadId, text: string) {
  const context = buildMessageContext({
    terminalContexts: [],
    reviewComments: [],
    previewAnnotations: [],
    ...readReferencedForkContexts(threadId, text),
  });
  return context === undefined ? {} : { context };
}
