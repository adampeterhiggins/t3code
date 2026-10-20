import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { DesktopQuickMessageSubmission } from "@t3tools/contracts";
import { useEffect, useEffectEvent, useRef } from "react";

import { composerDraftHasUserContent, useComposerDraftStore } from "../../composerDraftStore";
import { useComposerSubmitRequestStore } from "../../composerSubmitRequestStore";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { usePrimaryEnvironment } from "../../state/environments";
import { stackedThreadToast, toastManager } from "../ui/toast";

/**
 * Starts the threads the desktop quick message panel sends. The message goes through this
 * window's own composer, as if typed into a new thread here and sent.
 */
export function QuickMessageCoordinator() {
  const primaryEnvironment = usePrimaryEnvironment();
  const openThread = useNewThreadHandler();
  const queueRef = useRef(Promise.resolve());
  const quickMessage = window.desktopBridge?.quickMessage;
  const ready =
    quickMessage !== undefined &&
    primaryEnvironment?.connection.phase === "connected" &&
    primaryEnvironment.serverConfig !== null;

  const start = useEffectEvent(async (submission: DesktopQuickMessageSubmission) => {
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
    const existing = store.getComposerDraft(opened.draftId);
    store.setModelSelection(opened.draftId, submission.modelSelection, {
      explicit: true,
      replaceOptions: true,
    });
    // A draft can only come back holding text when another new thread raced this one to it.
    // Sending would take that text along, so the message joins it for the reader to send.
    if (composerDraftHasUserContent(existing)) {
      store.setPrompt(opened.draftId, `${existing?.prompt ?? ""}\n\n${submission.text}`);
      toastManager.add({
        type: "info",
        title: "Added to your draft",
        description: "This project already had a draft, so your message was added to it.",
      });
      return;
    }
    store.setPrompt(opened.draftId, submission.text);
    useComposerSubmitRequestStore.getState().request(opened.draftId, "send");
  });

  const receive = useEffectEvent((submission: DesktopQuickMessageSubmission) => {
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
