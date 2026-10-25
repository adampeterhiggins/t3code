import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { requestCustomSnooze } from "../components/CustomSnoozeDialog";
import { openGuestShareDialog } from "../components/chat/guestShareDialogState";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { canSnooze, effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";
import {
  AuthOrchestrationOperateScope,
  ProjectId,
  type ScopedThreadRef,
  type ThreadId,
} from "@t3tools/contracts";
import { useRouter } from "@tanstack/react-router";

import { resolveSnoozePresets } from "../components/Sidebar.snooze";
import {
  buildThreadActionMenuItems,
  collectThreadGroupNames,
  resolveThreadGroupMenuPick,
  resolveThreadProjectMenuPick,
  threadActionRequiresOperate,
  type ThreadActionMenuId,
} from "../components/threadActionMenu.logic";
import { threadMoveTargets } from "@t3tools/client-runtime/state/projects";
import { requestThreadGroup } from "../components/ThreadGroupDialog";
import { useThreadGroups } from "./useThreadGroups";
import { isGitHubProject } from "@t3tools/client-runtime/state/github-issues";
import { openGitHubIssuePicker } from "../components/chat/GitHubIssuePicker";
import { openLinearIssuePicker } from "../components/chat/LinearIssuePicker";
import { openNotionPagePicker } from "../components/chat/NotionPagePicker";
import { openGranolaNotePicker } from "../components/chat/GranolaNotePicker";
import { openSlackMessagePicker } from "../components/chat/SlackMessagePicker";
import { openDiscordMessagePicker } from "../components/chat/DiscordMessagePicker";
import { openTranscriptExportDialog } from "../components/TranscriptExportDialog";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { threadEnvironment } from "../state/threads";
import { useOrchestrationCommand } from "../state/use-orchestration-command";
import { readEnvironmentScope } from "../state/session";
import {
  readEnvironmentSupportsAutoSettleOptOut,
  readEnvironmentSupportsGroups,
  readEnvironmentLinkIntegrations,
  readEnvironmentSupportsHiding,
  readEnvironmentSupportsPinning,
  readEnvironmentSupportsProjectMove,
  readEnvironmentSupportsSettlement,
  readEnvironmentSupportsSnooze,
  readEnvironmentSupportsTitleRegeneration,
  readThreadShell,
  readThreadShells,
  useProjects,
} from "../state/entities";
import { usePrimaryEnvironmentId } from "../state/environments";
import { readLocalApi } from "../localApi";
import {
  deriveLogicalProjectKeyFromSettings,
  derivePhysicalProjectKey,
  selectProjectGroupingSettings,
} from "../logicalProject";
import { buildPhysicalToLogicalProjectKeyMap } from "../sidebarProjectGrouping";
import { threadRuntimeCanArchive } from "@t3tools/client-runtime/state/models";
import { useCopyToClipboard } from "./useCopyToClipboard";
import { useNewThreadHandler } from "./useHandleNewThread";
import { useClientSettings } from "./useSettings";
import { readThreadSubscriptionLimitGuard, useThreadActions } from "./useThreadActions";
import { useThreadTabActions } from "../components/chat/ThreadTabs";

function failureToast(title: string, error: unknown) {
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: error instanceof Error ? error.message : "An error occurred.",
    }),
  );
}

