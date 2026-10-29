import { useAtomValue } from "@effect/atom-react";
import { type ContextMenuItem, type MessageDraft, MessageDraftId } from "@t3tools/contracts";
import {
  SAVE_DRAFT_MENU_ITEM,
  findComposerSendMenuAction,
  resolveComposerSendMenu,
} from "@t3tools/client-runtime/state/send-menu";
import { replaceComposerContextReferences } from "@t3tools/shared/composerContextReferences";
import { useEffect, type RefObject } from "react";
import {
  collapseExpandedComposerCursor,
  type ComposerSubmissionIntent,
} from "../../composer-logic";
import { composerDraftHasUserContent, useComposerDraftStore } from "../../composerDraftStore";
import { useComposerSubmitRequestStore } from "../../composerSubmitRequestStore";
import { useStableCallback } from "../../hooks/useStableCallback";
import { readLocalApi } from "../../localApi";
import { messageDraftEnvironment, useThreadMessageDrafts } from "../../state/messageDrafts";
import { formatInlineContextReference } from "~/lib/composerContextReferences";
import type { ComposerPromptEditorHandle } from "../ComposerPromptEditor";
import { toastManager } from "../ui/toast";
import type { ChatComposerProps } from "./ChatComposer";
import type { ComposerSendSurface } from "./ComposerPrimaryActions";
import { messageDraftComposerRecords, openMessageDraftInComposer } from "./messageDraftComposer";
import { pendingDraftWork } from "./pendingDraftWork";
import { countPreparingComposerImages } from "./preparingComposerImages";
import {
  resolveComposerDispatchMode,
  type ComposerDispatchMode,
} from "@t3tools/client-runtime/state/composer-dispatch";
import type { useComposerContextImport } from "./useComposerContextImport";
import { useMessageDraftActions } from "./useMessageDraftActions";

