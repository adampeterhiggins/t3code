import { useAtomValue } from "@effect/atom-react";
import { settlePromise, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type {
  ChatAttachment,
  EnvironmentId,
  MessageDraft,
  MessageDraftId,
  MessageDraftSendMode,
  OrchestrationMessageContext,
  ServerConfig,
  ThreadId,
  UploadChatAttachment,
} from "@t3tools/contracts";
import type * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { useRef, useState } from "react";

import * as Dialog from "../../components/ui/Dialog";
import { prepareTurnAttachments, type UploadedMobileAttachment } from "../../lib/attachmentUpload";
import { uploadedComposerContext } from "../../lib/composerContext";
import type { DraftComposerAttachment } from "../../lib/composerImages";
import {
  downloadMessageDraftAttachments,
  messageDraftAttachmentsFromPrepared,
} from "../../lib/messageDraftAttachments";
import { scopedThreadKey } from "../../lib/scopedEntities";
import {
  messageDraftEnvironment,
  messageDraftFailureMessage,
  useThreadMessageDraftList,
} from "../../state/messageDrafts";
import {
  endQueuedRunEdit,
  getQueuedRunEdit,
  queuedEditDraftKey,
  resolveQueuedEditPayload,
} from "../../state/queued-run-edit";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  clearComposerDraftContent,
  getComposerDraftSnapshot,
  mergeComposerDraftContent,
  scheduleUnusedComposerAttachmentCleanup,
} from "../../state/use-composer-drafts";
import { buildCancelQueuedRunCommand } from "./threadQueueControlPresentation";

function failureText(result: { readonly cause: Cause.Cause<unknown> }): string {
  return messageDraftFailureMessage(squashAtomCommandFailure(result));
}

/**
 * Saving, opening, and sending the thread's server-side drafts. Mobile composer drafts keep local
 * files, so saving uploads them first and opening downloads the draft's attachments back.
 */
