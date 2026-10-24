import {
  type EnvironmentId,
  AuthOrchestrationOperateScope,
  type EnvironmentMachineKind,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { useThreadShell } from "../../state/entities";
import { ContextPreviewHover, type ContextPreviewPlacement } from "../contextPreviewRegistry";
import {
  ThreadTerminalStatusButton,
  ThreadPullRequestBadgeControl,
  ThreadWorktreeIndicator,
  prStatusIndicator,
  resolveThreadPullRequestBadge,
  useLinkedThreadPullRequest,
  ThreadSearchPullRequestNumber,
} from "../ThreadStatusIndicators";
import { discardComposerDraft } from "../../lib/discardComposerDraft";
import { useThreadMessageDrafts } from "../../state/messageDrafts";
import { requestCustomSnooze } from "../CustomSnoozeDialog";
import { useSupportsMultiplePullRequests } from "~/hooks/useSupportsMultiplePullRequests";
import { resolveThreadCurrentPullRequestLink } from "@t3tools/client-runtime/thread-pull-requests";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  canSnooze,
  hasQueuedTurnStart,
  QUEUED_TURN_START_GRACE_MS,
} from "@t3tools/client-runtime/state/thread-settled";
import { formatDiffCount } from "@t3tools/client-runtime/diff-count";
import { resolveSettledThreadTimestamp } from "@t3tools/client-runtime/state/thread-sort";
import { type EnvironmentThreadSearchMatch } from "@t3tools/client-runtime/state/thread-search";
import { resolveThreadProviderStack } from "@t3tools/client-runtime/state/models";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { type TimestampFormat } from "@t3tools/contracts/settings";
import {
  AlarmClockIcon,
  AlarmClockOffIcon,
  EyeIcon,
  BotIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleCheckIcon,
  ClockIcon,
  Columns2Icon,
  FileTextIcon,
  LayersIcon,
  PinIcon,
  PinOffIcon,
  PlusIcon,
  SquarePenIcon,
  Undo2Icon,
  XIcon,
} from "lucide-react";
import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { useRightPanelStore } from "../../rightPanelStore";
import { cn } from "~/lib/utils";
import { textDirection } from "~/textDirection";
import { useOpenPrLink } from "../../lib/openPullRequestLink";
import { useUiStateStore } from "../../uiStateStore";
import { useThreadSelectionStore } from "../../threadSelectionStore";
import { useNowMinute } from "../../hooks/useNowMinute";
import { useNowSecond } from "../../hooks/useNowSecond";
import { type ProviderEntrySummary } from "../../state/providerEntries";
import { readEnvironmentScope, useEnvironmentScope } from "../../state/session";
import { formatRelativeTimeLabel, parseTimestampDate } from "../../timestampFormat";
import { resolveSidebarTopStatus, SidebarTopStatusIcon } from "./SidebarTopStatus";
import { compactSidebarTimeLabel, threadTimeLabel } from "./SidebarTabSummary";
import type { SidebarThreadSummary } from "../../types";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import {
  animateSidebarLayoutChanges,
  formatWorkingDurationLabel,
  hasUnseenCompletion,
  sidebarTabToggleLabel,
  resolveSidebarRowAccessibility,
  type SidebarDropVerb,
  resolveSidebarThreadStatus,
  resolveThreadLastVisitedAt,
  shouldRecedeSidebarThread,
  resolveWorkingStartedAt,
  useSidebarRowSubscriptionLease,
} from "../Sidebar.logic";
import { animateSidebarDisclosure } from "../Sidebar.motion";
import { resolveSnoozePresets, type SnoozePreset } from "../Sidebar.snooze";
import { ProjectFavicon } from "../ProjectFavicon";
import { ThreadSearchMatchExcerpt } from "../ThreadSearchMatch";
import { makeWorkspaceFileDropHandlers } from "../chat/workspaceFileDrop";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { shouldShowInstanceBadge } from "../../providerInstances";
import { useThreadRunningTerminalIds } from "../../state/terminalSessions";
import { InlineButton } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuShortcut, MenuTrigger } from "../ui/menu";
import { PreviewCard, PreviewCardPopup, PreviewCardTrigger } from "../ui/preview-card";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { MiddleTruncate } from "../ui/middle-truncate";
import {
  useComposerDraftActiveModelSelection,
  useThreadHasUnsentDraft,
} from "../../composerDraftStore";

