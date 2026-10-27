import type {
  ChatAttachment,
  ChatFileAttachment,
  ChatImageAttachment,
  ComposerContextRecord,
  MessageDraft,
} from "@t3tools/contracts";

import { attachmentContextRecord } from "../../lib/composerContextRecords";

// A newer server's attachment kinds share `type: string`, so plain comparison cannot narrow.
const isImageOrFile = (
  attachment: ChatAttachment,
): attachment is ChatImageAttachment | ChatFileAttachment =>
  attachment.type === "image" || attachment.type === "file";

/**
 * The records that bring a draft back into a composer. Drafts saved from a composer carry a
 * record per attachment; ones saved elsewhere (an agent, an older client) may not, and their
 * attachments would otherwise be dropped on open.
 */
export function messageDraftComposerRecords(
  draft: Pick<MessageDraft, "attachments" | "context">,
): ReadonlyArray<ComposerContextRecord> {
  const records = draft.context?.records ?? [];
  const boundAttachmentIds = new Set(
    records.flatMap((record) =>
      (record.kind === "image" || record.kind === "file") && "attachmentId" in record
        ? [record.attachmentId]
        : [],
    ),
  );
  const unbound = draft.attachments.flatMap((attachment) =>
    isImageOrFile(attachment)
      ? boundAttachmentIds.has(attachment.id)
        ? []
        : [attachmentContextRecord({ attachment, attachmentId: attachment.id })]
      : [],
  );
  return [...records, ...unbound];
}

export async function openMessageDraftInComposer(input: {
  targetKey: string;
  take: () => Promise<MessageDraft | null>;
  putBack: (draft: MessageDraft) => Promise<unknown>;
  readComposer: () => { targetKey: string; hasContent: boolean; hasPrompt: boolean };
  saveCurrent: () => Promise<boolean>;
  waitForRender: () => Promise<unknown>;
  load: (draft: MessageDraft) => void;
}) {
  const draft = await input.take();
  if (draft === null) return;
  if (input.readComposer().targetKey !== input.targetKey) {
    await input.putBack(draft);
    return;
  }
  if (input.readComposer().hasContent) {
    if (!(await input.saveCurrent()) || input.readComposer().hasPrompt) {
      await input.putBack(draft);
      return;
    }
    await input.waitForRender();
  }
  input.load(draft);
}