export function useThreadMessageDrafts(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly serverConfig: ServerConfig | null;
  readonly onOpened?: () => void;
}) {
  const { environmentId, threadId } = input;
  const threadKey = scopedThreadKey(environmentId, threadId);
  const loadedDrafts = useThreadMessageDraftList(environmentId, threadId);
  const drafts = loadedDrafts ?? [];
  const canEdit =
    useAtomValue(messageDraftEnvironment.save.permissionAtom(environmentId)) &&
    loadedDrafts !== null;
  const options = { reportFailure: false } as const;
  const save = useAtomCommand(messageDraftEnvironment.save, { label: "save draft", ...options });
  const take = useAtomCommand(messageDraftEnvironment.take, { label: "open draft", ...options });
  const remove = useAtomCommand(messageDraftEnvironment.remove, {
    label: "delete draft",
    ...options,
  });
  const send = useAtomCommand(messageDraftEnvironment.send, { label: "send draft", ...options });
  const cancelQueuedRun = useAtomCommand(threadEnvironment.cancelQueuedRun, {
    label: "move queued message to drafts",
    ...options,
  });
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);

  const exclusive = async (work: () => Promise<boolean>): Promise<boolean> => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    return work().finally(() => {
      busyRef.current = false;
      setBusy(false);
    });
  };

  /** Uploads local files and saves the message; false (after telling the user) on failure. */
  const saveContent = async (content: {
    readonly text: string;
    readonly attachments: ReadonlyArray<DraftComposerAttachment>;
    readonly context?: OrchestrationMessageContext | undefined;
    readonly resolve?: (uploaded: ReadonlyArray<UploadedMobileAttachment>) => {
      readonly attachments: ReadonlyArray<ChatAttachment | UploadChatAttachment>;
      readonly context: OrchestrationMessageContext | undefined;
    };
  }): Promise<boolean> => {
    const prepared = await settlePromise(() =>
      prepareTurnAttachments({
        environmentId,
        attachments: content.attachments,
        supportsImageUploads:
          input.serverConfig?.environment.capabilities.attachmentUploads === true,
      }),
    );
    if (AsyncResult.isFailure(prepared)) {
      Dialog.alert("Could not save draft", failureText(prepared));
      return false;
    }
    if (prepared.value.status !== "ready") return false;
    const resolved = content.resolve?.(prepared.value.attachments) ?? {
      attachments: prepared.value.attachments,
      context: uploadedComposerContext(
        content.context,
        content.attachments,
        prepared.value.attachments,
      ),
    };
    const attachments = messageDraftAttachmentsFromPrepared(resolved.attachments);
    if (attachments === null) {
      Dialog.alert("Could not save draft", "This server cannot keep attachments in drafts.");
      return false;
    }
    const saved = await save({
      environmentId,
      input: {
        threadId,
        text: content.text,
        attachments,
        ...(resolved.context ? { context: resolved.context } : {}),
        origin: "mobile",
      },
    });
    if (saved._tag !== "Success") {
      Dialog.alert("Could not save draft", failureText(saved));
      return false;
    }
    return true;
  };

  const saveComposer = async (): Promise<boolean> => {
    const draft = getComposerDraftSnapshot(threadKey);
    if (draft.text.trim().length === 0 && draft.attachments.length === 0) return true;
    const saved = await saveContent(draft);
    if (!saved) return false;
    // Typing during the upload is kept rather than discarded with the saved snapshot.
    if (getComposerDraftSnapshot(threadKey).text === draft.text) {
      clearComposerDraftContent(threadKey, { deferAttachmentCleanup: true });
      scheduleUnusedComposerAttachmentCleanup(draft.attachments);
    }
    return true;
  };

  const moveQueuedEdit = async (): Promise<boolean> => {
    const edit = getQueuedRunEdit(threadKey);
    if (edit === null) return false;
    const draft = getComposerDraftSnapshot(queuedEditDraftKey(threadKey, edit.runId));
    const saved = await saveContent({
      ...draft,
      resolve: (uploaded) =>
        resolveQueuedEditPayload({
          edit,
          draftContext: draft.context,
          draftAttachments: draft.attachments,
          uploaded,
        }),
    });
    if (!saved) return false;
    const cancelled = await cancelQueuedRun(
      buildCancelQueuedRunCommand({ environmentId, threadId, runId: edit.runId }),
    );
    endQueuedRunEdit(threadKey, { deferAttachmentCleanup: true });
    scheduleUnusedComposerAttachmentCleanup(draft.attachments);
    if (cancelled._tag !== "Success") {
      Dialog.alert(
        "Saved as a draft",
        "The queued message may have already started, so it could not be removed from the queue.",
      );
    }
    return true;
  };

  const open = async (draftId: MessageDraftId): Promise<boolean> => {
    // Opening replaces the composer, so whatever is there becomes a draft first.
    if (!(await saveComposer())) return false;
    const taken = await take({ environmentId, input: { draftId } });
    if (taken._tag !== "Success") {
      Dialog.alert("Could not open draft", failureText(taken));
      return false;
    }
    const draft: MessageDraft = taken.value;
    const restored = await settlePromise(() =>
      downloadMessageDraftAttachments(environmentId, draft.attachments),
    );
    if (AsyncResult.isFailure(restored)) {
      // Taking removed it from the server; put it back so the attachments are not lost.
      await save({
        environmentId,
        input: {
          threadId,
          text: draft.text,
          attachments: draft.attachments,
          ...(draft.context ? { context: draft.context } : {}),
          origin: draft.origin,
        },
      });
      Dialog.alert("Could not open draft", "Its attachments could not be downloaded. Try again.");
      return false;
    }
    await mergeComposerDraftContent(threadKey, {
      text: draft.text,
      attachments: restored.value,
      ...(draft.context ? { context: draft.context } : {}),
    });
    input.onOpened?.();
    return true;
  };

  return {
    drafts,
    canEdit,
    busy,
    saveComposer: () => exclusive(saveComposer),
    moveQueuedEdit: () => exclusive(moveQueuedEdit),
    open: (draftId: MessageDraftId) => exclusive(() => open(draftId)),
    send: (draftId: MessageDraftId, mode: MessageDraftSendMode) =>
      exclusive(async () => {
        const result = await send({ environmentId, input: { draftId, mode } });
        if (result._tag === "Success") return true;
        Dialog.alert("Could not send draft", failureText(result));
        return false;
      }),
    remove: (draftId: MessageDraftId) =>
      exclusive(async () => {
        const result = await remove({ environmentId, input: { draftId } });
        if (result._tag === "Success") return true;
        Dialog.alert("Could not delete draft", failureText(result));
        return false;
      }),
  };
}

export type ThreadMessageDrafts = ReturnType<typeof useThreadMessageDrafts>;