export const SIDEBAR_THREAD_PREVIEW_PLACEMENT: ContextPreviewPlacement = {
  side: "right",
  align: "start",
  sideOffset: 4,
};
function settledTimeLabel(thread: SidebarThreadSummary): string {
  const timestamp = resolveSettledThreadTimestamp(thread);
  return timestamp === null ? "" : compactSidebarTimeLabel(formatRelativeTimeLabel(timestamp));
}
// Subscribes to the minute tick itself, so only the label re-renders each
// minute. The minute is passed as the clock so it is the formatter's input.
function RelativeTimeLabel(props: { timestamp: string | null }) {
  const nowMinute = useNowMinute();
  return props.timestamp === null
    ? null
    : compactSidebarTimeLabel(
        formatRelativeTimeLabel(props.timestamp, Date.parse(`${nowMinute}:00.000Z`)),
      );
}
function threadTimeTimestamp(thread: SidebarThreadSummary): string {
  return thread.latestUserMessageAt ?? thread.updatedAt;
}
export function JumpHintBadge(props: { label: string }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute right-1.5 top-1/2 z-10 inline-flex h-5 -translate-y-1/2 items-center rounded-full border border-border/80 bg-background/95 px-1.5 font-mono text-3xs font-medium tracking-tight text-foreground shadow-sm"
    >
      {props.label}
    </span>
  );
}
function WorkingDuration(props: { startedAt: string | null }) {
  const startedMs = props.startedAt !== null ? Date.parse(props.startedAt) : Number.NaN;
  if (Number.isNaN(startedMs)) return null;
  return <WorkingDurationLabel startedMs={startedMs} />;
}
// Self-ticking so only this span re-renders each second, not the whole row;
// the shared tick lands every working row's update in the same frame.
function WorkingDurationLabel(props: { startedMs: number }) {
  const nowMs = useNowSecond();
  return (
    <span className="tabular-nums">{formatWorkingDurationLabel(nowMs - props.startedMs)}</span>
  );
}
export function terminalProcessLabel(count: number): string {
  return `${count} terminal ${count === 1 ? "process" : "processes"} running`;
}
function SidebarProviderStack(props: {
  thread: SidebarThreadSummary;
  /** An unsent composer pick, which becomes the current provider before the next turn. */
  draftModelSelection?: ReturnType<typeof useComposerDraftActiveModelSelection>;
  providerEntryByInstanceId: ReadonlyMap<string, ProviderEntrySummary>;
}) {
  const stack = resolveThreadProviderStack(
    props.draftModelSelection
      ? {
          ...props.thread,
          runtime: null,
          modelSelection: props.draftModelSelection,
        }
      : props.thread,
  );
  const currentInstanceId = stack[stack.length - 1]!;
  const currentEntry = props.providerEntryByInstanceId.get(currentInstanceId) ?? null;
  if (currentEntry === null) return null;
  const showInstanceBadge = shouldShowInstanceBadge(
    currentEntry,
    props.providerEntryByInstanceId.values(),
  );
  const current = (
    <ProviderInstanceIcon
      driverKind={currentEntry.driverKind}
      displayName={currentEntry.displayName}
      accentColor={currentEntry.accentColor}
      acpRegistryAgentId={currentEntry.acpRegistryAgentId}
      acpRegistryIconUrl={currentEntry.acpRegistryIconUrl}
      showBadge={showInstanceBadge}
      size="compact"
      iconClassName="opacity-60"
    />
  );
  if (stack.length === 1) {
    return <span className="inline-flex shrink-0 items-center">{current}</span>;
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5">
      {stack.slice(0, -1).map((instanceId) => {
        const entry = props.providerEntryByInstanceId.get(instanceId);
        if (entry === undefined) return null;
        return (
          <ProviderInstanceIcon
            key={instanceId}
            driverKind={entry.driverKind}
            displayName={entry.displayName}
            acpRegistryAgentId={entry.acpRegistryAgentId}
            acpRegistryIconUrl={entry.acpRegistryIconUrl}
            iconClassName="size-3 opacity-35 grayscale"
          />
        );
      })}
      <span className="relative z-10 inline-flex items-center">{current}</span>
    </span>
  );
}
function SnoozeMenuButton(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSnooze: (preset: Pick<SnoozePreset, "snoozedUntil">) => void;
  timestampFormat: TimestampFormat;
}) {
  const { open, onOpenChange, onSnooze, timestampFormat } = props;
  const presets = open ? resolveSnoozePresets(new Date(), timestampFormat) : [];
  return (
    <Menu open={open} onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={
                <button
                  type="button"
                  aria-label="Snooze thread"
                  onClick={(event) => event.stopPropagation()}
                  onDoubleClick={(event) => event.stopPropagation()}
                  className="inline-flex h-full cursor-pointer items-center gap-0.5 rounded-md bg-transparent px-1.5 text-xs text-muted-foreground hover:text-foreground"
                />
              }
            />
          }
        >
          <ClockIcon className="size-3" />
        </TooltipTrigger>
        <TooltipPopup>Snooze thread</TooltipPopup>
      </Tooltip>
      <MenuPopup side="bottom" align="end">
        {presets.map((preset) => (
          <MenuItem
            key={preset.id}
            onClick={(event) => {
              event.stopPropagation();
              onSnooze(preset);
            }}
          >
            {preset.label}
            <MenuShortcut>{preset.whenLabel}</MenuShortcut>
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem
          onClick={async (event) => {
            event.stopPropagation();
            const choice = await requestCustomSnooze();
            if (choice) onSnooze(choice);
          }}
        >
          Custom…
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}
export type SortableThreadRowBag = Pick<
  ReturnType<typeof useSortable>,
  "listeners" | "setNodeRef" | "transform" | "transition" | "isDragging"
>;
// dnd-kit keys memoization on the disabled object identity.
export const SIDEBAR_SORTABLE_DRAG_DISABLED = { draggable: true } as const;
const SIDEBAR_SORTABLE_DRAG_ENABLED = { draggable: false } as const;
export function SortableTabThreadRow(props: {
  id: string;
  disabled: boolean;
  contextDrag: boolean;
  environmentId: EnvironmentId;
  children: (bag: SortableThreadRowBag) => ReactNode;
}) {
  const canOperateThread = useEnvironmentScope(props.environmentId, AuthOrchestrationOperateScope);
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.id,
    disabled:
      props.disabled || !canOperateThread
        ? SIDEBAR_SORTABLE_DRAG_DISABLED
        : SIDEBAR_SORTABLE_DRAG_ENABLED,
    animateLayoutChanges: animateSidebarLayoutChanges,
  });
  // dnd-kit memoizes each field but not the bag, so the memoized row would
  // rerender on every shell update without this.
  const bag = {
    listeners,
    setNodeRef,
    transform: props.contextDrag ? null : transform,
    transition: props.contextDrag && isDragging ? "transform 150ms ease-out" : transition,
    isDragging: isDragging && !props.contextDrag,
  };
  return props.children(bag);
}
export function SortableThreadRow(
  props: Omit<SidebarThreadRowProps, "sortable"> & {
    sortableId: string;
    sortableDisabled: boolean;
    contextDrag: boolean;
  },
) {
  const { sortableId, sortableDisabled, contextDrag, ...rowProps } = props;
  const canOperateThread = useEnvironmentScope(
    rowProps.thread.environmentId,
    AuthOrchestrationOperateScope,
  );
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: sortableId,
    disabled:
      sortableDisabled || !canOperateThread
        ? SIDEBAR_SORTABLE_DRAG_DISABLED
        : SIDEBAR_SORTABLE_DRAG_ENABLED,
    animateLayoutChanges: animateSidebarLayoutChanges,
  });
  // dnd-kit memoizes each field but not the bag, so the memoized row would
  // rerender on every shell update without this.
  const bag = {
    listeners,
    setNodeRef,
    transform: contextDrag ? null : transform,
    transition: contextDrag && isDragging ? "transform 150ms ease-out" : transition,
    isDragging: isDragging && !contextDrag,
  };
  // The sidebar arranges rows from quiet shells, which hold still while a
  // thread streams; reading the live shells here re-renders only this row.
  const thread =
    useThreadShell(scopeThreadRef(rowProps.thread.environmentId, rowProps.thread.id)) ??
    rowProps.thread;
  const displayThread =
    useThreadShell(
      scopeThreadRef(rowProps.displayThread.environmentId, rowProps.displayThread.id),
    ) ?? rowProps.displayThread;
  // Keyed by variant so a card/slim switch remounts the row.
  return (
    <SidebarThreadRow
      key={rowProps.variant}
      {...rowProps}
      thread={thread}
      displayThread={displayThread}
      sortable={bag}
    />
  );
}
export const draftSurfaceClassName = "bg-warning/4 hover:bg-warning/8";
export const draftPenClassName = "size-3 shrink-0 text-warning-foreground";
export type SidebarSweepAction = "settle" | "unsettle" | "unsnooze";
// Unhide is a row action but not a sweep: hidden rows are few and deliberate.
type SidebarRowAction = SidebarSweepAction | "unhide";
const dropVerbBadge: Record<SidebarDropVerb, ReactNode> = {
  pin: (
    <>
      <PinIcon aria-hidden className="size-3" />
      Pin
    </>
  ),
  unpin: (
    <>
      <PinOffIcon aria-hidden className="size-3" />
      Unpin
    </>
  ),
  settle: (
    <>
      <CircleCheckIcon aria-hidden className="size-3" />
      Settle
    </>
  ),
  unsettle: (
    <>
      <Undo2Icon aria-hidden className="size-3" />
      Un-settle
    </>
  ),
  wake: (
    <>
      <AlarmClockOffIcon aria-hidden className="size-3" />
      Wake
    </>
  ),
};
/** Marks a row whose chat is one side of the split view on screen. */
export function SidebarSplitIndicator() {
  return (
    <span
      role="img"
      aria-label="Shown side by side"
      className="inline-flex shrink-0 items-center text-muted-foreground"
    >
      <Columns2Icon className="size-3.5" />
    </span>
  );
}
type SidebarThreadRowProps = {
  thread: SidebarThreadSummary;
  /** The tab the hidden-tabs row opens; the group thread still owns ordering and selection. */
  displayThread: SidebarThreadSummary;
  tabGroupName?: string | undefined;
  variant: "card" | "slim";
  // The category determines the action independently of the row layout.
  variantAction: SidebarRowAction;
  settlementSupported: boolean;
  snoozeSupported: boolean;
  pinningSupported: boolean;
  isPinned: boolean;
  sortable?: SortableThreadRowBag | undefined;
  dropVerb: SidebarDropVerb | null;
  dragOverPinned: boolean;
  sweepAction: SidebarSweepAction | null;
  snoozeWakeLabelText: string | null;
  wokeAt: string | null;
  isActive: boolean;
  // One side of the split view on screen: the routed chat or the one beside it.
  inSplit: boolean;
  isRouteThread: boolean;
  // A sibling tab is the open route. The header stays present, but the active
  // pill belongs to that tab row.
  groupFocused?: boolean;
  openPullRequestsInRightPanel: boolean;
  jumpLabel: string | null;
  currentEnvironmentId: string | null;
  environmentLabel: string | null;
  environmentMachine: EnvironmentMachineKind;
  scratchMachineLabel: string | null;
  project: EnvironmentProject | null;
  projectDisplayName: string | null;
  providerEntryByInstanceId: ReadonlyMap<string, ProviderEntrySummary>;
  timestampFormat: TimestampFormat;
  onThreadClick: (
    event: ReactMouseEvent,
    threadRef: ScopedThreadRef,
    keepOpenGroupTab?: boolean,
  ) => void;
  onThreadActivate: (threadRef: ScopedThreadRef, keepOpenGroupTab?: boolean) => void;
  onStartRename: (threadRef: ScopedThreadRef, title: string) => void;
  onNameTabGroup: ((threadRef: ScopedThreadRef) => void) | undefined;
  onRenameTitleChange: (title: string) => void;
  onCommitRename: (threadRef: ScopedThreadRef, title: string, originalTitle: string) => void;
  onCancelRename: () => void;
  isRenaming: boolean;
  renamingTitle: string;
  onContextMenu: (
    threadRef: ScopedThreadRef,
    position: {
      x: number;
      y: number;
    },
  ) => void;
  onSettle: (threadRef: ScopedThreadRef) => void;
  onActionSweepStart: (
    threadRef: ScopedThreadRef,
    action: SidebarSweepAction,
    event: PointerEvent,
  ) => void;
  onUnsettle: (threadRef: ScopedThreadRef) => void;
  onSnooze: (threadRef: ScopedThreadRef, preset: Pick<SnoozePreset, "snoozedUntil">) => void;
  onUnsnooze: (threadRef: ScopedThreadRef) => void;
  onUnhide: (threadRef: ScopedThreadRef) => void;
  onUnpin: (threadRef: ScopedThreadRef) => void;
  onPin: (threadRef: ScopedThreadRef) => void;
  onAcknowledgeWoke: (threadRef: ScopedThreadRef, visitedAt: string) => void;
  onFileDropThreads?: ((threadRef: ScopedThreadRef, files: File[]) => void) | undefined;
  /** Adds a chat tab to this row's group. Absent where the environment has no tabs. */
  onNewTab?: ((threadRef: ScopedThreadRef) => void) | undefined;
  /** Tabs in this row's group; the badge shows only above one. */
  tabCount: number;
  /** Tabs the count control hides or reveals, after the show-up-to limit. */
  tabToggleCount: number;
  /** The group's tabs. Mounted under the row while `tabsOpen`, and while it animates closed. */
  tabs: ReactNode;
  tabsOpen: boolean;
  /** Lists the group's tabs when hovering the folded count badge, so one opens in place. */
  tabPreview?: ReactNode;
  /** Opens or folds this group's tabs. Absent where the row has no tabs. */
  onToggleTabs?: ((rowThreadKey: string) => void) | undefined;
  /** A tab list finished opening or closing, so rows below it have moved. */
  onTabsResized?: (() => void) | undefined;
};
const SidebarThreadRow = memo(function SidebarThreadRow(props: SidebarThreadRowProps) {
  const {
    isRenaming,
    onCancelRename,
    onCommitRename,
    onContextMenu,
    onAcknowledgeWoke,
    onFileDropThreads,
    onNewTab,
    onRenameTitleChange,
    onSettle,
    onActionSweepStart,
    onSnooze,
    onStartRename,
    onThreadActivate,
    onThreadClick,
    onUnsettle,
    onUnsnooze,
    onUnhide,
    onUnpin,
    onPin,
    openPullRequestsInRightPanel,
    renamingTitle,
    displayThread: thread,
    variant,
    variantAction,
  } = props;
  const threadRef = scopeThreadRef(thread.environmentId, thread.id);
  const rowThreadRef = scopeThreadRef(props.thread.environmentId, props.thread.id);
  const rowThreadKey = scopedThreadKey(rowThreadRef);
  const threadKey = scopedThreadKey(threadRef);
  const canOperateThread = useEnvironmentScope(thread.environmentId, AuthOrchestrationOperateScope);
  useEffect(() => {
    if (!canOperateThread && isRenaming) onCancelRename();
  }, [canOperateThread, isRenaming, onCancelRename]);
  const { leaseLiveStatus, rowRef } = useSidebarRowSubscriptionLease(props.isActive);
  const isRegeneratingTitle = thread.titleRegeneration != null;
  const localLastVisitedAt = useUiStateStore((state) => state.threadLastVisitedAtById[threadKey]);
  const lastVisitedAt = resolveThreadLastVisitedAt(thread.lastVisitedAt, localLastVisitedAt);
  // Woke belongs to the group, so it reads the row thread's visit, not the shown tab's.
  const localRowLastVisitedAt = useUiStateStore(
    (state) => state.threadLastVisitedAtById[rowThreadKey],
  );
  const rowLastVisitedAt = resolveThreadLastVisitedAt(
    props.thread.lastVisitedAt,
    localRowLastVisitedAt,
  );
  const isSelected = useThreadSelectionStore((state) => state.selectedThreadKeys.has(rowThreadKey));
  const openPrLink = useOpenPrLink();
  const runningTerminalIds = useThreadRunningTerminalIds({
    environmentId: thread.environmentId,
    threadId: thread.id,
  });
  const hasUnsentDraft = useThreadHasUnsentDraft(threadRef) && !props.isRouteThread;
  const savedDraftCount = useThreadMessageDrafts(threadRef).length;
  const handleDiscardDraftClick = (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    discardComposerDraft(threadRef);
  };
  const linkedPullRequestStatus = useLinkedThreadPullRequest(
    thread.environmentId,
    thread.linkedPullRequest,
    leaseLiveStatus,
    thread.pullRequests,
    thread.branchPullRequest,
  );
  const pr = linkedPullRequestStatus?.pr ?? null;
  const supportsMultiplePullRequests = useSupportsMultiplePullRequests(thread.environmentId);
  const currentLinkedPr = supportsMultiplePullRequests
    ? resolveThreadCurrentPullRequestLink(thread.pullRequests)
    : null;
  const isUnread = hasUnseenCompletion({ ...thread, lastVisitedAt });
  const status = resolveSidebarThreadStatus(thread);
  const lastVisitedDate =
    rowLastVisitedAt === undefined ? null : parseTimestampDate(rowLastVisitedAt);
  const wokeAtDate = props.wokeAt === null ? null : parseTimestampDate(props.wokeAt);
  const isWoke =
    wokeAtDate !== null &&
    (lastVisitedDate === null || lastVisitedDate < wokeAtDate) &&
    props.thread.settledOverride !== "settled";
  const shouldRecede = shouldRecedeSidebarThread({
    status,
    isUnread,
    isWoke,
    isActive: props.isActive || props.groupFocused === true,
    isSelected,
  });
  const resolvedTopStatus = resolveSidebarTopStatus(status, isWoke, isUnread);
  // A native /goal keeps the agent going across turns until it is met.
  const topStatus =
    resolvedTopStatus !== null && status === "working" && thread.goal?.status === "active"
      ? { ...resolvedTopStatus, label: "Goal" }
      : resolvedTopStatus;
  const isWokeStatus = topStatus?.icon === "woke";
  const prStatus = prStatusIndicator(pr, linkedPullRequestStatus?.sourceControlProvider);
  // An unsent composer pick wins, so the icon follows the composer before the next turn.
  const draftModelSelection = useComposerDraftActiveModelSelection(threadRef);
  const isRemote = thread.environmentId !== props.currentEnvironmentId;
  const showsScratchMachine = !thread.branch && props.scratchMachineLabel !== null;
  const handleClick = (event: ReactMouseEvent) => {
    // The group header stands for every tab. A tab already open in it stays open.
    onThreadClick(event, rowThreadRef, true);
  };
  const handleAcknowledgeWokeClick = (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (props.wokeAt === null) return;
    onAcknowledgeWoke(rowThreadRef, props.wokeAt);
  };
  const handleContextMenu = (event: ReactMouseEvent) => {
    event.preventDefault();
    onContextMenu(threadRef, { x: event.clientX, y: event.clientY });
  };
  const handleKeyDown = (event: ReactKeyboardEvent) => {
    if (event.target !== event.currentTarget) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onThreadActivate(rowThreadRef, true);
  };
  const handleDoubleClick = (event: ReactMouseEvent) => {
    if (
      !readEnvironmentScope(threadRef.environmentId, AuthOrchestrationOperateScope) ||
      isRenaming ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    if ((event.target as HTMLElement).closest("button, a, input")) return;
    event.preventDefault();
    if (props.onNameTabGroup) props.onNameTabGroup(threadRef);
    else onStartRename(threadRef, thread.title);
  };
  const [isFileDragOver, setIsFileDragOver] = useState(false);
  const fileDropHandlers = onFileDropThreads
    ? makeWorkspaceFileDropHandlers({
        setDragActive: setIsFileDragOver,
        addFiles: (files) => {
          onFileDropThreads(threadRef, files);
        },
        addFolders: () => {},
      })
    : null;
  useEffect(() => {
    if (!isFileDragOver) return;
    const clearFileDrag = () => setIsFileDragOver(false);
    window.addEventListener("dragend", clearFileDrag);
    return () => window.removeEventListener("dragend", clearFileDrag);
  }, [isFileDragOver]);
  const handleSettleClick = (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    onSettle(rowThreadRef);
  };
  const handleNewTabClick = (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    onNewTab?.(threadRef);
  };
  const handleActionPointerDown = (event: ReactPointerEvent) => {
    if (!event.isPrimary || event.button !== 0) return;
    event.stopPropagation();
    if (variantAction === "unhide") return;
    onActionSweepStart(threadRef, variantAction, event.nativeEvent);
  };
  const handleUnsettleClick = (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    onUnsettle(rowThreadRef);
  };
  const handleUnsnoozeClick = (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    onUnsnooze(rowThreadRef);
  };
  const handleUnhideClick = (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    onUnhide(rowThreadRef);
  };
  const rowAction =
    variantAction === "unhide"
      ? {
          label: "Unhide thread",
          text: "Unhide",
          Icon: EyeIcon,
          onClick: handleUnhideClick,
          supported: true,
        }
      : variantAction === "unsnooze"
        ? {
            label: "Wake thread now",
            text: "Wake",
            Icon: AlarmClockOffIcon,
            onClick: handleUnsnoozeClick,
            supported: props.snoozeSupported,
          }
        : variantAction === "unsettle"
          ? {
              label: "Un-settle thread",
              text: "Un-settle",
              Icon: Undo2Icon,
              onClick: handleUnsettleClick,
              supported: props.settlementSupported,
            }
          : {
              label: "Settle thread",
              text: "Settle",
              Icon: CheckIcon,
              onClick: handleSettleClick,
              supported: props.settlementSupported,
            };
  const RowActionIcon = rowAction.Icon;
  const handleUnpinClick = (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    onUnpin(rowThreadRef);
  };
  const handlePinClick = (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    onPin(rowThreadRef);
  };
  const handleSnoozePreset = (preset: Pick<SnoozePreset, "snoozedUntil">) => {
    onSnooze(rowThreadRef, preset);
  };
  const [snoozeMenuOpenRaw, setSnoozeMenuOpen] = useState(false);
  // The React Compiler caches render results on their inputs, so a clock read
  // here would stay frozen until `thread` changes and a queued-turn gate would
  // never reopen. The gate's clock is state, reset with the thread.
  const [snoozeGateClock, setSnoozeGateClock] = useState(() => ({
    thread,
    now: new Date().toISOString(),
  }));
  if (snoozeGateClock.thread !== thread) {
    setSnoozeGateClock({ thread, now: new Date().toISOString() });
  }
  const snoozeGateNow = snoozeGateClock.now;
  const snoozeGateExpiryMs = hasQueuedTurnStart(thread, { now: snoozeGateNow })
    ? Date.parse(thread.latestUserMessageAt ?? "") + QUEUED_TURN_START_GRACE_MS
    : Number.NaN;
  useEffect(() => {
    // A gate still closed past its expiry is held by runtime status, not time,
    // so no clock tick can open it.
    if (!Number.isFinite(snoozeGateExpiryMs) || snoozeGateExpiryMs <= Date.parse(snoozeGateNow)) {
      return;
    }
    const id = window.setTimeout(
      () => setSnoozeGateClock({ thread, now: new Date().toISOString() }),
      Math.min(Math.max(0, snoozeGateExpiryMs - Date.now()) + 50, 2_147_483_647),
    );
    return () => window.clearTimeout(id);
  }, [snoozeGateExpiryMs, snoozeGateNow, thread]);
  const showSnoozeButton =
    canOperateThread && props.snoozeSupported && canSnooze(thread, { now: snoozeGateNow });
  // Closing here, not just masking, keeps the menu from reopening when the button returns.
  if (snoozeMenuOpenRaw && !showSnoozeButton) setSnoozeMenuOpen(false);
  const showHoverActions =
    (canOperateThread && rowAction.supported) || showSnoozeButton || hasUnsentDraft;
  const snoozeMenuOpen = snoozeMenuOpenRaw && showSnoozeButton;
  const handlePrClick = (event: ReactMouseEvent<HTMLElement>, targetUrl?: string) => {
    const url = targetUrl ?? pr?.url ?? currentLinkedPr?.url;
    if (!url) return;
    const showInRightPanel = targetUrl !== undefined || openPullRequestsInRightPanel;
    const openedInRightPanel = openPrLink(event, url, showInRightPanel ? threadRef : undefined);
    if (openedInRightPanel && showInRightPanel && !props.isRouteThread) {
      onThreadActivate(threadRef);
    }
  };
  // An open tab list includes this thread as its first row, so the card is only
  // the group header. The active tab carries the highlight.
  const unifyTabs = variant === "card" && props.tabsOpen && props.tabs != null;
  const rowActive = props.isActive && !unifyTabs;
  // The chat beside the routed one in a split gets a lighter version of the active surface.
  const rowSplitPartner = props.inSplit && !props.isActive && !unifyTabs;
  // Each listed tab shows its own status, so the header would only repeat the
  // first tab's and read as the whole group's. Woke belongs to the group.
  const headerStatus = unifyTabs && !isWokeStatus ? null : topStatus;
  const rowSurfaceClassName = cn(
    "group/sidebar-row relative w-full cursor-pointer overflow-hidden rounded-md text-left outline-none select-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
    variantAction === "unsettle" && "[&:not(:hover):not(:focus-within)_*]:text-secondary-label/70",
    rowActive
      ? "bg-sidebar-row-active text-sidebar-foreground"
      : rowSplitPartner
        ? "bg-sidebar-row-active/50 text-sidebar-foreground"
        : isSelected || props.sweepAction !== null
          ? "bg-sidebar-row-selected text-sidebar-foreground"
          : hasUnsentDraft
            ? cn(draftSurfaceClassName, "text-sidebar-foreground")
            : shouldRecede
              ? "text-sidebar-muted-foreground/75 hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
              : "bg-transparent text-sidebar-foreground hover:bg-sidebar-row-hover",
    // Background work fades as a whole row, status label included, so it
    // takes less attention than rows that need a human (input, approval).
    shouldRecede &&
      status === "working" &&
      "opacity-70 transition-opacity hover:opacity-100 focus-within:opacity-100 motion-reduce:transition-none",
    isFileDragOver && "ring-1 ring-inset ring-primary/70",
    // The hover tint must not clobber an active/selected row's own surface.
    isFileDragOver && !rowActive && !isSelected && "bg-sidebar-row-hover",
    // The lifted row is an opaque card so the rows beneath it never show
    // through. The row tint is translucent in dark themes and the pointer
    // keeps the hover color applied, so both the tint and the solid sidebar
    // color are stacked as background images.
    props.sortable?.isDragging &&
      "bg-sidebar bg-linear-to-b from-sidebar-row-active to-sidebar-row-active text-sidebar-foreground opacity-100 shadow-lg",
  );
  const sortable = props.sortable;
  const sortableRootProps = sortable
    ? {
        ref: sortable.setNodeRef,
        style: {
          transform: CSS.Translate.toString(sortable.transform),
          transition: sortable.transition,
          // A zero-height boundary also makes dnd-kit scale the source to
          // zero. Only projected peers use scaleY as a visibility sentinel.
          visibility:
            !sortable.isDragging && sortable.transform?.scaleY === 0
              ? ("hidden" as const)
              : undefined,
        },
        ...sortable.listeners,
      }
    : {};
  const destinationVerb = sortable?.isDragging
    ? props.dropVerb
    : props.sweepAction === "unsnooze"
      ? "wake"
      : props.sweepAction;
  const dragDestination =
    destinationVerb !== null ? (
      <span
        role="status"
        className="pointer-events-none ml-auto inline-flex h-5 shrink-0 items-center gap-1 rounded-sm border border-primary/40 bg-primary/10 px-1.5 text-2xs font-medium text-primary"
      >
        {dropVerbBadge[destinationVerb]}
      </span>
    ) : null;
  const accessibility = resolveSidebarRowAccessibility({
    title: props.tabGroupName ?? thread.title,
    statusLabel: headerStatus?.label ?? null,
    projectDisplayName: props.projectDisplayName,
    isActive: rowActive,
    startedByAgent: thread.startedBy !== null,
  });
  const title =
    isRenaming && canOperateThread ? (
      <SidebarRenameInput
        threadRef={threadRef}
        originalTitle={thread.title}
        value={renamingTitle}
        onChange={onRenameTitleChange}
        onCommit={onCommitRename}
        onCancel={onCancelRename}
      />
    ) : (
      <span
        aria-hidden
        className={cn(
          "min-w-0 flex-1 text-start text-sm transition-opacity motion-reduce:transition-none",
          shouldRecede ? "font-normal" : "font-medium",
          variant === "card"
            ? cn(
                "truncate",
                shouldRecede
                  ? "text-secondary-label"
                  : isUnread || isWoke || status === "input"
                    ? "text-foreground"
                    : status === "failed"
                      ? "text-foreground/95"
                      : "text-foreground/90",
              )
            : cn(
                "truncate group-focus-within/sidebar-row:text-foreground group-hover/sidebar-row:text-foreground",
                shouldRecede
                  ? "text-secondary-label/70"
                  : props.isActive || isWoke || status === "input"
                    ? "text-foreground"
                    : isUnread
                      ? "text-muted-foreground"
                      : "text-secondary-label/70",
              ),
          isRegeneratingTitle && "opacity-55",
        )}
        dir={textDirection(props.tabGroupName ?? thread.title)}
      >
        {props.tabGroupName ?? thread.title}
      </span>
    );
  const accessibleTitle = isRenaming ? null : (
    <span className="sr-only">{props.tabGroupName ?? thread.title}</span>
  );
  const prBadgeShape = supportsMultiplePullRequests
    ? resolveThreadPullRequestBadge(thread.pullRequests)
    : null;
  const handlePrListClick = () => {
    useRightPanelStore.getState().open(threadRef, "pull-requests");
    if (!props.isRouteThread) onThreadActivate(threadRef);
  };
  const prBadge =
    prBadgeShape?.kind === "stack" || pr || currentLinkedPr ? (
      <ThreadPullRequestBadgeControl
        render={<InlineButton />}
        badge={prBadgeShape}
        pullRequests={thread.pullRequests}
        number={pr?.number ?? currentLinkedPr?.number}
        url={pr?.url ?? currentLinkedPr?.url}
        status={prStatus}
        onOpenList={handlePrListClick}
        onOpenPullRequest={handlePrClick}
      />
    ) : null;
  const terminalStatusIcon = (
    <ThreadTerminalStatusButton
      threadRef={threadRef}
      terminalIds={runningTerminalIds}
      onThreadActivate={onThreadActivate}
    />
  );
  const draftIndicator = hasUnsentDraft ? (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="img"
            aria-label="Unsent draft"
            data-testid={`sidebar-draft-indicator-${thread.id}`}
            className="inline-flex shrink-0 items-center"
          />
        }
      >
        <SquarePenIcon aria-hidden className={draftPenClassName} />
      </TooltipTrigger>
      <TooltipPopup side="top">Unsent draft</TooltipPopup>
    </Tooltip>
  ) : null;
  const savedDraftsLabel = `${savedDraftCount} draft${savedDraftCount === 1 ? "" : "s"}`;
  const savedDraftsIndicator =
    savedDraftCount > 0 ? (
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              role="img"
              aria-label={savedDraftsLabel}
              className="inline-flex shrink-0 items-center gap-0.5 text-muted-foreground/60 tabular-nums"
            />
          }
        >
          <FileTextIcon aria-hidden className="size-3" />
          {savedDraftCount}
        </TooltipTrigger>
        <TooltipPopup side="top">{savedDraftsLabel}</TooltipPopup>
      </Tooltip>
    ) : null;
  const onToggleTabs = props.onToggleTabs;
  const handleToggleTabsClick = (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    onToggleTabs?.(rowThreadKey);
  };
  // The row's own tooltip would cover the badge's tab list, so it stays shut while that is open.
  const [tabPreviewOpenRaw, setTabPreviewOpen] = useState(false);
  const tabPreviewOpen = tabPreviewOpenRaw && !props.tabsOpen && props.tabCount > 1;
  const tabCountBadge =
    props.tabCount > 1 ? (
      <SidebarTabCountBadge
        count={props.tabCount}
        toggleCount={props.tabToggleCount}
        open={props.tabsOpen}
        onToggle={onToggleTabs ? handleToggleTabsClick : undefined}
        preview={props.tabPreview}
        onPreviewOpenChange={setTabPreviewOpen}
      />
    ) : null;
  const tabList =
    props.tabs != null ? (
      <SidebarDisclosure open={props.tabsOpen} onSettled={props.onTabsResized}>
        {props.tabs}
      </SidebarDisclosure>
    ) : null;
  const showPin =
    props.isPinned && (!sortable?.isDragging || (props.dragOverPinned && props.dropVerb === null));
  // Unpinned rows offer pin beside the other hover actions. Pinned rows keep
  // a trailing marker instead, so the two never show at once.
  const showUnpinnedPinAction = props.pinningSupported && !props.isPinned;
  const pinIndicator = showPin ? (
    props.pinningSupported && canOperateThread && !sortable?.isDragging ? (
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label="Unpin thread"
              onClick={handleUnpinClick}
              className={cn(
                "group/unpin inline-flex cursor-pointer items-center rounded-sm text-muted-foreground/65 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                variant === "card" && "-mr-1 self-center px-1.5",
              )}
            />
          }
        >
          {/* Pin marks the pinned state at rest; hover and focus swap in pin-off so the
            icon reads as the action the button performs. */}
          <PinIcon
            aria-hidden
            className="size-3 shrink-0 group-hover/unpin:hidden group-focus-visible/unpin:hidden"
          />
          <PinOffIcon
            aria-hidden
            className="hidden size-3 shrink-0 group-hover/unpin:block group-focus-visible/unpin:block"
          />
        </TooltipTrigger>
        <TooltipPopup>Unpin thread</TooltipPopup>
      </Tooltip>
    ) : (
      <PinIcon
        aria-label="Pinned"
        role="img"
        className={cn(
          "size-3 shrink-0 text-muted-foreground/65",
          variant === "card" && "-mr-1 ml-1.5 self-center",
        )}
      />
    )
  ) : null;
  // An agent started this thread. The row's label speaks it, the hover card
  // and chat header say which agent.
  const agentIndicator =
    thread.startedBy !== null ? (
      <BotIcon aria-hidden className="size-3 shrink-0 text-muted-foreground/65" />
    ) : null;
  if (variant === "slim") {
    return (
      <li
        data-thread-item={threadKey}
        {...sortableRootProps}
        className={cn(
          "list-none [content-visibility:auto] [contain-intrinsic-size:auto_36px]",
          sortable?.isDragging && "relative z-20",
        )}
      >
        <ContextPreviewHover
          kind="thread"
          accessibleLabel={`Thread, ${thread.title}`}
          preview={{
            record: {
              environmentId: thread.environmentId,
              threadId: thread.id,
              title: thread.title,
            },
          }}
          placement={SIDEBAR_THREAD_PREVIEW_PLACEMENT}
          disabled={tabPreviewOpen || sortable?.isDragging}
          trigger={
            <div
              ref={rowRef}
              role="button"
              tabIndex={0}
              aria-label={accessibility.label}
              aria-current={accessibility.current}
              data-testid="sidebar-row-slim"
              aria-busy={isRegeneratingTitle || undefined}
              {...(fileDropHandlers ?? {})}
              className={cn(rowSurfaceClassName, "flex h-9 items-center gap-2.5 px-2.5")}
              onClick={handleClick}
              onDoubleClick={handleDoubleClick}
              onKeyDown={handleKeyDown}
              onContextMenu={handleContextMenu}
            >
              {accessibleTitle}
              <span
                className={cn(
                  "flex shrink-0 items-center transition-opacity",
                  (!props.isActive || variantAction === "unsettle") &&
                    "opacity-40 grayscale group-focus-within/sidebar-row:opacity-100 group-focus-within/sidebar-row:grayscale-0 group-hover/sidebar-row:opacity-100 group-hover/sidebar-row:grayscale-0",
                )}
              >
                {props.project ? (
                  <ProjectFavicon project={props.project} className="size-4" />
                ) : null}
              </span>
              {draftIndicator}
              {title}
              {tabCountBadge}
              {agentIndicator}
              {pinIndicator}
              {props.inSplit ? <SidebarSplitIndicator /> : null}
              {terminalStatusIcon}
              {savedDraftsIndicator}
              {isRegeneratingTitle ? (
                <span role="status" className="sr-only">
                  Regenerating title
                </span>
              ) : null}
              {prBadge}
              {sortable?.isDragging ? (
                dragDestination
              ) : (
                <span
                  className={cn(
                    "relative ml-auto flex h-6 min-w-8 shrink-0 items-center justify-end",
                    props.sweepAction !== null && "hidden",
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex justify-end tabular-nums text-secondary-label transition-opacity",
                      !isWoke && "group-any-hover/sidebar-row:opacity-0",
                    )}
                  >
                    {variantAction === "unsnooze" && props.snoozeWakeLabelText !== null ? (
                      <span className="text-xs text-info-foreground tabular-nums">
                        {props.snoozeWakeLabelText}
                      </span>
                    ) : isWoke ? (
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <button
                              type="button"
                              aria-label="Dismiss Woke notification"
                              onClick={handleAcknowledgeWokeClick}
                              className="inline-flex cursor-pointer items-center gap-1 rounded-sm text-xs font-medium text-warning-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                            >
                              <AlarmClockIcon aria-hidden className="size-3" />
                              <span role="status">Woke</span>
                            </button>
                          }
                        />
                        <TooltipPopup side="top">Dismiss Woke notification</TooltipPopup>
                      </Tooltip>
                    ) : (
                      <span className="text-xs">
                        <RelativeTimeLabel
                          timestamp={
                            variantAction === "unsettle"
                              ? resolveSettledThreadTimestamp(thread)
                              : threadTimeTimestamp(thread)
                          }
                        />
                      </span>
                    )}
                  </span>
                  {variantAction === "unhide" ? (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <button
                            type="button"
                            aria-label="Unhide thread"
                            onClick={handleUnhideClick}
                            className={cn(
                              "pointer-events-none absolute inset-y-0 right-0 -mr-1 inline-flex cursor-pointer items-center gap-1 rounded-md bg-transparent px-1.5 text-xs text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 group-any-hover/sidebar-row:pointer-events-auto group-any-hover/sidebar-row:opacity-100",
                              isWoke && "group-any-hover/sidebar-row:static",
                            )}
                          />
                        }
                      >
                        <EyeIcon className="mb-px size-3.5" />
                      </TooltipTrigger>
                      <TooltipPopup side="top">Unhide thread</TooltipPopup>
                    </Tooltip>
                  ) : variantAction === "unsnooze" ? (
                    !props.snoozeSupported ? null : (
                      <button
                        type="button"
                        aria-label="Wake thread now"
                        onClick={handleUnsnoozeClick}
                        onPointerDown={handleActionPointerDown}
                        className={cn(
                          "pointer-events-none absolute inset-y-0 right-0 -mr-1 inline-flex cursor-pointer items-center gap-1 rounded-md bg-transparent px-1.5 text-xs text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 group-any-hover/sidebar-row:pointer-events-auto group-any-hover/sidebar-row:opacity-100",
                          isWoke && "static",
                        )}
                      >
                        <AlarmClockOffIcon className="mb-px size-3" />
                      </button>
                    )
                  ) : !canOperateThread || !props.settlementSupported ? null : variantAction ===
                    "unsettle" ? (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <button
                            type="button"
                            aria-label="Un-settle thread"
                            onClick={handleUnsettleClick}
                            onPointerDown={handleActionPointerDown}
                            className={cn(
                              "pointer-events-none absolute inset-y-0 right-0 -mr-1 inline-flex cursor-pointer items-center gap-1 rounded-md bg-transparent px-1.5 text-xs text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 group-any-hover/sidebar-row:pointer-events-auto group-any-hover/sidebar-row:opacity-100",
                              isWoke && "static",
                            )}
                          />
                        }
                      >
                        <Undo2Icon className="mb-px size-3.5" />
                      </TooltipTrigger>
                      <TooltipPopup side="top">Un-settle thread</TooltipPopup>
                    </Tooltip>
                  ) : (
                    <button
                      type="button"
                      aria-label="Settle thread"
                      onClick={handleSettleClick}
                      onPointerDown={handleActionPointerDown}
                      className={cn(
                        "pointer-events-none absolute inset-y-0 right-0 inline-flex cursor-pointer items-center gap-1 rounded-md bg-transparent px-2 text-xs text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 group-any-hover/sidebar-row:pointer-events-auto group-any-hover/sidebar-row:opacity-100",
                        isWoke && "static",
                      )}
                    >
                      <CheckIcon className="size-3" />
                    </button>
                  )}
                </span>
              )}
              {props.sweepAction !== null ? dragDestination : null}
              {props.jumpLabel ? <JumpHintBadge label={props.jumpLabel} /> : null}
            </div>
          }
        />
        {tabList}
      </li>
    );
  }
  const diff = latestRunDiff(thread);
  return (
    <li
      data-thread-item={threadKey}
      {...sortableRootProps}
      className={cn(
        // Matches the content box; the py-0.5 padding is added on top. An open
        // tab list drops the title line, so the header is only project and branch.
        "list-none py-0.5 [content-visibility:auto]",
        unifyTabs ? "[contain-intrinsic-size:auto_52px]" : "[contain-intrinsic-size:auto_78px]",
        sortable?.isDragging && "relative z-20",
      )}
    >
      <ContextPreviewHover
        kind="thread"
        accessibleLabel={`Thread, ${thread.title}`}
        preview={{
          record: { environmentId: thread.environmentId, threadId: thread.id, title: thread.title },
        }}
        placement={SIDEBAR_THREAD_PREVIEW_PLACEMENT}
        disabled={snoozeMenuOpen || tabPreviewOpen || sortable?.isDragging}
        trigger={
          <div
            ref={rowRef}
            role="button"
            tabIndex={0}
            aria-label={accessibility.label}
            aria-current={accessibility.current}
            data-testid="sidebar-row-card"
            aria-busy={isRegeneratingTitle || undefined}
            {...(fileDropHandlers ?? {})}
            className={rowSurfaceClassName}
            onClick={handleClick}
            onDoubleClick={handleDoubleClick}
            onKeyDown={handleKeyDown}
            onContextMenu={handleContextMenu}
          >
            {accessibleTitle}
            {/* Sized by content (78px with the title) so the title line can
            animate away when the group's tabs open. */}
            <div className="relative z-10 px-(--sidebar-row-content-inset) py-(--sidebar-content-inset)">
              <div className="flex h-5 min-w-0 items-center gap-1.5">
                {draftIndicator}
                {props.project ? (
                  <ProjectFavicon project={props.project} className="size-4 shrink-0" />
                ) : null}
                {props.projectDisplayName ? (
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-secondary-label text-xs",
                      shouldRecede ? "font-normal" : "font-medium",
                    )}
                  >
                    {props.projectDisplayName}
                  </span>
                ) : (
                  <span className="flex-1" />
                )}
                {agentIndicator}
                {/* Status at rest, hover actions once they fit. The pin is the
            trailing item, outside that swap, so it cannot slide sideways. */}
                {sortable?.isDragging ? (
                  <>
                    {dragDestination}
                    {pinIndicator}
                  </>
                ) : (
                  <span
                    className={cn(
                      "ml-auto flex h-5 shrink-0 items-stretch justify-end text-xs",
                      props.sweepAction !== null && "hidden",
                    )}
                  >
                    <span className="group/sidebar-status-slot relative flex h-5 min-w-8 items-stretch justify-end">
                      {/* Read-only status labels yield to the hover actions. Woke is
              itself an action, so it stays pointer-enabled and visible
              while the other controls appear beside it. */}
                      <span
                        className={cn(
                          isWokeStatus
                            ? "pointer-events-auto"
                            : "pointer-events-none group-has-[:focus-visible]/sidebar-status-slot:absolute group-has-[:focus-visible]/sidebar-status-slot:right-0 group-has-[:focus-visible]/sidebar-status-slot:opacity-0 group-any-hover/sidebar-row:absolute group-any-hover/sidebar-row:right-0 group-any-hover/sidebar-row:opacity-0",
                          "flex items-center self-center justify-self-end tabular-nums text-secondary-label transition-opacity",
                          snoozeMenuOpen && "pointer-events-none absolute right-0 opacity-0",
                        )}
                      >
                        {headerStatus ? (
                          isWokeStatus ? (
                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  <button
                                    type="button"
                                    aria-label="Dismiss Woke notification"
                                    onClick={handleAcknowledgeWokeClick}
                                    className={cn(
                                      "inline-flex cursor-pointer items-center gap-1 rounded-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                                      headerStatus.className,
                                    )}
                                  >
                                    <AlarmClockIcon aria-hidden className="size-4 shrink-0" />
                                    <span role={props.isRouteThread ? undefined : "status"}>
                                      {headerStatus.label}
                                    </span>
                                  </button>
                                }
                              />
                              <TooltipPopup side="top">Dismiss Woke notification</TooltipPopup>
                            </Tooltip>
                          ) : (
                            <span
                              className={cn(
                                "inline-flex items-center gap-1 font-medium",
                                headerStatus.className,
                              )}
                            >
                              <SidebarTopStatusIcon
                                icon={headerStatus.icon}
                                className="size-4 shrink-0"
                              />
                              {/* The label alone is the live region: a role="status"
                  wrapper around the ticking duration would make
                  screen readers announce every second. */}
                              <span role={props.isRouteThread ? undefined : "status"}>
                                {headerStatus.label}
                              </span>
                              {status === "working" ? (
                                <span aria-hidden>
                                  <WorkingDuration startedAt={resolveWorkingStartedAt(thread)} />
                                </span>
                              ) : status === "waiting" ? (
                                <span aria-hidden>
                                  <WorkingDuration
                                    startedAt={thread.latestRun?.completedAt ?? null}
                                  />
                                </span>
                              ) : null}
                            </span>
                          )
                        ) : unifyTabs ? null : variantAction === "unsnooze" &&
                          props.snoozeWakeLabelText !== null ? (
                          props.snoozeWakeLabelText
                        ) : variantAction === "unsettle" ? (
                          settledTimeLabel(thread)
                        ) : (
                          threadTimeLabel(thread)
                        )}
                      </span>
                      {showHoverActions || onNewTab || showUnpinnedPinAction ? (
                        <span
                          className={cn(
                            // focus-visible, not focus-within: a mouse click leaves
                            // the Settle button focused, and a plain focus-within
                            // would keep the controls pinned over the status label
                            // once the pointer moves away (e.g. after a failed
                            // settle) instead of cross-fading back.
                            "pointer-events-none absolute inset-y-0 right-0 flex items-stretch opacity-0 transition-opacity has-[:focus-visible]:pointer-events-auto has-[:focus-visible]:static has-[:focus-visible]:opacity-100 group-any-hover/sidebar-row:pointer-events-auto group-any-hover/sidebar-row:static group-any-hover/sidebar-row:opacity-100",
                            snoozeMenuOpen && "pointer-events-auto static opacity-100",
                          )}
                        >
                          {hasUnsentDraft ? (
                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  <button
                                    type="button"
                                    aria-label="Discard draft"
                                    onClick={handleDiscardDraftClick}
                                    className="inline-flex cursor-pointer items-center rounded-md bg-transparent px-1.5 text-xs text-muted-foreground hover:text-foreground"
                                  />
                                }
                              >
                                <XIcon className="size-3.5" />
                              </TooltipTrigger>
                              <TooltipPopup side="top">Discard draft</TooltipPopup>
                            </Tooltip>
                          ) : null}
                          {onNewTab ? (
                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  <button
                                    type="button"
                                    aria-label="New tab"
                                    onClick={handleNewTabClick}
                                    className="inline-flex cursor-pointer items-center rounded-md bg-transparent px-1.5 text-xs text-muted-foreground hover:text-foreground"
                                  />
                                }
                              >
                                <PlusIcon className="size-3.5" />
                              </TooltipTrigger>
                              <TooltipPopup side="top">New tab</TooltipPopup>
                            </Tooltip>
                          ) : null}
                          {showSnoozeButton ? (
                            <SnoozeMenuButton
                              open={snoozeMenuOpen}
                              onOpenChange={setSnoozeMenuOpen}
                              onSnooze={handleSnoozePreset}
                              timestampFormat={props.timestampFormat}
                            />
                          ) : null}
                          {canOperateThread && rowAction.supported ? (
                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  <button
                                    type="button"
                                    aria-label={rowAction.label}
                                    onClick={rowAction.onClick}
                                    onPointerDown={handleActionPointerDown}
                                    className={cn(
                                      "inline-flex cursor-pointer items-center gap-1 rounded-md bg-transparent px-1.5 text-xs text-muted-foreground hover:text-foreground",
                                      // The pin owns the trailing inset when it is present.
                                      !showPin && !showUnpinnedPinAction && "-mr-1",
                                    )}
                                  />
                                }
                              >
                                <RowActionIcon className="size-3.5" />
                                {rowAction.text}
                              </TooltipTrigger>
                              <TooltipPopup>{rowAction.label}</TooltipPopup>
                            </Tooltip>
                          ) : null}
                          {showUnpinnedPinAction ? (
                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  <button
                                    type="button"
                                    aria-label="Pin thread"
                                    onClick={handlePinClick}
                                    onPointerDown={handleActionPointerDown}
                                    className="-mr-1 inline-flex cursor-pointer items-center rounded-md bg-transparent px-1.5 text-xs text-muted-foreground hover:text-foreground"
                                  />
                                }
                              >
                                <PinIcon className="size-3.5" />
                              </TooltipTrigger>
                              <TooltipPopup>Pin thread</TooltipPopup>
                            </Tooltip>
                          ) : null}
                        </span>
                      ) : null}
                    </span>
                    {pinIndicator}
                  </span>
                )}
                {props.sweepAction !== null ? dragDestination : null}
              </div>
              {/* An open tab list starts with this thread, so its title moves there. */}
              {props.tabs != null ? (
                <SidebarDisclosure open={!unifyTabs || props.tabGroupName !== undefined}>
                  <div className="flex min-w-0 pt-1">{title}</div>
                </SidebarDisclosure>
              ) : (
                <div className="mt-1 flex min-w-0">{title}</div>
              )}
              {isRegeneratingTitle ? (
                <span role="status" className="sr-only">
                  Regenerating title
                </span>
              ) : null}
              <div
                className={cn(
                  "flex min-w-0 items-center gap-1.5 text-secondary-label text-xs",
                  unifyTabs ? "mt-1" : "mt-0.5",
                )}
              >
                {/* Always the branch. The plan step used to take this slot while
            working, but it truncated to a half-sentence and dropped the
            branch, so the row lost its most stable identifier. */}
                {thread.branch ? (
                  <>
                    <ThreadWorktreeIndicator thread={thread} />
                    <span className="flex min-w-0 flex-1 text-muted-foreground/40">
                      <MiddleTruncate value={thread.branch} showTitle={false} />
                    </span>
                  </>
                ) : showsScratchMachine ? (
                  <>
                    <EnvironmentMachineIcon
                      aria-hidden
                      kind={props.environmentMachine}
                      className="size-3 shrink-0 text-muted-foreground/40"
                    />
                    <span className="min-w-0 flex-1 truncate text-muted-foreground/40">
                      {props.scratchMachineLabel}
                    </span>
                  </>
                ) : (
                  <span className="flex-1" />
                )}
                {tabCountBadge}
                {props.inSplit && !unifyTabs ? <SidebarSplitIndicator /> : null}
                {unifyTabs ? null : terminalStatusIcon}
                {savedDraftsIndicator}
                {prBadge}
                {diff ? (
                  <span className="shrink-0 font-mono">
                    <span className="text-diff-addition-foreground">
                      +{formatDiffCount(diff.insertions)}
                    </span>{" "}
                    <span className="text-diff-deletion-foreground">
                      −{formatDiffCount(diff.deletions)}
                    </span>
                  </span>
                ) : null}
                <span
                  aria-hidden
                  className="pointer-events-none ml-auto inline-flex shrink-0 items-center gap-1"
                >
                  {isRemote && !showsScratchMachine ? (
                    <span className="inline-flex shrink-0 items-center text-sidebar-muted-foreground/70">
                      <EnvironmentMachineIcon
                        aria-hidden
                        kind={props.environmentMachine}
                        className="size-3.5"
                      />
                    </span>
                  ) : null}
                  {unifyTabs ? null : (
                    <SidebarProviderStack
                      thread={thread}
                      draftModelSelection={draftModelSelection}
                      providerEntryByInstanceId={props.providerEntryByInstanceId}
                    />
                  )}
                </span>
              </div>
            </div>
            {unifyTabs || !props.jumpLabel ? null : <JumpHintBadge label={props.jumpLabel} />}
          </div>
        }
      />
      {tabList}
    </li>
  );
});
/** Inline title editor, mounted only while a row is being renamed. */
export function SidebarRenameInput(props: {
  threadRef: ScopedThreadRef;
  originalTitle: string;
  value: string;
  onChange: (title: string) => void;
  onCommit: (threadRef: ScopedThreadRef, title: string, originalTitle: string) => void;
  onCancel: () => void;
}) {
  // Enter and Escape unmount the field, which blurs it; the blur must not commit a second time.
  const finishedRef = useRef(false);
  return (
    <input
      autoFocus
      value={props.value}
      dir="auto"
      aria-label="Thread title"
      onChange={(event) => props.onChange(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === "Enter") {
          event.preventDefault();
          finishedRef.current = true;
          props.onCommit(props.threadRef, props.value, props.originalTitle);
        } else if (event.key === "Escape") {
          event.preventDefault();
          finishedRef.current = true;
          props.onCancel();
        }
      }}
      onBlur={() => {
        if (!finishedRef.current) props.onCommit(props.threadRef, props.value, props.originalTitle);
      }}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      className="min-w-0 flex-1 rounded-sm border border-input bg-card px-1 text-sm font-medium text-card-foreground outline-none focus:border-foreground"
    />
  );
}
/**
 * The group's tab count. With `onToggle`, it opens and folds that group's tabs. While folded,
 * hovering it shows `preview`, a list to switch tabs from without opening the group.
 */