export function useComposerDraftActions(
  input: Pick<
    ChatComposerProps,
    | "environmentId"
    | "routeThreadRef"
    | "routeKind"
    | "composerDraftTarget"
    | "promptRef"
    | "onSaveMessageDraft"
    | "canOperateThread"
    | "isSendBusy"
    | "isCompacting"
    | "projectSelectionRequired"
    | "environmentUnavailable"
    | "phase"
    | "onImplementPlanInNewThread"
    | "onCancelQueuedEdit"
    | "checkoutKindPending"
  > & {
    composerDraftTargetKey: string;
    composerDraftTargetKeyRef: RefObject<string>;
    attachmentTargetKey: string;
    isComposerApprovalState: boolean;
    activePendingProgress: ChatComposerProps["activePendingProgress"];
    isRevertingCheckpointRef: RefObject<boolean>;
    isEditingQueuedMessage: boolean;
    importContextRecords: ReturnType<typeof useComposerContextImport>["importContextRecords"];
    setComposerCursor: (cursor: number) => void;
    setComposerTrigger: (trigger: null) => void;
    composerEditorRef: RefObject<ComposerPromptEditorHandle | null>;
    isSendDisabled: boolean;
    noProviderAvailable: boolean;
    followUpBehavior: ChatComposerProps["settings"]["followUpBehavior"];
    composerSendState: { hasSendableContent: boolean };
    attachmentUploadPendingReason: string | null;
    submitComposer: (
      event?: React.MouseEvent<HTMLButtonElement>,
      dispatchMode?: ComposerDispatchMode,
      intent?: ComposerSubmissionIntent,
    ) => void;
    submitComposerStable: (
      event?: React.MouseEvent<HTMLButtonElement>,
      dispatchMode?: ComposerDispatchMode,
      intent?: ComposerSubmissionIntent,
    ) => void;
  },
) {
  const {
    environmentId,
    routeThreadRef,
    routeKind,
    composerDraftTarget,
    promptRef,
    onSaveMessageDraft,
    canOperateThread,
    isSendBusy,
    isCompacting,
    projectSelectionRequired,
    environmentUnavailable,
    phase,
    onImplementPlanInNewThread,
    onCancelQueuedEdit,
    checkoutKindPending,
    composerDraftTargetKey,
    composerDraftTargetKeyRef,
    attachmentTargetKey,
    isComposerApprovalState,
    activePendingProgress,
    isRevertingCheckpointRef,
    isEditingQueuedMessage,
    importContextRecords,
    setComposerCursor,
    setComposerTrigger,
    composerEditorRef,
    isSendDisabled,
    noProviderAvailable,
    followUpBehavior,
    composerSendState,
    attachmentUploadPendingReason,
    submitComposer,
    submitComposerStable,
  } = input;
  const getComposerDraft = useComposerDraftStore((store) => store.getComposerDraft);
  const setComposerDraftPrompt = useComposerDraftStore((store) => store.setPrompt);
  const messageDraftActions = useMessageDraftActions();
  const canWriteMessageDrafts = useAtomValue(
    messageDraftEnvironment.save.permissionAtom(environmentId),
  );
  const canSaveMessageDraft = onSaveMessageDraft !== null && canWriteMessageDrafts;
  const threadMessageDrafts = useThreadMessageDrafts(
    onSaveMessageDraft === null ? null : routeThreadRef,
  );
  const saveMessageDraft = async (): Promise<boolean> => {
    if (
      onSaveMessageDraft === null ||
      !canWriteMessageDrafts ||
      isComposerApprovalState ||
      activePendingProgress !== null ||
      isRevertingCheckpointRef.current
    ) {
      return false;
    }
    if (countPreparingComposerImages(attachmentTargetKey) > 0) {
      toastManager.add({
        type: "info",
        title: "Still compressing a pasted image.",
        description: "Save again once its thumbnail appears.",
      });
      return false;
    }
    if (pendingDraftWork.has(attachmentTargetKey)) {
      toastManager.add({
        type: "info",
        title: "Still bringing attached context into this message.",
        description: "Save again once its chip resolves.",
      });
      return false;
    }
    return onSaveMessageDraft();
  };
  const saveMessageDraftStable = useStableCallback(saveMessageDraft);
  const saveCitationAsDraftStable = useStableCallback(() => {
    void saveMessageDraft();
  });
  const loadMessageDraft = (draft: MessageDraft) => {
    const rewrittenContextIds = importContextRecords(
      messageDraftComposerRecords(draft),
      environmentId,
      composerDraftTarget,
    );
    const restoredPrompt = replaceComposerContextReferences(draft.text, (reference) => {
      const contextId = rewrittenContextIds.get(reference.contextId);
      return contextId
        ? formatInlineContextReference({
            ...reference,
            contextId,
            kind: reference.kind === "element" ? "preview-annotation" : reference.kind,
          })
        : reference.source;
    });
    promptRef.current = restoredPrompt;
    setComposerDraftPrompt(composerDraftTarget, restoredPrompt);
    setComposerCursor(collapseExpandedComposerCursor(restoredPrompt, restoredPrompt.length));
    setComposerTrigger(null);
    window.requestAnimationFrame(() => {
      composerEditorRef.current?.focusAtEnd();
    });
  };
  const loadMessageDraftStable = useStableCallback(loadMessageDraft);
  const openMessageDraft = async (draftId: MessageDraftId) => {
    if (isEditingQueuedMessage) {
      toastManager.add({
        type: "info",
        title: "Finish editing the queued message first",
        description: "Update it, move it to drafts, or cancel the edit, then open the draft.",
      });
      return;
    }
    if (isComposerApprovalState || activePendingProgress !== null) return;
    await openMessageDraftInComposer({
      targetKey: composerDraftTargetKey,
      take: () => messageDraftActions.take(environmentId, draftId),
      putBack: (draft) =>
        messageDraftActions.save(environmentId, {
          threadId: draft.threadId,
          text: draft.text,
          attachments: draft.attachments,
          context: draft.context,
        }),
      readComposer: () => ({
        targetKey: composerDraftTargetKeyRef.current,
        hasContent:
          promptRef.current.trim().length > 0 ||
          composerDraftHasUserContent(getComposerDraft(composerDraftTarget)),
        hasPrompt: promptRef.current.trim().length > 0,
      }),
      saveCurrent: saveMessageDraftStable,
      waitForRender: () => new Promise((resolve) => window.requestAnimationFrame(resolve)),
      load: loadMessageDraftStable,
    });
  };
  const openMessageDraftStable = useStableCallback(openMessageDraft);
  const openSendContextMenu = async (
    event: React.MouseEvent<HTMLElement>,
    surface: ComposerSendSurface,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const api = readLocalApi();
    if (!api || isComposerApprovalState || activePendingProgress !== null) return;
    const running = phase === "running";
    const sendDisabled =
      !canOperateThread ||
      isSendBusy ||
      isSendDisabled ||
      noProviderAvailable ||
      projectSelectionRequired ||
      environmentUnavailable !== null;
    const defaultDispatchMode = resolveComposerDispatchMode({
      running,
      alternateModifier: false,
      activeTurnDefault: followUpBehavior,
      canSteer: !isCompacting,
    });
    const position = { x: event.clientX, y: event.clientY };
    if (surface !== "send") {
      const items: ContextMenuItem[] =
        surface === "plan-refine"
          ? [
              { id: "send", label: "Refine", icon: "arrow-up", disabled: sendDisabled },
              ...(canSaveMessageDraft ? [{ ...SAVE_DRAFT_MENU_ITEM, separatorBefore: true }] : []),
            ]
          : [
              { id: "send", label: "Implement", icon: "arrow-up", disabled: sendDisabled },
              {
                id: "implement-in-new-thread",
                label: "Implement in a new thread",
                icon: "message-square-plus",
                disabled: sendDisabled,
              },
            ];
      const selected = await api.contextMenu.show(items, position);
      if (selected === "send") submitComposer(undefined, defaultDispatchMode);
      else if (selected === "implement-in-new-thread") onImplementPlanInNewThread();
      else if (selected === SAVE_DRAFT_MENU_ITEM.id) void saveMessageDraft();
      return;
    }
    const items = resolveComposerSendMenu({
      hasContent: composerSendState.hasSendableContent,
      running,
      canSteer: !isCompacting,
      activeTurnDefault: followUpBehavior,
      canSendInNewThread: routeKind !== "draft",
      canSaveDraft: canSaveMessageDraft,
      isEditingQueuedMessage,
      sendDisabled,
      drafts: canSaveMessageDraft ? threadMessageDrafts : [],
    });
    if (items.length === 0) return;
    const action = findComposerSendMenuAction(items, await api.contextMenu.show(items, position));
    switch (action?.type) {
      case "send":
      case "update-queued":
        submitComposer(undefined, defaultDispatchMode);
        return;
      case "queue":
      case "steer":
        submitComposer(undefined, action.type);
        return;
      case "send-in-new-thread":
        submitComposer(undefined, defaultDispatchMode, "background");
        return;
      case "save-draft":
      case "move-to-drafts":
        void saveMessageDraft();
        return;
      case "open-draft":
        void openMessageDraft(MessageDraftId.make(action.draftId));
        return;
      case "cancel-edit":
        onCancelQueuedEdit();
        return;
      case undefined:
        return;
    }
  };
  const openSendContextMenuStable = useStableCallback(openSendContextMenu);
  // A surface beside the composer asked to send what it wrote here. Wait out a connect, uploads,
  // a just-opened draft's git status (a non-git folder reads as a repo until it lands) and any
  // disabled send, such as a new worktree's setup script, then send as Enter would.
  const submitRequest = useComposerSubmitRequestStore(
    (state) => state.pending.get(composerDraftTargetKey) ?? null,
  );
  const attachmentsUploading = attachmentUploadPendingReason !== null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Dispatch external submit requests once the composer can accept them.
  useEffect(() => {
    if (
      submitRequest === null ||
      isSendBusy ||
      (submitRequest === "send" && isSendDisabled) ||
      attachmentsUploading ||
      checkoutKindPending
    ) {
      return;
    }
    const intent = useComposerSubmitRequestStore.getState().take(composerDraftTargetKey);
    if (intent === "save-draft") void saveMessageDraftStable();
    else if (intent === "send") submitComposerStable();
  }, [
    attachmentsUploading,
    checkoutKindPending,
    composerDraftTargetKey,
    isSendBusy,
    isSendDisabled,
    saveMessageDraftStable,
    submitComposerStable,
    submitRequest,
  ]);
  return {
    canSaveMessageDraft,
    saveMessageDraftStable,
    saveCitationAsDraftStable,
    openMessageDraftStable,
    openSendContextMenuStable,
  };
}
