import type { EnvironmentThreadShell, ThreadStructure } from "@t3tools/client-runtime/state/shell";
import type { ThreadTabGroup } from "@t3tools/contracts";
import type { ComposerThreadTarget } from "../../composerDraftStore";
import { threadHasStarted } from "../ChatView.logic";
import { useStableCallback } from "../../hooks/useStableCallback";
import {
  type EnvironmentId,
  type MessageId,
  ProviderInstanceId,
  type ScopedThreadRef,
  type ThreadId,
} from "@t3tools/contracts";
import { forkResponseIntoTab, forkThreadTab, useThreadTabActions } from "./ThreadTabs";
import { buildThreadRouteParams } from "../../threadRoutes";
import { prepareRevertedMessageAttachments } from "../ChatView.logic";
import { createModelSelection } from "@t3tools/shared/model";
import {
  latestThreadForkPoint,
  threadForkPointBeforeMessage,
} from "@t3tools/client-runtime/thread-tabs";
import { recallableComposerPrompt } from "./composerPromptHistory";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toastManager } from "../ui/toast";
import { useComposerDraftStore } from "../../composerDraftStore";
import { assetEnvironment } from "../../state/assets";
import { readPreparedConnection } from "../../state/session";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";

import * as DateTime from "effect/DateTime";
import {
  copyChatViewDraftAttachments,
  restoreMessageAttachments,
} from "./chatViewDraftAttachments";

