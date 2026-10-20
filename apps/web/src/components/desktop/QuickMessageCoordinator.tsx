import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { DesktopQuickMessageSubmission } from "@t3tools/contracts";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useRef } from "react";

import { composerDraftHasUserContent, useComposerDraftStore } from "../../composerDraftStore";
import { useComposerSubmitRequestStore } from "../../composerSubmitRequestStore";
import { useSidebarPendingFileDropStore } from "../../sidebarPendingFileDropStore";
import { openComposerAttachPicker } from "../chat/ComposerAttachMenu";
import { applyStartFromToDraft } from "../chat/StartFromPicker";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { usePrimaryEnvironment } from "../../state/environments";
import { stackedThreadToast, toastManager } from "../ui/toast";

type QuickMessageDraft = Extract<DesktopQuickMessageSubmission, { type: "draft" }>;

/**
 * Starts the threads the desktop quick message panel sends. The message goes through this
 * window's own composer, as if typed into a new thread here and sent.
 */
export function QuickMessageCoordinator() {
  const router = useRouter();
  const primaryEnvironment = usePrimaryEnvironment();
  const openThread = useNewThreadHandler();
  const queueRef = useRef(Promise.resolve());
  const quickMessage = window.desktopBridge?.quickMessage;
  const ready =
    quickMessage !== undefined &&
    primaryEnvironment?.connection.phase === "connected" &&
    primaryEnvironment.serverConfig !== null;

  const start = useEffectEvent(async (submission: QuickMessageDraft) => {
    const opened = await openThread(
      scopeProjectRef(submission.environmentId, submission.projectId),
    ).catch(() => null);
    if (opened === null) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not start the thread",
          description: "T3 Code could not open a new thread in that project.",
        }),
      );
      return;
    }
    const store = useComposerDraftStore.getState();
    const draft = store.getDraftSession(opened.draftId);
    const existing = store.getComposerDraft(opened.draftId);
    store.setModelSelection(opened.draftId, submission.modelSelection, {
      explicit: true,
      replaceOptions: true,
    });
    store.setRuntimeMode(opened.draftId, submission.runtimeMode);
    store.setInteractionMode(opened.draftId, submission.interactionMode);
    store.setDraftThreadContext(opened.draftId, {
      runtimeMode: submission.runtimeMode,
      interactionMode: submission.interactionMode,
    });
    // A draft can only come back holding text when another new thread raced this one to it.
    // Sending would take that text along, so the message joins it for the reader to send.
    const held = composerDraftHasUserContent(existing);
    const prompt = held
      ? [existing?.prompt ?? "", submission.text].filter((text) => text.length > 0).join("\n\n")
      : submission.text;
    store.setPrompt(opened.draftId, prompt);
    if (held) {
      toastManager.add({
        type: "info",
        title: "Added to your draft",
        description: "This project already had a draft, so your message was added to it.",
      });
    }
    const threadRef = draft ? scopeThreadRef(draft.environmentId, draft.threadId) : null;
    const finish = (send: boolean) => {
      if (submission.files.length > 0 && threadRef !== null) {
        // The composer prepares files itself (compression, limits, uploads), and only then sends.
        useSidebarPendingFileDropStore.getState().queuePendingFileDrop({
          threadRef,
          files: submission.files.map(
            (file) => new File([new Uint8Array(file.bytes)], file.name, { type: file.mimeType }),
          ),
          sendAfter: send,
        });
      } else if (send) {
        useComposerSubmitRequestStore.getState().request(opened.draftId, "send");
      }
      if (submission.action !== "send" && threadRef !== null) {
        openComposerAttachPicker(submission.action, threadRef);
      }
    };
    const send = submission.action === "send" && !held;
    // A pull request is checked out before anything sends, so nothing runs in the old checkout.
    if (submission.startFrom !== undefined && threadRef !== null) {
      applyStartFromToDraft({
        threadRef,
        pick: submission.startFrom,
        onApplied: (applied) => finish(send && applied),
      });
    } else {
      finish(send);
    }
  });

  const receive = useEffectEvent((submission: DesktopQuickMessageSubmission) => {
    if (submission.type === "open") {
      void router.navigate({ href: submission.href });
      return;
    }
    queueRef.current = queueRef.current.then(() => start(submission)).catch(() => undefined);
  });

  useEffect(() => {
    if (!ready || quickMessage === undefined) return;
    let subscribed = true;
    const unsubscribe = quickMessage.onSubmit(receive);
    queueMicrotask(() => {
      if (subscribed) void quickMessage.setReceiverReady(true).catch(() => undefined);
    });
    return () => {
      subscribed = false;
      void quickMessage.setReceiverReady(false).catch(() => undefined);
      unsubscribe();
    };
  }, [ready, quickMessage]);

  return null;
}