export function useThreadActionMenu(input: {
  readonly threadRef: ScopedThreadRef | null;
  readonly projectCwd: string | null;
  readonly onStartRename: () => void;
  /** True when the thread's environment serves chat tabs, which adds "New tab". */
  readonly canShareWithGuest: boolean;
  readonly tabsSupported: boolean;
}) {
  const { threadRef, projectCwd, onStartRename, tabsSupported, canShareWithGuest } = input;
  const { createTab } = useThreadTabActions();
  const router = useRouter();
  const projects = useProjects();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const logicalProjectKeyByPhysicalKey = (() =>
    buildPhysicalToLogicalProjectKeyMap({
      projects,
      settings: projectGroupingSettings,
      primaryEnvironmentId,
    }))();
  const {
    settleThread,
    unsettleThread,
    snoozeThread,
    unsnoozeThread,
    pinThread,
    confirmAndUnpinThread,
    setThreadAutoSettle,
    setThreadSubscriptionLimitGuard,
    setThreadHidden,
    setThreadGroup,
    confirmAndMoveThreadToProject,
    archiveThread,
    deleteThread,
    markThreadUnread,
  } = useThreadActions();
  const { groups, saveGroup } = useThreadGroups();
  const updateThreadMetadata = useOrchestrationCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const handleNewThread = useNewThreadHandler();
  const confirmThreadDelete = useClientSettings((s) => s.confirmThreadDelete);
  const confirmThreadArchive = useClientSettings((s) => s.confirmThreadArchive);
  const timestampFormat = useClientSettings((s) => s.timestampFormat);
  const { copyToClipboard: copyPathToClipboard } = useCopyToClipboard<{ path: string }>({
    onCopy: ({ path }) => {
      toastManager.add({ type: "success", title: "Path copied", description: path });
    },
    onError: (error) => failureToast("Failed to copy path", error),
  });
  const { copyToClipboard: copyBranchToClipboard } = useCopyToClipboard<{ branch: string }>({
    target: "branch name",
    onCopy: ({ branch }) => {
      toastManager.add({ type: "success", title: "Branch copied", description: branch });
    },
    onError: (error) => failureToast("Failed to copy branch", error),
  });
  const { copyToClipboard: copyThreadIdToClipboard } = useCopyToClipboard<{ threadId: ThreadId }>({
    onCopy: ({ threadId }) => {
      toastManager.add({ type: "success", title: "Thread ID copied", description: threadId });
    },
    onError: (error) => failureToast("Failed to copy thread ID", error),
  });

  const openMenu = (position: { x: number; y: number }) => {
    if (threadRef === null) return;
    void (async () => {
      const api = readLocalApi();
      if (!api) return;
      const thread = readThreadShell(threadRef);
      if (!thread) return;
      const now = new Date();
      const supports = {
        settlement: readEnvironmentSupportsSettlement(threadRef.environmentId),
        autoSettleOptOut: readEnvironmentSupportsAutoSettleOptOut(threadRef.environmentId),
        snooze: readEnvironmentSupportsSnooze(threadRef.environmentId),
        pinning: readEnvironmentSupportsPinning(threadRef.environmentId),
        hiding: readEnvironmentSupportsHiding(threadRef.environmentId),
        groups: readEnvironmentSupportsGroups(threadRef.environmentId),
        titleRegeneration: readEnvironmentSupportsTitleRegeneration(threadRef.environmentId),
      };
      const isRegeneratingTitle = thread.titleRegeneration != null;
      const snoozePresets = resolveSnoozePresets(now, timestampFormat);
      const items = buildThreadActionMenuItems({
        canOperate: readEnvironmentScope(threadRef.environmentId, AuthOrchestrationOperateScope),
        branch: thread.branch ?? null,
        projectFilter: null,
        // Closing tabs belongs to the tab crumb; this menu acts on the group's root thread.
        tabs: tabsSupported ? { canClose: false } : null,
        canLinkGitHubIssue: isGitHubProject(
          projects.find(
            (candidate) =>
              candidate.environmentId === thread.environmentId && candidate.id === thread.projectId,
          ),
        ),
        isPinned: thread.pinnedAt != null,
        isSettled: supports.settlement && thread.settledOverride === "settled",
        autoSettleEnabled: thread.autoSettleDisabledAt == null,
        subscriptionLimit: readThreadSubscriptionLimitGuard(thread),
        isSnoozed: supports.snooze && effectiveSnoozed(thread, { now: now.toISOString() }),
        isHidden: thread.hiddenAt != null,
        groupName: thread.groupName ?? null,
        groupNames: collectThreadGroupNames(readThreadShells(), Object.keys(groups)),
        moveTargets: threadMoveTargets(
          thread,
          projects,
          readEnvironmentSupportsProjectMove(threadRef.environmentId),
        ),
        canSnoozeNow: canSnooze(thread, { now: now.toISOString() }),
        isRegeneratingTitle,
        isRunning: !threadRuntimeCanArchive(thread.runtime),
        supports,
        snoozePresets,
        integrations: readEnvironmentLinkIntegrations(threadRef.environmentId),
        canShareWithGuest,
      });
      const clicked = await settlePromise(() => api.contextMenu.show(items, position));
      if (clicked._tag === "Failure" || clicked.value === null) return;
      const action: ThreadActionMenuId = clicked.value;
      if (
        threadActionRequiresOperate(action) &&
        !readEnvironmentScope(threadRef.environmentId, AuthOrchestrationOperateScope)
      ) {
        failureToast(
          "Thread action unavailable",
          new Error("This connection cannot change threads."),
        );
        return;
      }
      const groupPick = resolveThreadGroupMenuPick(action);
      if (groupPick !== undefined) {
        let groupName = groupPick === "new" ? null : groupPick.groupName;
        if (groupPick === "new") {
          const draft = await requestThreadGroup();
          if (draft === null || draft === "delete") return;
          groupName = draft.name;
          saveGroup(draft);
        }
        const result = await setThreadGroup(threadRef, groupName);
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          failureToast("Failed to move thread", squashAtomCommandFailure(result));
        }
        return;
      }
      const projectPick = resolveThreadProjectMenuPick(action);
      if (projectPick !== undefined) {
        const result = await confirmAndMoveThreadToProject(threadRef, ProjectId.make(projectPick));
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          failureToast("Failed to move thread", squashAtomCommandFailure(result));
        }
        return;
      }
      if (action.startsWith("snooze:")) {
        const preset =
          action === "snooze:custom"
            ? await requestCustomSnooze()
            : snoozePresets.find((candidate) => `snooze:${candidate.id}` === action);
        if (!preset) return;
        const result = await snoozeThread(threadRef, preset.snoozedUntil);
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          failureToast("Failed to snooze thread", squashAtomCommandFailure(result));
        }
        return;
      }
      const reportFailure = async (
        title: string,
        run: () => Promise<AtomCommandResult<unknown, unknown>>,
      ) => {
        const result = await run();
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          failureToast(title, squashAtomCommandFailure(result));
        }
      };
      switch (action) {
        case "new-tab":
          await createTab(threadRef, thread.modelSelection);
          return;
        case "project-settings": {
          const project = projects.find(
            (candidate) =>
              candidate.environmentId === thread.environmentId && candidate.id === thread.projectId,
          );
          if (!project) return;
          const projectKey =
            logicalProjectKeyByPhysicalKey.get(derivePhysicalProjectKey(project)) ??
            deriveLogicalProjectKeyFromSettings(project, projectGroupingSettings);
          void router.navigate({
            to: "/projects/$projectKey",
            params: { projectKey },
          });
          return;
        }
        case "new-thread-on-branch": {
          const result = await settlePromise(() =>
            handleNewThread(scopeProjectRef(threadRef.environmentId, thread.projectId), {
              branch: thread.branch,
              worktreePath: thread.worktreePath,
              envMode: thread.worktreePath ? "worktree" : "local",
              startFromOrigin: false,
            }),
          );
          if (result._tag === "Failure") {
            failureToast("Could not create thread", squashAtomCommandFailure(result));
          }
          return;
        }
        case "settle":
          await reportFailure("Failed to settle thread", () => settleThread(threadRef));
          return;
        case "unsettle":
          await reportFailure("Failed to un-settle thread", () => unsettleThread(threadRef));
          return;
        case "unsnooze":
          await reportFailure("Failed to wake thread", () => unsnoozeThread(threadRef));
          return;
        case "pin":
          await reportFailure("Failed to pin thread", () => pinThread(threadRef));
          return;
        case "unpin": {
          await reportFailure("Failed to unpin thread", () => confirmAndUnpinThread(threadRef));
          return;
        }
        case "auto-settle:enabled":
        case "auto-settle:disabled":
          await reportFailure("Failed to update auto-settle", () =>
            setThreadAutoSettle(threadRef, action === "auto-settle:enabled"),
          );
          return;
        case "subscription-limit:on":
        case "subscription-limit:off":
          await reportFailure("Failed to update subscription limit", () =>
            setThreadSubscriptionLimitGuard(thread, action === "subscription-limit:on"),
          );
          return;
        case "hide":
        case "unhide":
          await reportFailure(
            action === "hide" ? "Failed to hide thread" : "Failed to unhide thread",
            () => setThreadHidden(threadRef, action === "hide"),
          );
          return;
        case "rename":
          onStartRename();
          return;
        case "regenerate-title":
          if (isRegeneratingTitle) return;
          await reportFailure("Failed to regenerate thread title", () =>
            updateThreadMetadata({
              environmentId: threadRef.environmentId,
              input: { threadId: threadRef.threadId, regenerateTitle: true },
            }),
          );
          return;
        case "mark-unread":
          markThreadUnread(threadRef);
          return;
        case "share-guest":
          openGuestShareDialog(threadRef);
          return;
        case "copy-path": {
          const workspacePath = thread.worktreePath ?? projectCwd;
          if (!workspacePath) {
            toastManager.add(
              stackedThreadToast({
                type: "error",
                title: "Path unavailable",
                description: "This thread does not have a workspace path to copy.",
              }),
            );
            return;
          }
          copyPathToClipboard(workspacePath, { path: workspacePath });
          return;
        }
        case "copy-branch":
          if (thread.branch) {
            copyBranchToClipboard(thread.branch, { branch: thread.branch });
          }
          return;
        case "copy-thread-id":
          copyThreadIdToClipboard(thread.id, { threadId: thread.id });
          return;
        case "export-transcript":
          openTranscriptExportDialog(threadRef);
          return;
        case "link-linear-issue":
          openLinearIssuePicker(threadRef, "link");
          return;
        case "link-slack-thread":
          openSlackMessagePicker(threadRef, "link");
          return;
        case "link-discord-thread":
          openDiscordMessagePicker(threadRef, "link");
          return;
        case "link-notion-page":
          openNotionPagePicker(threadRef, "link");
          return;
        case "link-granola-note":
          openGranolaNotePicker(threadRef, "link");
          return;
        case "link-github-issue":
          openGitHubIssuePicker(threadRef, "link");
          return;
        case "archive": {
          if (confirmThreadArchive) {
            const confirmed = await settlePromise(() =>
              api.dialogs.confirm(`Archive thread "${thread.title}"?`),
            );
            if (confirmed._tag === "Failure" || !confirmed.value) return;
          }
          let didArchive = false;
          const result = await archiveThread(threadRef, {
            onArchived: () => {
              didArchive = true;
            },
          });
          if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
            failureToast(
              didArchive ? "Thread archived, but navigation failed" : "Failed to archive thread",
              squashAtomCommandFailure(result),
            );
          }
          return;
        }
        case "delete": {
          if (confirmThreadDelete) {
            const confirmed = await settlePromise(() =>
              api.dialogs.confirm(
                [
                  `Delete thread "${thread.title}"?`,
                  "This permanently clears conversation history for this thread.",
                ].join("\n"),
                { variant: "destructive" },
              ),
            );
            if (confirmed._tag === "Failure" || !confirmed.value) return;
          }
          const deleted = await deleteThread(threadRef);
          if (
            deleted._tag === "Failure" &&
            !isAtomCommandInterrupted(deleted) &&
            // A missing thread means cleanup failed after deletion; deleteThread already toasted that failure.
            readThreadShell(threadRef) !== null
          ) {
            failureToast("Failed to delete thread", squashAtomCommandFailure(deleted));
          }
          return;
        }
        default:
          return;
      }
    })();
  };

  const closeMenu = () => {
    void readLocalApi()?.contextMenu.close();
  };

  return { openMenu, closeMenu };
}
