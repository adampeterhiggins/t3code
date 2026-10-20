import type { ChatAttachment, EnvironmentId } from "@t3tools/contracts";

import type {
  ComposerFileAttachment,
  ComposerImageAttachment,
  ComposerThreadTarget,
} from "../../composerDraftStore";
import {
  awaitAttachmentUploads,
  getUploadedAttachments,
  readAttachmentUpload,
  retryAttachmentUpload,
  startAttachmentUpload,
} from "../../lib/attachmentUploadQueue";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { environmentServerConfigsAtom } from "../../state/server";
import { fileAttachmentCapabilityBlockReason } from "./composerAttachmentFiles";

/**
 * Uploads composer attachments into the environment's pending store and returns them as wire
 * attachments in the same order. For messages that are stored before they are sent, which must
 * reference uploads rather than carry inline bytes. Throws an error whose message is fit to show.
 */
export async function uploadComposerAttachments(input: {
  readonly environmentId: EnvironmentId;
  readonly attachments: ReadonlyArray<ComposerImageAttachment | ComposerFileAttachment>;
  readonly draftTarget: ComposerThreadTarget;
  readonly failedUploadMessage: string;
}): Promise<ReadonlyArray<ChatAttachment>> {
  const { environmentId, attachments, draftTarget } = input;
  if (attachments.length === 0) return [];
  // Capabilities are read again after the await: a reconnect while uploading can change them.
  const validate = () => {
    const config = appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId) ?? null;
    const supportsAttachmentUploads = config?.environment.capabilities.attachmentUploads === true;
    const reason = fileAttachmentCapabilityBlockReason({
      files: attachments.filter((attachment) => attachment.type === "file"),
      attachmentUploadsCapabilityKnown: config !== null,
      supportsAttachmentUploads,
      maxFileAttachmentBytes:
        config?.environment.capabilities.fileAttachments?.maxUploadBytes ?? null,
    });
    if (reason !== null) throw new Error(reason);
    if (config !== null && !supportsAttachmentUploads) {
      throw new Error("Update this server to keep images with a saved message.");
    }
  };
  validate();
  for (const attachment of attachments) {
    const upload =
      readAttachmentUpload(attachment.id)?.status === "failed"
        ? retryAttachmentUpload
        : startAttachmentUpload;
    upload({ environmentId, image: attachment, draftTarget });
  }
  await awaitAttachmentUploads(attachments.map((attachment) => attachment.id));
  validate();
  const uploaded = getUploadedAttachments({ environmentId, images: attachments });
  if (uploaded === null) throw new Error(input.failedUploadMessage);
  return uploaded;
}