function SidebarTabCountBadge(props: {
  count: number;
  toggleCount: number;
  open: boolean;
  onToggle?: ((event: ReactMouseEvent) => void) | undefined;
  preview?: ReactNode;
  onPreviewOpenChange?: ((open: boolean) => void) | undefined;
}) {
  const { onPreviewOpenChange } = props;
  const [previewOpen, setPreviewOpenState] = useState(false);
  const setPreviewOpen = (open: boolean) => {
    setPreviewOpenState(open);
    onPreviewOpenChange?.(open);
  };
  const className =
    "inline-flex shrink-0 items-center gap-0.5 text-xs tabular-nums text-muted-foreground/70";
  if (!props.onToggle) {
    return props.open ? null : (
      <span className={className}>
        <LayersIcon aria-hidden className="size-3" />
        {props.count}
        <span className="sr-only"> tabs</span>
      </span>
    );
  }
  const label = sidebarTabToggleLabel(props.open, props.toggleCount);
  const button = (
    <button
      type="button"
      aria-label={label}
      aria-expanded={props.open}
      data-testid="sidebar-tab-group-toggle"
      onClick={(event) => {
        setPreviewOpen(false);
        props.onToggle?.(event);
      }}
      onDoubleClick={(event) => event.stopPropagation()}
      className={cn(
        className,
        "-mx-1 cursor-pointer rounded-sm px-1 outline-none transition-colors hover:bg-sidebar-row-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
      )}
    />
  );
  const body = (
    <>
      <LayersIcon aria-hidden className="size-3" />
      {props.count}
      {/* The chevron marks the badge as a control: always while open, on hover while folded. */}
      <ChevronDownIcon
        aria-hidden
        className={cn(
          "size-3 transition-[rotate,opacity] motion-reduce:transition-none",
          props.open
            ? "rotate-180"
            : "opacity-0 group-hover/sidebar-row:opacity-100 group-has-[:focus-visible]/sidebar-row:opacity-100",
        )}
      />
    </>
  );
  if (!props.open && props.preview != null) {
    // The card renders in a portal but its events still bubble through the row in React, which
    // would open the row's thread, start a row drag, or open its context menu.
    const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();
    return (
      <PreviewCard open={previewOpen} onOpenChange={setPreviewOpen}>
        <PreviewCardTrigger delay={300} closeDelay={150} render={button}>
          {body}
        </PreviewCardTrigger>
        <PreviewCardPopup
          side="right"
          align="start"
          sideOffset={8}
          className="w-80 max-w-[calc(100vw-2rem)]"
        >
          <div
            className="p-1"
            onClick={(event) => {
              stop(event);
              // Every control in the list opens a tab, so a click there is done with the card.
              if (event.target instanceof Element && event.target.closest("button")) {
                setPreviewOpen(false);
              }
            }}
            onDoubleClick={stop}
            onPointerDown={stop}
            onKeyDown={stop}
            onContextMenu={stop}
          >
            {props.preview}
          </div>
        </PreviewCardPopup>
      </PreviewCard>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger render={button}>{body}</TooltipTrigger>
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
}
/**
 * Mounts `children` while open and animates its height on the way in and out.
 * The first render never animates, so a page load or remount lands in place.
 */
function SidebarDisclosure(props: {
  open: boolean;
  children: ReactNode;
  onSettled?: (() => void) | undefined;
}) {
  const { open, onSettled } = props;
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  const ref = useRef<HTMLDivElement>(null);
  const animationRef = useRef<Animation | null>(null);
  const settledOpenRef = useRef(open);
  useLayoutEffect(() => {
    const node = ref.current;
    if (settledOpenRef.current === open || node === null) return;
    settledOpenRef.current = open;
    const animation = animateSidebarDisclosure(node, open, animationRef.current);
    animationRef.current = animation;
    const settle = () => {
      if (animationRef.current !== animation) return;
      animationRef.current = null;
      if (!open) setMounted(false);
      onSettled?.();
    };
    if (animation === null) settle();
    // A finished animation stops holding the collapsed height, so the unmount
    // must commit before the next paint or the full list flashes back for a
    // frame. Committing first also lets onSettled measure the settled layout.
    else
      animation.addEventListener("finish", () => flushSync(settle), {
        once: true,
      });
  }, [open, onSettled]);
  useEffect(() => () => animationRef.current?.cancel(), []);
  if (!mounted) return null;
  return (
    <div ref={ref} className="overflow-hidden">
      {props.children}
    </div>
  );
}
function latestRunDiff(thread: SidebarThreadSummary): {
  insertions: number;
  deletions: number;
} | null {
  void thread;
  return null;
}
export const SidebarSearchResultRow = memo(function SidebarSearchResultRow(props: {
  isSettled: boolean;
  thread: SidebarThreadSummary;
  project: EnvironmentProject | null;
  projectDisplayName: string | null;
  isHighlighted: boolean;
  isRouteActive: boolean;
  resultId: string;
  searchMatch: EnvironmentThreadSearchMatch | null;
  searchQuery: string;
  /** The query `searchMatch` was found for, which lags `searchQuery` while a search runs. */
  searchMatchQuery?: string;
  onHighlight: () => void;
  onSelect: () => void;
  onFileDropThreads: (threadRef: ScopedThreadRef, files: File[]) => void;
}) {
  const thread =
    useThreadShell(scopeThreadRef(props.thread.environmentId, props.thread.id)) ?? props.thread;
  const accessibility = resolveSidebarRowAccessibility({
    title: thread.title,
    statusLabel: null,
    projectDisplayName: props.projectDisplayName,
    isActive: props.isRouteActive,
  });
  const threadRef = scopeThreadRef(thread.environmentId, thread.id);
  const { leaseLiveStatus, rowRef } = useSidebarRowSubscriptionLease(
    props.isHighlighted || props.isRouteActive,
  );
  const [isFileDragOver, setIsFileDragOver] = useState(false);
  const onFileDropThreads = props.onFileDropThreads;
  const fileDropHandlers = makeWorkspaceFileDropHandlers({
    setDragActive: setIsFileDragOver,
    addFiles: (files) => {
      onFileDropThreads(threadRef, files);
    },
    addFolders: () => {},
  });
  useEffect(() => {
    if (!isFileDragOver) return;
    const clearFileDrag = () => setIsFileDragOver(false);
    window.addEventListener("dragend", clearFileDrag);
    return () => window.removeEventListener("dragend", clearFileDrag);
  }, [isFileDragOver]);
  return (
    <li role="presentation" className="list-none" {...fileDropHandlers}>
      <ContextPreviewHover
        kind="thread"
        accessibleLabel={`Thread, ${thread.title}`}
        preview={{
          record: { environmentId: thread.environmentId, threadId: thread.id, title: thread.title },
        }}
        placement={SIDEBAR_THREAD_PREVIEW_PLACEMENT}
        trigger={
          <button
            ref={rowRef}
            id={props.resultId}
            data-search-result-key={scopedThreadKey(threadRef)}
            type="button"
            role="option"
            tabIndex={-1}
            aria-selected={props.isHighlighted}
            aria-current={accessibility.current}
            aria-describedby={`${props.resultId}-pr`}
            aria-label={accessibility.label}
            onMouseMove={props.onHighlight}
            onClick={props.onSelect}
            className={cn(
              "group/sidebar-row group/v2-row flex min-h-9 w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1 text-left text-sm outline-none",
              props.isHighlighted || props.isRouteActive
                ? "bg-sidebar-row-active text-sidebar-foreground"
                : "text-sidebar-muted-foreground/75 hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
              isFileDragOver && "ring-1 ring-inset ring-primary/70",
              isFileDragOver && !props.isRouteActive && "bg-sidebar-row-hover",
            )}
          >
            {props.project ? (
              <ProjectFavicon
                project={props.project}
                className={cn(
                  "size-4 shrink-0 transition-opacity",
                  props.isSettled &&
                    !props.isRouteActive &&
                    !props.isHighlighted &&
                    "opacity-40 grayscale group-hover/sidebar-row:opacity-100 group-hover/sidebar-row:grayscale-0",
                )}
              />
            ) : null}
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="flex min-w-0 items-center gap-2.5">
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate",
                    props.isSettled
                      ? "font-normal text-secondary-label/70 group-hover/sidebar-row:text-foreground"
                      : "font-medium text-foreground",
                    (props.isHighlighted || props.isRouteActive) && "text-foreground",
                    thread.titleRegeneration != null && "opacity-55",
                  )}
                >
                  {thread.title}
                </span>
                <span id={`${props.resultId}-pr`} className="contents">
                  <ThreadSearchPullRequestNumber
                    thread={thread}
                    query={props.searchQuery}
                    enabled={leaseLiveStatus}
                    settled={props.isSettled}
                  />
                </span>
                <span className="w-8 shrink-0 text-right text-xs text-muted-foreground/55 tabular-nums">
                  <RelativeTimeLabel timestamp={threadTimeTimestamp(thread)} />
                </span>
              </span>
              {props.searchMatch ? (
                <ThreadSearchMatchExcerpt
                  match={{
                    source: props.searchMatch.source,
                    snippet: props.searchMatch.snippet,
                    query: props.searchMatchQuery ?? props.searchQuery,
                  }}
                />
              ) : null}
            </span>
          </button>
        }
      />
    </li>
  );
});
