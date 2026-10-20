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
