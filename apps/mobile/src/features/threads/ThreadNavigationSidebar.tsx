import { useActiveNewTask } from "../../state/active-new-task";
import { ThreadUndoNotice } from "../home/ThreadUndoNotice";
import { useAndroidControlSizing } from "../../components/ui/useAndroidControlSizing";
import {
  pickableProjectGroups,
  resolveScratchProjectScopeKey,
} from "@t3tools/client-runtime/state/project-grouping";
import {
  useAppearancePreferences,
  useAndroidFloatingTabs,
} from "../settings/appearance/AppearancePreferencesProvider";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import { threadSearchMatchKey } from "@t3tools/client-runtime/state/thread-search";
import { threadTabGroupHeaderTarget } from "@t3tools/client-runtime/thread-tabs";
import { AnimatedLegendList } from "@legendapp/list/reanimated";
import { THREAD_SIDEBAR_ROW_LAYOUT } from "./threadListAnimations";
import { useAtomValue } from "@effect/atom-react";
import { useMemo, useRef, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { GestureDetector, useNativeGesture } from "react-native-gesture-handler";
import type { SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import { FLOATING_TABS } from "../layout/workspace/floating-workspace-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/ui/AppText";
import { scopedProjectKey, scopedThreadKey } from "../../lib/scopedEntities";
import { useProjects, useNavigationThreadShells } from "../../state/entities";
import { useHiddenTabThreads } from "./useHiddenTabThreads";
import { useThreadSearch } from "../../state/queries";
import { useThreadListPages } from "./use-thread-list-pages";
import { scopeProjectRefsByOrganisations } from "../home/thread-list-organisations";
import { useThreadListOrganisations } from "../home/use-thread-list-organisations";
import { useThreadListV2ShelfPreferences } from "./use-thread-list-v2-shelf-preferences";
import { useThreadListNow } from "./use-thread-list-now";
import { usePendingThreadOrder } from "../../state/thread-order";
import { threadListEnvironmentsAtom } from "../../state/presentation";
import { usePendingNewTasks, type PendingNewTask } from "../../state/use-pending-new-tasks";
import { useQueuedThreadKeys } from "../../state/use-thread-outbox";
import { useMessageDraftCounts } from "../../state/messageDrafts";
import { useWorkspaceState } from "../../state/workspace";
import { useSavedRemoteConnections } from "../../state/use-remote-environment-registry";
import { useThreadListV2 } from "./useThreadListV2";
import { useThreadJumpShortcuts } from "../keyboard/threadKeyboardShortcuts";
import { requestThreadMessageJump } from "./threadMessageJump";
import { useThreadListSearchMatches } from "./useThreadListSearchMatches";
import { useHomeListOptions } from "../home/home-list-options";
import { buildHomeListFilterMenuItems } from "../home/home-list-filter-menu";
import { useThreadListFilterFacets } from "../home/use-thread-list-filter-facets";
import { buildHomeProjectScopes } from "../home/homeThreadList";
import { SwipeableScrollGateProvider, useSwipeableScrollGate } from "../home/thread-swipe-actions";
import { usePendingTaskListActions } from "../home/usePendingTaskListActions";
import { useThreadListActions } from "../home/useThreadListActions";
import { useFabScroll } from "../home/FabScrollContext";
import { WorkspaceListHeader } from "../layout/workspace/WorkspaceListHeader";
import { WORKSPACE_LIST_SCROLL_INSETS } from "../layout/workspace/workspace-list-insets";
import { WorkspaceSidebarColumn } from "../layout/workspace/WorkspaceSidebarColumn";
import {
  ThreadListV2GroupSectionHeader,
  ThreadListV2PendingRow,
  ThreadListV2Row,
  ThreadListV2SectionDivider,
  ThreadListV2ShowMoreRow,
  ThreadListV2WorkingShelfHeader,
} from "./thread-list-v2-items";
import { useThreadRowProviderInstanceResolver } from "./thread-provider-instance";
import type { ThreadPrPresentation } from "../../state/thread-pr-presentation";
import { ThreadPrDemandProvider } from "../../state/thread-pr-demand";
import {
  isThreadListV2ListItem,
  threadListV2ListItemsAreEqual,
  THREAD_LIST_V2_SETTLED_INITIAL_COUNT,
  THREAD_LIST_V2_SETTLED_PAGE_COUNT,
  isDefaultThreadListPages,
  type ThreadListV2ListItem,
} from "./threadListV2";
import { useSelectWorkspaceDetail } from "../layout/workspace/useSelectWorkspaceDetail";
import { NativeScrollView } from "../../native/NativeScrollViewMarker";

type SidebarListItem =
  | ThreadListV2ListItem
  | {
      readonly type: "v2-show-more";
      readonly key: string;
      readonly hiddenCount: number;
      readonly state?: "loading" | "failed";
    };

interface ThreadNavigationSidebarProps {
  readonly width: number;
  readonly visible: boolean;
  readonly selectedThreadKey: string | null;
  readonly onOpenSettings: () => void;
  readonly onOpenEnvironmentSettings: () => void;
  readonly onNewThreadOnBranch: (thread: EnvironmentThreadShell) => void;
  readonly onNewThreadInProject: (project: EnvironmentProject) => void;
  readonly onOpenPendingTask: (pendingTask: PendingNewTask) => void;
  readonly onSearchQueryChange: (query: string) => void;
  readonly onSelectThread: (thread: EnvironmentThreadShell) => void;
  readonly onOpenThreadPullRequests: (
    thread: EnvironmentThreadShell,
    pr: ThreadPrPresentation,
  ) => void;
  readonly onRequestVisibility: () => void;
  readonly searchQuery: string;
}

export function ThreadNavigationSidebar(props: ThreadNavigationSidebarProps) {
  return (
    <ThreadPrDemandProvider visible={props.visible}>
      <WorkspaceSidebarColumn width={props.width}>
        <ThreadNavigationSidebarPane {...props} />
      </WorkspaceSidebarColumn>
    </ThreadPrDemandProvider>
  );
}

function ThreadNavigationSidebarPane(props: ThreadNavigationSidebarProps) {
  const floatingTabsEnabled = useAndroidFloatingTabs();
  const { themeVariables: materialTheme } = useAppearancePreferences();
  const drawerColor = materialTheme["--color-drawer"];

  const insets = useSafeAreaInsets();
  const { fabClearance, fabSize } = useAndroidControlSizing();
  const projects = useProjects();
  const allThreads = useNavigationThreadShells();
  const { hiddenTabThreads, groupNames: tabGroupNames } = useHiddenTabThreads(allThreads);
  const threads = (() =>
    allThreads
      .filter((thread) => !hiddenTabThreads.has(`${thread.environmentId}:${thread.id}`))
      .map((thread) => ({
        ...thread,
        tabGroupName: tabGroupNames.get(`${thread.environmentId}:${thread.id}`),
      })))();
  const sidebarSelectedThreadKey =
    props.selectedThreadKey === null
      ? null
      : (hiddenTabThreads.get(props.selectedThreadKey) ?? props.selectedThreadKey);
  const { environments: workspaceEnvironments, state: catalogState } = useWorkspaceState();
  const { savedConnectionsById } = useSavedRemoteConnections();
  const openSwipeableRef = useRef<SwipeableMethods | null>(null);
  const sidebarScrollGesture = useNativeGesture();
  const {
    archiveThread,
    confirmDeleteThread,
    settleThread,
    snoozeThread,
    unsnoozeThread,
    unsettleThread,
    pinThread,
    unpinThread,
    setThreadAutoSettle,
    setThreadSubscriptionLimitGuard,
    setThreadHidden,
    setThreadGroup,
    moveThreadToNewGroup,
    moveThreadToProject,
    createThreadGroup,
    editThreadGroup,
    moveThread,
    renameThread,
    regenerateThreadTitle,
  } = useThreadListActions();
  const pendingTasks = usePendingNewTasks();
  const activeNewTask = useActiveNewTask();
  const queuedThreadKeys = useQueuedThreadKeys();
  const draftCounts = useMessageDraftCounts();
  const selectDetail = useSelectWorkspaceDetail();
  const { confirmDeletePendingTask } = usePendingTaskListActions((params) =>
    selectDetail({ name: "Thread", params }),
  );
  const environments = Object.values(savedConnectionsById)
    .map((connection) => ({
      environmentId: connection.environmentId,
      label: connection.environmentLabel,
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
  const availableEnvironmentIds = new Set(
    environments.map((environment) => environment.environmentId),
  );
  const { options, setSelectedEnvironmentId, setSelectedProjectKey } =
    useHomeListOptions(availableEnvironmentIds);
  const searchEnvironmentIds =
    options.selectedEnvironmentId === null
      ? workspaceEnvironments
          .filter((environment) => environment.connectionState === "connected")
          .map((environment) => environment.environmentId)
      : workspaceEnvironments.some(
            (environment) =>
              environment.environmentId === options.selectedEnvironmentId &&
              environment.connectionState === "connected",
          )
        ? [options.selectedEnvironmentId]
        : [];
  // A legacy per-environment scratch key resolves here on every render; the stored
  // value is only rewritten when the user picks a filter.
  const resolvedProjectKey = resolveScratchProjectScopeKey(options.selectedProjectKey, projects, {
    sidebarProjectGroupingMode: options.projectGroupingMode,
    sidebarProjectGroupingOverrides: {},
  });
  const projectScopes = useMemo(
    () =>
      buildHomeProjectScopes({
        projects,
        environmentId: options.selectedEnvironmentId,
        projectGroupingMode: options.projectGroupingMode,
      }),
    [projects, options.selectedEnvironmentId, options.projectGroupingMode],
  );
  const projectTitleByProjectKey = useMemo(
    () =>
      new Map(
        projectScopes.flatMap((scope) =>
          scope.projectRefs.map(
            (projectRef) =>
              [
                scopedProjectKey(projectRef.environmentId, projectRef.projectId),
                scope.title,
              ] as const,
          ),
        ),
      ),
    [projectScopes],
  );
  // An archived project's filter reads as all projects, matching the filter menu.
  const selectedProjectScope =
    pickableProjectGroups(projectScopes).find((scope) => scope.key === resolvedProjectKey) ?? null;
  const selectedProjectKey = selectedProjectScope?.key ?? null;
  const { organisations, organisationKeys, toggleOrganisation, clearOrganisations } =
    useThreadListOrganisations(projects);
  // The Organisations filter narrows the project scope (or every checkout).
  const scopedProjectRefs = (() =>
    scopeProjectRefsByOrganisations({
      projects,
      projectRefs: selectedProjectScope?.projectRefs ?? null,
      organisationKeys,
    }))();
  const threadSearch = useThreadSearch(
    searchEnvironmentIds,
    props.searchQuery,
    selectedProjectScope === null
      ? {}
      : { projectIds: selectedProjectScope.projectRefs.map((ref) => ref.projectId) },
  );
  // This map reaches LegendList's extraData, which re-renders every row whenever it changes
  // identity; the hook keeps it stable.
  const threadSearchMatchByKey = useThreadListSearchMatches(threads, threadSearch);
  const projectByKey = useMemo(() => {
    const map = new Map<string, EnvironmentProject>();
    for (const project of projects) {
      map.set(scopedProjectKey(project.environmentId, project.id), project);
    }
    return map;
  }, [projects]);

  const [settledVisibleCount, setSettledVisibleCount] = useState(
    THREAD_LIST_V2_SETTLED_INITIAL_COUNT,
  );
  const settledResetKey = `${options.selectedEnvironmentId ?? "all"}:${selectedProjectKey ?? "all"}:${props.searchQuery.trim()}`;
  const [lastSettledResetKey, setLastSettledResetKey] = useState(settledResetKey);
  if (lastSettledResetKey !== settledResetKey) {
    setLastSettledResetKey(settledResetKey);
    setSettledVisibleCount(THREAD_LIST_V2_SETTLED_INITIAL_COUNT);
  }
  const showMoreSettled = () =>
    setSettledVisibleCount((count) => count + THREAD_LIST_V2_SETTLED_PAGE_COUNT);
  const {
    loaded: shelfPreferencesLoaded,
    workingShelfEnabled,
    workingShelfExpanded,
    toggleWorkingShelf,
  } = useThreadListV2ShelfPreferences();
  const snoozedShelfExpanded = true;
  const settledShelfExpanded = true;
  const now = useThreadListNow(threads);
  const listEnvironments = useAtomValue(threadListEnvironmentsAtom);
  const {
    providersByEnvironmentId,
    machineByEnvironmentId,
    settlementEnvironmentIds,
    snoozeEnvironmentIds,
    snoozePresetsByEnvironmentId,
    pinningEnvironmentIds,
    autoSettleOptOutEnvironmentIds,
    hidingEnvironmentIds,
    groupEnvironmentIds,
    groupsShownInThreads,
    groupsHidingSettled,
    automationsHidingSettledEnvironmentIds,
    pinReorderEnvironmentIds,
    activeReorderEnvironmentIds,
    titleRegenerationEnvironmentIds,
  } = listEnvironments;
  const {
    pages,
    availablePages,
    groups,
    groupNames,
    groupsSupported,
    togglePage,
    renameGroupPage,
  } = useThreadListPages(threads);
  const filterFacets = useThreadListFilterFacets({
    threads,
    projects,
    projectGroupingMode: options.projectGroupingMode,
    organisations,
    environmentId: options.selectedEnvironmentId,
    projectKey: selectedProjectKey,
    organisationKeys,
    pages,
    searchQuery: props.searchQuery,
  });
  const filterEnvironments = (() =>
    environments.map((environment) => ({
      ...environment,
      count: filterFacets.environmentCounts.get(environment.environmentId) ?? 0,
    })))();
  const handleEditGroup = async (name: string) => {
    const result = await editThreadGroup(name);
    if (result !== null) renameGroupPage(result.from, result.to);
  };
  const resolveProviderInstance = useThreadRowProviderInstanceResolver(providersByEnvironmentId);
  const pendingOrder = usePendingThreadOrder();
  const {
    layout: threadListV2Layout,
    items: threadListV2Items,
    contentOnlyThreadKeys,
    olderSettledShelf,
  } = useThreadListV2({
    threads,
    pendingTasks,
    environmentId: options.selectedEnvironmentId,
    projectRefs: scopedProjectRefs,
    searchQuery: props.searchQuery,
    searchMatches: threadSearchMatchByKey,
    settlementEnvironmentIds,
    snoozeEnvironmentIds,
    hidingEnvironmentIds,
    groupEnvironmentIds,
    groupsShownInThreads,
    groupsHidingSettled,
    automationsHidingSettledEnvironmentIds,
    pages,
    draftCounts,
    pinReorderEnvironmentIds,
    activeReorderEnvironmentIds,
    queuedThreadKeys,
    settledLimit: settledVisibleCount,
    now,
    pendingOrder,
    shelfPreferencesLoaded,
    workingShelfEnabled,
    workingShelfExpanded,
    snoozedShelfExpanded,
    settledShelfExpanded,
    selectedThreadKey: sidebarSelectedThreadKey,
  });
  const listItems: readonly SidebarListItem[] =
    settledShelfExpanded && threadListV2Layout.hiddenSettledCount > 0
      ? [
          ...threadListV2Items,
          {
            type: "v2-show-more",
            key: "v2-show-more",
            hiddenCount: threadListV2Layout.hiddenSettledCount,
            ...(olderSettledShelf.loading
              ? { state: "loading" as const }
              : olderSettledShelf.failed
                ? { state: "failed" as const }
                : {}),
          },
        ]
      : threadListV2Items;

  const handleSwipeableWillOpen = (methods: SwipeableMethods) => {
    if (openSwipeableRef.current !== methods) {
      openSwipeableRef.current?.close();
      openSwipeableRef.current = methods;
    }
  };
  const handleSwipeableClose = (methods: SwipeableMethods) => {
    if (openSwipeableRef.current === methods) {
      openSwipeableRef.current = null;
    }
  };
  // Destructure callback props; capturing all props would invalidate these row-closing handlers on unrelated changes.
  const { onSelectThread, onOpenThreadPullRequests } = props;
  // A row listed for a message match opens the thread at that message, by
  // tap or by shortcut.
  const handleSelectThread = (thread: EnvironmentThreadShell) => {
    const rowKey = scopedThreadKey(thread.environmentId, thread.id);
    const targetKey = threadTabGroupHeaderTarget(
      rowKey,
      props.selectedThreadKey,
      hiddenTabThreads,
      hiddenTabThreads,
      {},
    );
    openSwipeableRef.current?.close();
    if (targetKey !== rowKey) return;
    const key = threadSearchMatchKey({ environmentId: thread.environmentId, threadId: thread.id });
    const messageId = contentOnlyThreadKeys.has(key)
      ? threadSearchMatchByKey.get(key)?.messageId
      : undefined;
    if (messageId) {
      requestThreadMessageJump(scopedThreadKey(thread.environmentId, thread.id), messageId);
    }
    onSelectThread(thread);
    openSwipeableRef.current?.close();
  };
  const handleOpenThreadPullRequests = (
    thread: EnvironmentThreadShell,
    pr: ThreadPrPresentation,
  ) => {
    onOpenThreadPullRequests(thread, pr);
    openSwipeableRef.current?.close();
  };
  const handleScrollBeginDrag = () => {
    openSwipeableRef.current?.close();
  };
  const onFabScroll = useFabScroll();
  const { swipeEnabled, scrollGateHandlers } = useSwipeableScrollGate({
    onScroll: onFabScroll,
    onScrollBeginDrag: handleScrollBeginDrag,
  });
  // Recycle equality needs project/search data for titles and favicons; keep the minute clock on items to limit updates.
  const listExtraData = {
    selectedThreadKey: sidebarSelectedThreadKey ?? "",
    activeNewTask,
    projectByKey,
    projectTitleByProjectKey,
    savedConnectionsById,
    listEnvironments,
    threadSearchMatchByKey,
    workingShelfEnabled,
    groupNames,
    groups,
  };
  useThreadJumpShortcuts(listItems, handleSelectThread);
  const sidebarItemsAreEqual = (previous: SidebarListItem, item: SidebarListItem): boolean => {
    if (isThreadListV2ListItem(previous) && isThreadListV2ListItem(item)) {
      return threadListV2ListItemsAreEqual(previous, item);
    }
    if (previous.type === "v2-show-more" && item.type === "v2-show-more") {
      return previous.hiddenCount === item.hiddenCount && previous.state === item.state;
    }
    return false;
  };
  const renderListItem = ({ item }: { readonly item: SidebarListItem }) => {
    switch (item.type) {
      case "v2-pending": {
        const pendingScopeKey = scopedProjectKey(
          item.pendingTask.environmentId,
          item.pendingTask.projectId,
        );
        return (
          <ThreadListV2PendingRow
            pendingTask={item.pendingTask}
            selected={
              activeNewTask?.pendingKey === item.pendingTask.key ||
              (item.pendingTask.kind === "pending" &&
                scopedThreadKey(
                  item.pendingTask.environmentId,
                  item.pendingTask.message.threadId,
                ) === props.selectedThreadKey)
            }
            project={projectByKey.get(pendingScopeKey) ?? null}
            projectTitle={projectTitleByProjectKey.get(pendingScopeKey)}
            environmentLabel={
              Object.keys(savedConnectionsById).length > 1
                ? (savedConnectionsById[item.pendingTask.environmentId]?.environmentLabel ?? null)
                : null
            }
            environmentMachine={machineByEnvironmentId.get(item.pendingTask.environmentId)}
            pane="sidebar"
            showPendingDivider={item.showPendingDivider}
            onSelectPendingTask={props.onOpenPendingTask}
            onDeletePendingTask={confirmDeletePendingTask}
            fullSwipeWidth={props.width - 20}
            onSwipeableClose={handleSwipeableClose}
            onSwipeableWillOpen={handleSwipeableWillOpen}
            simultaneousSwipeGesture={sidebarScrollGesture}
          />
        );
      }
      case "v2-thread": {
        const thread = item.item.thread;
        const scopeKey = scopedProjectKey(thread.environmentId, thread.projectId);
        return (
          <ThreadListV2Row
            onNewThreadOnBranch={props.onNewThreadOnBranch}
            thread={thread}
            variant={item.item.variant}
            hasQueuedMessages={item.hasQueuedMessages}
            draftCount={item.draftCount}
            snoozed={item.item.snoozed}
            pinned={item.item.pinned}
            hidden={item.item.hidden}
            wokeAt={item.item.wokeAt}
            snoozePresetMinute={item.snoozePresetMinute ?? ""}
            snoozeWakeLabelText={item.snoozeWakeLabelText}
            timeLabel={item.timeLabel}
            project={projectByKey.get(scopeKey) ?? null}
            providerInstance={resolveProviderInstance(thread)}
            providers={providersByEnvironmentId.get(thread.environmentId)}
            environmentLabel={
              Object.keys(savedConnectionsById).length > 1
                ? (savedConnectionsById[thread.environmentId]?.environmentLabel ?? null)
                : null
            }
            environmentMachine={machineByEnvironmentId.get(thread.environmentId)}
            searchMatch={
              // Only rows listed for their messages show one and open at it.
              contentOnlyThreadKeys.has(
                threadSearchMatchKey({ environmentId: thread.environmentId, threadId: thread.id }),
              )
                ? threadSearchMatchByKey.get(
                    threadSearchMatchKey({
                      environmentId: thread.environmentId,
                      threadId: thread.id,
                    }),
                  )
                : undefined
            }
            searchQuery={threadSearch.query}
            pane="sidebar"
            selected={
              !activeNewTask &&
              scopedThreadKey(thread.environmentId, thread.id) === sidebarSelectedThreadKey
            }
            fullSwipeWidth={props.width - 20}
            onSelectThread={handleSelectThread}
            onOpenThreadPullRequests={handleOpenThreadPullRequests}
            onDeleteThread={confirmDeleteThread}
            onArchiveThread={archiveThread}
            onRenameThread={renameThread}
            onRegenerateThreadTitle={regenerateThreadTitle}
            titleRegenerationSupported={titleRegenerationEnvironmentIds.has(thread.environmentId)}
            settlementSupported={settlementEnvironmentIds.has(thread.environmentId)}
            onSettleThread={settleThread}
            snoozeSupported={snoozeEnvironmentIds.has(thread.environmentId)}
            snoozePresets={snoozePresetsByEnvironmentId.get(thread.environmentId)}
            pinningSupported={pinningEnvironmentIds.has(thread.environmentId)}
            autoSettleOptOutSupported={autoSettleOptOutEnvironmentIds.has(thread.environmentId)}
            hidingSupported={hidingEnvironmentIds.has(thread.environmentId)}
            groupsSupported={groupEnvironmentIds.has(thread.environmentId)}
            groupNames={groupNames}
            reorderSupported={
              item.item.grouped
                ? false
                : item.item.pinned
                  ? pinReorderEnvironmentIds.has(thread.environmentId)
                  : !workingShelfEnabled && activeReorderEnvironmentIds.has(thread.environmentId)
            }
            canMoveUp={item.canMoveUp}
            canMoveDown={item.canMoveDown}
            onSnoozeThread={snoozeThread}
            onUnsnoozeThread={unsnoozeThread}
            onUnsettleThread={unsettleThread}
            onPinThread={pinThread}
            onUnpinThread={unpinThread}
            onSetThreadAutoSettle={setThreadAutoSettle}
            onSetThreadSubscriptionLimitGuard={setThreadSubscriptionLimitGuard}
            onSetThreadHidden={setThreadHidden}
            onSetThreadGroup={setThreadGroup}
            onMoveThreadToNewGroup={moveThreadToNewGroup}
            onMoveThreadToProject={moveThreadToProject}
            onMoveThread={moveThread}
            onSwipeableClose={handleSwipeableClose}
            onSwipeableWillOpen={handleSwipeableWillOpen}
            simultaneousSwipeGesture={sidebarScrollGesture}
          />
        );
      }
      case "v2-working-shelf":
        return (
          <ThreadListV2WorkingShelfHeader
            count={item.count}
            disabled={item.disabled}
            expanded={item.expanded}
            onToggle={toggleWorkingShelf}
            pane="sidebar"
          />
        );
      case "v2-group-section":
        return (
          <ThreadListV2GroupSectionHeader
            name={item.name}
            group={groups[item.name]}
            empty={item.empty}
            pane="sidebar"
            onEdit={handleEditGroup}
          />
        );
      case "v2-snoozed-shelf":
        return <ThreadListV2SectionDivider label="Snoozed" pane="sidebar" tone="snoozed" />;
      case "v2-automations-section":
        return <ThreadListV2SectionDivider label="Automations" pane="sidebar" />;
      case "v2-hidden-section":
        return <ThreadListV2SectionDivider label="Hidden" pane="sidebar" />;
      case "v2-settled-shelf":
        return <ThreadListV2SectionDivider label="Settled" pane="sidebar" />;
      case "v2-show-more":
        return (
          <ThreadListV2ShowMoreRow
            pane="sidebar"
            hiddenCount={item.hiddenCount}
            {...(item.state === undefined ? {} : { state: item.state })}
            onPress={() => {
              olderSettledShelf.retry();
              showMoreSettled();
            }}
          />
        );
    }
  };
  const header = (
    <WorkspaceListHeader
      accessibilityLabel="T3 Code, Threads"
      onOpenEnvironments={props.onOpenEnvironmentSettings}
      onOpenSettings={props.onOpenSettings}
      search={{
        value: props.searchQuery,
        onChangeText: props.onSearchQueryChange,
        placeholder: "Search",
        accessibilityLabel: "Search threads",
      }}
      filter={{
        customized:
          options.selectedEnvironmentId !== null ||
          selectedProjectKey !== null ||
          organisationKeys.length > 0 ||
          !isDefaultThreadListPages(pages),
        items: buildHomeListFilterMenuItems({
          environments: filterEnvironments,
          projects: filterFacets.projects,
          selectedEnvironmentId: options.selectedEnvironmentId,
          selectedProjectKey,
          onEnvironmentChange: setSelectedEnvironmentId,
          onProjectChange: setSelectedProjectKey,
          pages,
          availablePages,
          onTogglePage: togglePage,
          pageCounts: filterFacets.pageCounts,
          groups,
          onCreateGroup: groupsSupported ? createThreadGroup : undefined,
          organisations: filterFacets.organisations,
          organisationKeys,
          onToggleOrganisation: toggleOrganisation,
          onClearOrganisations: clearOrganisations,
        }),
      }}
      sidebar={{
        width: props.width,
        visible: props.visible,
        onRequestVisibility: props.onRequestVisibility,
      }}
    />
  );
  const listEmpty = (
    <Text
      className={
        Platform.OS === "android"
          ? "px-4 py-4 text-center text-sm text-drawer-foreground-muted"
          : "px-2 py-4 text-sm text-drawer-foreground-muted"
      }
    >
      {catalogState.isLoadingConnections
        ? "Loading threads…"
        : Platform.OS === "android" && !catalogState.hasConnections
          ? "No environments connected"
          : props.searchQuery.trim().length > 0
            ? threadSearch.isPending
              ? "Searching thread messages…"
              : "No matching threads"
            : !isDefaultThreadListPages(pages)
              ? "Nothing to show in the picked pages"
              : selectedProjectScope !== null
                ? `No threads in ${selectedProjectScope.title}`
                : "No threads yet"}
    </Text>
  );

  if (Platform.OS === "ios") {
    return (
      <>
        {header}
        <View className="flex-1">
          <SwipeableScrollGateProvider enabled={swipeEnabled}>
            <GestureDetector gesture={sidebarScrollGesture}>
              <AnimatedLegendList
                renderScrollComponent={NativeScrollView}
                itemLayoutAnimation={THREAD_SIDEBAR_ROW_LAYOUT}
                data={listItems}
                drawDistance={500}
                estimatedItemSize={64}
                extraData={listExtraData}
                getItemType={(item) => item.type}
                itemsAreEqual={sidebarItemsAreEqual}
                keyExtractor={(item) => item.key}
                renderItem={renderListItem}
                {...WORKSPACE_LIST_SCROLL_INSETS}
                contentContainerStyle={[
                  styles.threadListContent,
                  {
                    paddingBottom: Math.max(insets.bottom, 16) + 16,
                    paddingTop: 6,
                  },
                ]}
                keyboardDismissMode="on-drag"
                keyboardShouldPersistTaps="handled"
                {...scrollGateHandlers}
                recycleItems
                scrollEventThrottle={16}
                showsVerticalScrollIndicator={false}
                style={styles.threadList}
                ListEmptyComponent={listEmpty}
              />
            </GestureDetector>
          </SwipeableScrollGateProvider>
          <ThreadUndoNotice visible={props.visible} />
        </View>
      </>
    );
  }

  // Android: the bar floats below the list.
  return (
    <View testID="thread-navigation-sidebar" className="flex-1 bg-header">
      <View
        className="flex-1"
        style={{
          marginHorizontal: 4,
          paddingBottom: insets.bottom,
          backgroundColor: drawerColor,
          borderTopLeftRadius: 28,
          borderTopRightRadius: 28,
          overflow: "hidden",
        }}
      >
        {listItems.length === 0 ? (
          <View className="flex-1 items-center justify-center">{listEmpty}</View>
        ) : (
          <SwipeableScrollGateProvider enabled={swipeEnabled}>
            <GestureDetector gesture={sidebarScrollGesture}>
              {/* oxlint-disable-next-line t3code/require-registered-list-scroll -- The Android sidebar has no native header to register with. */}
              <AnimatedLegendList
                itemLayoutAnimation={THREAD_SIDEBAR_ROW_LAYOUT}
                data={listItems}
                drawDistance={500}
                estimatedItemSize={64}
                extraData={listExtraData}
                getItemType={(item) => item.type}
                itemsAreEqual={sidebarItemsAreEqual}
                keyExtractor={(item) => item.key}
                renderItem={renderListItem}
                contentContainerStyle={{
                  paddingBottom: floatingTabsEnabled
                    ? FLOATING_TABS.bottom + FLOATING_TABS.edge + fabSize
                    : Math.max(insets.bottom, 16) + fabClearance - insets.bottom,
                  paddingTop: 6,
                }}
                keyboardDismissMode="on-drag"
                keyboardShouldPersistTaps="handled"
                {...scrollGateHandlers}
                recycleItems
                scrollEventThrottle={16}
                showsVerticalScrollIndicator={false}
                style={styles.threadList}
                ListEmptyComponent={listEmpty}
              />
            </GestureDetector>
          </SwipeableScrollGateProvider>
        )}
      </View>
      {header}
      <ThreadUndoNotice visible={props.visible} />
    </View>
  );
}

const styles = StyleSheet.create({
  threadList: {
    flex: 1,
  },
  threadListContent: {
    paddingHorizontal: 8,
  },
});
