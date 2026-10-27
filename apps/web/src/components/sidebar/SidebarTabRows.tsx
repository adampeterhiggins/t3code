import type { SidebarThreadSummary } from "../../types";
import { SidebarSplitIndicator } from "./SidebarRowDecorations";
import { SidebarRenameInput } from "./SidebarRenameInput";

import { type ScopedThreadRef } from "@t3tools/contracts";
import { ContextPreviewHover } from "../contextPreviewRegistry";

import { terminalStatusFromRunningIds } from "../ThreadStatusIndicators";

import {
  closestCenter,
  DndContext,
  useSensor,
  useSensors,
  type CollisionDetection,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";

import { type EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";

import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  type SidebarTabSortDirection,
  type SidebarTabSortOrder,
} from "@t3tools/contracts/settings";

import { ChevronDownIcon } from "lucide-react";
import { ChevronUpIcon, TerminalIcon, XIcon } from "lucide-react";
import {
  createContext,
  memo,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";

import { cn } from "~/lib/utils";
import { textDirection } from "~/textDirection";

import { useUiStateStore } from "../../uiStateStore";
import { useThreadSelectionStore } from "../../threadSelectionStore";

import { type ProviderEntrySummary } from "../../state/providerEntries";

import { resolveSidebarTopStatus, SidebarTopStatusIcon } from "./SidebarTopStatus";
import { SidebarTabSummary, threadTimeLabel } from "./SidebarTabSummary";

import {
  hasUnseenCompletion,
  holdSidebarTabOrder,
  sortSidebarTabs,
  resolveSidebarTabPairTarget,
  sidebarTabSortTimestamp,
  resolveSidebarRowAccessibility,
  resolveSidebarThreadStatus,
  shouldRecedeSidebarThread,
} from "../Sidebar.logic";

import { SidebarPointerSensor } from "../Sidebar.pointer";
import { createSidebarListMotion } from "../Sidebar.motion";

import { makeWorkspaceFileDropHandlers } from "../chat/workspaceFileDrop";

import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { getTriggerDisplayModelLabel } from "../chat/providerIconUtils";
import { shouldShowInstanceBadge, type ProviderInstanceEntry } from "../../providerInstances";
import { useThreadRunningTerminalIds } from "../../state/terminalSessions";

import { PreviewCard, PreviewCardPopup, PreviewCardTrigger } from "../ui/preview-card";

import { useComposerDraftActiveModelSelection } from "../../composerDraftStore";
import {
  SIDEBAR_THREAD_PREVIEW_PLACEMENT,
  JumpHintBadge,
  terminalProcessLabel,
  type SortableThreadRowBag,
} from "./SidebarThreadRow";

function sidebarThreadKey(thread: EnvironmentThreadShell): string {
  return scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
}
/**
 * A group's tabs under its header, including the thread the row stands for. Tabs drag within
 * the list in their own drag context, so picking one up never drags the whole group, and they
 * move with the thread list's motion when a sort, the limit or a drop changes their order.
 */
/** How long a dragged tab rests on another before releasing it pairs them in split view. */
const SIDEBAR_TAB_PAIR_HOLD_MS = 500;
/** The tab a dragged tab pairs with if released now; that row lights up. */
const SidebarTabPairTargetContext = createContext<string | null>(null);
export function SidebarTabList(props: {
  /** Sortable ids of the rendered tabs, in display order. */
  tabKeys: readonly string[];
  /** Changes when the "more" row appears, disappears or flips, so its move animates too. */
  overflowKey: string;
  onReorder: (activeKey: string, overKey: string) => void;
  /** A dragged tab was held on another and released there: show the two side by side. */
  onPair: (draggedKey: string, targetKey: string) => void;
  /** The pointer entered or left the list; a live sort holds still while it rests here. */
  onPointerRestChange: (resting: boolean) => void;
  /** The list's height may have changed; rows below it re-measure and glide. */
  onLayoutChange: () => void;
  children: ReactNode;
}) {
  const { onLayoutChange, onReorder, onPair, tabKeys } = props;
  const motionRef = useRef<ReturnType<typeof createSidebarListMotion> | null>(null);
  const attachMotionRef = (node: HTMLUListElement | null) => {
    motionRef.current?.dispose();
    motionRef.current = node === null ? null : createSidebarListMotion(node);
    motionRef.current?.update(false);
  };
  const [dragging, setDragging] = useState(false);
  const sensorRef = useRef<SidebarPointerSensor | null>(null);
  const finishDrag = (started: boolean) => {
    sensorRef.current = null;
    if (!started) return;
    // Rows glide from where the drag left them into their committed slots.
    motionRef.current?.release();
    setDragging(false);
  };
  const attachSensor = (sensor: SidebarPointerSensor) => {
    sensorRef.current = sensor;
  };
  useEffect(() => () => sensorRef.current?.cancel(), []);
  const sensors = useSensors(
    useSensor(SidebarPointerSensor, {
      distance: 6,
      onAttach: attachSensor,
      onFinish: finishDrag,
    }),
  );
  // Resting a dragged tab on another row, iOS home-screen style, aims to pair the two. Aiming
  // holds the list still; after a short hold the row lights up and releasing pairs them.
  const overKeyRef = useRef<string | null>(null);
  const aimRef = useRef<{
    key: string | null;
    timer: number | null;
  }>({ key: null, timer: null });
  const pairTargetRef = useRef<string | null>(null);
  const [pairTarget, setPairTarget] = useState<string | null>(null);
  const resetPairAim = () => {
    if (aimRef.current.timer !== null) window.clearTimeout(aimRef.current.timer);
    aimRef.current = { key: null, timer: null };
    pairTargetRef.current = null;
    setPairTarget(null);
  };
  useEffect(() => resetPairAim, [resetPairAim]);
  const collisionDetection: CollisionDetection = (args) => {
    const activeKey = String(args.active.id);
    const target = resolveSidebarTabPairTarget({
      keys: tabKeys,
      slots: tabKeys.map((key) => args.droppableRects.get(key)),
      activeKey,
      overKey: overKeyRef.current,
      centerY: args.collisionRect.top + args.collisionRect.height / 2,
    });
    // dnd-kit runs this during render, so it only starts and stops the hold timer.
    const aim = aimRef.current;
    if (target !== aim.key) {
      if (aim.timer !== null) window.clearTimeout(aim.timer);
      if (pairTargetRef.current !== null) {
        pairTargetRef.current = null;
        queueMicrotask(() => setPairTarget(pairTargetRef.current));
      }
      aimRef.current = {
        key: target,
        timer:
          target === null
            ? null
            : window.setTimeout(() => {
                aimRef.current.timer = null;
                pairTargetRef.current = target;
                setPairTarget(target);
              }, SIDEBAR_TAB_PAIR_HOLD_MS),
      };
    }
    if (target === null) return closestCenter(args);
    return [{ id: overKeyRef.current ?? activeKey }];
  };
  const orderKey = `${props.tabKeys.join("\0")}\0${props.overflowKey}`;
  // A list that just mounted is opening inside its disclosure, which owns that height change.
  const mountedRef = useRef(false);
  const tabMotionPass = { orderKey, dragging };
  useLayoutEffect(() => {
    if (tabMotionPass.dragging) return;
    motionRef.current?.update(true);
    if (mountedRef.current) onLayoutChange();
    mountedRef.current = true;
  }, [tabMotionPass, onLayoutChange]);
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      onDragStart={(event) => {
        overKeyRef.current = String(event.active.id);
        motionRef.current?.suspend();
        setDragging(true);
      }}
      onDragOver={(event) => {
        overKeyRef.current = event.over === null ? null : String(event.over.id);
      }}
      onDragEnd={(event) => {
        const target = pairTargetRef.current;
        resetPairAim();
        if (target !== null) {
          onPair(String(event.active.id), target);
        } else if (event.over !== null && event.over.id !== event.active.id) {
          onReorder(String(event.active.id), String(event.over.id));
        }
      }}
      onDragCancel={resetPairAim}
    >
      <SortableContext items={[...tabKeys]} strategy={verticalListSortingStrategy}>
        <SidebarTabPairTargetContext.Provider value={pairTarget}>
          <ul
            ref={attachMotionRef}
            role="presentation"
            onPointerEnter={() => props.onPointerRestChange(true)}
            onPointerLeave={() => props.onPointerRestChange(false)}
            className="relative ms-[calc(var(--sidebar-row-content-inset)+0.4375rem)] flex flex-col gap-px border-s border-sidebar-border ps-1 pb-0.5"
          >
            {props.children}
          </ul>
        </SidebarTabPairTargetContext.Provider>
      </SortableContext>
    </DndContext>
  );
}
/**
 * Tabs listed in a hover card, with the same title, status, time, and provider as the sidebar's
 * tab rows. Clicking one opens it; `activeKey` marks the tab already open. Hovering one shows
 * the same details card as a tab row.
 */
function SidebarTabPreviewList(props: {
  tabs: readonly SidebarThreadSummary[];
  label: string;
  testId: string;
  activeKey?: string | null | undefined;
  providerEntriesByEnvironment: ReadonlyMap<string, ReadonlyMap<string, ProviderEntrySummary>>;
  tabSortOrder: SidebarTabSortOrder;
  openedAtByThreadKey: Readonly<Record<string, number>>;
  onOpenTab: (threadRef: ScopedThreadRef) => void;
}) {
  return (
    <ul
      aria-label={props.label}
      data-testid={props.testId}
      className="flex max-h-80 flex-col gap-px overflow-y-auto overscroll-contain"
    >
      {props.tabs.map((thread) => {
        const threadKey = sidebarThreadKey(thread);
        const active = threadKey === props.activeKey;
        const providerEntries = props.providerEntriesByEnvironment.get(thread.environmentId);
        return (
          <li key={threadKey} className="list-none">
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
              trigger={
                <button
                  type="button"
                  aria-current={active ? "page" : undefined}
                  onClick={() => props.onOpenTab(scopeThreadRef(thread.environmentId, thread.id))}
                  className={cn(
                    "flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    active ? "bg-sidebar-row-active" : "hover:bg-sidebar-row-hover",
                  )}
                >
                  <SidebarTabSummary
                    thread={thread}
                    providerEntries={providerEntries}
                    tabSortOrder={props.tabSortOrder}
                    openedAt={props.openedAtByThreadKey[threadKey]}
                  />
                </button>
              }
            />
          </li>
        );
      })}
    </ul>
  );
}
/**
 * Every tab in a folded group, in the order its open list would show them. The order holds
 * while the card is open, so a live sort never moves a tab out from under the pointer.
 */
export function SidebarTabGroupPreview(props: {
  tabs: readonly SidebarThreadSummary[];
  activeKey: string | null;
  providerEntriesByEnvironment: ReadonlyMap<string, ReadonlyMap<string, ProviderEntrySummary>>;
  tabSortOrder: SidebarTabSortOrder;
  tabSortDirection: SidebarTabSortDirection;
  tabManualRanks: Readonly<Record<string, number>>;
  openedAtByThreadKey: Readonly<Record<string, number>>;
  onOpenTab: (threadRef: ScopedThreadRef) => void;
}) {
  const { openedAtByThreadKey } = props;
  const sorted = sortSidebarTabs(props.tabs, {
    order: props.tabSortOrder,
    direction: props.tabSortDirection,
    getKey: sidebarThreadKey,
    getTimestamp: (tab, order) =>
      sidebarTabSortTimestamp(tab, order, openedAtByThreadKey[sidebarThreadKey(tab)]),
    manualRanks: props.tabManualRanks,
  });
  const [heldKeys] = useState(() => sorted.map(sidebarThreadKey));
  return (
    <SidebarTabPreviewList
      tabs={holdSidebarTabOrder(sorted, heldKeys, sidebarThreadKey)}
      label={`${props.tabs.length} tabs`}
      testId="sidebar-tab-group-preview"
      activeKey={props.activeKey}
      providerEntriesByEnvironment={props.providerEntriesByEnvironment}
      tabSortOrder={props.tabSortOrder}
      openedAtByThreadKey={openedAtByThreadKey}
      onOpenTab={props.onOpenTab}
    />
  );
}
/**
 * Stands in for a group's tabs past the limit. It names what it hides that needs you, and the
 * providers behind them, so folding tabs away never hides work in progress. Hovering the
 * collapsed row lists those tabs.
 */
export function SidebarTabOverflowRow(props: {
  hidden: readonly SidebarThreadSummary[];
  expanded: boolean;
  providerEntriesByEnvironment: ReadonlyMap<string, ReadonlyMap<string, ProviderEntrySummary>>;
  tabSortOrder: SidebarTabSortOrder;
  openedAtByThreadKey: Readonly<Record<string, number>>;
  onToggle: () => void;
  onOpenTab: (threadRef: ScopedThreadRef) => void;
  onPreviewOpenChange?: ((open: boolean) => void) | undefined;
}) {
  const { hidden, providerEntriesByEnvironment } = props;
  const summary = (() => {
    // Most urgent first, the same precedence as a row's own status.
    const precedence = ["approval", "input", "failed", "limited", "working", "waiting"] as const;
    const counts = new Map<string, number>();
    for (const thread of hidden) {
      const status = resolveSidebarThreadStatus(thread);
      counts.set(status, (counts.get(status) ?? 0) + 1);
    }
    const status = precedence.find((candidate) => counts.has(candidate)) ?? null;
    const topStatus = status === null ? null : resolveSidebarTopStatus(status, false, false);
    const providers = new Map<
      string,
      {
        driverKind: ProviderInstanceEntry["driverKind"];
        displayName: string;
      }
    >();
    for (const thread of hidden) {
      const instanceId = thread.runtime?.providerInstanceId ?? thread.modelSelection.instanceId;
      const entry = providerEntriesByEnvironment.get(thread.environmentId)?.get(instanceId);
      if (entry && !providers.has(entry.driverKind)) {
        providers.set(entry.driverKind, {
          driverKind: entry.driverKind,
          displayName: entry.displayName,
        });
      }
    }
    return {
      topStatus,
      statusCount: status === null ? 0 : (counts.get(status) ?? 0),
      providers: [...providers.values()].slice(0, 3),
    };
  })();
  const label = props.expanded ? "Show less" : `${hidden.length} more`;
  const onPreviewOpenChangeRef = useRef(props.onPreviewOpenChange);

  useLayoutEffect(() => {
    onPreviewOpenChangeRef.current = props.onPreviewOpenChange;
  });

  const previewOpenRef = useRef(false);
  // The card unmounts when the row expands or the group leaves the list. Release the sort hold
  // if that happens while the preview is open and the pointer is no longer over the list.
  useEffect(() => {
    if (props.expanded && previewOpenRef.current) {
      previewOpenRef.current = false;
      onPreviewOpenChangeRef.current?.(false);
    }
  }, [props.expanded]);
  useEffect(
    () => () => {
      if (!previewOpenRef.current) return;
      previewOpenRef.current = false;
      onPreviewOpenChangeRef.current?.(false);
    },
    [],
  );
  const buttonClassName =
    "flex h-7 w-full cursor-pointer items-center gap-1.5 rounded-md px-2 text-left text-secondary-label text-xs outline-none hover:bg-sidebar-row-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";
  const buttonBody = (
    <>
      {props.expanded ? (
        <ChevronUpIcon aria-hidden className="size-3 shrink-0" />
      ) : (
        <ChevronDownIcon aria-hidden className="size-3 shrink-0" />
      )}
      <span className="shrink-0">{label}</span>
      {!props.expanded && summary.topStatus ? (
        <span
          className={cn(
            "inline-flex min-w-0 items-center gap-1 truncate font-medium",
            summary.topStatus.className,
          )}
        >
          <SidebarTopStatusIcon icon={summary.topStatus.icon} className="size-3 shrink-0" />
          {summary.statusCount} {summary.topStatus.label.toLowerCase()}
        </span>
      ) : null}
      {!props.expanded && summary.providers.length > 0 ? (
        <span aria-hidden className="ml-auto inline-flex shrink-0 items-center gap-1">
          {summary.providers.map((provider) => (
            <ProviderInstanceIcon
              key={provider.driverKind}
              driverKind={provider.driverKind}
              displayName={provider.displayName}
              showBadge={false}
              iconClassName="size-3 opacity-45"
            />
          ))}
        </span>
      ) : null}
    </>
  );
  const showPreview = !props.expanded && hidden.length > 0;
  return (
    <li className="list-none">
      {showPreview ? (
        <PreviewCard
          onOpenChange={(open) => {
            previewOpenRef.current = open;
            props.onPreviewOpenChange?.(open);
          }}
        >
          <PreviewCardTrigger
            delay={400}
            closeDelay={150}
            render={
              <button
                type="button"
                data-testid="sidebar-tab-overflow"
                aria-expanded={false}
                onClick={props.onToggle}
                className={buttonClassName}
              />
            }
          >
            {buttonBody}
          </PreviewCardTrigger>
          <PreviewCardPopup
            side="right"
            align="start"
            sideOffset={4}
            className="w-80 max-w-[calc(100vw-2rem)]"
          >
            <div className="p-1">
              <SidebarTabPreviewList
                tabs={hidden}
                label={`${hidden.length} more tabs`}
                testId="sidebar-tab-overflow-preview"
                providerEntriesByEnvironment={providerEntriesByEnvironment}
                tabSortOrder={props.tabSortOrder}
                openedAtByThreadKey={props.openedAtByThreadKey}
                onOpenTab={props.onOpenTab}
              />
            </div>
          </PreviewCardPopup>
        </PreviewCard>
      ) : (
        <button
          type="button"
          data-testid="sidebar-tab-overflow"
          aria-expanded={props.expanded}
          onClick={props.onToggle}
          className={buttonClassName}
        >
          {buttonBody}
        </button>
      )}
    </li>
  );
}
/**
 * One chat tab listed under its group's row: title, live status, time since your last
 * message, and the provider it runs on. Lifecycle actions stay on the group's row.
 */
export const SidebarTabRow = memo(function SidebarTabRow(props: {
  thread: SidebarThreadSummary;
  isActive: boolean;
  /** One side of the split view on screen: the routed chat or the one beside it. */
  inSplit: boolean;
  jumpLabel: string | null;
  projectDisplayName: string | null;
  providerEntryByInstanceId: ReadonlyMap<string, ProviderEntrySummary>;
  isRenaming: boolean;
  renamingTitle: string;
  onThreadClick: (event: ReactMouseEvent, threadRef: ScopedThreadRef) => void;
  onThreadActivate: (threadRef: ScopedThreadRef) => void;
  onStartRename: (threadRef: ScopedThreadRef, title: string) => void;
  onRenameTitleChange: (title: string) => void;
  onCommitRename: (threadRef: ScopedThreadRef, title: string, originalTitle: string) => void;
  onCancelRename: () => void;
  onContextMenu: (
    threadRef: ScopedThreadRef,
    position: {
      x: number;
      y: number;
    },
  ) => void;
  onFileDropThreads: (threadRef: ScopedThreadRef, files: File[]) => void;
  /** Closes this tab; its hover control stands in for the time label. */
  onCloseTab: (threadRef: ScopedThreadRef) => void;
  /** The sorted-by time, so labels read in the list's order. Defaults to your last message. */
  timeLabel?: string | undefined;
  sortable?: SortableThreadRowBag | undefined;
}) {
  const { thread, onFileDropThreads, sortable } = props;
  const threadRef = scopeThreadRef(thread.environmentId, thread.id);
  const threadKey = scopedThreadKey(threadRef);
  const isPairTarget = useContext(SidebarTabPairTargetContext) === threadKey;
  const lastVisitedAt = useUiStateStore((state) => state.threadLastVisitedAtById[threadKey]);
  const isSelected = useThreadSelectionStore((state) => state.selectedThreadKeys.has(threadKey));
  const runningTerminalIds = useThreadRunningTerminalIds({
    environmentId: thread.environmentId,
    threadId: thread.id,
  });
  const terminalStatus = terminalStatusFromRunningIds(runningTerminalIds);
  const isUnread = hasUnseenCompletion({ ...thread, lastVisitedAt });
  const status = resolveSidebarThreadStatus(thread);
  const topStatus = resolveSidebarTopStatus(status, false, isUnread);
  const shouldRecede = shouldRecedeSidebarThread({
    status,
    isUnread,
    isWoke: false,
    isActive: props.isActive,
    isSelected,
  });
  const { modelInstanceId, providerEntry, driverKind, showInstanceBadge } = useSidebarTabProvider(
    thread,
    threadRef,
    props.providerEntryByInstanceId,
  );
  const [isFileDragOver, setIsFileDragOver] = useState(false);
  const fileDropHandlers = makeWorkspaceFileDropHandlers({
    setDragActive: setIsFileDragOver,
    addFiles: (files) => onFileDropThreads(threadRef, files),
    addFolders: () => {},
  });
  useEffect(() => {
    if (!isFileDragOver) return;
    const clearFileDrag = () => setIsFileDragOver(false);
    window.addEventListener("dragend", clearFileDrag);
    return () => window.removeEventListener("dragend", clearFileDrag);
  }, [isFileDragOver]);
  const accessibility = resolveSidebarRowAccessibility({
    title: thread.title,
    statusLabel: topStatus?.label ?? null,
    projectDisplayName: props.projectDisplayName,
    isActive: props.isActive,
  });
  return (
    <li
      ref={sortable?.setNodeRef}
      style={
        sortable
          ? {
              transform: CSS.Translate.toString(sortable.transform),
              transition: sortable.transition,
            }
          : undefined
      }
      {...sortable?.listeners}
      className={cn("list-none", sortable?.isDragging && "relative z-20")}
    >
      <ContextPreviewHover
        kind="thread"
        accessibleLabel={`Thread, ${thread.title}`}
        preview={{
          record: { environmentId: thread.environmentId, threadId: thread.id, title: thread.title },
        }}
        placement={SIDEBAR_THREAD_PREVIEW_PLACEMENT}
        disabled={sortable?.isDragging}
        trigger={
          <div
            role="button"
            tabIndex={0}
            aria-label={accessibility.label}
            aria-current={accessibility.current}
            data-testid="sidebar-row-tab"
            {...fileDropHandlers}
            className={cn(
              "group/sidebar-row relative flex h-8 w-full cursor-pointer items-center gap-2 overflow-hidden rounded-md px-2 text-left outline-none select-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              props.isActive
                ? "bg-sidebar-row-active text-sidebar-foreground"
                : props.inSplit
                  ? "bg-sidebar-row-active/50 text-sidebar-foreground"
                  : isSelected
                    ? "bg-sidebar-row-selected text-sidebar-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-row-hover",
              isFileDragOver && "ring-1 ring-inset ring-primary/70",
              isFileDragOver && !props.isActive && !isSelected && "bg-sidebar-row-hover",
              isPairTarget && "bg-primary/10 ring-2 ring-inset ring-primary",
              // Lifted like a dragged thread: an opaque card over the rows beneath.
              sortable?.isDragging &&
                "bg-sidebar bg-linear-to-b from-sidebar-row-active to-sidebar-row-active text-sidebar-foreground shadow-lg",
            )}
            onClick={(event) => props.onThreadClick(event, threadRef)}
            onDoubleClick={(event) => {
              if (props.isRenaming || event.metaKey || event.ctrlKey || event.shiftKey) return;
              event.preventDefault();
              props.onStartRename(threadRef, thread.title);
            }}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return;
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              props.onThreadActivate(threadRef);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              props.onContextMenu(threadRef, {
                x: event.clientX,
                y: event.clientY,
              });
            }}
          >
            {props.isRenaming ? (
              <SidebarRenameInput
                threadRef={threadRef}
                originalTitle={thread.title}
                value={props.renamingTitle}
                onChange={props.onRenameTitleChange}
                onCommit={props.onCommitRename}
                onCancel={props.onCancelRename}
              />
            ) : (
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-start text-sm",
                  shouldRecede
                    ? "text-secondary-label"
                    : props.isActive || isUnread || status === "input"
                      ? "text-foreground"
                      : "text-foreground/85",
                )}
                dir={textDirection(thread.title)}
              >
                {thread.title}
              </span>
            )}
            {props.inSplit || isPairTarget ? <SidebarSplitIndicator /> : null}
            {terminalStatus ? (
              <TerminalIcon
                aria-label={terminalProcessLabel(runningTerminalIds.length)}
                role="img"
                className={cn("size-3.5 shrink-0", terminalStatus.colorClass)}
              />
            ) : null}
            {topStatus ? (
              <span
                className={cn(
                  "inline-flex shrink-0 items-center gap-1 text-xs font-medium",
                  topStatus.className,
                )}
              >
                <SidebarTopStatusIcon icon={topStatus.icon} className="size-3.5 shrink-0" />
                <span role="status">{topStatus.label}</span>
              </span>
            ) : null}
            {/* Time and close share one grid cell so swapping them on hover keeps the row width stable. */}
            <span className="grid shrink-0 items-center justify-items-end">
              <span className="col-start-1 row-start-1 text-xs tabular-nums text-secondary-label group-hover/sidebar-row:invisible group-focus-visible/sidebar-row:invisible group-has-[:focus-visible]/sidebar-row:invisible">
                {props.timeLabel ?? threadTimeLabel(thread)}
              </span>
              <button
                type="button"
                aria-label="Close tab"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  props.onCloseTab(threadRef);
                }}
                onDoubleClick={(event) => event.stopPropagation()}
                className="invisible col-start-1 row-start-1 -mx-1 inline-flex size-5 cursor-pointer items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-foreground/10 hover:text-foreground focus-visible:visible focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring group-hover/sidebar-row:visible group-focus-visible/sidebar-row:visible"
              >
                <XIcon className="size-3.5" />
              </button>
            </span>
            {driverKind ? (
              <span aria-hidden className="inline-flex shrink-0 items-center">
                <ProviderInstanceIcon
                  driverKind={driverKind}
                  displayName={
                    providerEntry?.displayName ?? thread.runtime?.providerName ?? modelInstanceId
                  }
                  accentColor={providerEntry?.accentColor}
                  showBadge={showInstanceBadge}
                  iconClassName="size-3.5 opacity-60"
                  badgeClassName="right-[-0.1875rem] bottom-[-0.1875rem] h-3 min-w-3 px-0.5 text-5xs"
                />
              </span>
            ) : null}
            {props.jumpLabel ? <JumpHintBadge label={props.jumpLabel} /> : null}
          </div>
        }
      />
    </li>
  );
});
/** The provider and model a tab runs on. An unsent composer pick wins, so the icon follows the composer before the next turn. */
function useSidebarTabProvider(
  thread: SidebarThreadSummary,
  threadRef: ScopedThreadRef,
  providerEntryByInstanceId: ReadonlyMap<string, ProviderEntrySummary>,
) {
  const draftModelSelection = useComposerDraftActiveModelSelection(threadRef);
  const modelSelection = draftModelSelection ?? thread.modelSelection;
  const modelInstanceId =
    draftModelSelection?.instanceId ??
    thread.runtime?.providerInstanceId ??
    thread.modelSelection.instanceId;
  const providerEntry = providerEntryByInstanceId.get(modelInstanceId) ?? null;
  const showInstanceBadge =
    providerEntry !== null &&
    shouldShowInstanceBadge(providerEntry, providerEntryByInstanceId.values());
  const selectedModel = providerEntry?.models.find((model) => model.slug === modelSelection.model);
  return {
    modelInstanceId,
    providerEntry,
    driverKind: providerEntry?.driverKind ?? null,
    showInstanceBadge,
    modelLabel: selectedModel ? getTriggerDisplayModelLabel(selectedModel) : modelSelection.model,
  };
}
