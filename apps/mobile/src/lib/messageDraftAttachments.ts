import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import { executeAtomQuery, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { ChatAttachment, EnvironmentId, UploadChatImageAttachment } from "@t3tools/contracts";
import * as Option from "effect/Option";

import { appAtomRegistry } from "../state/atom-registry";
import { assetEnvironment } from "../state/assets";
import { environmentSession } from "../state/session";
import { COMPOSER_ATTACHMENT_DIRECTORY } from "./composerAttachmentFiles";
import {
  removePersistedComposerAttachmentFile,
  type DraftComposerAttachment,
} from "./composerImages";
import { uuidv4 } from "./uuid";

/**
 * Drafts hold attachments the server already owns. Inline image data means the server cannot
 * take uploads, so it cannot keep the draft's images either.
 */
export function messageDraftAttachmentsFromPrepared(
  prepared: ReadonlyArray<ChatAttachment | UploadChatImageAttachment>,
): ReadonlyArray<ChatAttachment> | null {
  const attachments: ChatAttachment[] = [];
  for (const attachment of prepared) {
    if ("dataUrl" in attachment) return null;
    attachments.push(attachment);
  }
  return attachments;
}

/**
 * The local id stays the server id so the draft's context chips still point at it, and the
 * upload id lets the next send reuse the bytes the thread already holds.
 */
export function composerAttachmentFromMessageDraft(input: {
  readonly environmentId: EnvironmentId;
  readonly attachment: ChatAttachment;
  readonly fileUri: string;
}): DraftComposerAttachment {
  const { attachment, environmentId, fileUri } = input;
  const common = {
    id: attachment.id,
    name: attachment.name,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    fileUri,
    uploadedAttachmentId: attachment.id,
    uploadEnvironmentId: environmentId,
  };
  if (attachment.type === "image") {
    return { ...common, type: "image", previewUri: fileUri };
  }
  const source = "source" in attachment ? attachment.source : undefined;
  return {
    ...common,
    type: "file",
    ...(source && "_tag" in source && source._tag === "pasted-text" ? { source } : {}),
  };
}

async function attachmentDownloadUrl(
  environmentId: EnvironmentId,
  attachment: ChatAttachment,
): Promise<string> {
  const connection = appAtomRegistry.get(
    environmentSession.preparedConnectionValueAtom(environmentId),
  );
  if (Option.isNone(connection)) throw new Error("The environment is not connected.");
  const result = await executeAtomQuery(
    appAtomRegistry,
    assetEnvironment.createUrl({
      environmentId,
      input: {
        resource: {
          _tag: "attachment",
          attachmentId: attachment.id,
          fileName: attachment.name,
          mimeType: attachment.mimeType,
        },
      },
    }),
    { refresh: true, reportFailure: false, reportDefect: false },
  );
  if (result._tag !== "Success") throw squashAtomCommandFailure(result);
  const url = resolveAssetUrl(connection.value.httpBaseUrl, result.value.relativeUrl);
  if (url === null) throw new Error(`Could not download '${attachment.name}'.`);
  return url;
}

/** Copies a draft's server attachments into composer-owned files so they preview and resend. */
export async function downloadMessageDraftAttachments(
  environmentId: EnvironmentId,
  attachments: ReadonlyArray<ChatAttachment>,
): Promise<ReadonlyArray<DraftComposerAttachment>> {
  if (attachments.length === 0) return [];
  const { Directory, File, Paths } = await import("expo-file-system");
  const directory = new Directory(Paths.document, COMPOSER_ATTACHMENT_DIRECTORY);
  directory.create({ idempotent: true, intermediates: true });
  const restored: DraftComposerAttachment[] = [];
  try {
    for (const attachment of attachments) {
      const url = await attachmentDownloadUrl(environmentId, attachment);
      const safeName = attachment.name.replace(/[/\\\p{Cc}]/gu, "-") || "file";
      const file = new File(directory, `${uuidv4()}-${safeName}`);
      await File.downloadFileAsync(url, file);
      restored.push(
        composerAttachmentFromMessageDraft({ environmentId, attachment, fileUri: file.uri }),
      );
    }
  } catch (error) {
    await Promise.all(
      restored.flatMap((attachment) =>
        attachment.fileUri ? [removePersistedComposerAttachmentFile(attachment.fileUri)] : [],
      ),
    );
    throw error;
  }
  return restored;
}