export function useChatViewTabForks(input: {
  environmentId: EnvironmentId;
  activeThread: EnvironmentThreadShell | undefined;
  serverThread: EnvironmentThreadShell | null;
  serverProjection: ThreadStructure | null;
  isServerThread: boolean;
  composerDraftTarget: ComposerThreadTarget;
  threadTabGroup: ThreadTabGroup | null;
}) {
  const {
    environmentId,
    activeThread,
    serverThread,
    serverProjection,
    isServerThread,
    composerDraftTarget,
    threadTabGroup,
  } = input;
  const navigate = useNavigate();
  const { closeTab } = useThreadTabActions();
  const createAttachmentAssetUrl = useAtomQueryRunner(assetEnvironment.createUrl, {
    reportFailure: false,
    refresh: true,
  });
  // Forks into a new tab of this thread: from before a user message, or onto a model or account
  // this tab cannot switch to. They fork natively from the last finished response, so the tab
  // carries the conversation itself; with none to fork from, its draft starts with a summary.
  const forkInFlightRef = useRef(false);
  const runFork = async (
    fork: (connection: NonNullable<ReturnType<typeof readPreparedConnection>>) => Promise<void>,
  ) => {
    if (!activeThread || !isServerThread || forkInFlightRef.current) return;
    const connection = readPreparedConnection(environmentId);
    if (!connection) {
      toastManager.add({ type: "error", title: "The environment is not connected." });
      return;
    }
    forkInFlightRef.current = true;
    try {
      await fork(connection);
    } catch (cause) {
      toastManager.add({
        type: "error",
        title: "Could not fork into a new tab",
        description: cause instanceof Error ? cause.message : undefined,
      });
    }
    forkInFlightRef.current = false;
  };
  const openForkedTab = (tabRef: ScopedThreadRef) =>
    navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(tabRef) });
  // The fork stops before the message, whose text and attachments wait in the new tab's composer.
  const onForkFromMessage = (messageId: MessageId) =>
    runFork(async (connection) => {
      if (!activeThread || !serverProjection) return;
      const source = serverProjection.messages.find((entry) => entry.id === messageId);
      if (!source || source.role !== "user" || source.streaming) return;
      const message = {
        id: source.id,
        role: source.role,
        text: source.text,
        attachments: source.attachments,
        context: source.context,
        runId: source.runId,
        streaming: false,
        createdAt: DateTime.formatIso(source.createdAt),
        updatedAt: DateTime.formatIso(source.updatedAt),
      };
      const files = await prepareRevertedMessageAttachments({
        message,
        environmentId,
        httpBaseUrl: connection.httpBaseUrl,
        createAssetUrl: createAttachmentAssetUrl,
      });
      const prompt = recallableComposerPrompt(message.text);
      const forkPoint = threadForkPointBeforeMessage(
        serverProjection.visibleTurnItems,
        serverProjection.runs,
        messageId,
      );
      let tabRef: ScopedThreadRef;
      if (forkPoint) {
        tabRef = await forkResponseIntoTab(connection, {
          environmentId,
          tabThreadId: activeThread.id,
          ...forkPoint,
          title: `${activeThread.title} fork`,
        });
        useComposerDraftStore.getState().setPrompt(tabRef, prompt);
      } else {
        // Inherited history comes first in the timeline, and an older window may precede it.
        const timelineIndex = serverProjection.visibleTurnItems.findIndex(
          (entry) => entry.item.type === "user_message" && entry.item.messageId === messageId,
        );
        const hasHistory =
          timelineIndex !== 0 ||
          serverProjection.visibleTurnItems.length < (serverThread?.visibleItemCount ?? 0);
        tabRef = await forkThreadTab(connection, {
          environmentId,
          sourceThreadId: activeThread.id,
          sourceTitle: activeThread.title,
          modelSelection: activeThread.modelSelection,
          beforeMessageId: messageId,
          prompt,
          hasHistory,
        });
      }
      restoreMessageAttachments(tabRef, message, files);
      await openForkedTab(tabRef);
    });
  // From a context pill of an empty tab: a sibling's conversation continues in a native fork that
  // takes this tab's place, on the sibling's own model and with this tab's draft. Closing archives
  // this tab, so undo brings it back.
  const onContinueFromTab = (sourceThreadId: ThreadId, sourceTitle: string) =>
    runFork(async (connection) => {
      if (!activeThread || !threadTabGroup) return;
      const tabRef = await forkResponseIntoTab(connection, {
        environmentId,
        tabThreadId: activeThread.id,
        sourceThreadId,
        title: `${sourceTitle} fork`,
      });
      const draft = useComposerDraftStore.getState().getComposerDraft(composerDraftTarget);
      useComposerDraftStore.getState().setPrompt(tabRef, draft?.prompt.trim() ?? "");
      copyChatViewDraftAttachments(activeThread.id, composerDraftTarget, tabRef);
      await closeTab(scopeThreadRef(environmentId, activeThread.id), tabRef);
    });
  // From the model or account picker: the new tab carries the whole chat onto the picked model,
  // and this tab's draft is copied into it. The draft here is left as it was. `emptyDraftPrompt`
  // stands in for the draft when there is none.
  const onForkModel = (instanceId: ProviderInstanceId, model: string, emptyDraftPrompt = "") =>
    runFork(async (connection) => {
      if (!activeThread) return;
      const store = useComposerDraftStore.getState();
      const draft = store.getComposerDraft(composerDraftTarget);
      const modelSelection = createModelSelection(instanceId, model);
      const prompt = draft?.prompt.trim() || emptyDraftPrompt;
      const forkPoint = serverProjection
        ? latestThreadForkPoint(serverProjection.visibleTurnItems, serverProjection.runs)
        : null;
      let tabRef: ScopedThreadRef;
      if (forkPoint) {
        tabRef = await forkResponseIntoTab(connection, {
          environmentId,
          tabThreadId: activeThread.id,
          ...forkPoint,
          title: `${activeThread.title} fork`,
          modelSelection,
        });
        store.setPrompt(tabRef, prompt);
      } else {
        tabRef = await forkThreadTab(connection, {
          environmentId,
          sourceThreadId: activeThread.id,
          sourceTitle: activeThread.title,
          modelSelection,
          prompt,
          hasHistory: threadHasStarted(activeThread),
        });
      }
      copyChatViewDraftAttachments(activeThread.id, composerDraftTarget, tabRef);
      await openForkedTab(tabRef);
    });
  // From the full-context notice: a fresh tab on the same model that starts from this chat's
  // summary chip rather than its native history, so it opens with an empty window. This tab's
  // draft is copied into it.
  const onContinueInFreshTab = () =>
    runFork(async (connection) => {
      if (!activeThread) return;
      const draft = useComposerDraftStore.getState().getComposerDraft(composerDraftTarget);
      const tabRef = await forkThreadTab(connection, {
        environmentId,
        sourceThreadId: activeThread.id,
        sourceTitle: activeThread.title,
        modelSelection: activeThread.modelSelection,
        prompt: draft?.prompt.trim() ?? "",
        hasHistory: threadHasStarted(activeThread),
      });
      copyChatViewDraftAttachments(activeThread.id, composerDraftTarget, tabRef);
      await openForkedTab(tabRef);
    });
  const onForkTimelineMessage = useStableCallback((messageId: MessageId) => {
    void onForkFromMessage(messageId);
  });
  const onForkComposerModel = useStableCallback((instanceId: ProviderInstanceId, model: string) => {
    void onForkModel(instanceId, model);
  });
  return {
    onForkModel,
    onForkTimelineMessage,
    onForkComposerModel,
    onContinueFromTab,
    onContinueInFreshTab,
  };
}
