import { copyThreadReference } from "../lib/copyThreadReference";
import { threadChipCopyTarget } from "@t3tools/client-runtime/thread-reference";
import { attachSidebarTree, SIDEBAR_TREE_PROPS } from "../lib/sidebarTree";
import { resolveProjectExpanded, useUiStateStore } from "../uiStateStore";
import {
  SidebarProjectFolderHeader,
  sidebarFolderRowId,
} from "./sidebar/SidebarProjectFolderHeader";
import { openSidebarIntegrationLink } from "./sidebar/integrationLinks";
import { useSidebarTabs } from "./sidebar/useSidebarTabs";
import {
  SidebarTabList,
  SidebarTabGroupPreview,
  SidebarTabOverflowRow,
  SidebarTabRow,
} from "./sidebar/SidebarTabRows";
import { groupSidebarThreadsByName, projectSidebarPages } from "./sidebar/pageProjection";
import {
  sidebarThreadView,
  isSidebarThreadGroupedAway,
  buildSidebarFilterFacets,
  sidebarGroupPage,
} from "./sidebar/organization.logic";
import { useSidebarProjectScope } from "./sidebar/useSidebarProjectScope";
import { useSidebarOrganization } from "./sidebar/useSidebarOrganization";
import { createSidebarGroupActions } from "./sidebar/groupActions";
import { partitionSidebarThreads, type SidebarOptimisticDrop } from "./sidebar/partitionThreads";
import { SidebarGroupHeader } from "./sidebar/SidebarGroupHeader";
import { useThreadRouteTarget } from "../hooks/useThreadRouteTarget";
import {
  type ScopedProjectRef,
  type EnvironmentId,
  AuthOrchestrationOperateScope,
  ProjectId,
  type ScopedThreadRef,
  type ThreadId,
} from "@t3tools/contracts";
import { CollapsibleSectionHeader } from "./ui/collapsible-section-header";
import { ThreadContextDragGhost } from "./chat/ThreadContextDragGhost";
import {
  dropThreadContext,
  endThreadContextDrag,
  moveThreadContextDrag as moveThreadContextDragGhost,
} from "./chat/threadContextDrag";
import { discardComposerDraft } from "../lib/discardComposerDraft";
import { requestCustomSnooze } from "./CustomSnoozeDialog";
import { useAtomValue } from "@effect/atom-react";
import * as Schema from "effect/Schema";
import {
  DndContext,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type Modifier,
} from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import { restrictToFirstScrollableAncestor, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  canSnooze,
  effectiveSnoozed,
  threadWokeAt,
} from "@t3tools/client-runtime/state/thread-settled";
import { createInboxReturnTracker } from "@t3tools/client-runtime/state/thread-inbox";
import { sortSettledThreads } from "@t3tools/client-runtime/state/thread-sort";
import {
  nextShownOrder,
  threadSearchMatchKey,
  threadSearchSubject,
  type ShownOrder,
} from "@t3tools/client-runtime/state/thread-search";
import { foldSearchQuery, rankMessageMatches } from "@t3tools/shared/paletteSearch";
import { findForMessageMatch, openThreadFindOnQuery } from "./chat/threadFindStore";
import {
  threadRuntimeCanArchive,
  type EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import {
  threadTabGroupHeaderTarget,
  threadTabGroupTarget,
} from "@t3tools/client-runtime/thread-tabs";
import { useHiddenTabThreads } from "./sidebar/useHiddenTabThreads";
import { resolveThreadTabTarget, useThreadTabRecencyStore } from "../threadTabRecencyStore";
import {
  parseScopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
  scopedThreadKey,
} from "@t3tools/client-runtime/environment";
import type { OlderSettledScope } from "@t3tools/client-runtime/state/threads";

import { ChevronDownIcon, PlusIcon } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { type AnyRouter, useRouter } from "@tanstack/react-router";

import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { isElectron } from "../env";
import {
  resolveShortcutCommand,
  shortcutLabelForCommand,
  shouldShowThreadJumpHintsForModifiers,
  threadJumpCommandForIndex,
  threadJumpIndexFromCommand,
  threadTraversalDirectionFromCommand,
} from "../keybindings";
import { useShortcutModifierState } from "../shortcutModifierState";
import { isTerminalFocused } from "../lib/terminalFocus";
import { isModelPickerOpen } from "../modelPickerVisibility";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../terminalUiStateStore";
import { isMacPlatform, cn } from "~/lib/utils";
import { readLocalApi } from "../localApi";
import { useSidebarPendingFileDropStore } from "../sidebarPendingFileDropStore";
import { selectProjectGroupingSettings } from "@t3tools/client-runtime/state/project-grouping";
import {
  projectGroupsSpanEnvironments,
  getSidebarProjectSettingsKey,
  type SidebarProjectSnapshot,
} from "../sidebarProjectGrouping";
import {
  getThreadKeysToDeselectAfterDelete,
  useThreadSelectionStore,
} from "../threadSelectionStore";
import {
  canTurnThreadIntoProject,
  readThreadSubscriptionLimitGuard,
  useAcknowledgeThreadWoke,
  useThreadActions,
} from "../hooks/useThreadActions";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { useRestartAgentSessionWithToast } from "../hooks/useRestartAgentSession";
import { useSidebarProjectGroups } from "../hooks/useSidebarProjectGroups";
import { useTerminalFocus } from "../hooks/useTerminalFocus";
import { isCommandPaletteOpen, openCommandPalette } from "../commandPaletteBus";
import { registerSettleAndAdvance } from "../settleAndAdvance";
import { startNewThreadFromContext } from "../lib/chatThreadActions";
import {
  useClientSettings,
  updateClientSettings,
  useBoringSidebarEnabled,
} from "../hooks/useSettings";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { useNowMinute } from "../hooks/useNowMinute";
import {
  useEnvironmentIdentities,
  useConnectedEnvironmentIds,
  useEnvironmentMachines,
  usePrimaryEnvironmentId,
} from "../state/environments";
import {
  readEnvironmentLinkIntegrations,
  readProject,
  readThreadShell,
  useProjects,
  useServerConfigs,
  useQuietThreadShells,
  useDelegatedUnderParent,
} from "../state/entities";
import {
  providerEntriesByEnvironmentAtom,
  type ProviderEntrySummary,
} from "../state/providerEntries";

import { primaryServerKeybindingsAtom } from "../state/server";

import { threadEnvironment } from "../state/threads";
import { useOlderSettledShelf, useOlderSettledShelfGrowth } from "../state/olderSettledShelf";
import { useThreadSearch } from "../state/queries";
import { useOrchestrationCommand } from "../state/use-orchestration-command";
import { readEnvironmentScope } from "../state/session";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { canShareWithGuestAtom } from "./chat/guestShareAvailability";
import { openGuestShareDialog } from "./chat/guestShareDialogState";
import {
  buildThreadRouteParams,
  resolveActiveThreadRouteRef,
  resolveThreadRouteTarget,
} from "../threadRoutes";
import { tabSortTimeLabel } from "./sidebar/SidebarTabSummary";
import type { SidebarThreadSummary } from "../types";
import { isScratchProject, threadMoveTargets } from "@t3tools/client-runtime/state/projects";
import { ProjectEnvironmentBadge } from "./ProjectEnvironmentBadge";
import {
  buildDraftActionMenuItems,
  buildThreadActionMenuItems,
  threadActionRequiresOperate,
  collectThreadGroupNames,
  resolveThreadGroupMenuPick,
  resolveThreadProjectMenuPick,
} from "./threadActionMenu.logic";
import { isGitHubProject } from "@t3tools/client-runtime/state/github-issues";
import { openTranscriptExportDialog } from "./TranscriptExportDialog";
import {
  applySidebarThreadDrop,
  filterSidebarV2VisibleThreads,
  groupSidebarThreadsByProject,
  sidebarFolderExpansionKeys,
  buildBulkTitleRegenerationContextMenuItem,
  buildBulkUnpinContextMenuItem,
  deleteSelectedThreadEntries,
  foldedSidebarTabThreads,
  groupSidebarTabThreads,
  isSidebarTabGroupOpen,
  sidebarTabToggleCount,
  sidebarTabGroupRowKey,
  sidebarTabNeighbourKey,
  isSidebarNestedLinkClick,
  isTrailingDoubleClick,
  planSidebarThreadDrop,
  resolveAdjacentThreadId,
  resolveSidebarSweepKeys,
  resolveSidebarDropTarget,
  resolveSidebarDropVerb,
  searchSidebarThreads,
  shouldCreateNewThreadInCurrentProject,
  shouldNavigateAfterThreadPark,
  sidebarListItemId,
  sidebarThreadKeyAtY,
  sortInboxThreadsByReturn,
  withSidebarTabThreads,
  useThreadJumpHintsVisible,
  type SidebarListItem,
  type SidebarSection,
} from "./Sidebar.logic";
import {
  createSidebarCollisionDetection,
  createSidebarSortingStrategy,
  restrictBelowSidebarLabel,
} from "./Sidebar.drag";
import { SidebarPointerSensor } from "./Sidebar.pointer";
import { createSidebarListMotion } from "./Sidebar.motion";
import {
  pickSnoozePreset,
  resolveSnoozePresets,
  snoozeWakeLabel,
  type SnoozePreset,
} from "./Sidebar.snooze";
import { useThreadTabActions } from "./chat/ThreadTabs";
import {
  SPLIT_VIEW_HIDDEN_MEDIA_QUERY,
  useSplitPartner,
  useSplitViewActions,
} from "./chat/splitPane";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { splitMenuAction, useSplitViewStore } from "../splitViewStore";
import { useStableCallback } from "../hooks/useStableCallback";
import {
  pendingSidebarRouteReveal,
  completeSidebarRouteReveal,
  type SidebarRouteReveal,
} from "./sidebar/routeReveal";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { SidebarContent, SidebarGroup, useSidebar } from "./ui/sidebar";
import { SidebarChromeFooter, SidebarChromeHeader } from "./sidebar/SidebarChrome";
import { SidebarAttentionInbox } from "./sidebar/SidebarAttentionInbox";
import { SidebarThreadHeader } from "./sidebar/SidebarThreadHeader";
import {
  SidebarFilterMenu,
  SidebarFilterPills,
  sidebarPageLabel,
} from "./sidebar/SidebarFilterMenu";
import { requestThreadGroup } from "./ThreadGroupDialog";

import { SidebarTabsMenu } from "./sidebar/SidebarTabsMenu";
import { TooltipProvider } from "./ui/tooltip";
import { composerDraftHasUserContent, DraftId, useComposerDraftStore } from "../composerDraftStore";
import {
  SortableTabThreadRow,
  SortableThreadRow,
  type SidebarSweepAction,
  SidebarSearchResultRow,
} from "./sidebar/SidebarThreadRow";
import { SidebarDraftBlock } from "./sidebar/SidebarDraftBlock";
import {
  SortableSidebarMarker,
  SidebarSectionPlaceholder,
  SidebarDragBoundary,
  SidebarSectionHeader,
} from "./sidebar/SidebarListMarkers";

const EMPTY_PROVIDER_ENTRIES: ReadonlyMap<string, ProviderEntrySummary> = new Map();
// Collapsed shelves share one empty list so a route change alone does not
// give the sidebar list a new identity.
const EMPTY_THREADS: readonly EnvironmentThreadShell[] = [];
const SIDEBAR_PAGE_BY_MARKER = {
  "automations-header": "automations",
  "snoozed-header": "snoozed",
  "hidden-header": "hidden",
  "settled-header": "settled",
} as const;
const SETTLED_TAIL_INITIAL_COUNT = 10;
const SETTLED_TAIL_PAGE_COUNT = 25;
const WORKING_SHELF_EXPANDED_KEY = "t3code:sidebar:working-expanded";
const inboxReturns = createInboxReturnTracker();
function canOperateThreads(
  threads: ReadonlyArray<Pick<SidebarThreadSummary, "environmentId">>,
): boolean {
  return threads.every((thread) =>
    readEnvironmentScope(thread.environmentId, AuthOrchestrationOperateScope),
  );
}
function checkThreadOperations(
  threads: ReadonlyArray<Pick<SidebarThreadSummary, "environmentId">>,
): boolean {
  if (canOperateThreads(threads)) return true;
  toastManager.add({
    type: "error",
    title: "Thread action unavailable",
    description: "This connection cannot change one or more selected threads.",
  });
  return false;
}
const EMPTY_TABS_BY_ROW: ReadonlyMap<string, readonly EnvironmentThreadShell[]> = new Map();
function sidebarThreadKey(thread: EnvironmentThreadShell): string {
  return scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
}
const SIDEBAR_DRAG_DISTANCE = 6;
const SIDEBAR_DRAG_LABEL_HEIGHT = 24;
function olderSettledScopes(
  environmentIds: ReadonlyArray<EnvironmentId>,
  scopedProjectKeys: ReadonlySet<string> | null,
): ReadonlyArray<OlderSettledScope> {
  if (scopedProjectKeys === null) {
    return environmentIds.map((environmentId) => ({ environmentId, projectIds: null }));
  }
  return environmentIds.flatMap((environmentId) => {
    const prefix = `${environmentId}:`;
    const projectIds = [...scopedProjectKeys].flatMap((key) =>
      key.startsWith(prefix) ? [ProjectId.make(key.slice(prefix.length))] : [],
    );
    return projectIds.length === 0 ? [] : [{ environmentId, projectIds }];
  });
}

// Continuations that outlive a render read the open thread from the router.
function readRouteThreadKey(router: AnyRouter): string | null {
  const target = resolveThreadRouteTarget(router.state.matches.at(-1)?.params ?? {});
  const draft =
    target?.kind === "draft"
      ? useComposerDraftStore.getState().getDraftSession(target.draftId)
      : null;
  const ref = resolveActiveThreadRouteRef(target, draft);
  return ref === null ? null : scopedThreadKey(ref);
}

export default function Sidebar({ routeReveal }: { routeReveal: SidebarRouteReveal }) {
  const projects = useProjects();
  const threads = useQuietThreadShells();
  const inboxReturnsVersion = useSyncExternalStore(
    inboxReturns.subscribe,
    inboxReturns.getSnapshot,
  );
  const {
    hiddenTabThreads: tabThreadGroups,
    tabEnvironmentIds,
    groupNames: tabGroupNames,
  } = useHiddenTabThreads(threads);
  const { createTab, closeTab } = useThreadTabActions();
  const restartAgentSession = useRestartAgentSessionWithToast();
  const splitViewActions = useSplitViewActions();
  const threadViews = useClientSettings((s) => s.sidebarThreadViews);
  const {
    showTabs,
    tabLimit,
    tabSortOrder,
    tabSortDirection,
    tabManualRanks,
    expandedTabRowKey,
    setExpandedTabRowKey,
    openedAtByThreadKey,
    tabGroupOverrides,
    layoutTabGroups,
    toggleTabGroup,
    nameTabGroup,
    tabLayoutByRowKeyRef,
    commitTabLayout,
    toggleTabOverflow,
    handleTabPointerRest,
    handleTabOverflowPreview,
    handleTabReorder,
    handleTabsShownChange,
    handleTabSortOrderChange,
    handleTabSortDirectionChange,
  } = useSidebarTabs(threads, tabGroupNames);
  const hiddenTabThreads = foldedSidebarTabThreads(tabThreadGroups, tabGroupOverrides, showTabs);
  const router = useRouter();
  const { isMobile, setOpenMobile } = useSidebar();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const confirmThreadDelete = useClientSettings((s) => s.confirmThreadDelete);
  const confirmThreadArchive = useClientSettings((s) => s.confirmThreadArchive);
  const timestampFormat = useClientSettings((s) => s.timestampFormat);
  const boringSidebarEnabled = useBoringSidebarEnabled();
  const workingShelfEnabled =
    useClientSettings((s) => s.sidebarWorkingShelfEnabled) && !boringSidebarEnabled;
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const {
    settleThread,
    unsettleThread,
    snoozeThread,
    unsnoozeThread,
    pinThread,
    unpinThread,
    confirmAndUnpinThread,
    setThreadAutoSettle,
    setThreadSubscriptionLimitGuard,
    setThreadHidden,
    setThreadGroup,
    confirmAndMoveThreadToProject,
    turnThreadIntoProject,
    reorderPinnedThread,
    reorderActiveThread,
    markThreadUnread,
    archiveThread,
    deleteThread,
  } = useThreadActions();
  const updateThreadMetadata = useOrchestrationCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const { copyToClipboard: copyPathToClipboard } = useCopyToClipboard<{
    path: string;
  }>({
    onCopy: ({ path }) => {
      toastManager.add({
        type: "success",
        title: "Path copied",
        description: path,
      });
    },
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to copy path",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    },
  });
  const { copyToClipboard: copyBranchToClipboard } = useCopyToClipboard<{
    branch: string;
  }>({
    target: "branch name",
    onCopy: ({ branch }) => {
      toastManager.add({
        type: "success",
        title: "Branch copied",
        description: branch,
      });
    },
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to copy branch",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    },
  });
  const { copyToClipboard: copyThreadIdToClipboard } = useCopyToClipboard<{
    threadId: ThreadId;
  }>({
    onCopy: ({ threadId }) => {
      toastManager.add({
        type: "success",
        title: "Thread ID copied",
        description: threadId,
      });
    },
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to copy thread ID",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    },
  });
  const folderRowsMultiline = useClientSettings((settings) => settings.boringSidebarMultilineRows);
  const newThreadContext = useHandleNewThread();
  const { handleNewThread } = newThreadContext;
  const openAddProjectCommandPalette = () => openCommandPalette({ open: "add-project" });
  const environments = useEnvironmentIdentities();
  const serverConfigs = useServerConfigs();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const clearSelection = useThreadSelectionStore((s) => s.clearSelection);
  const setSelectionAnchor = useThreadSelectionStore((s) => s.setAnchor);
  const toggleThreadSelection = useThreadSelectionStore((s) => s.toggleThread);
  const rangeSelectTo = useThreadSelectionStore((s) => s.rangeSelectTo);
  const acknowledgeWoke = useAcknowledgeThreadWoke();
  const routeTarget = useThreadRouteTarget();
  const routeDraftThread = useComposerDraftStore((store) =>
    routeTarget?.kind === "draft" ? store.getDraftSession(routeTarget.draftId) : null,
  );
  const routeThreadRef = resolveActiveThreadRouteRef(routeTarget, routeDraftThread);
  const routeThreadKey = routeThreadRef ? scopedThreadKey(routeThreadRef) : null;
  // The open thread's group row, which must stay rendered even inside a collapsed shelf.
  const sidebarRouteThreadKey =
    routeThreadKey === null ? null : (tabThreadGroups.get(routeThreadKey) ?? routeThreadKey);
  // A listed tab carries its own highlight; a folded one lights its group's row.
  const highlightedRouteThreadKey =
    routeThreadKey === null ? null : (hiddenTabThreads.get(routeThreadKey) ?? routeThreadKey);
  // The chat shown beside the routed one in split view, mapped to its row the same way.
  const splitHidden = useMediaQuery(SPLIT_VIEW_HIDDEN_MEDIA_QUERY);
  const splitPartnerRef = useSplitPartner(
    routeTarget?.kind === "server" && !splitHidden ? routeThreadRef : null,
  );
  const splitPartnerThreadKey = splitPartnerRef ? scopedThreadKey(splitPartnerRef) : null;
  const splitPartnerRowKey =
    splitPartnerThreadKey === null
      ? null
      : (hiddenTabThreads.get(splitPartnerThreadKey) ?? splitPartnerThreadKey);
  // Rows the "more" fold never hides: the routed chat's and its split partner's.
  const openRowKeys = [highlightedRouteThreadKey, splitPartnerRowKey].filter(
    (key): key is string => key !== null,
  );
  const isSplitRowKey = (key: string) =>
    splitPartnerRowKey !== null &&
    (key === splitPartnerRowKey || key === highlightedRouteThreadKey);
  const routeTargetRef = useRef(routeTarget);

  const routeThreadKeyRef = useRef(routeThreadKey);

  const environmentLabelById = new Map(
    environments.map((environment) => [environment.environmentId, environment.label] as const),
  );
  const environmentMachineById = useEnvironmentMachines();
  const projectGroups = useSidebarProjectGroups();
  const projectGroupsRef = useRef(projectGroups);

  const providerEntriesByEnvironment = useAtomValue(providerEntriesByEnvironmentAtom);
  const projectByKey = new Map(
    projects.map((project) => [`${project.environmentId}:${project.id}`, project]),
  );
  const projectDisplayNameByKey = new Map(
    projectGroups.flatMap((group) =>
      group.memberProjects.map(
        (project) => [`${project.environmentId}:${project.id}`, group.displayName] as const,
      ),
    ),
  );
  const delegatedUnderParent = useDelegatedUnderParent();
  const nowMinute = useNowMinute();
  // Snooze wake times are second-precise, so classifying with the quantized
  // minute would hold a woken thread on the shelf for up to a minute.
  const [snoozeWakeTick, bumpSnoozeWakeTick] = useState(() => Date.now());
  const {
    persistedProjectScopeKeys,
    setProjectScopeKeys,
    projectScopeKeys,
    scopedProjectGroups,
    storedOrganisationKeys,
    setOrganisationKeys,
    scopedOrganisationKeys,
    organisationOptions,
    scopedProjectKeys,
  } = useSidebarProjectScope(projectGroups, projectGroupingSettings);
  const showProjectEnvironments = projectGroupsSpanEnvironments(projectGroups);
  const scratchMachineLabelFor = (
    thread: Pick<SidebarThreadSummary, "environmentId" | "projectId">,
  ) => {
    if (!showProjectEnvironments) return null;
    const project = projectByKey.get(`${thread.environmentId}:${thread.projectId}`);
    if (
      !project ||
      !isScratchProject(project, serverConfigs.get(thread.environmentId)?.scratchWorkspaceRoot)
    ) {
      return null;
    }
    return environmentLabelById.get(thread.environmentId) ?? null;
  };
  const routeDraftIdForRows = routeTarget?.kind === "draft" ? routeTarget.draftId : null;
  const visibleDraftSessionCount = useComposerDraftStore((store) => {
    let count = 0;
    for (const [draftKey, session] of Object.entries(store.draftThreadsByThreadKey)) {
      if (session.promotedTo != null) {
        continue;
      }
      if (!composerDraftHasUserContent(store.draftsByThreadKey[draftKey])) {
        continue;
      }
      if (
        scopedProjectKeys !== null &&
        !scopedProjectKeys.has(`${session.environmentId}:${session.projectId}`)
      ) {
        continue;
      }
      count += 1;
    }
    return count;
  });
  const selectionScope = { clearSelection, projectScopeKeys, scopedOrganisationKeys };
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- clears the external thread-selection store when sidebar scope changes
  useEffect(() => {
    selectionScope.clearSelection();
  }, [selectionScope]);
  const openProjectSettings = useStableCallback(
    (projectGroup: SidebarProjectSnapshot, projectRef?: ScopedProjectRef) => {
      if (isMobile) {
        setOpenMobile(false);
      }
      void router.navigate({
        to: "/projects/$projectKey",
        params: {
          projectKey: getSidebarProjectSettingsKey(
            projectGroup,
            projectGroupingSettings,
            projects,
            projectRef,
          ),
        },
      });
    },
  );
  const handleProjectSettings = useStableCallback(
    (event: ReactMouseEvent<HTMLElement>, projectGroup: SidebarProjectSnapshot) => {
      event.preventDefault();
      event.stopPropagation();
      openProjectSettings(projectGroup);
    },
  );
  // Groups are names threads share, so they are read off every thread, not just the scoped ones.
  const {
    threadGroups,
    saveGroup,
    deleteGroup,
    groupsShownInThreads,
    sidebarPages,
    setSidebarPages,
    availablePages,
    collapsedPages,
    setCollapsedPages,
    togglePageCollapsed,
  } = useSidebarOrganization(threads);
  // Keep a dropped row at its destination while its server applies the
  // lifecycle command and any order-key writes. The next pickup waits for
  // this hold so a second drop cannot replace an unconfirmed placement.
  const [optimisticDrop, setOptimisticDrop] = useState<SidebarOptimisticDrop | null>(null);
  const {
    pinnedThreads,
    draggableThreadKeys,
    activeReorderableThreadKeys,
    activeThreads,
    workingThreads,
    snoozedThreads,
    hiddenThreads,
    groupedThreads,
    shownGroupThreads,
    automationThreads,
    settledThreads,
    facetThreads,
    snoozeNow,
  } = partitionSidebarThreads({
    delegatedUnderParent,
    inboxReturns,
    threads,
    tabThreadGroups,
    groupsShownInThreads,
    serverConfigs,
    scopedProjectKeys,
    optimisticDrop,
    workingShelfEnabled,
    sortActiveBySend: boringSidebarEnabled,
    clockKey: `${nowMinute}:${snoozeWakeTick}:${inboxReturnsVersion}`,
  });
  const projectExpandedById = useUiStateStore((store) => store.projectExpandedById);
  const setProjectExpanded = useUiStateStore((store) => store.setProjectExpanded);
  const folderGroups = boringSidebarEnabled
    ? scopedProjectGroups.length === 0
      ? projectGroups
      : scopedProjectGroups
    : null;
  const projectFolders =
    folderGroups === null
      ? null
      : groupSidebarThreadsByProject(
          folderGroups,
          activeThreads,
          scopedProjectGroups.length > 0,
        ).map((folder) => {
          const collapsed = !resolveProjectExpanded(
            projectExpandedById,
            sidebarFolderExpansionKeys(folder.group),
          );
          return {
            group: folder.group,
            collapsed,
            threads: collapsed
              ? folder.threads.filter(
                  (thread) => sidebarThreadKey(thread) === sidebarRouteThreadKey,
                )
              : folder.threads,
            hiddenThreads: collapsed
              ? folder.threads.filter(
                  (thread) => sidebarThreadKey(thread) !== sidebarRouteThreadKey,
                )
              : [],
          };
        });
  const toggleProjectFolder = (group: SidebarProjectSnapshot) => {
    const keys = sidebarFolderExpansionKeys(group);
    setProjectExpanded(keys, !resolveProjectExpanded(projectExpandedById, keys));
  };
  const startThreadInProjectFolder = (group: SidebarProjectSnapshot) => {
    if (isMobile) setOpenMobile(false);
    void handleNewThread(scopeProjectRef(group.environmentId, group.id));
  };
  const handleProjectFolderContextMenu = (
    group: SidebarProjectSnapshot,
    position: { x: number; y: number },
  ) => {
    const api = readLocalApi();
    if (!api) return;
    void (async () => {
      const clicked = await settlePromise(() =>
        api.contextMenu.show(
          [
            { id: "new-thread", label: "New thread" },
            { id: "copy-path", label: "Copy path" },
            { id: "project-settings", label: "Project settings", icon: "settings" },
          ],
          position,
        ),
      );
      if (clicked._tag === "Failure") return;
      switch (clicked.value) {
        case "new-thread":
          startThreadInProjectFolder(group);
          return;
        case "copy-path":
          copyPathToClipboard(group.workspaceRoot, { path: group.workspaceRoot });
          return;
        case "project-settings":
          openProjectSettings(group);
          return;
      }
    })();
  };
  const tabsByRowKey =
    tabThreadGroups.size === 0
      ? EMPTY_TABS_BY_ROW
      : groupSidebarTabThreads(
          new Map(threads.map((thread) => [sidebarThreadKey(thread), thread] as const)),
          tabThreadGroups,
        );
  const listedTabsByRowKey = (() => {
    const listed = [...tabsByRowKey].filter(([rowKey]) =>
      isSidebarTabGroupOpen(rowKey, tabGroupOverrides, showTabs),
    );
    return listed.length === 0 ? EMPTY_TABS_BY_ROW : new Map(listed);
  })();
  const displayTabsByRowKey = (() => {
    const displayTabs = new Map<string, EnvironmentThreadShell>();
    for (const [rowKey, tabs] of tabsByRowKey) {
      if (listedTabsByRowKey.has(rowKey)) continue;
      const targetKey = threadTabGroupTarget(
        rowKey,
        new Map(tabs.map((tab) => [sidebarThreadKey(tab), rowKey])),
        openedAtByThreadKey,
      );
      const tab = tabs.find((tab) => sidebarThreadKey(tab) === targetKey);
      if (tab) displayTabs.set(rowKey, tab);
    }
    return displayTabs;
  })();
  const threadSearchInputRef = useRef<HTMLInputElement>(null);
  const [threadSearchQuery, setThreadSearchQuery] = useState("");
  const [isThreadSearchApplied, setIsThreadSearchApplied] = useState(false);
  const [searchHighlightKey, setSearchHighlightKey] = useState<string | null>(null);
  const isSearchingThreads = threadSearchQuery.trim().length > 0;
  const searchableThreads = withSidebarTabThreads(
    [
      ...pinnedThreads,
      ...activeThreads,
      ...workingThreads,
      ...groupedThreads,
      ...automationThreads,
      ...snoozedThreads,
      ...hiddenThreads,
      ...settledThreads,
    ],
    sidebarThreadKey,
    listedTabsByRowKey,
  );
  const searchEnvironmentIds = useConnectedEnvironmentIds();
  const threadSearch = useThreadSearch(searchEnvironmentIds, threadSearchQuery);

  // History, the command palette, and links can open a thread the project
  // scope hides or the list has scrolled away. A remount starts the list at
  // the top, so each mount also scrolls to the open thread once, without
  // widening the scope.
  const mountRevealOwed = useRef(true);
  const revealRouteRow = useStableCallback(() => {
    const pendingKey = pendingSidebarRouteReveal(routeReveal, sidebarRouteThreadKey);
    // Search results replace the thread list; reveal once the list returns.
    if (isSearchingThreads) return;
    const revealKey = pendingKey ?? (mountRevealOwed.current ? sidebarRouteThreadKey : null);
    if (revealKey === null) return;
    const thread = threads.find((candidate) => sidebarThreadKey(candidate) === revealKey);
    if (thread === undefined) return;
    if (
      pendingKey !== null &&
      scopedProjectKeys !== null &&
      filterSidebarV2VisibleThreads([thread], scopedProjectKeys, delegatedUnderParent).length ===
        0 &&
      filterSidebarV2VisibleThreads([thread], null, delegatedUnderParent).length === 1
    ) {
      // The row renders under the widened scope; scroll on that pass.
      setProjectScopeKeys([]);
      setOrganisationKeys([]);
      return;
    }
    const activeRow = document.querySelector('[data-sidebar="content"] [aria-current="page"]');
    if (!activeRow) return;
    completeSidebarRouteReveal(routeReveal);
    mountRevealOwed.current = false;
    activeRow.scrollIntoView({ block: "nearest" });
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Scroll the newly routed row after its environment shells mount.
  useEffect(revealRouteRow, [
    revealRouteRow,
    sidebarRouteThreadKey,
    threads,
    persistedProjectScopeKeys,
    storedOrganisationKeys,
    isSearchingThreads,
  ]);

  // Ranked across environments as the palette ranks them, so one
  // environment's list does not sit above another's better matches; rows
  // already shown keep their places while slower environments answer.
  const threadByMatchKey =
    threadSearch.matches.length === 0
      ? null
      : new Map(
          searchableThreads.map((thread) => [
            threadSearchMatchKey({ environmentId: thread.environmentId, threadId: thread.id }),
            thread,
          ]),
        );
  const rankedServerMatches =
    threadByMatchKey === null
      ? []
      : rankMessageMatches(
          threadSearch.matches,
          (match) => {
            const thread = threadByMatchKey.get(threadSearchMatchKey(match));
            return thread ? threadSearchSubject(thread, null) : undefined;
          },
          foldSearchQuery(threadSearchQuery),
          // oxlint-disable-next-line react/purity -- Recency ranking samples the clock when the search matches change; the compiler recomputes it only then.
          Date.now(),
          // A list filter, as on mobile: a pick would move rows unexplained.
          { picks: false },
        );
  const serverMatchByKey = new Map(
    rankedServerMatches.map((match) => [threadSearchMatchKey(match), match] as const),
  );
  const [shownMessageOrder, setShownMessageOrder] = useState<ShownOrder | null>(null);
  const messageOrder = nextShownOrder(
    shownMessageOrder,
    threadSearch.query,
    [...serverMatchByKey.keys()],
    Number.POSITIVE_INFINITY,
  );
  if (messageOrder !== shownMessageOrder) setShownMessageOrder(messageOrder);
  const { titleMatches: threadTitleResults, contentMatches: threadContentResults } =
    searchSidebarThreads(
      searchableThreads,
      threadSearchQuery,
      new Set(messageOrder.keys),
      // oxlint-disable-next-line react/purity -- Recency ranking samples the clock when the search matches change; the compiler recomputes it only then.
      Date.now(),
      tabGroupNames,
    );
  const threadSearchResults = [...threadTitleResults, ...threadContentResults];
  // Only rows listed for their messages show one, and open find on it.
  const threadSearchMatchByKey = new Map(
    threadContentResults.flatMap((thread) => {
      const key = threadSearchMatchKey({
        environmentId: thread.environmentId,
        threadId: thread.id,
      });
      const match = serverMatchByKey.get(key);
      return match ? [[key, match] as const] : [];
    }),
  );
  const moveSearchHighlight = (step: 1 | -1) => {
    const count = threadSearchResults.length;
    setActiveSearchResultIndex((activeSearchResultIndex + step + count) % count);
  };
  const threadSearchResultKeys = threadSearchResults.map((thread) =>
    scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
  );

  // The highlight follows its thread, so rows that arrive late do not move
  // it under Enter; a new query starts at the top.
  const activeSearchResultIndex = Math.max(
    0,
    searchHighlightKey === null ? 0 : threadSearchResultKeys.indexOf(searchHighlightKey),
  );
  const setActiveSearchResultIndex = (index: number | ((index: number) => number)) =>
    setSearchHighlightKey(
      threadSearchResultKeys[
        typeof index === "function" ? index(activeSearchResultIndex) : index
      ] ?? null,
    );
  const activeSearchResultKey = isSearchingThreads
    ? (threadSearchResultKeys[activeSearchResultIndex] ?? null)
    : null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Keep the highlighted search row inside the browser scroll viewport.
  useEffect(() => {
    if (activeSearchResultKey === null) return;
    document
      .querySelector(`[data-search-result-key="${activeSearchResultKey}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeSearchResultKey]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Arm the next precise snooze wake against the browser clock.
  useEffect(() => {
    const nextWakeAtMs =
      snoozedThreads.length > 0 && snoozedThreads[0]?.snoozedUntil != null
        ? Date.parse(snoozedThreads[0].snoozedUntil)
        : Number.NaN;
    if (Number.isNaN(nextWakeAtMs)) return;
    // setTimeout delays are signed 32-bit: anything larger overflows and fires
    // immediately, turning a far-future wake (event-condition snoozes synced
    // from elsewhere) into a tight re-arm loop.
    // oxlint-disable-next-line react/purity -- Measures the wake delay inside the effect, not during render.
    const delayMs = Math.min(Math.max(0, nextWakeAtMs - new Date().getTime()) + 50, 2147483647);
    const id = window.setTimeout(() => bumpSnoozeWakeTick(Date.now()), delayMs);
    return () => window.clearTimeout(id);
  }, [snoozedThreads]);
  // A group shown in Threads lists only the members no other picked page already lists.
  const groupedThreadsByName = groupSidebarThreadsByName(
    groupedThreads,
    shownGroupThreads,
    sidebarPages,
  );
  const [settledVisibleCount, setSettledVisibleCount] = useState(SETTLED_TAIL_INITIAL_COUNT);
  const settledResetKey = JSON.stringify([projectScopeKeys, scopedOrganisationKeys]);
  const [lastSettledResetKey, setLastSettledResetKey] = useState(settledResetKey);
  if (lastSettledResetKey !== settledResetKey) {
    setLastSettledResetKey(settledResetKey);
    setSettledVisibleCount(SETTLED_TAIL_INITIAL_COUNT);
  }
  const olderSettledShelf = useOlderSettledShelf({
    scopes: olderSettledScopes([...serverConfigs.keys()], scopedProjectKeys),
    expanded: sidebarPages.includes("settled") && !collapsedPages.has("settled"),
    visibleCount: settledVisibleCount,
  });
  const listedSettledThreads = settledThreads.filter(olderSettledShelf.isListed);
  useOlderSettledShelfGrowth(olderSettledShelf, listedSettledThreads);
  const settledCount = settledThreads.length + olderSettledShelf.unloadedCount(threads);
  const visibleSettledThreads = (() => {
    const visible = listedSettledThreads.slice(0, settledVisibleCount);
    if (
      sidebarRouteThreadKey !== null &&
      !visible.some((thread) => sidebarThreadKey(thread) === sidebarRouteThreadKey)
    ) {
      const routeThread = settledThreads.find(
        (thread) => sidebarThreadKey(thread) === sidebarRouteThreadKey,
      );
      if (routeThread !== undefined) visible.push(routeThread);
    }
    return visible;
  })();
  const hiddenSettledCount = settledCount - visibleSettledThreads.length;
  const showMoreSettled = () => setSettledVisibleCount((count) => count + SETTLED_TAIL_PAGE_COUNT);
  // Show, Organisations and Projects each count the threads the other two let through.
  const filterFacets = buildSidebarFilterFacets({
    threads: facetThreads,
    projects: projectGroups,
    pages: sidebarPages,
    scopedProjectKeys: projectScopeKeys,
    scopedOrganisationKeys,
  });
  const pageCounts = new Map(filterFacets.pageCounts);
  pageCounts.set("settled", settledCount);
  const filterOrganisationOptions = organisationOptions.filter((option) =>
    filterFacets.organisationKeys.has(option.key),
  );
  const {
    visibleGroups,
    showsPage,
    showsThreads,
    threadsOnly,
    visibleAutomationThreads,
    renderedSettledThreads,
    visibleSnoozedThreads,
    visibleHiddenThreads,
  } = projectSidebarPages({
    sidebarPages,
    collapsedPages,
    sidebarRouteThreadKey,
    groupedThreadsByName,
    automationThreads,
    visibleSettledThreads,
    snoozedThreads,
    hiddenThreads,
  });
  // Navigating anywhere folds an expanded tab list back to its limit.
  const [expandedForRouteKey, setExpandedForRouteKey] = useState(routeThreadKey);
  if (expandedForRouteKey !== routeThreadKey) {
    setExpandedForRouteKey(routeThreadKey);
    setExpandedTabRowKey(null);
  }
  const tabLayoutByRowKey = layoutTabGroups(
    listedTabsByRowKey,
    listedTabsByRowKey.size === 0
      ? EMPTY_THREADS
      : [
          ...(threadViews.pinned === "card" ? pinnedThreads : []),
          ...(threadViews.active === "card" ? activeThreads : []),
          ...(threadViews.working === "card" ? workingThreads : []),
          ...visibleGroups.flatMap((group) =>
            sidebarThreadView("grouped", group.name, threadGroups, threadViews) === "card"
              ? group.threads
              : [],
          ),
          // Automations is a built-in group, so it takes the groups' view.
          ...(threadViews.grouped === "card" ? visibleAutomationThreads : []),
          ...(threadViews.hidden === "card" ? visibleHiddenThreads : []),
          ...(threadViews.snoozed === "card" ? visibleSnoozedThreads : []),
          ...(threadViews.settled === "card" ? renderedSettledThreads : []),
        ],
    openRowKeys,
  );

  const shownTabsByRowKey =
    tabLayoutByRowKey.size === 0
      ? EMPTY_TABS_BY_ROW
      : new Map([...tabLayoutByRowKey].map(([rowKey, layout]) => [rowKey, layout.shown]));
  const [workingShelfExpanded, setWorkingShelfExpanded] = useLocalStorage(
    WORKING_SHELF_EXPANDED_KEY,
    false,
    Schema.Boolean,
  );
  const projectChoiceCount = projectGroups.length;
  const toggleWorkingShelf = () => setWorkingShelfExpanded((value) => !value);
  const visibleWorkingThreads = (() => {
    if (workingShelfExpanded) return workingThreads;
    if (sidebarRouteThreadKey === null) return EMPTY_THREADS;
    const routeThread = workingThreads.find(
      (thread) =>
        scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)) === sidebarRouteThreadKey,
    );
    return routeThread === undefined ? EMPTY_THREADS : [routeThread];
  })();
  // Every thread that renders a row, in list order, before tabs are spliced in.
  const rowThreads = [
    ...(showsThreads ? [...pinnedThreads, ...activeThreads, ...visibleWorkingThreads] : []),
    ...visibleGroups.flatMap((group) => group.threads),
    ...visibleAutomationThreads,
    ...visibleSnoozedThreads,
    ...visibleHiddenThreads,
    ...renderedSettledThreads,
  ];
  const orderedThreads = withSidebarTabThreads(
    rowThreads,
    sidebarThreadKey,
    shownTabsByRowKey,
    (rowKey) => tabLayoutByRowKey.get(rowKey)?.listsRow === true,
  );
  const orderedThreadKeys = orderedThreads.map((thread) =>
    scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
  );
  const orderedThreadKeysRef = useRef(orderedThreadKeys);

  // Every row's thread as well as the shown tabs: a card whose tab list stands in for it can
  // sort its own thread past the tab limit, yet the row still renders and drags by that key.
  const threadByKey = new Map(
    [...rowThreads, ...orderedThreads].map((thread) => [sidebarThreadKey(thread), thread] as const),
  );
  // Handlers read these through refs: depending on per-update Map/Set
  // identities would give every row a fresh callback prop on each shell
  // event and defeat row memoization during streaming.
  const threadByKeyRef = useRef(threadByKey);

  const handleNewThreadRef = useRef(newThreadContext.handleNewThread);

  const settledThreadKeys = new Set(
    settledThreads.map((thread) =>
      scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
    ),
  );
  const settledThreadKeysRef = useRef(settledThreadKeys);

  const snoozedThreadKeys = new Set(
    snoozedThreads.map((thread) =>
      scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
    ),
  );
  const snoozedThreadKeysRef = useRef(snoozedThreadKeys);

  const jumpLabelByKey = (() => {
    const mapping = new Map<string, string>();
    for (const [index, threadKey] of orderedThreadKeys.entries()) {
      const jumpCommand = threadJumpCommandForIndex(index);
      if (!jumpCommand) break;
      const label = shortcutLabelForCommand(keybindings, jumpCommand);
      if (label) mapping.set(threadKey, label);
    }
    return mapping;
  })();
  const tabThreadGroupsRef = useRef(tabThreadGroups);

  const openThreadRoute = (threadRef: ScopedThreadRef, target: ScopedThreadRef) => {
    if (useThreadSelectionStore.getState().selectedThreadKeys.size > 0) {
      clearSelection();
    }
    setSelectionAnchor(scopedThreadKey(threadRef));
    if (isMobile) {
      setOpenMobile(false);
    }
    return router.navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(target),
    });
  };
  const navigateToThread = (threadRef: ScopedThreadRef, keepOpenGroupTab = false) =>
    openThreadRoute(
      threadRef,
      keepOpenGroupTab
        ? (parseScopedThreadKey(
            threadTabGroupHeaderTarget(
              scopedThreadKey(threadRef),
              routeThreadKeyRef.current,
              tabThreadGroupsRef.current,
              hiddenTabThreads,
              useThreadTabRecencyStore.getState().openedAtByThreadKey,
            ),
          ) ?? threadRef)
        : resolveThreadTabTarget(threadRef, hiddenTabThreads),
    );
  // A tab picked from a list opens itself, even the tab that stands for its folded group.
  const openTab = (threadRef: ScopedThreadRef) => openThreadRoute(threadRef, threadRef);
  // New tabs join the clicked thread's group and start on its model.
  const handleNewTab = (threadRef: ScopedThreadRef) => {
    // Compact rows act on the displayed tab, which can be hidden from the ordered list.
    const thread = readThreadShell(threadRef);
    if (!thread) return;
    if (isMobile) setOpenMobile(false);
    void createTab(threadRef, thread.modelSelection);
  };
  const handleCloseTab = (threadRef: ScopedThreadRef) => {
    // The next tab down the list as sorted, else the one above; it may sit past the limit.
    const threadKey = scopedThreadKey(threadRef);
    const rowKey = tabThreadGroupsRef.current.get(threadKey) ?? threadKey;
    const ordered = tabLayoutByRowKeyRef.current.get(rowKey)?.ordered.map(sidebarThreadKey);
    const index = ordered?.indexOf(threadKey) ?? -1;
    const nextKey =
      ordered !== undefined && index !== -1
        ? (ordered[index + 1] ?? ordered[index - 1] ?? null)
        : sidebarTabNeighbourKey(threadKey, tabThreadGroupsRef.current);
    const nextRef = nextKey === null ? null : parseScopedThreadKey(nextKey);
    if (nextRef === null || readThreadShell(nextRef) === null) return;
    void closeTab(threadRef, nextRef);
  };
  const queuePendingFileDrop = useSidebarPendingFileDropStore((s) => s.queuePendingFileDrop);
  const clearPendingFileDrop = useSidebarPendingFileDropStore((s) => s.clearPendingFileDrop);
  const handleThreadFileDrop = async (rowThreadRef: ScopedThreadRef, files: File[]) => {
    const threadRef = resolveThreadTabTarget(rowThreadRef, hiddenTabThreads);
    // Queued, not replaced: a second drop before the thread opens keeps
    // both files, and the id lets cleanup below touch only this drop.
    const dropId = queuePendingFileDrop({ threadRef, files });
    const landedBefore =
      router.buildLocation({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(threadRef),
      }).pathname === router.state.location.pathname;
    if (landedBefore) return;
    try {
      await navigateToThread(threadRef);
      const landed =
        router.buildLocation({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(threadRef),
        }).pathname === router.state.location.pathname;
      if (!landed) clearPendingFileDrop(dropId);
    } catch {
      clearPendingFileDrop(dropId);
    }
  };
  const navigateToDraft = (draftId: DraftId) => {
    clearSelection();
    if (isMobile) {
      setOpenMobile(false);
    }
    void router.navigate({ to: "/draft/$draftId", params: { draftId } });
  };
  const clearThreadSearch = () => {
    setThreadSearchQuery("");
    setIsThreadSearchApplied(false);
    setSearchHighlightKey(null);
  };
  const selectThreadSearchResult = (thread: EnvironmentThreadShell) => {
    setIsThreadSearchApplied(true);
    threadSearchInputRef.current?.blur();
    const ref = scopeThreadRef(thread.environmentId, thread.id);
    const match = threadSearchMatchByKey.get(
      threadSearchMatchKey({ environmentId: thread.environmentId, threadId: thread.id }),
    );
    navigateToThread(ref);
    if (match && match.source !== "group_name")
      openThreadFindOnQuery(scopedThreadKey(ref), findForMessageMatch(match, threadSearch.query));
  };
  const handleThreadSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape" && isSearchingThreads) {
      event.preventDefault();
      event.stopPropagation();
      clearThreadSearch();
      return;
    }
    if (threadSearchResults.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveSearchHighlight(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveSearchHighlight(-1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const result = threadSearchResults[activeSearchResultIndex];
      if (result) selectThreadSearchResult(result);
    }
  };
  const [renamingThreadRef, setRenamingThreadRef] = useState<ScopedThreadRef | null>(null);
  const renamingThreadKey = renamingThreadRef ? scopedThreadKey(renamingThreadRef) : null;
  const [renamingTitle, setRenamingTitle] = useState("");
  const startThreadRename = (threadRef: ScopedThreadRef, title: string) => {
    if (!readEnvironmentScope(threadRef.environmentId, AuthOrchestrationOperateScope)) return;
    setRenamingThreadRef(threadRef);
    setRenamingTitle(title);
  };
  const cancelThreadRename = () => setRenamingThreadRef(null);
  const commitThreadRename = (threadRef: ScopedThreadRef, title: string, originalTitle: string) => {
    void (async () => {
      if (!readEnvironmentScope(threadRef.environmentId, AuthOrchestrationOperateScope)) return;
      const trimmed = title.trim();
      setRenamingThreadRef(null);
      if (trimmed.length === 0) {
        toastManager.add({
          type: "warning",
          title: "Thread title cannot be empty",
        });
        return;
      }
      if (trimmed === originalTitle) return;
      const result = await updateThreadMetadata({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId, title: trimmed },
      });
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to rename thread",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
    })();
  };
  const handleThreadClick = (
    event: ReactMouseEvent,
    threadRef: ScopedThreadRef,
    keepOpenGroupTab = false,
  ) => {
    if (isSidebarNestedLinkClick(event.target)) return;
    const isMac = isMacPlatform(navigator.platform);
    const isModClick = isMac ? event.metaKey : event.ctrlKey;
    const threadKey = scopedThreadKey(threadRef);
    if (isModClick) {
      event.preventDefault();
      toggleThreadSelection(threadKey);
      return;
    }
    if (event.shiftKey) {
      event.preventDefault();
      rangeSelectTo(threadKey, orderedThreadKeysRef.current);
      return;
    }
    if (isTrailingDoubleClick(event.detail)) {
      return;
    }
    setExpandedTabRowKey(null);
    navigateToThread(threadRef, keepOpenGroupTab);
  };
  const settlingThreadKeysRef = useRef(new Set<string>());
  // Callers snapshot the plan BEFORE the command mutates the partition;
  // background parks never navigate (null plan).
  const planForwardNavigation = (
    threadKey: string,
    coParkingKeys?: ReadonlySet<string>,
  ): (() => void) | null => {
    if (readRouteThreadKey(router) !== threadKey) return null;
    const shell = threadByKeyRef.current.get(threadKey);
    const orderedKeys = orderedThreadKeysRef.current;
    const settledKeys = settledThreadKeysRef.current;
    const snoozedKeys = snoozedThreadKeysRef.current;
    const currentIndex = orderedKeys.indexOf(threadKey);
    const nextCardKey =
      currentIndex === -1
        ? null
        : ([...orderedKeys.slice(currentIndex + 1), ...orderedKeys.slice(0, currentIndex)].find(
            (key) => !settledKeys.has(key) && !snoozedKeys.has(key) && !coParkingKeys?.has(key),
          ) ?? null);
    const nextThread = nextCardKey ? threadByKeyRef.current.get(nextCardKey) : null;
    return nextThread
      ? () => navigateToThread(scopeThreadRef(nextThread.environmentId, nextThread.id))
      : shell
        ? () => void handleNewThread(scopeProjectRef(shell.environmentId, shell.projectId))
        : () => void router.navigate({ to: "/" });
  };
  const attemptSettle = (
    threadRef: ScopedThreadRef,
    opts: {
      coSettlingKeys?: ReadonlySet<string>;
    } = {},
  ) => {
    void (async () => {
      const threadKey = scopedThreadKey(threadRef);
      if (settlingThreadKeysRef.current.has(threadKey)) return;
      settlingThreadKeysRef.current.add(threadKey);
      const navigateAfterSettle = planForwardNavigation(threadKey, opts.coSettlingKeys);
      const result = await settleThread(threadRef);
      settlingThreadKeysRef.current.delete(threadKey);
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Failed to settle thread",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        }
        return;
      }
      if (
        shouldNavigateAfterThreadPark({
          threadKey,
          currentThreadKey: readRouteThreadKey(router),
          action: "settle",
          now: new Date().toISOString(),
          thread: readThreadShell(threadRef),
        })
      ) {
        navigateAfterSettle?.();
      }
    })();
  };
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Register the sidebar settle handler with the command dispatcher.
  useEffect(() => registerSettleAndAdvance(attemptSettle), [attemptSettle]);
  const settleThreads = (threadKeys: readonly string[]) => {
    const coSettlingKeys = new Set(threadKeys);
    for (const threadKey of threadKeys) {
      const thread = threadByKeyRef.current.get(threadKey);
      if (!thread || thread.settledOverride === "settled") continue;
      attemptSettle(scopeThreadRef(thread.environmentId, thread.id), {
        coSettlingKeys,
      });
    }
  };
  const attemptUnsettle = (threadRef: ScopedThreadRef) => {
    void (async () => {
      const result = await unsettleThread(threadRef);
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to un-settle thread",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
    })();
  };
  const attemptUnsnooze = (threadRef: ScopedThreadRef) => {
    void (async () => {
      const result = await unsnoozeThread(threadRef);
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to wake thread",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
    })();
  };
  const attemptSetHidden = (threadRef: ScopedThreadRef, hidden: boolean) => {
    void (async () => {
      const result = await setThreadHidden(threadRef, hidden);
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: hidden ? "Failed to hide thread" : "Failed to unhide thread",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
    })();
  };
  const attemptSetGroup = (threadRef: ScopedThreadRef, groupName: string | null) => {
    void (async () => {
      const result = await setThreadGroup(threadRef, groupName);
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to move thread",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
    })();
  };
  const attemptMoveToProject = (threadRef: ScopedThreadRef, projectId: ProjectId) => {
    void (async () => {
      const result = await confirmAndMoveThreadToProject(threadRef, projectId);
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to move thread",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
    })();
  };
  const { editThreadGroup, createThreadGroup } = createSidebarGroupActions({
    threads,
    threadGroups,
    saveGroup,
    deleteGroup,
    setSidebarPages,
    setCollapsedPages,
    attemptSetGroup,
  });
  const attemptUnhide = (threadRef: ScopedThreadRef) => attemptSetHidden(threadRef, false);
  const threadListRef = useRef<HTMLUListElement | null>(null);
  const dragLabelOffsetRef = useRef(0);
  const restrictBelowPins: Modifier = (args) =>
    restrictBelowSidebarLabel(args, dragLabelOffsetRef.current);
  const listMotionRef = useRef<ReturnType<typeof createSidebarListMotion> | null>(null);
  const attachListMotionRef = (node: HTMLUListElement | null) => {
    threadListRef.current = node;
    if (node === null) return;
    const motion = createSidebarListMotion(node);
    listMotionRef.current = motion;
    motion.update(false);
    return () => {
      // Search replaces this list while the Sidebar stays mounted, and a drag
      // whose rows are gone can never drop. The compiler memoizes this callback
      // with no deps (it reads only refs), so the cleanup runs only on unmount.
      dragSensorRef.current?.cancel();
      motion.dispose();
      if (listMotionRef.current === motion) listMotionRef.current = null;
      if (threadListRef.current === node) threadListRef.current = null;
    };
  };
  // A group's tabs resize its row in place. Re-baseline without animating so
  // the next list change measures from where rows actually are.
  const refreshListMotion = () => listMotionRef.current?.update(false);
  // A group's tab list changed height in place (its "more" row, a limit, a new tab), so the
  // rows below glide to where it pushed them. Never mid-drag, which owns every row's position.
  const listMotionPausedRef = useRef(false);
  const animateListMotion = () => {
    if (!listMotionPausedRef.current) listMotionRef.current?.update(true);
  };
  const [dragState, setDragState] = useState<{
    readonly activeKey: string;
    readonly activeSection: SidebarSection;
    readonly occurredAt: string;
    readonly activationY: number | null;
    readonly targetSection: SidebarSection | null;
    readonly contextDrag: boolean;
  } | null>(null);
  const isContextDrag = dragState?.contextDrag === true || dragState?.activeSection === "working";
  const dragTargetSection = isContextDrag ? null : (dragState?.targetSection ?? null);
  const dragSensorRef = useRef<SidebarPointerSensor | null>(null);
  const contextDragKeyRef = useRef<string | null>(null);
  const finishThreadDrag = (started: boolean) => {
    dragSensorRef.current = null;
    contextDragKeyRef.current = null;
    endThreadContextDrag();
    if (started) {
      listMotionRef.current?.release();
      setDragState(null);
    }
  };
  const attachDragSensor = (sensor: SidebarPointerSensor) => {
    dragSensorRef.current = sensor;
  };
  const cancelThreadDrag = () => {
    dragSensorRef.current?.cancel();
  };
  const contextDragThreads = (): ReadonlyArray<ScopedThreadRef> => {
    const key = contextDragKeyRef.current;
    if (key === null) return [];
    const selected = useThreadSelectionStore.getState().selectedThreadKeys;
    const keys = selected.has(key) ? [...selected] : [key];
    return keys.flatMap((candidate) => {
      const ref = parseScopedThreadKey(candidate);
      return ref ? [ref] : [];
    });
  };
  const pointerOutsideThreadList = (point: { x: number; y: number }) => {
    const bounds = threadListRef.current?.getBoundingClientRect();
    return bounds !== undefined && (point.x < bounds.left || point.x > bounds.right);
  };
  const moveThreadContextDrag = (point: { x: number; y: number }) => {
    const contextDrag = pointerOutsideThreadList(point);
    setDragState((current) =>
      current === null || current.contextDrag === contextDrag
        ? current
        : { ...current, contextDrag },
    );
    if (!contextDrag) {
      endThreadContextDrag();
      return false;
    }
    const threads = contextDragThreads();
    const title =
      threadByKeyRef.current.get(contextDragKeyRef.current ?? "")?.title.trim() || "Thread";
    moveThreadContextDragGhost(point, { title, count: threads.length });
    return true;
  };
  const dropThreadContextDrag = (point: { x: number; y: number }) => {
    if (!pointerOutsideThreadList(point)) return false;
    dropThreadContext(point, contextDragThreads());
    return true;
  };
  const dndSensors = useSensors(
    useSensor(SidebarPointerSensor, {
      distance: SIDEBAR_DRAG_DISTANCE,
      onAttach: attachDragSensor,
      onFinish: finishThreadDrag,
      onMove: moveThreadContextDrag,
      onDrop: dropThreadContextDrag,
    }),
  );
  const sectionByThreadKey = (() => {
    const map = new Map<string, SidebarSection>();
    const add = (list: readonly EnvironmentThreadShell[], section: SidebarSection) => {
      for (const thread of list) {
        map.set(scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)), section);
      }
    };
    add(pinnedThreads, "pinned");
    add(activeThreads, "active");
    add(workingThreads, "working");
    add(snoozedThreads, "snoozed");
    add(groupedThreads, "grouped");
    add(automationThreads, "automations");
    add(hiddenThreads, "hidden");
    add(settledThreads, "settled");
    return map;
  })();
  const sectionByThreadKeyRef = useRef(sectionByThreadKey);

  const [actionSweep, setActionSweep] = useState<{
    action: SidebarSweepAction;
    keys: ReadonlySet<string>;
  } | null>(null);
  const startActionSweep = useStableCallback(
    (threadRef: ScopedThreadRef, action: SidebarSweepAction, event: PointerEvent) => {
      const originKey = scopedThreadKey(threadRef);
      const originSection = sectionByThreadKeyRef.current.get(originKey);
      const canApply = (key: string) => {
        const thread = threadByKeyRef.current.get(key);
        return (
          thread !== undefined &&
          sectionByThreadKeyRef.current.get(key) === originSection &&
          serverConfigs.has(thread.environmentId)
        );
      };
      let targetKey: string | null = null;
      let sweptKeys: string[] = [];
      const sweepTo = (key: string | null) => {
        if (key === null || key === targetKey) return;
        targetKey = key;
        sweptKeys = resolveSidebarSweepKeys(orderedThreadKeysRef.current, originKey, key, canApply);
        setActionSweep({ action, keys: new Set(sweptKeys) });
      };
      dragSensorRef.current = new SidebarPointerSensor({
        active: originKey,
        event,
        options: {
          distance: SIDEBAR_DRAG_DISTANCE,
          onAttach: () => {},
          onFinish: () => {
            dragSensorRef.current = null;
            setActionSweep(null);
          },
        },
        onPending: () => {},
        onStart: () => sweepTo(originKey),
        onMove: ({ y }) =>
          sweepTo(threadListRef.current && sidebarThreadKeyAtY(threadListRef.current, y)),
        onEnd: () => {
          const keys = sweptKeys.filter(canApply);
          if (action === "settle") {
            settleThreads(keys);
            return;
          }
          for (const key of keys) {
            const ref = parseScopedThreadKey(key);
            if (ref === null) continue;
            if (action === "unsettle") attemptUnsettle(ref);
            else attemptUnsnooze(ref);
          }
        },
        onCancel: () => {},
        onAbort: () => {},
      });
    },
  );
  const pinnedKeys = pinnedThreads.map((thread) =>
    scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
  );
  const activeKeys = activeThreads.map((thread) =>
    scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
  );
  const releaseOptimisticDrop = (() => {
    if (optimisticDrop === null) return false;
    const canonicalByKey = new Map(
      threads.map((thread) => [
        scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
        thread,
      ]),
    );
    const thread = canonicalByKey.get(optimisticDrop.key);
    if (thread === undefined || thread.archivedAt !== null) {
      return true;
    }
    const canonicalSection =
      thread.hiddenAt != null
        ? "hidden"
        : isSidebarThreadGroupedAway(thread.groupName, groupsShownInThreads)
          ? "grouped"
          : thread.scheduledTaskId != null
            ? "automations"
            : effectiveSnoozed(thread, { now: snoozeNow })
              ? "snoozed"
              : thread.settledOverride === "settled"
                ? "settled"
                : thread.pinnedAt != null
                  ? "pinned"
                  : "active";
    if (
      canonicalSection !== optimisticDrop.sourceSection &&
      canonicalSection !== optimisticDrop.section
    ) {
      return true;
    }
    if (optimisticDrop.order === null) {
      // Settle also emits unpin/unsnooze events. Wait for the entire move
      // before releasing the projected fields and sort timestamps.
      if (
        canonicalSection === optimisticDrop.section &&
        thread.pinnedAt == null &&
        (!optimisticDrop.clearsSnooze || thread.snoozedUntil == null)
      ) {
        return true;
      }
      return false;
    }
    if (canonicalSection !== optimisticDrop.section) return false;
    if (optimisticDrop.clearsSnooze && thread.snoozedUntil != null) return false;
    const destinationKeys = optimisticDrop.section === "pinned" ? pinnedKeys : activeKeys;
    const canonicalDestination = destinationKeys.flatMap((key) => {
      const canonical = canonicalByKey.get(key);
      return canonical === undefined ? [] : [canonical];
    });
    const keyByThread = new Map(
      canonicalDestination.map((thread) => [
        scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
        (optimisticDrop.section === "pinned" ? thread.pinOrderKey : thread.activeOrderKey) ?? null,
      ]),
    );
    const heldOrder = optimisticDrop.order;
    const heldKeys = new Set(heldOrder);
    const membershipChanged =
      destinationKeys.length !== heldOrder.length ||
      destinationKeys.some((key) => !heldKeys.has(key));
    const foreignKeyLanded = destinationKeys.some((threadKey) => {
      const currentKey = keyByThread.get(threadKey) ?? null;
      if (currentKey === (optimisticDrop.keysAtDrop.get(threadKey) ?? null)) return false;
      return currentKey !== optimisticDrop.assignedKeys.get(threadKey);
    });
    const allAssignmentsLanded = [...optimisticDrop.assignedKeys].every(
      ([threadKey, orderKey]) => keyByThread.get(threadKey) === orderKey,
    );
    return membershipChanged || foreignKeyLanded || allAssignmentsLanded;
  })();
  if (releaseOptimisticDrop) setOptimisticDrop(null);
  const attemptPin = (threadRef: ScopedThreadRef) => {
    void (async () => {
      const result = await pinThread(threadRef);
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to pin thread",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
    })();
  };
  const attemptUnpin = (threadRef: ScopedThreadRef) => {
    void (async () => {
      const result = await confirmAndUnpinThread(threadRef);
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to unpin thread",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
    })();
  };
  const handleThreadDragStart = (event: DragStartEvent) => {
    const activeKey = String(event.active.id);
    contextDragKeyRef.current = activeKey;
    const activeSection = sectionByThreadKey.get(activeKey);
    if (activeSection === undefined) return;
    listMotionRef.current?.suspend();
    const list = threadListRef.current;
    const header = list?.querySelector<HTMLElement>('[data-testid="sidebar-pinned-header"]');
    if (list && header) {
      const listRect = list.getBoundingClientRect();
      const scale = list.offsetWidth > 0 ? listRect.width / list.offsetWidth : 1;
      dragLabelOffsetRef.current =
        header.getBoundingClientRect().top - listRect.top + SIDEBAR_DRAG_LABEL_HEIGHT * scale;
    } else {
      dragLabelOffsetRef.current = 0;
    }
    setDragState({
      activeKey,
      activeSection,
      targetSection: activeSection,
      contextDrag: false,
      // oxlint-disable-next-line react/purity -- Drag start stamps the move when the handler runs.
      occurredAt: new Date().toISOString(),
      activationY:
        event.activatorEvent instanceof PointerEvent ? event.activatorEvent.clientY : null,
    });
  };
  const attachTreeRef = (node: HTMLUListElement) => {
    const detachMotion = attachListMotionRef(node);
    const detachTree = attachSidebarTree(node);
    return () => {
      detachTree?.();
      detachMotion?.();
    };
  };
  const hasProjectFolders = projectFolders !== null && projectFolders.length > 0;
  const sidebarListItemsFresh = ((): readonly SidebarListItem[] => {
    const rowsOf = (
      list: readonly EnvironmentThreadShell[],
      section: SidebarSection,
    ): SidebarListItem[] =>
      list.map((thread) => {
        const key = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
        return { kind: "thread", key, section };
      });
    const items: SidebarListItem[] = [];
    if (
      showsThreads &&
      (hasProjectFolders || pinnedThreads.length + activeThreads.length + workingThreads.length > 0)
    ) {
      items.push({ kind: "marker", marker: "pinned-header" });
      items.push(...rowsOf(pinnedThreads, "pinned"));
      items.push({ kind: "marker", marker: "pinned-divider" });
      items.push({ kind: "marker", marker: "active-placeholder" });
      items.push(...rowsOf(activeThreads, "active"));
      if (workingThreads.length > 0) {
        items.push({ kind: "marker", marker: "working-header" });
        items.push(...rowsOf(visibleWorkingThreads, "working"));
      }
    }
    // Each other page lists under its own title: groups by name, then the shelves.
    // A picked group keeps its title while empty, so it stays editable and reads as picked.
    for (const group of visibleGroups) {
      items.push(
        { kind: "marker", marker: "group-header", group: group.name },
        ...rowsOf(group.threads, "grouped"),
      );
    }
    const pages = [
      ["automations-header", rowsOf(visibleAutomationThreads, "automations")],
      ["snoozed-header", rowsOf(visibleSnoozedThreads, "snoozed")],
      ["hidden-header", rowsOf(visibleHiddenThreads, "hidden")],
      ["settled-header", rowsOf(renderedSettledThreads, "settled")],
    ] as const;
    for (const [marker, rows] of pages) {
      const page = SIDEBAR_PAGE_BY_MARKER[marker];
      // A folded page keeps its header so it can be opened again.
      if (!sidebarPages.includes(page) || (pageCounts.get(page) ?? 0) === 0) continue;
      items.push({ kind: "marker", marker }, ...rows);
    }
    return items;
  })();
  // Preserve the list while streamed updates leave order unchanged to retain row memoization.
  const sidebarListItemsKey = sidebarListItemsFresh
    .map((item) =>
      item.kind === "thread" ? item.section + ":" + item.key : item.marker + (item.group ?? ""),
    )
    .join("\n");
  const [sidebarListItemsState, setSidebarListItems] = useState(sidebarListItemsFresh);
  const [sidebarListItemsKeyState, setSidebarListItemsKeyState] = useState(sidebarListItemsKey);
  let sidebarListItems = sidebarListItemsState;
  if (sidebarListItemsKeyState !== sidebarListItemsKey) {
    setSidebarListItemsKeyState(sidebarListItemsKey);
    setSidebarListItems(sidebarListItemsFresh);
    // Update the local list too; threadByKey already omits rows moved into collapsed shelves.
    sidebarListItems = sidebarListItemsFresh;
  }
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Cancel the external drag sensor when its source disappears.
  useEffect(() => {
    if (
      dragState !== null &&
      !sidebarListItems.some((item) => item.kind === "thread" && item.key === dragState.activeKey)
    ) {
      cancelThreadDrag();
    }
  }, [cancelThreadDrag, dragState, sidebarListItems]);
  const listMotionPaused = dragState !== null;

  // Every shell event rebuilds sidebarListItems, but rows only move when the
  // rendered order or a row's section changes. Keying the motion pass on that
  // keeps ordinary updates from forcing a layout read and animating rows
  // whose position drifted for other reasons.
  const sidebarListOrderKey = sidebarListItems
    .map((item) => (item.kind === "thread" ? `${item.key}:${item.section}` : item.marker))
    .join("\0");
  const sidebarListHasRows = sidebarListItems.length + visibleDraftSessionCount > 0;
  const listMotionPass = {
    layoutKey: [sidebarListOrderKey, routeDraftIdForRows ?? "", visibleDraftSessionCount].join(
      "\0",
    ),
    animate: !listMotionPaused && sidebarListHasRows,
  };
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Apply list motion to the committed DOM layout.
  useLayoutEffect(() => {
    listMotionRef.current?.update(listMotionPass.animate);
  }, [listMotionPass, listMotionRef]);
  const handleThreadDragOver = (event: DragOverEvent) => {
    const target = event.over
      ? resolveSidebarDropTarget(sidebarListItems, String(event.active.id), String(event.over.id))
      : null;
    setDragState((current) =>
      current === null || current.activeKey !== String(event.active.id)
        ? current
        : { ...current, targetSection: target?.section ?? null },
    );
  };
  const sortableIds = sidebarListItems.map(sidebarListItemId);
  const draggedSettledOrder = (() => {
    const thread = dragState === null ? undefined : threadByKey.get(dragState.activeKey);
    if (dragState === null || thread === undefined) return [];
    const key = (candidate: EnvironmentThreadShell) =>
      scopedThreadKey(scopeThreadRef(candidate.environmentId, candidate.id));
    return sortSettledThreads([
      ...settledThreads.filter((candidate) => key(candidate) !== dragState.activeKey),
      applySidebarThreadDrop(thread, "settled", dragState.occurredAt),
    ]).map(key);
  })();
  const draggedActiveOrder = (() => {
    const thread = dragState === null ? undefined : threadByKey.get(dragState.activeKey);
    if (!workingShelfEnabled || dragState === null || thread === undefined) return undefined;
    const key = (candidate: EnvironmentThreadShell) =>
      scopedThreadKey(scopeThreadRef(candidate.environmentId, candidate.id));
    return sortInboxThreadsByReturn(
      [
        ...activeThreads.filter((candidate) => key(candidate) !== dragState.activeKey),
        applySidebarThreadDrop(thread, "active", dragState.occurredAt),
      ],
      inboxReturns.returnedAt,
    ).map(key);
  })();
  const sidebarSortingStrategy = createSidebarSortingStrategy({
    items: sidebarListItems,
    enabled: !isContextDrag,
    boundaryLabelHeight: SIDEBAR_DRAG_LABEL_HEIGHT,
    settledOrder: draggedSettledOrder,
    ...(draggedActiveOrder === undefined ? {} : { activeOrder: draggedActiveOrder }),
    settledExpanded: false,
    settledVisibleCount,
    routeThreadKey: sidebarRouteThreadKey,
    snoozedThreadCount: snoozedThreads.length,
  });
  const { pinnedKeysById, activeKeysById } = {
    pinnedKeysById: new Map(
      threads.map((thread) => [
        scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
        thread.pinOrderKey ?? null,
      ]),
    ),
    activeKeysById: new Map(
      threads.map((thread) => [
        scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
        thread.activeOrderKey ?? null,
      ]),
    ),
  };
  const draggedThreadKey = dragState?.activeKey;
  const draggedFromSection = dragState?.activeSection;
  const dragActivationY = dragState?.activationY;
  const dndCollisionDetection = (() => {
    if (draggedThreadKey === undefined || draggedFromSection === undefined)
      return createSidebarCollisionDetection(() => true);
    const source = threadByKey.get(draggedThreadKey);
    if (source === undefined) return createSidebarCollisionDetection(() => false);
    return createSidebarCollisionDetection(
      (id) => {
        const target = resolveSidebarDropTarget(sidebarListItems, draggedThreadKey, id);
        if (target === null) return false;
        return (
          planSidebarThreadDrop({
            activeKey: draggedThreadKey,
            activeSection: draggedFromSection,
            activePinned: source.pinnedAt != null,
            activeSettled: source.settledOverride === "settled",
            supportsSettlement: serverConfigs.has(source.environmentId),
            target,
            pinnedOrder: pinnedKeys,
            pinnedKeysById,
            reorderableKeys: draggableThreadKeys,
            activeOrder: activeKeys,
            activeKeysById,
            activeReorderableKeys: activeReorderableThreadKeys,
            activeTimeOrdered: workingShelfEnabled,
          }).kind !== "none"
        );
      },
      {
        items: sidebarListItems,
        activationY: dragActivationY ?? null,
      },
    );
  })();
  const handleThreadDragEnd = (event: DragEndEvent) => {
    const activeKey = String(event.active.id);
    const activeSection = sectionByThreadKey.get(activeKey);
    const target =
      event.over === null
        ? null
        : resolveSidebarDropTarget(sidebarListItems, activeKey, String(event.over.id));
    const activeThread = threadByKey.get(activeKey);
    if (activeSection === undefined || target === null || activeThread === undefined) return;
    const threadRef = scopeThreadRef(activeThread.environmentId, activeThread.id);
    const plan = planSidebarThreadDrop({
      activeKey,
      activeSection,
      activePinned: activeThread.pinnedAt != null,
      activeSettled: activeThread.settledOverride === "settled",
      supportsSettlement: serverConfigs.has(activeThread.environmentId),
      target,
      pinnedOrder: pinnedKeys,
      pinnedKeysById,
      reorderableKeys: draggableThreadKeys,
      activeOrder: activeKeys,
      activeKeysById,
      activeReorderableKeys: activeReorderableThreadKeys,
      activeTimeOrdered: workingShelfEnabled,
    });
    if (plan.kind === "none") return;
    if (plan.kind === "settle" && settlingThreadKeysRef.current.has(activeKey)) return;
    const assignments =
      plan.kind === "pin"
        ? [
            ...(plan.orderKey === undefined ? [] : [{ id: activeKey, orderKey: plan.orderKey }]),
            ...plan.extraAssignments,
          ]
        : plan.kind === "reorder-pinned" || plan.kind === "move-active"
          ? plan.assignments
          : [];
    if (
      !checkThreadOperations(
        [activeKey, ...assignments.map(({ id }) => id)].flatMap((key) => {
          const thread = threadByKey.get(key);
          return thread ? [thread] : [];
        }),
      )
    )
      return;
    const drop = {
      key: activeKey,
      sourceSection: activeSection,
      section: target.section,
      // oxlint-disable-next-line react/purity -- Drop stamps the move when the handler runs.
      occurredAt: new Date().toISOString(),
      clearsSnooze:
        plan.kind === "pin" ||
        plan.kind === "settle" ||
        (plan.kind === "move-active" && plan.unsnooze),
      order: plan.kind === "settle" ? null : plan.order,
      keysAtDrop: target.section === "active" ? activeKeysById : pinnedKeysById,
      assignedKeys: new Map(assignments.map(({ id, orderKey }) => [id, orderKey])),
    };
    setOptimisticDrop(drop);
    void (async () => {
      const run = async (
        operation: Promise<AtomCommandResult<unknown, unknown>>,
        title: string,
      ) => {
        const result = await operation;
        if (result._tag === "Success") return true;
        setOptimisticDrop((current) => (current === drop ? null : current));
        if (!isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title,
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        }
        return false;
      };
      switch (plan.kind) {
        case "settle": {
          settlingThreadKeysRef.current.add(activeKey);
          const navigateAfterSettle = planForwardNavigation(activeKey);
          const settled = await run(settleThread(threadRef), "Failed to settle thread").finally(
            () => settlingThreadKeysRef.current.delete(activeKey),
          );
          if (
            settled &&
            shouldNavigateAfterThreadPark({
              threadKey: activeKey,
              currentThreadKey: readRouteThreadKey(router),
              action: "settle",
              now: new Date().toISOString(),
              thread: readThreadShell(threadRef),
            })
          )
            navigateAfterSettle?.();
          return;
        }
        case "move-active":
          if (plan.unpin && !(await run(unpinThread(threadRef), "Failed to unpin thread"))) return;
          if (
            plan.unsettle &&
            !(await run(unsettleThread(threadRef), "Failed to un-settle thread"))
          )
            return;
          if (plan.unsnooze && !(await run(unsnoozeThread(threadRef), "Failed to wake thread")))
            return;
          break;
        case "pin":
          if (
            !(await run(
              pinThread(threadRef, plan.orderKey === undefined ? {} : { orderKey: plan.orderKey }),
              "Failed to pin thread",
            ))
          )
            return;
          break;
        case "reorder-pinned":
          break;
      }
      const keyWrites = plan.kind === "pin" ? plan.extraAssignments : plan.assignments;
      for (const assignment of keyWrites) {
        const thread = threadByKey.get(assignment.id);
        if (thread === undefined) continue;
        if (
          !(await run(
            (plan.kind === "move-active" ? reorderActiveThread : reorderPinnedThread)(
              scopeThreadRef(thread.environmentId, thread.id),
              assignment.orderKey,
            ),
            plan.kind === "move-active"
              ? "Failed to reorder active threads"
              : "Failed to reorder pinned threads",
          ))
        )
          return;
      }
    })();
  };
  const snoozingThreadKeysRef = useRef(new Set<string>());
  const performSnooze = async (
    threadRef: ScopedThreadRef,
    preset: Pick<SnoozePreset, "snoozedUntil">,
    opts: {
      coSnoozingKeys?: ReadonlySet<string>;
    } = {},
  ) => {
    const threadKey = scopedThreadKey(threadRef);
    if (snoozingThreadKeysRef.current.has(threadKey)) {
      return { status: "skipped" } as const;
    }
    snoozingThreadKeysRef.current.add(threadKey);
    const navigateAfterSnooze = planForwardNavigation(threadKey, opts.coSnoozingKeys);
    const result = await snoozeThread(threadRef, preset.snoozedUntil);
    snoozingThreadKeysRef.current.delete(threadKey);
    if (result._tag === "Failure") {
      return isAtomCommandInterrupted(result)
        ? ({ status: "interrupted" } as const)
        : ({ status: "failure", error: squashAtomCommandFailure(result) } as const);
    }
    if (
      shouldNavigateAfterThreadPark({
        threadKey,
        currentThreadKey: readRouteThreadKey(router),
        action: "snooze",
        // oxlint-disable-next-line react/purity -- Snooze checks the clock when the handler runs.
        now: new Date().toISOString(),
        thread: readThreadShell(threadRef),
      })
    ) {
      navigateAfterSnooze?.();
    }
    return { status: "success" } as const;
  };
  const attemptSnooze = (
    threadRef: ScopedThreadRef,
    preset: Pick<SnoozePreset, "snoozedUntil">,
    opts: {
      coSnoozingKeys?: ReadonlySet<string>;
    } = {},
  ) => {
    void (async () => {
      const outcome = await performSnooze(threadRef, preset, opts);
      if (outcome.status === "failure") {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to snooze thread",
            description:
              outcome.error instanceof Error ? outcome.error.message : "An error occurred.",
          }),
        );
        return;
      }
    })();
  };
  const removeFromSelection = useThreadSelectionStore((s) => s.removeFromSelection);
  const handleMultiSelectContextMenu = useStableCallback(
    async (position: { x: number; y: number }) => {
      const api = readLocalApi();
      if (!api) return;
      const selectedThreadKeys = [...useThreadSelectionStore.getState().selectedThreadKeys];
      const threadKeys = selectedThreadKeys.filter((threadKey) =>
        threadByKeyRef.current.has(threadKey),
      );
      if (threadKeys.length === 0) return;
      const count = threadKeys.length;
      // oxlint-disable-next-line react/purity -- The bulk menu reads the clock when it opens.
      const selectionNow = new Date();
      const selectedThreads = threadKeys.flatMap((threadKey) => {
        const thread = threadByKeyRef.current.get(threadKey);
        return thread ? [thread] : [];
      });
      const settlingThreads = selectedThreads.filter(
        (thread) => thread.settledOverride !== "settled",
      );
      const canSnoozeSelection = selectedThreads.every(
        (thread) =>
          serverConfigs.has(thread.environmentId) &&
          canSnooze(thread, { now: selectionNow.toISOString() }),
      );
      const titleRegenerationThreads = selectedThreads.filter((thread) =>
        serverConfigs.has(thread.environmentId),
      );
      const regeneratableTitleThreads = titleRegenerationThreads.filter(
        (thread) => thread.titleRegeneration == null,
      );
      const titleRegenerationMenuItem = buildBulkTitleRegenerationContextMenuItem({
        supportedCount: titleRegenerationThreads.length,
        actionableCount: regeneratableTitleThreads.length,
      });
      const pinnedSelectedThreads = selectedThreads.filter(
        (thread) => serverConfigs.has(thread.environmentId) && thread.pinnedAt != null,
      );
      const unpinMenuItem = buildBulkUnpinContextMenuItem({
        pinnedCount: pinnedSelectedThreads.length,
      });
      const snoozePresets = resolveSnoozePresets(
        // oxlint-disable-next-line react/purity -- menu handlers read the clock when opened
        new Date(),
        timestampFormat,
        selectedThreads[0]!.environmentId,
      );
      const clicked = await settlePromise(() =>
        api.contextMenu.show(
          [
            ...(unpinMenuItem
              ? [
                  {
                    ...unpinMenuItem,
                    disabled: !canOperateThreads(pinnedSelectedThreads),
                  },
                ]
              : []),
            {
              id: "settle",
              label: `Settle (${count})`,
              disabled: settlingThreads.length === 0 || !canOperateThreads(settlingThreads),
            },
            ...(canSnoozeSelection
              ? [
                  {
                    id: "snooze",
                    label: `Snooze (${count})`,
                    disabled: !canOperateThreads(selectedThreads),
                    children: [
                      ...snoozePresets.map((preset) => ({
                        id: `snooze:${preset.id}`,
                        label: `${preset.label} (${preset.whenLabel})`,
                        disabled: !canOperateThreads(selectedThreads),
                      })),
                      {
                        id: "snooze:custom",
                        label: "Custom…",
                        separatorBefore: snoozePresets.length > 0,
                        disabled: !canOperateThreads(selectedThreads),
                      },
                    ],
                  },
                ]
              : []),
            ...(titleRegenerationMenuItem
              ? [
                  {
                    ...titleRegenerationMenuItem,
                    disabled:
                      titleRegenerationMenuItem.disabled ||
                      !canOperateThreads(regeneratableTitleThreads),
                  },
                ]
              : []),
            { id: "mark-unread", label: `Mark unread (${count})` },
            {
              id: "delete",
              label: `Delete (${count})`,
              destructive: true,
              disabled: !canOperateThreads(selectedThreads),
            },
          ],
          position,
        ),
      );
      if (clicked._tag === "Failure" || clicked.value === null) return;
      const actionTargets =
        clicked.value === "unpin"
          ? pinnedSelectedThreads
          : clicked.value === "regenerate-title"
            ? regeneratableTitleThreads
            : clicked.value === "settle"
              ? settlingThreads.flatMap((thread) => {
                  const current = threadByKeyRef.current.get(
                    scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
                  );
                  return current && current.settledOverride !== "settled" ? [current] : [];
                })
              : selectedThreads;
      if (clicked.value === "settle" && actionTargets.length === 0) return;
      if (clicked.value !== "mark-unread" && !checkThreadOperations(actionTargets)) return;
      if (clicked.value?.startsWith("snooze:")) {
        const preset =
          clicked.value === "snooze:custom"
            ? await requestCustomSnooze()
            : pickSnoozePreset(
                snoozePresets,
                clicked.value.slice("snooze:".length),
                timestampFormat,
                selectedThreads[0]!.environmentId,
              );
        if (preset) {
          const coSnoozingKeys = new Set(threadKeys);
          clearSelection();
          const outcomes = await Promise.all(
            selectedThreads.map(async (thread) => {
              const threadRef = scopeThreadRef(thread.environmentId, thread.id);
              const outcome = await performSnooze(threadRef, preset, {
                coSnoozingKeys,
              });
              return { outcome, threadRef };
            }),
          );
          const snoozedThreadRefs = outcomes.flatMap(({ outcome, threadRef }) =>
            outcome.status === "success" ? [threadRef] : [],
          );
          const failures = outcomes.flatMap(({ outcome }) =>
            outcome.status === "failure" ? [outcome.error] : [],
          );
          if (failures.length > 0) {
            const firstError = failures[0];
            toastManager.add(
              stackedThreadToast({
                type: "error",
                title:
                  snoozedThreadRefs.length > 0
                    ? `Failed to snooze ${failures.length} thread${failures.length === 1 ? "" : "s"}`
                    : "Failed to snooze threads",
                description:
                  firstError instanceof Error ? firstError.message : "An error occurred.",
              }),
            );
          }
        }
        return;
      }
      if (clicked.value === "unpin") {
        for (const thread of pinnedSelectedThreads) {
          attemptUnpin(scopeThreadRef(thread.environmentId, thread.id));
        }
        clearSelection();
        return;
      }
      if (clicked.value === "regenerate-title") {
        for (const thread of regeneratableTitleThreads) {
          const result = await updateThreadMetadata({
            environmentId: thread.environmentId,
            input: { threadId: thread.id, regenerateTitle: true },
          });
          if (result._tag === "Success") continue;
          if (!isAtomCommandInterrupted(result)) {
            const error = squashAtomCommandFailure(result);
            toastManager.add(
              stackedThreadToast({
                type: "error",
                title: "Failed to regenerate thread titles",
                description: error instanceof Error ? error.message : "An error occurred.",
              }),
            );
          }
          return;
        }
        clearSelection();
        return;
      }
      if (clicked.value === "settle") {
        settleThreads(
          actionTargets.map((thread) =>
            scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
          ),
        );
        clearSelection();
        return;
      }
      if (clicked.value === "mark-unread") {
        for (const threadKey of threadKeys) {
          const thread = threadByKeyRef.current.get(threadKey);
          if (thread) markThreadUnread(scopeThreadRef(thread.environmentId, thread.id));
        }
        clearSelection();
        return;
      }
      if (clicked.value !== "delete") return;
      if (confirmThreadDelete) {
        const confirmed = await settlePromise(() =>
          api.dialogs.confirm(
            [
              `Delete ${count} thread${count === 1 ? "" : "s"}?`,
              "This permanently clears conversation history for these threads.",
            ].join("\n"),
            { variant: "destructive" },
          ),
        );
        if (confirmed._tag === "Failure" || !confirmed.value) return;
      }
      if (
        !checkThreadOperations(
          threadKeys.flatMap((threadKey) => {
            const thread = threadByKeyRef.current.get(threadKey);
            return thread ? [thread] : [];
          }),
        )
      )
        return;
      const { deletedThreadKeys, firstFailure } = await deleteSelectedThreadEntries({
        entries: threadKeys.map((threadKey) => ({ threadKey })),
        delete: async ({ threadKey }, deletedThreadKeys) => {
          const thread = threadByKeyRef.current.get(threadKey);
          if (!thread) return null;
          return deleteThread(scopeThreadRef(thread.environmentId, thread.id), {
            deletedThreadKeys,
          });
        },
      });
      if (firstFailure !== null) {
        const firstError = squashAtomCommandFailure(firstFailure);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to delete threads",
            description: firstError instanceof Error ? firstError.message : "An error occurred.",
          }),
        );
      }
      removeFromSelection(
        getThreadKeysToDeselectAfterDelete(selectedThreadKeys, deletedThreadKeys, (threadKey) => {
          const threadRef = parseScopedThreadKey(threadKey);
          return threadRef !== null && readThreadShell(threadRef) !== null;
        }),
      );
    },
  );
  const handleDraftContextMenu = useStableCallback(
    (
      draftId: DraftId,
      position: {
        x: number;
        y: number;
      },
    ) => {
      void (async () => {
        const api = readLocalApi();
        const session = useComposerDraftStore.getState().getDraftSession(draftId);
        if (!api || !session || session.promotedTo) return;
        const projectGroup = projectGroupsRef.current.find((group) =>
          group.memberProjectRefs.some(
            (ref) =>
              ref.environmentId === session.environmentId && ref.projectId === session.projectId,
          ),
        );
        const workspacePath =
          session.worktreePath ??
          projectByKey.get(`${session.environmentId}:${session.projectId}`)?.workspaceRoot;
        const clicked = await settlePromise(() =>
          api.contextMenu.show(
            buildDraftActionMenuItems({
              hasPath: Boolean(workspacePath),
              hasBranch: Boolean(session.branch),
              hasProject: projectGroup != null,
            }),
            position,
          ),
        );
        if (clicked._tag === "Failure") return;
        switch (clicked.value) {
          case "project-settings":
            if (projectGroup)
              openProjectSettings(projectGroup, {
                environmentId: session.environmentId,
                projectId: session.projectId,
              });
            return;
          case "copy-path":
            if (workspacePath) copyPathToClipboard(workspacePath, { path: workspacePath });
            return;
          case "copy-branch":
            if (session.branch) copyBranchToClipboard(session.branch, { branch: session.branch });
            return;
          case "discard": {
            // The menu may outlive draft promotion; discarding then would strand the send.
            const current = useComposerDraftStore.getState().getDraftSession(draftId);
            if (current && !current.promotedTo) discardComposerDraft(draftId);
            return;
          }
        }
      })();
    },
  );
  const handleThreadContextMenu = useStableCallback(
    (
      threadRef: ScopedThreadRef,
      position: {
        x: number;
        y: number;
      },
    ) => {
      void (async () => {
        const api = readLocalApi();
        if (!api) return;
        const threadKey = scopedThreadKey(threadRef);
        const selectionState = useThreadSelectionStore.getState();
        if (selectionState.hasSelection() && selectionState.selectedThreadKeys.has(threadKey)) {
          await handleMultiSelectContextMenu(position);
          return;
        }
        const thread = readThreadShell(threadRef);
        if (!thread) return;
        // The row the shelf classifies may be a different tab than the one this menu was
        // opened on. Hide follows the row, and the server mirrors that to the other tabs.
        const rowKey = sidebarTabGroupRowKey(threadKey, tabThreadGroupsRef.current);
        const rowRef = parseScopedThreadKey(rowKey) ?? threadRef;
        const rowThread = threadByKeyRef.current.get(rowKey) ?? thread;
        const threadWorkspacePath =
          thread.worktreePath ??
          projectByKey.get(`${thread.environmentId}:${thread.projectId}`)?.workspaceRoot ??
          null;
        const configLoaded = serverConfigs.has(thread.environmentId);
        const supportsAutoSettleOptOut =
          serverConfigs.get(thread.environmentId)?.environment.capabilities
            .threadAutoSettleOptOut === true;
        const supportsHiding =
          serverConfigs.get(thread.environmentId)?.environment.capabilities.threadHiding === true;
        const supportsGroups =
          serverConfigs.get(thread.environmentId)?.environment.capabilities.threadGroups === true;
        const supportsTitleRegeneration =
          serverConfigs.get(thread.environmentId)?.environment.capabilities
            .threadTitleRegeneration === true;
        const isRegeneratingTitle = thread.titleRegeneration != null;
        const isSettled = settledThreadKeysRef.current.has(threadKey);
        const isSnoozed = snoozedThreadKeysRef.current.has(rowKey);
        const isPinned = thread.pinnedAt != null;
        const snoozePresets = resolveSnoozePresets(
          new Date(),
          timestampFormat,
          thread.environmentId,
        );
        const routeKey = routeThreadKeyRef.current;
        const routeRef = routeKey ? parseScopedThreadKey(routeKey) : null;
        // Only a started chat can be split; a draft route has no server thread yet.
        const splitAction =
          routeRef && readThreadShell(routeRef)
            ? splitMenuAction(useSplitViewStore.getState().panes, threadKey, routeKey)
            : null;
        const threadProjectGroup =
          projectGroupsRef.current.find((project) =>
            project.memberProjectRefs.some(
              (projectRef) =>
                projectRef.environmentId === thread.environmentId &&
                projectRef.projectId === thread.projectId,
            ),
          ) ?? null;
        const clicked = await settlePromise(() =>
          api.contextMenu.show(
            [
              ...(tabsByRowKey.has(rowKey) &&
              readEnvironmentScope(threadRef.environmentId, AuthOrchestrationOperateScope)
                ? [
                    {
                      id: "name-tab-group" as const,
                      label: "Name thread group…",
                    },
                  ]
                : []),
              ...buildThreadActionMenuItems({
                canOperate: readEnvironmentScope(
                  threadRef.environmentId,
                  AuthOrchestrationOperateScope,
                ),
                branch: thread.branch ?? null,
                projectFilter: threadProjectGroup
                  ? {
                      label: threadProjectGroup.displayName,
                      isActive:
                        projectScopeKeys.length === 1 &&
                        projectScopeKeys[0] === threadProjectGroup.projectKey,
                    }
                  : null,
                tabs: tabEnvironmentIds.has(thread.environmentId)
                  ? {
                      canClose:
                        sidebarTabNeighbourKey(threadKey, tabThreadGroupsRef.current) !== null,
                    }
                  : null,
                split: splitAction,
                canRestartSession: true,
                canShareWithGuest: appAtomRegistry.get(
                  canShareWithGuestAtom(threadRef.environmentId),
                ),
                canTurnIntoProject: canTurnThreadIntoProject(threadRef),
                canLinkGitHubIssue: isGitHubProject(
                  readProject(scopeProjectRef(thread.environmentId, thread.projectId)),
                ),
                isPinned,
                isSettled,
                autoSettleEnabled: thread.autoSettleDisabledAt == null,
                subscriptionLimit: readThreadSubscriptionLimitGuard(thread),
                isSnoozed,
                isHidden: supportsHiding && rowThread.hiddenAt != null,
                groupName: thread.groupName ?? null,
                groupNames: collectThreadGroupNames(threads, Object.keys(threadGroups)),
                moveTargets: threadMoveTargets(
                  thread,
                  projects,
                  serverConfigs.get(thread.environmentId)?.environment.capabilities
                    .threadProjectMove === true,
                ),
                canSnoozeNow: canSnooze(thread, {
                  now: new Date().toISOString(),
                }),
                isRegeneratingTitle,
                isRunning: !threadRuntimeCanArchive(thread.runtime),
                supports: {
                  settlement: configLoaded,
                  autoSettleOptOut: supportsAutoSettleOptOut,
                  snooze: configLoaded,
                  pinning: configLoaded,
                  hiding: supportsHiding,
                  groups: supportsGroups,
                  titleRegeneration: supportsTitleRegeneration,
                },
                snoozePresets,
                integrations: readEnvironmentLinkIntegrations(thread.environmentId),
              }),
            ],
            position,
          ),
        );
        if (clicked._tag === "Failure" || clicked.value === null) return;
        if (threadActionRequiresOperate(clicked.value) && !checkThreadOperations([thread])) return;
        if (clicked.value?.startsWith("snooze:")) {
          const preset =
            clicked.value === "snooze:custom"
              ? await requestCustomSnooze()
              : pickSnoozePreset(
                  snoozePresets,
                  clicked.value.slice("snooze:".length),
                  timestampFormat,
                  thread.environmentId,
                );
          if (preset) attemptSnooze(threadRef, preset);
          return;
        }
        const groupPick = clicked.value ? resolveThreadGroupMenuPick(clicked.value) : undefined;
        if (groupPick !== undefined) {
          if (groupPick !== "new") {
            attemptSetGroup(threadRef, groupPick.groupName);
            return;
          }
          const draft = await requestThreadGroup();
          if (draft === null || draft === "delete") return;
          saveGroup(draft);
          attemptSetGroup(threadRef, draft.name);
          return;
        }
        const projectPick = clicked.value ? resolveThreadProjectMenuPick(clicked.value) : undefined;
        if (projectPick !== undefined) {
          attemptMoveToProject(threadRef, ProjectId.make(projectPick));
          return;
        }
        if (openSidebarIntegrationLink(clicked.value, threadRef)) return;
        switch (clicked.value) {
          case "filter-by-project":
            // This item is the only scope control here, so it narrows the
            // list to this one project, and picking it again while that is
            // the whole scope is the way back to all projects.
            if (threadProjectGroup) {
              setProjectScopeKeys(
                projectScopeKeys.length === 1 &&
                  projectScopeKeys[0] === threadProjectGroup.projectKey
                  ? []
                  : [threadProjectGroup.projectKey],
              );
            }
            return;
          case "project-settings":
            if (threadProjectGroup)
              openProjectSettings(threadProjectGroup, {
                environmentId: threadRef.environmentId,
                projectId: thread.projectId,
              });
            return;
          case "new-tab":
            handleNewTab(threadRef);
            return;
          case "close-tab":
            handleCloseTab(threadRef);
            return;
          case "restart-session":
            void restartAgentSession(threadRef);
            return;
          case "open-in-split":
            if (!routeRef) return;
            if (isMobile) setOpenMobile(false);
            splitViewActions.openBeside(routeRef, threadRef);
            return;
          case "close-split":
            useSplitViewStore.getState().close();
            return;
          case "new-thread-on-branch": {
            const result = await settlePromise(() =>
              handleNewThread(scopeProjectRef(thread.environmentId, thread.projectId), {
                branch: thread.branch,
                worktreePath: thread.worktreePath,
                envMode: thread.worktreePath ? "worktree" : "local",
                startFromOrigin: false,
              }),
            );
            if (result._tag === "Failure") {
              const error = squashAtomCommandFailure(result);
              toastManager.add(
                stackedThreadToast({
                  type: "error",
                  title: "Could not create thread",
                  description: error instanceof Error ? error.message : "An error occurred.",
                }),
              );
            }
            return;
          }
          case "settle":
            attemptSettle(threadRef);
            return;
          case "unsettle":
            attemptUnsettle(threadRef);
            return;
          case "unsnooze":
            attemptUnsnooze(threadRef);
            return;
          case "pin":
            attemptPin(threadRef);
            return;
          case "unpin":
            attemptUnpin(threadRef);
            return;
          case "hide":
          case "unhide":
            attemptSetHidden(rowRef, clicked.value === "hide");
            return;
          case "turn-into-project": {
            const result = await turnThreadIntoProject(threadRef);
            if (result._tag === "Success") {
              toastManager.add({
                type: "success",
                title: "Project created",
                description: thread.title,
              });
            } else if (!isAtomCommandInterrupted(result)) {
              const error = squashAtomCommandFailure(result);
              toastManager.add(
                stackedThreadToast({
                  type: "error",
                  title: "Could not turn thread into a project",
                  description: error instanceof Error ? error.message : "An error occurred.",
                }),
              );
            }
            return;
          }
          case "auto-settle:enabled":
          case "auto-settle:disabled": {
            const result = await setThreadAutoSettle(
              threadRef,
              clicked.value === "auto-settle:enabled",
            );
            if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
              const error = squashAtomCommandFailure(result);
              toastManager.add(
                stackedThreadToast({
                  type: "error",
                  title: "Failed to update auto-settle",
                  description: error instanceof Error ? error.message : "An error occurred.",
                }),
              );
            }
            return;
          }
          case "subscription-limit:on":
          case "subscription-limit:off": {
            const result = await setThreadSubscriptionLimitGuard(
              thread,
              clicked.value === "subscription-limit:on",
            );
            if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
              const error = squashAtomCommandFailure(result);
              toastManager.add(
                stackedThreadToast({
                  type: "error",
                  title: "Failed to update subscription limit",
                  description: error instanceof Error ? error.message : "An error occurred.",
                }),
              );
            }
            return;
          }
          case "name-tab-group":
            nameTabGroup(threadRef);
            return;
          case "rename":
            startThreadRename(threadRef, thread.title);
            return;
          case "share-guest":
            openGuestShareDialog(threadRef);
            return;
          case "regenerate-title": {
            if (isRegeneratingTitle) return;
            const result = await updateThreadMetadata({
              environmentId: threadRef.environmentId,
              input: { threadId: threadRef.threadId, regenerateTitle: true },
            });
            if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
              const error = squashAtomCommandFailure(result);
              toastManager.add(
                stackedThreadToast({
                  type: "error",
                  title: "Failed to regenerate thread title",
                  description: error instanceof Error ? error.message : "An error occurred.",
                }),
              );
            }
            return;
          }
          case "mark-unread":
            markThreadUnread(threadRef);
            return;
          case "copy-path":
            if (!threadWorkspacePath) {
              toastManager.add(
                stackedThreadToast({
                  type: "error",
                  title: "Path unavailable",
                  description: "This thread does not have a workspace path to copy.",
                }),
              );
              return;
            }
            copyPathToClipboard(threadWorkspacePath, {
              path: threadWorkspacePath,
            });
            return;
          case "copy-branch":
            if (thread.branch) {
              copyBranchToClipboard(thread.branch, { branch: thread.branch });
            }
            return;
          case "copy-thread":
            void copyThreadReference(threadChipCopyTarget(threadRef, thread.title));
            return;
          case "copy-thread-id":
            copyThreadIdToClipboard(thread.id, { threadId: thread.id });
            return;
          case "export-transcript":
            openTranscriptExportDialog(threadRef);
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
              const error = squashAtomCommandFailure(result);
              toastManager.add(
                stackedThreadToast({
                  type: "error",
                  title: didArchive
                    ? "Thread archived, but navigation failed"
                    : "Failed to archive thread",
                  description: error instanceof Error ? error.message : "An error occurred.",
                }),
              );
              return;
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
            const result = await deleteThread(threadRef);
            if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
              const error = squashAtomCommandFailure(result);
              toastManager.add(
                stackedThreadToast({
                  type: "error",
                  title: "Failed to delete thread",
                  description: error instanceof Error ? error.message : "An error occurred.",
                }),
              );
              return;
            }
            return;
          }
          default:
            return;
        }
      })();
    },
  );
  const toggleShowTabs = () => {
    void updateClientSettings({ sidebarShowTabs: !showTabs });
  };
  const toggleTabsShortcutLabel = shortcutLabelForCommand(keybindings, "sidebar.toggleTabs");
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Publish committed row snapshots to asynchronous drag and menu callbacks.
  useLayoutEffect(() => {
    routeTargetRef.current = routeTarget;
    routeThreadKeyRef.current = routeThreadKey;
    projectGroupsRef.current = projectGroups;
    commitTabLayout(tabLayoutByRowKey);
    orderedThreadKeysRef.current = orderedThreadKeys;
    threadByKeyRef.current = threadByKey;
    handleNewThreadRef.current = newThreadContext.handleNewThread;
    settledThreadKeysRef.current = settledThreadKeys;
    snoozedThreadKeysRef.current = snoozedThreadKeys;
    tabThreadGroupsRef.current = tabThreadGroups;
    sectionByThreadKeyRef.current = sectionByThreadKey;
    listMotionPausedRef.current = listMotionPaused;
  });

  // A tab held on another pairs them in split view. The routed chat keeps focus when it is one of
  // the two; otherwise the dragged tab opens with the other beside it.
  const handleTabPair = (draggedKey: string, targetKey: string) => {
    const dragged = parseScopedThreadKey(draggedKey);
    const target = parseScopedThreadKey(targetKey);
    if (!dragged || !target) return;
    const keepTarget = routeThreadKeyRef.current === targetKey;
    splitViewActions.openBeside(keepTarget ? target : dragged, keepTarget ? dragged : target);
    if (!keepTarget && routeThreadKeyRef.current !== draggedKey) void navigateToThread(dragged);
  };
  const routeTerminalOpen = useTerminalUiStateStore((state) =>
    routeThreadRef
      ? selectThreadTerminalUiState(state.terminalUiStateByThreadKey, routeThreadRef).terminalOpen
      : false,
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Register browser keyboard shortcuts for the visible sidebar.
  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || isCommandPaletteOpen() || isModelPickerOpen()) {
        return;
      }
      const command = resolveShortcutCommand(event, keybindings, {
        platform: navigator.platform,
        context: {
          terminalFocus: isTerminalFocused(),
          terminalOpen: routeTerminalOpen,
          modelPickerOpen: isModelPickerOpen(),
          isWeb: !isElectron,
          isDesktop: isElectron,
        },
      });
      const navigateToThreadKey = (targetThreadKey: string | null) => {
        if (!targetThreadKey) return false;
        const targetThread = threadByKey.get(targetThreadKey);
        if (!targetThread) return false;
        event.preventDefault();
        event.stopPropagation();
        navigateToThread(scopeThreadRef(targetThread.environmentId, targetThread.id));
        return true;
      };
      if (command === "sidebar.toggleTabs") {
        event.preventDefault();
        event.stopPropagation();
        toggleShowTabs();
        return;
      }
      const traversalDirection = threadTraversalDirectionFromCommand(command);
      if (traversalDirection !== null) {
        navigateToThreadKey(
          resolveAdjacentThreadId({
            threadIds: orderedThreadKeys,
            currentThreadId: sidebarRouteThreadKey,
            direction: traversalDirection,
          }),
        );
        return;
      }
      const jumpIndex = threadJumpIndexFromCommand(command ?? "");
      if (jumpIndex === null) return;
      navigateToThreadKey(orderedThreadKeys[jumpIndex] ?? null);
    };
    window.addEventListener("keydown", onWindowKeyDown);
    return () => window.removeEventListener("keydown", onWindowKeyDown);
  }, [
    keybindings,
    navigateToThread,
    orderedThreadKeys,
    sidebarRouteThreadKey,
    routeTerminalOpen,
    threadByKey,
    toggleShowTabs,
  ]);
  const shortcutModifiers = useShortcutModifierState();
  const terminalFocused = useTerminalFocus();
  const shouldShowJumpHintsNow = shouldShowThreadJumpHintsForModifiers(
    shortcutModifiers,
    keybindings,
    {
      platform: navigator.platform,
      context: {
        terminalFocus: terminalFocused,
        terminalOpen: routeTerminalOpen,
        modelPickerOpen: isModelPickerOpen(),
        isWeb: !isElectron,
        isDesktop: isElectron,
      },
    },
  );
  const showJumpHints = useThreadJumpHintsVisible(shouldShowJumpHintsNow);
  const handleNewThreadClick = (event?: ReactMouseEvent) => {
    if (shouldCreateNewThreadInCurrentProject(event?.shiftKey ?? false, projectChoiceCount)) {
      if (isMobile) setOpenMobile(false);
      void startNewThreadFromContext({
        activeDraftThread: newThreadContext.activeDraftThread,
        activeThread: newThreadContext.activeThread ?? undefined,
        defaultProjectRef: newThreadContext.defaultProjectRef,
        handleNewThread,
      });
      return;
    }
    if (isMobile) setOpenMobile(false);
    openCommandPalette({ open: "new-thread-in" });
  };
  const newThreadShortcutLabel =
    shortcutLabelForCommand(keybindings, "chat.new") ??
    (projectChoiceCount <= 1 ? shortcutLabelForCommand(keybindings, "chat.newLocal") : undefined);
  const projectBadges = new Map(
    projectGroups.map((project) => [
      project.projectKey,
      showProjectEnvironments ? (
        <ProjectEnvironmentBadge
          key={project.projectKey}
          group={project}
          primaryEnvironmentId={primaryEnvironmentId}
          machineByEnvironmentId={environmentMachineById}
        />
      ) : null,
    ]),
  );
  const newThreadInProjectShortcutLabel = shortcutLabelForCommand(keybindings, "chat.newLocal");
  return (
    <>
      <ThreadContextDragGhost />
      <SidebarChromeHeader isElectron={isElectron} />
      <SidebarContent
        className="min-h-full"
        fixedHeader={
          // Lifted above the stage backdrop, whose fade bleeds below the
          // header and would otherwise paint across the search row's outline.
          <SidebarGroup className="z-[1]">
            <SidebarThreadHeader
              hasProjects={projectGroups.length > 0}
              attentionInbox={<SidebarAttentionInbox />}
              onNewProject={openAddProjectCommandPalette}
              onNewThread={handleNewThreadClick}
              newThreadDisabled={projects.length === 0}
              newThreadShortcutLabel={newThreadShortcutLabel}
              newThreadInProjectShortcutLabel={newThreadInProjectShortcutLabel}
              showNewThreadInProjectHint={projectChoiceCount > 1}
              searchInputRef={threadSearchInputRef}
              searchQuery={isThreadSearchApplied ? "" : threadSearchQuery}
              onSearchFocus={() => setIsThreadSearchApplied(false)}
              onSearchQueryChange={(value) => {
                setThreadSearchQuery(value);
                setSearchHighlightKey(null);
              }}
              onSearchKeyDown={handleThreadSearchKeyDown}
              isSearching={isSearchingThreads && !isThreadSearchApplied}
              searchResultCount={threadSearchResults.length}
              activeSearchResultIndex={activeSearchResultIndex}
              onClearSearch={clearThreadSearch}
              filterMenu={
                <SidebarFilterMenu
                  pages={sidebarPages}
                  availablePages={availablePages}
                  pageCounts={pageCounts}
                  groupStyles={threadGroups}
                  onNewGroup={createThreadGroup}
                  organisations={filterOrganisationOptions}
                  organisationCounts={filterFacets.organisationCounts}
                  scopedOrganisationKeys={scopedOrganisationKeys}
                  onScopedOrganisationKeysChange={setOrganisationKeys}
                  onPagesChange={setSidebarPages}
                  projects={filterFacets.projects}
                  projectCounts={filterFacets.projectCounts}
                  scopedProjectKeys={projectScopeKeys}
                  onScopedProjectKeysChange={setProjectScopeKeys}
                  onProjectSettings={handleProjectSettings}
                  projectBadge={(project) => projectBadges.get(project.projectKey) ?? null}
                />
              }
              tabsMenu={
                tabsByRowKey.size > 0 || showTabs ? (
                  <SidebarTabsMenu
                    shown={showTabs}
                    limit={tabLimit}
                    sortOrder={tabSortOrder}
                    sortDirection={tabSortDirection}
                    shortcutLabel={toggleTabsShortcutLabel}
                    onToggle={toggleShowTabs}
                    onShownChange={handleTabsShownChange}
                    onSortOrderChange={handleTabSortOrderChange}
                    onSortDirectionChange={handleTabSortDirectionChange}
                  />
                ) : null
              }
            />
            <SidebarFilterPills
              searchQuery={isThreadSearchApplied ? threadSearchQuery : ""}
              onClearSearch={clearThreadSearch}
              pages={sidebarPages}
              groupStyles={threadGroups}
              onPagesChange={setSidebarPages}
              organisations={organisationOptions}
              scopedOrganisationKeys={scopedOrganisationKeys}
              onScopedOrganisationKeysChange={setOrganisationKeys}
              projects={projectGroups}
              scopedProjectKeys={projectScopeKeys}
              onScopedProjectKeysChange={setProjectScopeKeys}
            />
          </SidebarGroup>
        }
      >
        <SidebarGroup className="flex-1" role="presentation">
          {isSearchingThreads ? (
            threadSearchResults.length > 0 ? (
              <TooltipProvider
                key="sidebar-thread-search-tooltips-150"
                delay={150}
                closeDelay={0}
                timeout={400}
              >
                <ul
                  id="sidebar-thread-search-results"
                  role="listbox"
                  aria-label="Thread search results"
                  className="flex flex-col gap-px"
                >
                  {threadSearchResults.map((thread, index) => {
                    const threadKey = scopedThreadKey(
                      scopeThreadRef(thread.environmentId, thread.id),
                    );
                    return (
                      <SidebarSearchResultRow
                        isSettled={settledThreadKeys.has(threadKey)}
                        key={threadKey}
                        thread={thread}
                        project={
                          projectByKey.get(`${thread.environmentId}:${thread.projectId}`) ?? null
                        }
                        projectDisplayName={
                          projectDisplayNameByKey.get(
                            `${thread.environmentId}:${thread.projectId}`,
                          ) ?? null
                        }
                        isHighlighted={activeSearchResultIndex === index}
                        isRouteActive={highlightedRouteThreadKey === threadKey}
                        resultId={`sidebar-thread-search-result-${index}`}
                        searchMatch={
                          threadSearchMatchByKey.get(
                            threadSearchMatchKey({
                              environmentId: thread.environmentId,
                              threadId: thread.id,
                            }),
                          ) ?? null
                        }
                        searchQuery={threadSearchQuery}
                        searchMatchQuery={threadSearch.query}
                        onHighlight={() => setActiveSearchResultIndex(index)}
                        onSelect={() => selectThreadSearchResult(thread)}
                        onFileDropThreads={handleThreadFileDrop}
                      />
                    );
                  })}
                </ul>
              </TooltipProvider>
            ) : (
              <p
                role="status"
                className="px-2 py-6 text-center text-xs text-sidebar-muted-foreground"
              >
                {threadSearch.isPending ? "Searching thread messages…" : "No threads found"}
              </p>
            )
          ) : null}
          {!isSearchingThreads ? (
            <TooltipProvider
              key="sidebar-thread-tooltips-150"
              delay={150}
              closeDelay={0}
              timeout={400}
            >
              <DndContext
                sensors={dndSensors}
                autoScroll={!isContextDrag}
                collisionDetection={dndCollisionDetection}
                modifiers={[
                  restrictToVerticalAxis,
                  restrictBelowPins,
                  restrictToFirstScrollableAncestor,
                ]}
                onDragStart={handleThreadDragStart}
                onDragOver={handleThreadDragOver}
                onDragEnd={handleThreadDragEnd}
              >
                <SortableContext items={sortableIds} strategy={sidebarSortingStrategy}>
                  <ul
                    {...SIDEBAR_TREE_PROPS}
                    ref={attachTreeRef}
                    className={cn(
                      "relative flex flex-col gap-px",
                      sidebarListItems.length > 0 && "flex-1",
                      actionSweep !== null && "**:pointer-events-none",
                    )}
                  >
                    {(() => {
                      const renderThreadRow = (
                        thread: EnvironmentThreadShell,
                        section: SidebarSection,
                        // The tree row of the project folder this row sits in.
                        folderRow?: string,
                      ) => {
                        const threadKey = scopedThreadKey(
                          scopeThreadRef(thread.environmentId, thread.id),
                        );
                        const rowVariant = folderRow
                          ? folderRowsMultiline
                            ? "folder-multiline"
                            : "folder"
                          : sidebarThreadView(section, thread.groupName, threadGroups, threadViews);
                        const isCard = rowVariant === "card";
                        const rowTabs = tabsByRowKey.get(threadKey);
                        const rowTabsOpen = listedTabsByRowKey.has(threadKey);
                        const rowTabLayout = tabLayoutByRowKey.get(threadKey);
                        const rowTabList =
                          rowTabLayout?.shown ?? (isCard ? [thread, ...(rowTabs ?? [])] : rowTabs);
                        const displayThread = displayTabsByRowKey.get(threadKey) ?? thread;
                        const displayThreadKey = sidebarThreadKey(displayThread);
                        return (
                          <SortableThreadRow
                            key={threadKey}
                            sortableId={threadKey}
                            contextDrag={isContextDrag}
                            sortableDisabled={
                              projectFolders !== null ||
                              renamingThreadKey === displayThreadKey ||
                              section === "working" ||
                              section === "automations" ||
                              !threadsOnly ||
                              !draggableThreadKeys.has(threadKey) ||
                              optimisticDrop !== null
                            }
                            thread={thread}
                            displayThread={displayThread}
                            tabGroupName={tabGroupNames.get(threadKey)}
                            variant={rowVariant}
                            navigationParent={
                              folderRow ??
                              (section === "working" ||
                              section === "snoozed" ||
                              section === "settled"
                                ? `shelf:${section}`
                                : undefined)
                            }
                            // Each category keeps its action in either view.
                            variantAction={
                              section === "hidden"
                                ? "unhide"
                                : section === "snoozed"
                                  ? "unsnooze"
                                  : section === "settled"
                                    ? "unsettle"
                                    : "settle"
                            }
                            settlementSupported={serverConfigs.has(thread.environmentId)}
                            snoozeSupported={serverConfigs.has(thread.environmentId)}
                            pinningSupported={serverConfigs.has(thread.environmentId)}
                            isPinned={thread.pinnedAt != null}
                            dropVerb={
                              dragState?.activeKey === threadKey
                                ? resolveSidebarDropVerb(dragState.activeSection, dragTargetSection)
                                : null
                            }
                            dragOverPinned={
                              dragState?.activeKey === threadKey && dragTargetSection === "pinned"
                            }
                            sweepAction={
                              actionSweep?.keys.has(threadKey) ? actionSweep.action : null
                            }
                            snoozeWakeLabelText={
                              section === "snoozed" && thread.snoozedUntil != null
                                ? snoozeWakeLabel(thread.snoozedUntil, {
                                    now: new Date().toISOString(),
                                  })
                                : null
                            }
                            // All sections: a woken thread can classify straight
                            // into the settled tail (PR merged while snoozed), and
                            // the wake signal must survive the trip. Still-snoozed
                            // rows resolve to null on their own.
                            wokeAt={threadWokeAt(thread, { now: snoozeNow })}
                            isActive={highlightedRouteThreadKey === threadKey}
                            isRouteThread={routeThreadKey === threadKey}
                            inSplit={isSplitRowKey(threadKey)}
                            groupFocused={
                              rowTabsOpen &&
                              isCard &&
                              rowTabs?.some(
                                (tab) => sidebarThreadKey(tab) === highlightedRouteThreadKey,
                              ) === true
                            }
                            openPullRequestsInRightPanel={routeThreadRef !== null}
                            jumpLabel={
                              showJumpHints ? (jumpLabelByKey.get(threadKey) ?? null) : null
                            }
                            currentEnvironmentId={primaryEnvironmentId}
                            environmentLabel={
                              environmentLabelById.get(thread.environmentId) ?? null
                            }
                            environmentMachine={
                              environmentMachineById.get(thread.environmentId) ?? "server"
                            }
                            scratchMachineLabel={scratchMachineLabelFor(thread)}
                            project={
                              projectByKey.get(`${thread.environmentId}:${thread.projectId}`) ??
                              null
                            }
                            projectDisplayName={
                              projectDisplayNameByKey.get(
                                `${thread.environmentId}:${thread.projectId}`,
                              ) ?? null
                            }
                            providerEntryByInstanceId={
                              providerEntriesByEnvironment.get(thread.environmentId) ??
                              EMPTY_PROVIDER_ENTRIES
                            }
                            timestampFormat={timestampFormat}
                            onThreadClick={handleThreadClick}
                            onThreadActivate={navigateToThread}
                            onStartRename={startThreadRename}
                            onNameTabGroup={
                              rowTabs !== undefined || tabGroupNames.has(threadKey)
                                ? nameTabGroup
                                : undefined
                            }
                            onRenameTitleChange={setRenamingTitle}
                            onCommitRename={commitThreadRename}
                            onCancelRename={cancelThreadRename}
                            isRenaming={renamingThreadKey === displayThreadKey}
                            renamingTitle={
                              renamingThreadKey === displayThreadKey ? renamingTitle : ""
                            }
                            onContextMenu={handleThreadContextMenu}
                            onSettle={attemptSettle}
                            onActionSweepStart={startActionSweep}
                            onUnsettle={attemptUnsettle}
                            onSnooze={attemptSnooze}
                            onUnsnooze={attemptUnsnooze}
                            onUnhide={attemptUnhide}
                            onUnpin={attemptUnpin}
                            onPin={attemptPin}
                            onAcknowledgeWoke={acknowledgeWoke}
                            onFileDropThreads={handleThreadFileDrop}
                            onNewTab={
                              isCard && tabEnvironmentIds.has(thread.environmentId)
                                ? handleNewTab
                                : undefined
                            }
                            tabCount={rowTabs ? rowTabs.length + 1 : 0}
                            tabToggleCount={
                              rowTabLayout
                                ? rowTabLayout.shown.length
                                : sidebarTabToggleCount({
                                    // A card lists its own thread; a slim row lists only the others.
                                    listed: rowTabs ? rowTabs.length + (isCard ? 1 : 0) : 0,
                                    limit: tabLimit,
                                    expanded: expandedTabRowKey === threadKey,
                                  })
                            }
                            tabsOpen={rowTabsOpen}
                            tabPreview={
                              rowTabs && !rowTabsOpen ? (
                                <SidebarTabGroupPreview
                                  tabs={[thread, ...rowTabs]}
                                  activeKey={highlightedRouteThreadKey}
                                  providerEntriesByEnvironment={providerEntriesByEnvironment}
                                  tabSortOrder={tabSortOrder}
                                  tabSortDirection={tabSortDirection}
                                  tabManualRanks={tabManualRanks}
                                  openedAtByThreadKey={openedAtByThreadKey}
                                  onOpenTab={openTab}
                                />
                              ) : undefined
                            }
                            onToggleTabs={rowTabs ? toggleTabGroup : undefined}
                            onTabsResized={refreshListMotion}
                            tabs={
                              rowTabs ? (
                                <SidebarTabList
                                  tabKeys={(rowTabList ?? []).map(sidebarThreadKey)}
                                  overflowKey={
                                    rowTabLayout === undefined
                                      ? ""
                                      : `${rowTabLayout.hidden.length}:${rowTabLayout.expanded}`
                                  }
                                  onReorder={(activeKey, overKey) =>
                                    handleTabReorder(threadKey, activeKey, overKey)
                                  }
                                  onPair={handleTabPair}
                                  onPointerRestChange={(resting) =>
                                    handleTabPointerRest(threadKey, resting)
                                  }
                                  onLayoutChange={animateListMotion}
                                >
                                  {(rowTabList ?? []).map((tab) => {
                                    const tabKey = sidebarThreadKey(tab);
                                    const tabProjectKey =
                                      `${tab.environmentId}:${tab.projectId}` as const;
                                    return (
                                      <SortableTabThreadRow
                                        key={tabKey}
                                        id={tabKey}
                                        environmentId={tab.environmentId}
                                        contextDrag={false}
                                        disabled={renamingThreadKey === tabKey}
                                      >
                                        {(bag) => (
                                          <SidebarTabRow
                                            sortable={bag}
                                            timeLabel={tabSortTimeLabel(
                                              tab,
                                              tabSortOrder,
                                              openedAtByThreadKey[tabKey],
                                            )}
                                            thread={tab}
                                            isActive={highlightedRouteThreadKey === tabKey}
                                            inSplit={isSplitRowKey(tabKey)}
                                            jumpLabel={
                                              showJumpHints
                                                ? (jumpLabelByKey.get(tabKey) ?? null)
                                                : null
                                            }
                                            projectDisplayName={
                                              projectDisplayNameByKey.get(tabProjectKey) ?? null
                                            }
                                            providerEntryByInstanceId={
                                              providerEntriesByEnvironment.get(tab.environmentId) ??
                                              EMPTY_PROVIDER_ENTRIES
                                            }
                                            isRenaming={renamingThreadKey === tabKey}
                                            renamingTitle={
                                              renamingThreadKey === tabKey ? renamingTitle : ""
                                            }
                                            onThreadClick={handleThreadClick}
                                            onThreadActivate={navigateToThread}
                                            onStartRename={startThreadRename}
                                            onRenameTitleChange={setRenamingTitle}
                                            onCommitRename={commitThreadRename}
                                            onCancelRename={cancelThreadRename}
                                            onContextMenu={handleThreadContextMenu}
                                            onFileDropThreads={handleThreadFileDrop}
                                            onCloseTab={handleCloseTab}
                                          />
                                        )}
                                      </SortableTabThreadRow>
                                    );
                                  })}
                                  {rowTabLayout &&
                                  (rowTabLayout.hidden.length > 0 || rowTabLayout.expanded) ? (
                                    <SidebarTabOverflowRow
                                      hidden={rowTabLayout.hidden}
                                      expanded={rowTabLayout.expanded}
                                      providerEntriesByEnvironment={providerEntriesByEnvironment}
                                      tabSortOrder={tabSortOrder}
                                      openedAtByThreadKey={openedAtByThreadKey}
                                      onToggle={() => toggleTabOverflow(threadKey)}
                                      onOpenTab={openTab}
                                      onPreviewOpenChange={(open) =>
                                        handleTabOverflowPreview(threadKey, open)
                                      }
                                    />
                                  ) : null}
                                </SidebarTabList>
                              ) : null
                            }
                          />
                        );
                      };
                      const from = isContextDrag ? null : (dragState?.activeSection ?? null);
                      const items: ReactNode[] = !showsThreads
                        ? []
                        : [
                            <SidebarDraftBlock
                              key="draft-sessions"
                              projectByKey={projectByKey}
                              projectDisplayNameByKey={projectDisplayNameByKey}
                              scopedProjectKeys={scopedProjectKeys}
                              routeDraftId={routeDraftIdForRows}
                              onNavigateToDraft={navigateToDraft}
                              onDraftContextMenu={handleDraftContextMenu}
                            />,
                          ];
                      for (const item of sidebarListItems) {
                        if (item.kind === "thread") {
                          // Folders draw active rows in their own place below.
                          if (projectFolders !== null && item.section === "active") continue;
                          items.push(renderThreadRow(threadByKey.get(item.key)!, item.section));
                          continue;
                        }
                        if (projectFolders !== null && item.marker === "active-placeholder") {
                          for (const folder of projectFolders) {
                            items.push(
                              <SidebarProjectFolderHeader
                                key={`project-folder:${folder.group.projectKey}`}
                                group={folder.group}
                                collapsed={folder.collapsed}
                                hiddenThreads={folder.hiddenThreads}
                                onToggle={toggleProjectFolder}
                                onNewThread={startThreadInProjectFolder}
                                onContextMenu={handleProjectFolderContextMenu}
                              />,
                            );
                            for (const thread of folder.threads) {
                              items.push(
                                renderThreadRow(
                                  thread,
                                  "active",
                                  sidebarFolderRowId(folder.group.projectKey),
                                ),
                              );
                            }
                          }
                          continue;
                        }
                        switch (item.marker) {
                          case "pinned-header":
                            items.push(
                              <SidebarDragBoundary
                                key="pinned-header"
                                marker="pinned-header"
                                label="Pinned"
                                visible={from !== null}
                                isDropTarget={dragTargetSection === "pinned"}
                              />,
                            );
                            break;
                          case "pinned-divider":
                            items.push(
                              <SidebarDragBoundary
                                key="pinned-divider"
                                marker="pinned-divider"
                                label="Active"
                                visible={from !== null}
                                isDropTarget={dragTargetSection === "active"}
                              />,
                            );
                            break;
                          case "active-placeholder":
                            items.push(
                              <SidebarSectionPlaceholder
                                key="active-placeholder"
                                marker="active-placeholder"
                                label="Active"
                                showHint={
                                  from !== null &&
                                  (activeThreads.length === 0 ||
                                    (from === "active" &&
                                      activeThreads.length === 1 &&
                                      dragTargetSection !== null &&
                                      dragTargetSection !== "active"))
                                }
                                isDropTarget={dragTargetSection === "active"}
                              />,
                            );
                            break;
                          case "working-header":
                            items.push(
                              <SidebarSectionHeader
                                key="working-shelf-header"
                                marker="working-header"
                                className="mt-auto"
                                label="Working"
                                count={workingThreads.length}
                                toggle={{
                                  expanded: workingShelfExpanded,
                                  onToggle: toggleWorkingShelf,
                                }}
                              />,
                            );
                            break;
                          case "automations-header":
                          case "snoozed-header":
                          case "hidden-header":
                          case "settled-header": {
                            const page = SIDEBAR_PAGE_BY_MARKER[item.marker];
                            const collapsed = collapsedPages.has(page);
                            items.push(
                              <SortableSidebarMarker
                                key={item.marker}
                                marker={item.marker}
                                className="mx-0.5 h-8"
                              >
                                <CollapsibleSectionHeader
                                  expanded={!collapsed}
                                  onClick={() => togglePageCollapsed(page)}
                                >
                                  {collapsed
                                    ? `${sidebarPageLabel(page)} (${pageCounts.get(page) ?? 0})`
                                    : sidebarPageLabel(page)}
                                </CollapsibleSectionHeader>
                              </SortableSidebarMarker>,
                            );
                            break;
                          }
                          case "group-header":
                            items.push(
                              <SortableSidebarMarker
                                key={sidebarListItemId(item)}
                                id={sidebarListItemId(item)}
                                marker={item.marker}
                                className="mx-0.5"
                              >
                                <SidebarGroupHeader
                                  name={item.group!}
                                  style={threadGroups[item.group!]}
                                  count={groupedThreadsByName.get(item.group!)?.length ?? 0}
                                  collapsed={collapsedPages.has(sidebarGroupPage(item.group!))}
                                  onEdit={editThreadGroup}
                                  onToggle={() =>
                                    togglePageCollapsed(sidebarGroupPage(item.group!))
                                  }
                                />
                              </SortableSidebarMarker>,
                            );
                            break;
                        }
                      }
                      return items;
                    })()}
                    {showsPage("settled") &&
                    !collapsedPages.has("settled") &&
                    hiddenSettledCount > 0 ? (
                      <li className="list-none">
                        <button
                          type="button"
                          role="treeitem"
                          tabIndex={-1}
                          data-sidebar-row="settled:more"
                          data-sidebar-parent="shelf:settled"
                          disabled={olderSettledShelf.loading}
                          onClick={() => {
                            olderSettledShelf.retry();
                            showMoreSettled();
                          }}
                          className="flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-left text-sm text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground disabled:cursor-default"
                        >
                          {/* Plus means "add", so revealing more uses a chevron. */}
                          <ChevronDownIcon aria-hidden className="size-4 shrink-0" />
                          {olderSettledShelf.loading
                            ? "Loading"
                            : olderSettledShelf.failed
                              ? "Could not load older threads. Retry"
                              : `Show ${Math.min(hiddenSettledCount, SETTLED_TAIL_PAGE_COUNT)} more`}
                        </button>
                      </li>
                    ) : null}
                  </ul>
                </SortableContext>
              </DndContext>
            </TooltipProvider>
          ) : null}
          {!isSearchingThreads && !showsThreads && sidebarListItems.length === 0 ? (
            <p
              role="status"
              className="px-2 py-6 text-center text-xs text-sidebar-muted-foreground"
            >
              No {sidebarPages.map(sidebarPageLabel).join(" or ")} threads
            </p>
          ) : null}
          {!isSearchingThreads &&
          showsThreads &&
          sidebarListItems.length === 0 &&
          visibleDraftSessionCount === 0 ? (
            <div className="flex flex-col items-center gap-2 px-2 py-6 text-center text-xs text-muted-foreground/60">
              {projects.length === 0 ? (
                <>
                  <span>No projects yet</span>
                  <button
                    type="button"
                    onClick={openAddProjectCommandPalette}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-sidebar-border px-2.5 py-1 text-2xs font-medium text-sidebar-muted-foreground transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
                  >
                    <PlusIcon className="-mx-0.5 size-3" />
                    Add project
                  </button>
                </>
              ) : scopedProjectGroups.length === 1 ? (
                `No threads in ${scopedProjectGroups[0]!.displayName} yet`
              ) : scopedProjectGroups.length > 1 ? (
                "No threads in these projects yet"
              ) : (
                "No threads yet"
              )}
            </div>
          ) : null}
        </SidebarGroup>
      </SidebarContent>
      <SidebarChromeFooter />
    </>
  );
}
