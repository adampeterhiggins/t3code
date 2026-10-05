import { requestCustomSnooze } from "./CustomSnoozeDialog";
import { useSupportsMultiplePullRequests } from "~/hooks/useSupportsMultiplePullRequests";
import { resolveThreadCurrentPullRequestLink } from "@t3tools/shared/threadPullRequests";
import { useAtomValue } from "@effect/atom-react";
import { replaceComposerContextReferences } from "@t3tools/shared/composerContextReferences";
import * as Schema from "effect/Schema";
import {
  closestCenter,
  DndContext,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type Modifier,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import {
  restrictToFirstScrollableAncestor,
  restrictToParentElement,
  restrictToVerticalAxis,
} from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import {
  canSnooze,
  effectiveSnoozed,
  threadWokeAt,
} from "@t3tools/client-runtime/state/thread-settled";
import {
  resolveSettledThreadTimestamp,
  sortSettledThreads,
} from "@t3tools/client-runtime/state/thread-sort";
import {
  threadSearchMatchKey,
  type EnvironmentThreadSearchMatch,
} from "@t3tools/client-runtime/state/thread-search";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { useHiddenTabThreads } from "./sidebar/useHiddenTabThreads";
import { resolveThreadTabTarget, useThreadTabRecencyStore } from "../threadTabRecencyStore";
import {
  threadTabGroupHeaderTarget,
  threadTabGroupTarget,
} from "@t3tools/client-runtime/thread-tabs";
import {
  parseScopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
  scopedThreadKey,
} from "@t3tools/client-runtime/environment";
import {
  resolveEnvironmentMachineKind,
  type EnvironmentMachineKind,
  type ProjectIconOverride,
  type ScopedThreadRef,
  type ThreadId,
} from "@t3tools/contracts";
import type {
  SidebarTabSortDirection,
  SidebarTabSortOrder,
  TimestampFormat,
} from "@t3tools/contracts/settings";
import {
  AlarmClockIcon,
  AlarmClockOffIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  ClockIcon,
  FolderIcon,
  FoldersIcon,
  BotIcon,
  GitBranchIcon,
  LayersIcon,
  PinIcon,
  PinOffIcon,
  PlusIcon,
  SettingsIcon,
  SquarePenIcon,
  TerminalIcon,
  Undo2Icon,
  XIcon,
} from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { useParams, useRouter } from "@tanstack/react-router";

import { useRightPanelStore } from "../rightPanelStore";
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
import { useTerminalFocus } from "../hooks/useTerminalFocus";
import { isTerminalFocused } from "../lib/terminalFocus";
import { isModelPickerOpen } from "../modelPickerVisibility";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../terminalUiStateStore";
import { isMacPlatform } from "~/lib/utils";
import { useOpenPrLink } from "../lib/openPullRequestLink";
import { releaseComposerDraftUploads } from "../lib/composerDraftUploads";
import { readLocalApi } from "../localApi";
import {
  isSameSidebarThreadRef,
  useSidebarPendingFileDropStore,
} from "../sidebarPendingFileDropStore";
import { getProjectOrderKey, selectProjectGroupingSettings } from "../logicalProject";
import {
  buildSidebarProjectSnapshots,
  projectGroupsSpanEnvironments,
  type SidebarProjectSnapshot,
} from "../sidebarProjectGrouping";
import { legacyProjectCwdPreferenceKey, useUiStateStore } from "../uiStateStore";
import {
  getThreadKeysToDeselectAfterDelete,
  useThreadSelectionStore,
} from "../threadSelectionStore";
import { useThreadActions } from "../hooks/useThreadActions";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { isCommandPaletteOpen, openCommandPalette } from "../commandPaletteBus";
import { startNewThreadFromContext } from "../lib/chatThreadActions";
import {
  useClientSettings,
  useClientSettingsHydrated,
  useUpdateClientSettings,
} from "../hooks/useSettings";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { useNowMinute } from "../hooks/useNowMinute";
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";
import {
  readThreadShell,
  useAllEnvironmentProjectSnapshotsReady,
  useProjects,
  useThreadShells,
} from "../state/entities";
import { environmentServerConfigsAtom, primaryServerKeybindingsAtom } from "../state/server";
import { vcsEnvironment } from "../state/vcs";
import { threadEnvironment } from "../state/threads";
import { useEnvironmentQuery } from "../state/query";
import { useThreadSearch } from "../state/queries";
import { useAtomCommand } from "../state/use-atom-command";
import {
  buildThreadRouteParams,
  resolveActiveThreadRouteRef,
  resolveThreadRouteTarget,
} from "../threadRoutes";
import { formatRelativeTimeLabel, parseTimestampDate } from "../timestampFormat";
import { resolveSidebarTopStatus, SidebarTopStatusIcon } from "./sidebar/SidebarTopStatus";
import type { SidebarThreadSummary } from "../types";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { cn } from "~/lib/utils";
import { EnvironmentMachineIcon } from "./EnvironmentMachineIcon";
import { ProjectEnvironmentBadge } from "./ProjectEnvironmentBadge";
import { buildThreadActionMenuItems } from "./threadActionMenu.logic";
import { openTranscriptExportDialog } from "./TranscriptExportDialog";
import { openLinearIssuePicker } from "./chat/LinearIssuePicker";
import {
  animateSidebarLayoutChanges,
  applySidebarThreadDrop,
  buildBulkTitleRegenerationContextMenuItem,
  buildBulkUnpinContextMenuItem,
  deleteSelectedThreadEntries,
  filterSidebarProjectScopeItems,
  formatWorkingDurationLabel,
  firstValidTimestampMs,
  foldedSidebarTabThreads,
  groupSidebarTabThreads,
  isSidebarTabGroupOpen,
  setSidebarTabGroupOverride,
  type SidebarTabGroupOverrides,
  hasUnseenCompletion,
  layoutSidebarTabs,
  sidebarTabToggleCount,
  sidebarTabToggleLabel,
  moveSidebarTab,
  sidebarTabNeighbourKey,
  sidebarTabSortTimestamp,
  withSidebarTabRanks,
  isSidebarNestedLinkClick,
  isSidebarThreadWorking,
  isTrailingDoubleClick,
  orderItemsByPreferredIds,
  planSidebarThreadDrop,
  reduceSidebarProjectScopeMenuState,
  resolveSidebarProjectScopeKeys,
  resolveAdjacentThreadId,
  resolveSidebarDropTarget,
  resolveSidebarDropVerb,
  resolveSidebarRowAccessibility,
  type SidebarDropVerb,
  resolveSidebarThreadStatus,
  searchSidebarThreads,
  shouldCreateNewThreadInCurrentProject,
  shouldNavigateAfterThreadPark,
  shouldRecedeSidebarThread,
  resolveWorkingStartedAt,
  sidebarListItemId,
  sidebarMarkerId,
  sortInboxThreadsByReturn,
  sortLogicalProjectsForSidebar,
  sortPinnedThreadsForSidebar,
  NO_SIDEBAR_TAB_MANUAL_RANKS,
  SIDEBAR_TAB_MANUAL_RANKS_KEY,
  SidebarTabManualRanksSchema,
  sidebarThreadShelf,
  sortThreadsForSidebar,
  useRetainedValue,
  useSidebarRowSubscriptionLease,
  useThreadJumpHintVisibility,
  withSidebarTabThreads,
  type SidebarListItem,
  type SidebarListMarker,
  type SidebarSection,
} from "./Sidebar.logic";
import { resolveLocalCheckoutBranchMismatch } from "./BranchToolbar.logic";
import {
  createSidebarCollisionDetection,
  createSidebarSortingStrategy,
  restrictBelowSidebarLabel,
} from "./Sidebar.drag";
import { SidebarDragLifecycle, SidebarPointerSensor } from "./Sidebar.pointer";
import { animateSidebarDisclosure, createSidebarListMotion } from "./Sidebar.motion";
import {
  ThreadPullRequestBadgeControl,
  ThreadPullRequestsMiniList,
  ThreadWorktreeIndicator,
  prStatusIndicator,
  resolveThreadPullRequestBadge,
  terminalStatusFromRunningIds,
  synchronizeTerminalPulse,
  type TerminalStatusIndicator,
  useLinkedThreadPullRequest,
} from "./ThreadStatusIndicators";
import { resolveSnoozePresets, snoozeWakeLabel, type SnoozePreset } from "./Sidebar.snooze";
import { ProjectFavicon, type ProjectFaviconProject } from "./ProjectFavicon";
import { ThreadSearchMatchExcerpt } from "./ThreadSearchMatch";
import { makeWorkspaceFileDropHandlers } from "./chat/workspaceFileDrop";
import { useThreadTabActions } from "./chat/ThreadTabs";
import { useSplitViewActions } from "./chat/splitPane";
import { splitMenuAction, useSplitViewStore } from "../splitViewStore";
import { ProviderInstanceIcon } from "./chat/ProviderInstanceIcon";
import { getTriggerDisplayModelLabel } from "./chat/providerIconUtils";
import {
  deriveProviderEntriesByEnvironment,
  shouldShowInstanceBadge,
  type ProviderInstanceEntry,
} from "../providerInstances";
import { useThreadRunningTerminalIds } from "../state/terminalSessions";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { Button, InlineButton } from "./ui/button";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxSearchInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxTrigger,
  useComboboxFilter,
} from "./ui/combobox";
import { SidebarContent, SidebarGroup, useSidebar } from "./ui/sidebar";
import { SidebarChromeFooter, SidebarChromeHeader } from "./sidebar/SidebarChrome";
import { SidebarAttentionInbox } from "./sidebar/SidebarAttentionInbox";
import { SidebarHeaderIconButton, SidebarThreadHeader } from "./sidebar/SidebarThreadHeader";
import {
  SIDEBAR_TAB_SORT_ORDER_LABELS,
  sidebarTabSortDirectionLabel,
  SidebarTabsMenu,
} from "./sidebar/SidebarTabsMenu";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuShortcut, MenuTrigger } from "./ui/menu";
import { PreviewCard, PreviewCardPopup, PreviewCardTrigger } from "./ui/preview-card";
import { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger } from "./ui/tooltip";
import { MiddleTruncate } from "./ui/middle-truncate";
import {
  composerDraftHasUserContent,
  DraftId,
  useComposerDraftStore,
  useComposerDraftActiveModelSelection,
  useThreadHasUnsentDraft,
  type ComposerThreadDraftState,
  type DraftSessionState,
} from "../composerDraftStore";

// Settled-tail paging: recent history is the common lookup; the deep tail
// stays behind an explicit Show more.
const SETTLED_TAIL_INITIAL_COUNT = 10;
const SETTLED_TAIL_PAGE_COUNT = 25;
// Fresh keys deliberately reset both shelves to collapsed for existing users.
const SETTLED_SHELF_EXPANDED_KEY = "t3code:sidebar:settled-expanded";
const SNOOZED_SHELF_EXPANDED_KEY = "t3code:sidebar:snoozed-expanded";
// Per-group exceptions to Show tabs. Client-local, like the shelves: a view preference.
// Stored with the Show tabs value they were made under, so changing that setting from
// anywhere (header, Settings, palette, keybinding) resets every group to it.
const TAB_GROUP_OVERRIDES_KEY = "t3code:sidebar:tab-group-overrides";
const TabGroupOverridesSchema = Schema.Struct({
  showTabs: Schema.Boolean,
  groups: Schema.Record(Schema.String, Schema.Boolean),
});
const NO_TAB_GROUP_OVERRIDES: SidebarTabGroupOverrides = {};
const INITIAL_TAB_GROUP_OVERRIDES = { showTabs: false, groups: NO_TAB_GROUP_OVERRIDES };
const WORKING_SHELF_EXPANDED_KEY = "t3code:sidebar:working-expanded";

// Working beta: when this client saw each thread leave the Working shelf.
// Module scope keeps the inbox order across routes that unmount the sidebar.
let lastWorkingThreadKeys: ReadonlySet<string> | null = null;
const observedInboxReturns = new Map<string, number>();

/** Stamps threads that stopped working since the last call. The first call
    only takes a baseline, so mounting never reshuffles the inbox. Pass null
    to reset when the beta is off. */
function observeInboxReturns(threads: readonly EnvironmentThreadShell[] | null): void {
  if (threads === null) {
    lastWorkingThreadKeys = null;
    observedInboxReturns.clear();
    return;
  }
  const working = new Set<string>();
  const present = new Set<string>();
  for (const thread of threads) {
    const key = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
    present.add(key);
    if (isSidebarThreadWorking(thread)) working.add(key);
  }
  // Drop deleted threads so the map stays bounded by the live thread list.
  for (const key of observedInboxReturns.keys()) {
    if (!present.has(key)) observedInboxReturns.delete(key);
  }
  const now = Date.now();
  for (const key of lastWorkingThreadKeys ?? []) {
    if (present.has(key) && !working.has(key)) observedInboxReturns.set(key, now);
  }
  lastWorkingThreadKeys = working;
}

function compactSidebarTimeLabel(label: string): string {
  if (label === "just now") return "now";
  return label.endsWith(" ago") ? label.slice(0, -4) : label;
}

function threadTimeLabel(thread: SidebarThreadSummary): string {
  const timestamp = thread.latestUserMessageAt ?? thread.updatedAt;
  return compactSidebarTimeLabel(formatRelativeTimeLabel(timestamp));
}

/** A tab's label under a timed sort reads the time it sorted by; manual keeps the default. */
function tabSortTimeLabel(
  thread: SidebarThreadSummary,
  order: SidebarTabSortOrder,
  openedAt: number | undefined,
): string | undefined {
  if (order === "manual") return undefined;
  const ms = sidebarTabSortTimestamp(thread, order, openedAt);
  return ms === null
    ? ""
    : compactSidebarTimeLabel(formatRelativeTimeLabel(new Date(ms).toISOString()));
}

// Settled rows read "how long ago did this wrap up", matching their sort
// key: both go through resolveSettledThreadTimestamp so label and order can't
// disagree.
function settledTimeLabel(thread: SidebarThreadSummary): string {
  const timestamp = resolveSettledThreadTimestamp(thread);
  return timestamp === null ? "" : compactSidebarTimeLabel(formatRelativeTimeLabel(timestamp));
}

// Floats at the row's right edge, vertically centered, while the jump
// modifier is held. An overlay pill instead of an inline slot: the hint
// must neither displace the status/time label (holding ⌘ used to blank
// out "Working") nor shift any layout when it appears. pointer-events-none
// so it never swallows clicks meant for the settle/un-settle buttons it
// can overlap.
function JumpHintBadge(props: { label: string }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute right-1.5 top-1/2 z-10 inline-flex h-5 -translate-y-1/2 items-center rounded-full border border-border/80 bg-background/95 px-1.5 font-mono text-3xs font-medium tracking-tight text-foreground shadow-sm"
    >
      {props.label}
    </span>
  );
}

// Self-ticking so only this span re-renders each second, not the whole row.
function WorkingDuration(props: { startedAt: string | null }) {
  const startedMs = props.startedAt !== null ? Date.parse(props.startedAt) : Number.NaN;
  const [, setTick] = useState(0);
  useEffect(() => {
    if (Number.isNaN(startedMs)) return;
    const id = window.setInterval(() => setTick((tick) => tick + 1), 1_000);
    return () => window.clearInterval(id);
  }, [startedMs]);
  if (Number.isNaN(startedMs)) return null;
  return <span className="tabular-nums">{formatWorkingDurationLabel(Date.now() - startedMs)}</span>;
}

const EMPTY_PROVIDER_ENTRIES: ReadonlyMap<string, ProviderInstanceEntry> = new Map();
// Collapsed shelves share one empty list so a route change alone does not
// give the sidebar list a new identity.
const EMPTY_THREADS: readonly EnvironmentThreadShell[] = [];
const EMPTY_TABS_BY_ROW: ReadonlyMap<string, readonly EnvironmentThreadShell[]> = new Map();

function sidebarThreadKey(thread: EnvironmentThreadShell): string {
  return scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
}

function terminalProcessLabel(count: number): string {
  return `${count} terminal ${count === 1 ? "process" : "processes"} running`;
}

function SidebarThreadTooltip({
  thread,
  project,
  projectDisplayName,
  environmentLabel,
  environmentMachine,
  providerEntry,
  showInstanceBadge,
  modelInstanceId,
  modelLabel,
  branchMismatch,
  terminalStatus,
  terminalProcessCount,
}: {
  thread: SidebarThreadSummary;
  project: ProjectFaviconProject | null;
  projectDisplayName: string | null;
  environmentLabel: string | null;
  environmentMachine: EnvironmentMachineKind;
  providerEntry: ProviderInstanceEntry | null;
  showInstanceBadge: boolean;
  modelInstanceId: string;
  modelLabel: string;
  branchMismatch: {
    threadBranch: string;
    currentBranch: string;
  } | null;
  terminalStatus: TerminalStatusIndicator | null;
  terminalProcessCount: number;
}) {
  const driverKind = providerEntry?.driverKind ?? null;
  const supportsMultiplePullRequests = useSupportsMultiplePullRequests(thread.environmentId);
  return (
    <TooltipPopup side="right" align="start" sideOffset={4} variant="glass">
      {/* The viewport's own inset (py-1 px-2) plus this one make the floating inset. */}
      <div className="flex min-w-0 max-w-80 flex-col gap-2 px-1 py-2">
        <div className="min-w-0 truncate text-xs leading-tight font-medium text-foreground">
          {thread.title}
        </div>
        <div className="grid gap-1.5 pl-0.5 text-xs text-muted-foreground">
          {projectDisplayName ? (
            <div className="flex min-w-0 items-center gap-2">
              {project ? <ProjectFavicon project={project} className="size-3 shrink-0" /> : null}
              <div className="min-w-0 truncate text-foreground/75">{projectDisplayName}</div>
            </div>
          ) : null}
          {environmentLabel ? (
            <div className="flex min-w-0 items-center gap-2">
              <EnvironmentMachineIcon
                kind={environmentMachine}
                className="size-3 shrink-0 stroke-muted-foreground"
              />
              <div className="min-w-0 truncate text-foreground/75">{environmentLabel}</div>
            </div>
          ) : null}
          {thread.branch ? (
            <div className="flex min-w-0 items-center gap-2 text-foreground/75">
              <GitBranchIcon className="size-3 shrink-0 stroke-muted-foreground" />
              <MiddleTruncate value={thread.branch} className="flex" />
            </div>
          ) : null}
          {branchMismatch ? (
            <div className="flex min-w-0 items-start gap-2 text-warning">
              <CircleAlertIcon aria-hidden className="mt-0.5 size-3 shrink-0 stroke-current" />
              <div className="min-w-0 flex-1 wrap-break-word leading-5">
                You're currently checked out on another branch.
              </div>
            </div>
          ) : null}
          {driverKind ? (
            <div className="flex min-w-0 items-center gap-2">
              <ProviderInstanceIcon
                driverKind={driverKind}
                displayName={
                  providerEntry?.displayName ?? thread.session?.providerName ?? modelInstanceId
                }
                accentColor={providerEntry?.accentColor}
                // Initials would swallow a size-3 glyph: accent dot, name in label.
                showBadge={showInstanceBadge && providerEntry?.accentColor !== undefined}
                badgeContent="none"
                badgeClassName="h-2 min-w-2 px-0"
                iconClassName="size-3 shrink-0 grayscale opacity-60"
              />
              <div className="min-w-0 truncate text-foreground/75">
                {showInstanceBadge && providerEntry
                  ? `${modelLabel} · ${providerEntry.displayName}`
                  : modelLabel}
              </div>
            </div>
          ) : null}
          {terminalStatus ? (
            <div className="flex min-w-0 items-center gap-2">
              <TerminalIcon
                aria-hidden
                className={cn("size-3 shrink-0", terminalStatus.colorClass)}
              />
              <div className="min-w-0 truncate text-foreground/75">
                {terminalProcessLabel(terminalProcessCount)}
              </div>
            </div>
          ) : null}
          {thread.session?.lastError ? (
            <div className="flex min-w-0 items-center gap-2 text-destructive-foreground">
              <CircleAlertIcon className="size-3 shrink-0 stroke-current" />
              <div className="min-w-0 truncate">Error occurred</div>
            </div>
          ) : null}
        </div>
        {supportsMultiplePullRequests && thread.pullRequests.length > 0 ? (
          <div className="border-t border-border/60 pt-2 pl-0.5 text-xs text-muted-foreground">
            <ThreadPullRequestsMiniList pullRequests={thread.pullRequests} />
          </div>
        ) : null}
      </div>
    </TooltipPopup>
  );
}

/**
 * Hover entry point for snooze: a clock button opening the preset menu.
 * Controlled by the row (which also uses the open state to pin its hover
 * actions while the menu is up).
 */
function SnoozeMenuButton(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSnooze: (preset: Pick<SnoozePreset, "snoozedUntil">) => void;
  timestampFormat: TimestampFormat;
}) {
  const { open, onOpenChange, onSnooze, timestampFormat } = props;
  // Presets resolve at open time so "In 1 hour" is relative to the click,
  // not to when the row mounted.
  const presets = useMemo(
    () => (open ? resolveSnoozePresets(new Date(), timestampFormat) : []),
    [open, timestampFormat],
  );
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

// Subset of useSortable applied to a thread row's root <li>. Listeners go
// on the whole row (no dedicated handle): the pointer sensor's distance
// constraint keeps plain clicks working, and we skip dnd-kit's aria
// attributes since there is no keyboard sensor and the row body already
// carries its own button semantics.
type SortableThreadRowBag = Pick<
  ReturnType<typeof useSortable>,
  "listeners" | "setNodeRef" | "transform" | "transition" | "isDragging"
>;

function SortableThreadRow(props: {
  id: string;
  disabled: boolean;
  children: (bag: SortableThreadRowBag) => ReactNode;
}) {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.id,
    disabled: { draggable: props.disabled },
    animateLayoutChanges: animateSidebarLayoutChanges,
  });
  // dnd-kit memoizes each field but not the bag, so the memoized row would
  // rerender on every shell update without this.
  const bag = useMemo(
    () => ({ listeners, setNodeRef, transform, transition, isDragging }),
    [listeners, setNodeRef, transform, transition, isDragging],
  );
  return props.children(bag);
}

// Unsent work shares one look: the new-thread draft rows and thread rows
// with unsent composer text both use this tint and pen so they read alike.
const draftSurfaceClassName = "bg-warning/4 hover:bg-warning/8";
const draftPenClassName = "size-3 shrink-0 text-warning-foreground";

// Structural list items — the section headers and the
// empty-section placeholders — take part in the sortable list so they shift
// with the rows and the gap can open on either side of them. They can't be
// picked up, and a marker is the sortable `over` when the pointer is on it,
// which resolveSidebarDropTarget turns into the section the gap sits in.
function SortableSidebarMarker(props: {
  marker: SidebarListMarker;
  className?: string;
  children?: ReactNode;
  "data-testid"?: string;
}) {
  const { setNodeRef, transform, transition } = useSortable({
    id: sidebarMarkerId(props.marker),
    disabled: { draggable: true },
    animateLayoutChanges: animateSidebarLayoutChanges,
  });
  return (
    <li
      ref={setNodeRef}
      data-thread-selection-safe
      data-testid={props["data-testid"]}
      className={cn("list-none", props.className)}
      style={{
        transform: CSS.Translate.toString(transform),
        // A newly revealed target must not slide from its hidden position.
        transition: props.marker.endsWith("-placeholder") ? "none" : transition,
        visibility: transform?.scaleY === 0 ? "hidden" : undefined,
      }}
    >
      {props.children}
    </li>
  );
}

// Empty targets stay measurable without reserving space at rest. The sorting
// strategy opens their hint space during a drag.
function SidebarSectionPlaceholder(props: {
  marker: "active-placeholder" | "settled-placeholder";
  label: string;
  showHint: boolean;
  isDropTarget: boolean;
}) {
  return (
    <SortableSidebarMarker
      marker={props.marker}
      data-testid={`sidebar-${props.marker}`}
      className="relative mx-0.5 -mb-px h-0"
    >
      {props.showHint ? (
        <div
          className={cn(
            "absolute inset-x-0 top-0 flex h-9 items-center justify-center rounded-md border border-dashed border-sidebar-foreground/25 text-xs text-sidebar-foreground/80",
            props.isDropTarget && "border-primary/40 bg-primary/5 text-primary",
          )}
        >
          {props.label}
        </div>
      ) : null}
    </SortableSidebarMarker>
  );
}

// Zero-height markers reserve no label space at rest. During a drag the
// sorting strategy opens 24px for a 16px label with 4px clearance on each side.
const SIDEBAR_DRAG_LABEL_HEIGHT = 24;

function SidebarDragBoundary(props: {
  marker: "pinned-header" | "pinned-divider";
  label: string;
  visible: boolean;
  isDropTarget: boolean;
}) {
  return (
    <SortableSidebarMarker
      marker={props.marker}
      data-testid={`sidebar-${props.marker}`}
      className="pointer-events-none relative mx-0.5 -mb-px h-0"
    >
      {props.visible ? (
        <div className="sidebar-drag-boundary-label absolute inset-x-2 top-1 flex h-4 items-center gap-2">
          <span
            className={cn(
              "shrink-0 text-xs font-medium",
              props.isDropTarget ? "text-primary" : "text-sidebar-foreground/80",
            )}
          >
            {props.label}
          </span>
          <span
            aria-hidden
            className={cn(
              "h-px flex-1",
              props.isDropTarget ? "bg-primary/50" : "bg-sidebar-foreground/25",
            )}
          />
        </div>
      ) : null}
    </SortableSidebarMarker>
  );
}

// Shelf headers stay visible and keep their measured height while dragging.
function SidebarSectionHeader(props: {
  marker: "working-header" | "snoozed-header" | "settled-header";
  label: string;
  className?: string;
  // While dragging, the settled header reads at full strength and takes the
  // accent while the lifted row is over it.
  dragging?: boolean;
  isDropTarget?: boolean;
  toggle: { expanded: boolean; onToggle: () => void };
}) {
  const shelf =
    props.marker === "working-header"
      ? "working"
      : props.marker === "snoozed-header"
        ? "snoozed"
        : "settled";
  const snoozed = shelf === "snoozed";
  const className = cn(
    "flex h-full w-full items-center gap-2 px-2 text-left text-xs font-medium",
    snoozed ? "text-info-foreground" : "text-sidebar-muted-foreground/60",
    props.dragging && "text-sidebar-foreground/80",
    props.isDropTarget && "text-primary",
  );
  const content = (
    <>
      <span className="shrink-0">{props.label}</span>
      <span
        aria-hidden
        className={cn(
          "h-px min-w-2 flex-1",
          snoozed ? "bg-info/20" : "bg-sidebar-border/60",
          props.dragging && "bg-sidebar-foreground/25",
          props.isDropTarget && "bg-primary/50",
        )}
      />
      <ChevronDownIcon
        aria-hidden
        className={cn(
          "size-3 shrink-0 transition-transform",
          props.toggle.expanded && "rotate-180",
        )}
      />
    </>
  );
  return (
    <SortableSidebarMarker
      marker={props.marker}
      data-testid={`sidebar-${props.marker}`}
      className={cn("mx-0.5 h-8", props.className)}
    >
      <button
        type="button"
        onClick={props.toggle.onToggle}
        aria-expanded={props.toggle.expanded}
        data-testid={`sidebar-${shelf}-shelf-toggle`}
        className={cn(className, "cursor-pointer")}
      >
        {content}
      </button>
    </SortableSidebarMarker>
  );
}

// One unsent draft session the user has invested content in. Two lines,
// nothing else: project name, then the typed prompt. All the draft's
// settings (model, env mode, branch, worktree) still travel with it —
// clicking is a plain navigation to /draft/$draftId, which touches nothing.
// While the draft is open the row renders a frozen snapshot (see
// SidebarDraftBlock); memoized so per-keystroke block re-renders skip it
// entirely.
const SidebarDraftRow = memo(function SidebarDraftRow(props: {
  draftId: DraftId;
  session: DraftSessionState;
  composer: ComposerThreadDraftState;
  project: ProjectFaviconProject | null;
  projectDisplayName: string | null;
  isActive: boolean;
  onNavigate: (draftId: DraftId) => void;
  onDiscard: (draftId: DraftId) => void;
}) {
  const { composer, draftId, onDiscard, onNavigate, session } = props;
  const promptPreview =
    replaceComposerContextReferences(composer.prompt, (occurrence) => occurrence.label)
      .trim()
      .split("\n", 1)[0] ?? "";
  // images mirrors persistedAttachments once rehydration finishes; before
  // that only the persisted list is populated, hence max not sum.
  const attachmentCount =
    Math.max(composer.images.length, composer.persistedAttachments.length) +
    composer.files.length +
    composer.terminalContexts.length +
    composer.previewAnnotations.length +
    composer.reviewComments.length;
  const preview =
    promptPreview.length > 0
      ? promptPreview
      : `${attachmentCount} attachment${attachmentCount === 1 ? "" : "s"}`;
  const accessibility = resolveSidebarRowAccessibility({
    title: preview,
    statusLabel: "Unsent draft",
    projectDisplayName: props.projectDisplayName,
    isActive: props.isActive,
  });
  const handleActivate = useCallback(() => onNavigate(draftId), [draftId, onNavigate]);
  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      // Keys targeting the nested discard button belong to the button:
      // preventDefault here would swallow Space's synthesized click and
      // navigate instead of discarding.
      if ((event.target as HTMLElement).closest("button")) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onNavigate(draftId);
      }
    },
    [draftId, onNavigate],
  );
  const handleDiscard = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      onDiscard(draftId);
    },
    [draftId, onDiscard],
  );
  return (
    <li className="list-none py-0.5">
      <div
        role="button"
        tabIndex={0}
        aria-label={accessibility.label}
        aria-current={accessibility.current}
        data-testid="sidebar-draft-row"
        className={cn(
          "group/sidebar-row relative w-full cursor-pointer overflow-hidden rounded-md text-left text-sidebar-foreground outline-none select-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          props.isActive ? "bg-sidebar-row-active" : draftSurfaceClassName,
        )}
        onClick={handleActivate}
        onKeyDown={handleKeyDown}
      >
        <span className="sr-only">{preview}</span>
        <div className="relative z-10 h-[4.875rem] px-(--sidebar-row-content-inset) py-(--sidebar-content-inset)">
          <div className="flex h-5 min-w-0 items-center gap-1.5">
            <SquarePenIcon aria-hidden className={draftPenClassName} />
            {props.project ? (
              <ProjectFavicon project={props.project} className="size-4 shrink-0" />
            ) : null}
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-secondary-label">
              {props.projectDisplayName}
            </span>
            <span className="ml-auto flex h-5 min-w-5 shrink-0 items-center justify-end">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-label="Discard draft"
                      onClick={handleDiscard}
                      className="pointer-events-none inline-flex cursor-pointer items-center rounded-md bg-transparent px-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover/sidebar-row:pointer-events-auto group-hover/sidebar-row:opacity-100"
                    >
                      <XIcon className="size-3" />
                    </button>
                  }
                />
                <TooltipPopup side="top">Discard draft</TooltipPopup>
              </Tooltip>
            </span>
          </div>
          <div aria-hidden className="mt-0.5 truncate text-sm font-medium text-foreground/90">
            {preview}
          </div>
        </div>
      </div>
    </li>
  );
});

interface SidebarDraftRowData {
  draftId: DraftId;
  session: DraftSessionState;
  composer: ComposerThreadDraftState;
}

// Draft sessions with user content, surfaced above the pinned block so an
// interrupted "new thread" stays one click away. Self-contained (own store
// subscription + closing divider) so per-keystroke composer updates
// re-render only this block, never the whole sidebar. Vanishes at count 0.
const SidebarDraftBlock = memo(function SidebarDraftBlock(props: {
  projectByKey: ReadonlyMap<string, EnvironmentProject>;
  projectDisplayNameByKey: ReadonlyMap<string, string>;
  scopedProjectKeys: ReadonlySet<string> | null;
  routeDraftId: string | null;
  onNavigateToDraft: (draftId: DraftId) => void;
}) {
  const draftThreadsByThreadKey = useComposerDraftStore((store) => store.draftThreadsByThreadKey);
  const draftsByThreadKey = useComposerDraftStore((store) => store.draftsByThreadKey);
  const clearDraftThread = useComposerDraftStore((store) => store.clearDraftThread);
  // The open draft's row is FROZEN at the moment the draft became the route:
  // it stays visible (like a thread row) but never repaints while the user
  // types. A draft that was never navigated away from has no snapshot to
  // freeze, so a fresh typing session shows no row at all. Captured
  // synchronously on route change (setState-during-render derived state) so
  // the row never flickers out for a frame between route change and capture.
  const [frozenActive, setFrozenActive] = useState<{
    routeDraftId: string | null;
    row: SidebarDraftRowData | null;
  }>({ routeDraftId: null, row: null });
  if (frozenActive.routeDraftId !== props.routeDraftId) {
    let row: SidebarDraftRowData | null = null;
    if (props.routeDraftId !== null) {
      const draftId = DraftId.make(props.routeDraftId);
      const store = useComposerDraftStore.getState();
      const session = store.getDraftSession(draftId);
      const composer = store.getComposerDraft(draftId);
      row =
        session && session.promotedTo == null && composer && composerDraftHasUserContent(composer)
          ? { draftId, session, composer }
          : null;
    }
    setFrozenActive({ routeDraftId: props.routeDraftId, row });
  }
  const drafts = useMemo(() => {
    const rows: SidebarDraftRowData[] = [];
    // Every non-promoted session with content gets a row, mapped or not:
    // new-thread surfaces mint fresh drafts and leave invested ones behind
    // unmapped, so the mapping only knows about the latest per project.
    for (const [draftKey, session] of Object.entries(draftThreadsByThreadKey)) {
      if (session.promotedTo != null) {
        continue;
      }
      if (
        props.scopedProjectKeys !== null &&
        !props.scopedProjectKeys.has(`${session.environmentId}:${session.projectId}`)
      ) {
        continue;
      }
      if (draftKey === props.routeDraftId) {
        // Open draft: render the frozen entry snapshot, or nothing for a
        // draft that has never been left. Gated on the LIVE session above so
        // send/discard still removes the row immediately.
        if (frozenActive.routeDraftId === draftKey && frozenActive.row !== null) {
          rows.push(frozenActive.row);
        }
        continue;
      }
      const composer = draftsByThreadKey[draftKey];
      if (!composer || !composerDraftHasUserContent(composer)) {
        continue;
      }
      rows.push({ draftId: DraftId.make(draftKey), session, composer });
    }
    rows.sort((left, right) => right.session.createdAt.localeCompare(left.session.createdAt));
    return rows;
  }, [
    draftThreadsByThreadKey,
    draftsByThreadKey,
    frozenActive,
    props.routeDraftId,
    props.scopedProjectKeys,
  ]);
  const handleDiscard = useCallback(
    (draftId: DraftId) => {
      // The /draft/$draftId route redirects home on its own when the draft
      // it renders disappears, so discarding the open draft needs no
      // special-casing here.
      releaseComposerDraftUploads(draftId);
      clearDraftThread(draftId);
    },
    [clearDraftThread],
  );
  if (drafts.length === 0) {
    return null;
  }
  return (
    <>
      {drafts.map(({ composer, draftId, session }) => {
        const projectKey = `${session.environmentId}:${session.projectId}`;
        return (
          <SidebarDraftRow
            key={draftId}
            draftId={draftId}
            session={session}
            composer={composer}
            project={props.projectByKey.get(projectKey) ?? null}
            projectDisplayName={props.projectDisplayNameByKey.get(projectKey) ?? null}
            isActive={draftId === props.routeDraftId}
            onNavigate={props.onNavigateToDraft}
            onDiscard={handleDiscard}
          />
        );
      })}
      <li
        aria-hidden
        data-testid="sidebar-draft-divider"
        className="mx-2.5 my-1.5 h-px list-none bg-sidebar-border/60"
      />
    </>
  );
});

// Verb and icon on the lifted row while it hovers over another section. Uses
// the same icons as the row actions and context menu so the drop reads as the
// action it performs.
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

const SidebarThreadRow = memo(function SidebarThreadRow(props: {
  thread: SidebarThreadSummary;
  /** The tab the hidden-tabs row opens; the group thread still owns ordering and selection. */
  displayThread: SidebarThreadSummary;
  variant: "card" | "slim";
  // Slim rows are either settled (action: un-settle) or merely quiet
  // (seen Ready threads — action: settle).
  variantAction: "settle" | "unsettle" | "unsnooze";
  // False on environments whose server predates thread.settle/unsettle:
  // the lifecycle affordances hide entirely rather than fail on click.
  settlementSupported: boolean;
  // Same contract for thread.snooze/unsnooze.
  snoozeSupported: boolean;
  // Pinned threads show the same pin marker in active, settled, and snoozed
  // rows. The marker can unpin the thread when the server supports pinning.
  pinningSupported: boolean;
  isPinned: boolean;
  // Present on rows whose server supports every drop outcome: dnd-kit
  // sortable bag applied to the row root so the whole row drags (the
  // pointer sensor's distance constraint keeps plain clicks working).
  sortable?: SortableThreadRowBag | undefined;
  dropVerb: SidebarDropVerb | null;
  // While dragging, the pin marker stays only for a pinned thread still over
  // the pinned section. Any other position shows the verb badge instead, and
  // the badge carries its own icon.
  dragOverPinned: boolean;
  // Compact wake countdown ("2h") for rows in the snoozed shelf.
  snoozeWakeLabelText: string | null;
  // When a snooze ended (timer or early wake); drives the Woke pill until
  // the user visits the thread.
  wokeAt: string | null;
  isActive: boolean;
  // A sibling tab is the open route. The header stays present, but the active
  // pill belongs to that tab row.
  groupFocused?: boolean;
  openPullRequestsInRightPanel: boolean;
  jumpLabel: string | null;
  currentEnvironmentId: string | null;
  environmentLabel: string | null;
  environmentMachine: EnvironmentMachineKind;
  project: EnvironmentProject | null;
  projectDisplayName: string | null;
  providerEntryByInstanceId: ReadonlyMap<string, ProviderInstanceEntry>;
  timestampFormat: TimestampFormat;
  onThreadClick: (
    event: ReactMouseEvent,
    threadRef: ScopedThreadRef,
    keepOpenGroupTab?: boolean,
  ) => void;
  onThreadActivate: (threadRef: ScopedThreadRef, keepOpenGroupTab?: boolean) => void;
  onStartRename: (threadRef: ScopedThreadRef, title: string) => void;
  onRenameTitleChange: (title: string) => void;
  onCommitRename: (threadRef: ScopedThreadRef, title: string, originalTitle: string) => void;
  onCancelRename: () => void;
  isRenaming: boolean;
  renamingTitle: string;
  onContextMenu: (threadRef: ScopedThreadRef, position: { x: number; y: number }) => void;
  onSettle: (threadRef: ScopedThreadRef) => void;
  onUnsettle: (threadRef: ScopedThreadRef) => void;
  onSnooze: (threadRef: ScopedThreadRef, preset: Pick<SnoozePreset, "snoozedUntil">) => void;
  onUnsnooze: (threadRef: ScopedThreadRef) => void;
  onUnpin: (threadRef: ScopedThreadRef) => void;
  onPin: (threadRef: ScopedThreadRef) => void;
  onAcknowledgeWoke: (threadRef: ScopedThreadRef, visitedAt: string) => void;
  /**
   * External files dropped onto this row. The row highlights while the drag
   * is over it; the callback opens the thread and hands the files to its
   * composer. Absent when the sidebar cannot open server threads.
   */
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
  /** Opens or folds this group's tabs. Absent where the row has no tabs. */
  onToggleTabs?: ((rowThreadKey: string) => void) | undefined;
  /** A tab list finished opening or closing, so rows below it have moved. */
  onTabsResized?: (() => void) | undefined;
}) {
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
    onSnooze,
    onStartRename,
    onThreadActivate,
    onThreadClick,
    onUnsettle,
    onUnsnooze,
    onUnpin,
    onPin,
    openPullRequestsInRightPanel,
    renamingTitle,
    displayThread: thread,
    variant,
    variantAction,
  } = props;
  const threadRef = useMemo(
    () => scopeThreadRef(thread.environmentId, thread.id),
    [thread.environmentId, thread.id],
  );
  const rowThreadRef = useMemo(
    () => scopeThreadRef(props.thread.environmentId, props.thread.id),
    [props.thread.environmentId, props.thread.id],
  );
  const rowThreadKey = scopedThreadKey(rowThreadRef);
  const threadKey = scopedThreadKey(threadRef);
  const { leaseLiveStatus, rowRef } = useSidebarRowSubscriptionLease(props.isActive);
  const isRegeneratingTitle = thread.titleRegeneration != null;
  const lastVisitedAt = useUiStateStore((state) => state.threadLastVisitedAtById[threadKey]);
  const rowLastVisitedAt = useUiStateStore((state) => state.threadLastVisitedAtById[rowThreadKey]);
  const isSelected = useThreadSelectionStore((state) => state.selectedThreadKeys.has(rowThreadKey));
  const openPrLink = useOpenPrLink();
  const runningTerminalIds = useThreadRunningTerminalIds({
    environmentId: thread.environmentId,
    threadId: thread.id,
  });
  const terminalStatus = terminalStatusFromRunningIds(runningTerminalIds);
  const terminalProcessCount = runningTerminalIds.length;
  // Unsent composer text on this thread. The open thread shows its own
  // composer, so the marker only decorates rows you have navigated away from.
  const hasUnsentDraft = useThreadHasUnsentDraft(threadRef) && !props.isActive;
  const clearComposerContent = useComposerDraftStore((store) => store.clearComposerContent);
  const handleDiscardDraftClick = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      releaseComposerDraftUploads(threadRef);
      clearComposerContent(threadRef);
    },
    [clearComposerContent, threadRef],
  );

  const gitCwd = thread.worktreePath ?? props.project?.workspaceRoot ?? null;
  const linkedPullRequestStatus = useLinkedThreadPullRequest(
    thread.environmentId,
    thread.linkedPullRequest,
    leaseLiveStatus,
    thread.pullRequests,
    thread.branchPullRequest,
  );
  const gitStatus = useEnvironmentQuery(
    leaseLiveStatus && (thread.branch != null || thread.worktreePath !== null) && gitCwd !== null
      ? vcsEnvironment.status({
          environmentId: thread.environmentId,
          input: { cwd: gitCwd },
        })
      : null,
  );
  const visibleGitStatus = useRetainedValue(
    JSON.stringify([thread.environmentId, gitCwd]),
    gitStatus.data,
  );
  const pr = linkedPullRequestStatus?.pr ?? null;
  const supportsMultiplePullRequests = useSupportsMultiplePullRequests(thread.environmentId);
  const currentLinkedPr = supportsMultiplePullRequests
    ? resolveThreadCurrentPullRequestLink(thread.pullRequests)
    : null;

  // Same semantics as the legacy sidebar (never-visited counts as read):
  // switching sidebars must not light up every historical thread as unread.
  const isUnread = hasUnseenCompletion({ ...thread, lastVisitedAt });
  const status = resolveSidebarThreadStatus(thread);
  // A woken thread reappears at its original position (the sort is
  // deliberately static), so the pill has to carry the weight. Snoozing is
  // an explicit act, so the pill clears only when the user re-engages:
  // reading a completion-triggered wake, clicking the pill, sending a
  // message, settling, archiving, or a change request state that settles the
  // thread. Timer wakes survive a mere visit. An unparseable visit timestamp
  // counts as never-visited, so corrupt local data cannot eat the wake signal.
  const lastVisitedDate =
    rowLastVisitedAt === undefined ? null : parseTimestampDate(rowLastVisitedAt);
  const wokeAtDate = props.wokeAt === null ? null : parseTimestampDate(props.wokeAt);
  const isWoke =
    wokeAtDate !== null &&
    (lastVisitedDate === null || lastVisitedDate < wokeAtDate) &&
    props.thread.settledOverride !== "settled";
  // Background work always recedes when it is not selected: an unread parent
  // completion must not pull a still-working thread back into the foreground.
  // Ready and action-required rows keep their unread and wake prominence.
  const shouldRecede = shouldRecedeSidebarThread({
    status,
    isUnread,
    isWoke,
    isActive: props.isActive || props.groupFocused === true,
    isSelected,
  });
  const topStatus = resolveSidebarTopStatus(status, isWoke, isUnread);
  const isWokeStatus = topStatus?.icon === "woke";

  const branchMismatch = resolveLocalCheckoutBranchMismatch({
    effectiveEnvMode: thread.worktreePath === null ? "local" : "worktree",
    activeWorktreePath: thread.worktreePath,
    activeThreadBranch: thread.branch,
    currentGitBranch: visibleGitStatus?.refName ?? null,
  });
  const prStatus = prStatusIndicator(pr, linkedPullRequestStatus?.sourceControlProvider);

  // An unsent composer pick wins, so the icon follows the composer before the next turn.
  const draftModelSelection = useComposerDraftActiveModelSelection(threadRef);
  const modelSelection = draftModelSelection ?? thread.modelSelection;
  const modelInstanceId =
    draftModelSelection?.instanceId ??
    thread.session?.providerInstanceId ??
    thread.modelSelection.instanceId;
  const providerEntry = props.providerEntryByInstanceId.get(modelInstanceId) ?? null;
  const driverKind = providerEntry?.driverKind ?? null;
  const showInstanceBadge =
    providerEntry !== null &&
    shouldShowInstanceBadge(providerEntry, props.providerEntryByInstanceId.values());
  const selectedModel = providerEntry?.models.find((model) => model.slug === modelSelection.model);
  const modelLabel = selectedModel
    ? getTriggerDisplayModelLabel(selectedModel)
    : modelSelection.model;

  // The local environment is "this machine" and needs no marker; every other
  // one gets its machine glyph. With no local environment (the hosted app)
  // that is every thread, which is the point: the glyph is what tells rows on
  // different machines apart.
  const isRemote = thread.environmentId !== props.currentEnvironmentId;

  const detailsTooltip = (
    <SidebarThreadTooltip
      thread={thread}
      project={props.project}
      projectDisplayName={props.projectDisplayName}
      environmentLabel={props.environmentLabel}
      environmentMachine={props.environmentMachine}
      providerEntry={providerEntry}
      showInstanceBadge={showInstanceBadge}
      modelInstanceId={modelInstanceId}
      modelLabel={modelLabel}
      branchMismatch={branchMismatch}
      terminalStatus={terminalStatus}
      terminalProcessCount={terminalProcessCount}
    />
  );

  const handleClick = useCallback(
    (event: ReactMouseEvent) => {
      // The group header stands for every tab. A tab already open in it stays open.
      onThreadClick(event, rowThreadRef, true);
    },
    [onThreadClick, rowThreadRef],
  );
  const handleAcknowledgeWokeClick = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (props.wokeAt === null) return;
      onAcknowledgeWoke(rowThreadRef, props.wokeAt);
    },
    [onAcknowledgeWoke, props.wokeAt, rowThreadRef],
  );
  const handleContextMenu = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault();
      onContextMenu(threadRef, { x: event.clientX, y: event.clientY });
    },
    [onContextMenu, threadRef],
  );
  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      if (event.target !== event.currentTarget) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      onThreadActivate(rowThreadRef, true);
    },
    [onThreadActivate, rowThreadRef],
  );
  const handleDoubleClick = useCallback(
    (event: ReactMouseEvent) => {
      if (isRenaming || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      // The title lives on the first tab row, which owns rename.
      if (variant === "card" && props.tabsOpen && props.tabs != null) return;
      if ((event.target as HTMLElement).closest("button, a, input")) return;
      event.preventDefault();
      onStartRename(threadRef, thread.title);
    },
    [isRenaming, onStartRename, props.tabs, props.tabsOpen, thread.title, threadRef, variant],
  );
  const [isFileDragOver, setIsFileDragOver] = useState(false);
  const fileDropHandlers = useMemo(
    () =>
      onFileDropThreads
        ? makeWorkspaceFileDropHandlers({
            setDragActive: setIsFileDragOver,
            addFiles: (files) => {
              onFileDropThreads(threadRef, files);
            },
            addFolders: () => {},
          })
        : null,
    [onFileDropThreads, threadRef],
  );
  // A drop lands on a child or outside the window entirely, so dragend is
  // the reset of last resort for the row's highlight.
  useEffect(() => {
    if (!isFileDragOver) return;
    const clearFileDrag = () => setIsFileDragOver(false);
    window.addEventListener("dragend", clearFileDrag);
    return () => window.removeEventListener("dragend", clearFileDrag);
  }, [isFileDragOver]);
  const handleSettleClick = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      onSettle(rowThreadRef);
    },
    [onSettle, rowThreadRef],
  );
  const handleNewTabClick = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      onNewTab?.(threadRef);
    },
    [onNewTab, threadRef],
  );
  const handleUnsettleClick = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      onUnsettle(rowThreadRef);
    },
    [onUnsettle, rowThreadRef],
  );
  const handleUnsnoozeClick = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      onUnsnooze(rowThreadRef);
    },
    [onUnsnooze, rowThreadRef],
  );
  const handleUnpinClick = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      onUnpin(rowThreadRef);
    },
    [onUnpin, rowThreadRef],
  );
  const handlePinClick = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      onPin(rowThreadRef);
    },
    [onPin, rowThreadRef],
  );
  const handleSnoozePreset = useCallback(
    (preset: Pick<SnoozePreset, "snoozedUntil">) => {
      onSnooze(rowThreadRef, preset);
    },
    [onSnooze, rowThreadRef],
  );
  // While the snooze popover is open the pointer leaves the row, which
  // would fade the hover actions out from under the open menu. Pin them and
  // suppress the row tooltip so its portal cannot overlap the popover.
  const [snoozeMenuOpenRaw, setSnoozeMenuOpen] = useState(false);
  // Snooze is offered only where it can succeed: capability-gated and never
  // on blocked-on-you work or queued turns (the server rejects both).
  const showSnoozeButton =
    props.snoozeSupported && canSnooze(props.thread, { now: new Date().toISOString() });
  // If the thread becomes blocked while the popover is open, the button
  // unmounts without firing onOpenChange(false). Deriving the flag keeps a
  // stale true from permanently hiding the status label / pinning the
  // hover actions, and the effect clears the raw state so the popover
  // doesn't resurrect if the button later remounts.
  const snoozeMenuOpen = snoozeMenuOpenRaw && showSnoozeButton;
  useEffect(() => {
    if (!showSnoozeButton) setSnoozeMenuOpen(false);
  }, [showSnoozeButton]);
  const handlePrClick = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      const url = pr?.url ?? currentLinkedPr?.url;
      if (!url) return;
      const openedInRightPanel = openPrLink(
        event,
        url,
        openPullRequestsInRightPanel ? threadRef : undefined,
      );
      if (openedInRightPanel && openPullRequestsInRightPanel && !props.isActive) {
        onThreadActivate(threadRef);
      }
    },
    [
      onThreadActivate,
      openPrLink,
      openPullRequestsInRightPanel,
      pr,
      currentLinkedPr,
      props.isActive,
      threadRef,
    ],
  );

  // All sidebar rows share one surface model. Live threads used to look
  // like elevated cards while settled threads were plain rows, leaving neither
  // a useful hierarchy nor a reliable hover cue. Status now lives in the row
  // content; surface is reserved for interaction (hover, multi-select, route).
  // An open tab list includes this thread as its first row, so the card is only
  // the group header. The active tab carries the highlight.
  const unifyTabs = variant === "card" && props.tabsOpen && props.tabs != null;
  const rowActive = props.isActive && !unifyTabs;
  // Each listed tab shows its own status, so the header would only repeat the
  // first tab's and read as the whole group's. Woke belongs to the group.
  const headerStatus = unifyTabs && !isWokeStatus ? null : topStatus;
  const rowSurfaceClassName = cn(
    "group/sidebar-row relative w-full cursor-pointer overflow-hidden rounded-md text-left outline-none select-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
    variantAction === "unsettle" && "[&:not(:hover):not(:focus-within)_*]:text-secondary-label/70",
    rowActive
      ? "bg-sidebar-row-active text-sidebar-foreground"
      : isSelected
        ? "bg-sidebar-row-selected text-sidebar-foreground"
        : hasUnsentDraft
          ? cn(draftSurfaceClassName, "text-sidebar-foreground")
          : shouldRecede
            ? "text-sidebar-muted-foreground/75 hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
            : "bg-transparent text-sidebar-foreground hover:bg-sidebar-row-hover",
    // Background work fades as a whole row, status label included, so it
    // takes less attention than rows that need a human (input, approval).
    shouldRecede &&
      (status === "working" || status === "monitoring") &&
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
  // dnd-kit props for the row root. Same bag on both variants: every row in
  // the list translates around the gap as the drag passes it.
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
  const dragDestination =
    sortable?.isDragging && props.dropVerb !== null ? (
      <span
        role="status"
        className="pointer-events-none ml-auto inline-flex h-5 shrink-0 items-center gap-1 rounded-sm border border-primary/40 bg-primary/10 px-1.5 text-2xs font-medium text-primary"
      >
        {dropVerbBadge[props.dropVerb]}
      </span>
    ) : null;

  const accessibility = resolveSidebarRowAccessibility({
    title: thread.title,
    statusLabel: headerStatus?.label ?? null,
    projectDisplayName: props.projectDisplayName,
    isActive: rowActive,
  });

  const title = isRenaming ? (
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
        "min-w-0 flex-1 text-sm transition-opacity motion-reduce:transition-none",
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
    >
      {thread.title}
    </span>
  );
  const accessibleTitle = isRenaming ? null : <span className="sr-only">{thread.title}</span>;

  // Stacks show their layer count; multiple unrelated links show their total count.
  // Either opens the thread's pull requests tab; a single PR link opens that PR and still
  // supports opening the host in a new tab.
  const prBadgeShape = supportsMultiplePullRequests
    ? resolveThreadPullRequestBadge(thread.pullRequests)
    : null;
  const handlePrListClick = useCallback(() => {
    useRightPanelStore.getState().open(threadRef, "pull-requests");
    if (!props.isActive) onThreadActivate(threadRef);
  }, [onThreadActivate, props.isActive, threadRef]);
  const prBadge =
    prBadgeShape?.kind === "stack" || pr || currentLinkedPr ? (
      <ThreadPullRequestBadgeControl
        render={<InlineButton />}
        badge={prBadgeShape}
        number={pr?.number ?? currentLinkedPr?.number}
        url={pr?.url ?? currentLinkedPr?.url}
        status={prStatus}
        onOpenList={handlePrListClick}
        onOpenPullRequest={handlePrClick}
      />
    ) : null;
  const terminalStatusIcon = terminalStatus ? (
    <span
      role="img"
      aria-label={terminalProcessLabel(terminalProcessCount)}
      data-testid={`sidebar-terminal-status-${thread.id}`}
      className={cn("inline-flex shrink-0 items-center justify-center", terminalStatus.colorClass)}
    >
      <TerminalIcon
        className={cn("size-3.5", terminalStatus.pulse && "motion-safe:animate-status-pulse")}
        onAnimationStart={synchronizeTerminalPulse}
      />
    </span>
  ) : null;
  // Same pen the new-thread draft rows lead with, so both kinds of unsent
  // work read the same way in the list.
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
  const onToggleTabs = props.onToggleTabs;
  const handleToggleTabsClick = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      onToggleTabs?.(rowThreadKey);
    },
    [onToggleTabs, rowThreadKey],
  );
  const tabCountBadge =
    props.tabCount > 1 ? (
      <SidebarTabCountBadge
        count={props.tabCount}
        toggleCount={props.tabToggleCount}
        open={props.tabsOpen}
        onToggle={onToggleTabs ? handleToggleTabsClick : undefined}
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
    props.pinningSupported && !sortable?.isDragging ? (
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label="Unpin thread"
              onClick={handleUnpinClick}
              className={cn(
                "inline-flex cursor-pointer items-center rounded-sm text-muted-foreground/65 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                variant === "card" && "-mr-1 self-center px-1.5",
              )}
            />
          }
        >
          <PinIcon aria-hidden className="size-3 shrink-0" />
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

  // An agent started this thread; the chat header says which one.
  const agentIndicator =
    props.thread.createdBy != null ? (
      <BotIcon
        aria-label="Started by an agent"
        role="img"
        className="size-3 shrink-0 text-muted-foreground/65"
      />
    ) : null;

  if (variant === "slim") {
    return (
      <li
        data-thread-item
        {...sortableRootProps}
        className={cn(
          // Matches the h-9 row so unrendered rows never shift the list when they paint.
          "list-none [content-visibility:auto] [contain-intrinsic-size:auto_36px]",
          sortable?.isDragging && "relative z-20",
        )}
      >
        <Tooltip disabled={sortable?.isDragging}>
          <TooltipTrigger
            render={
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
              />
            }
          >
            {accessibleTitle}
            {/* Settled history recedes: dimmed favicon at rest, restored on
              hover so the tail stays scannable when you're hunting. */}
            <span
              className={cn(
                "shrink-0 transition-opacity",
                (!props.isActive || variantAction === "unsettle") &&
                  "opacity-40 grayscale group-focus-within/sidebar-row:opacity-100 group-focus-within/sidebar-row:grayscale-0 group-hover/sidebar-row:opacity-100 group-hover/sidebar-row:grayscale-0",
              )}
            >
              {props.project ? <ProjectFavicon project={props.project} className="size-4" /> : null}
            </span>
            {draftIndicator}
            {title}
            {tabCountBadge}
            {agentIndicator}
            {pinIndicator}
            {terminalStatusIcon}
            {isRegeneratingTitle ? (
              <span role="status" className="sr-only">
                Regenerating title
              </span>
            ) : null}
            {/* The PR badge stays outside the hover-fading slot: it must
              remain visible AND clickable while the row is hovered. Only
              the time/jump label yields to the settle affordance. */}
            {prBadge}
            {sortable?.isDragging ? (
              dragDestination
            ) : (
              <span className="relative ml-auto flex h-6 min-w-8 shrink-0 items-center justify-end">
                <span
                  className={cn(
                    "inline-flex justify-end tabular-nums text-secondary-label transition-opacity",
                    !isWoke && "group-hover/sidebar-row:opacity-0",
                  )}
                >
                  {variantAction === "unsnooze" && props.snoozeWakeLabelText !== null ? (
                    // Snoozed rows show when they come BACK, not when they were
                    // last touched — the return ticket is the row's whole story.
                    <span className="text-xs text-info-foreground tabular-nums">
                      {props.snoozeWakeLabelText}
                    </span>
                  ) : isWoke ? (
                    // A wake can land straight in the settled tail (e.g. PR
                    // merged while snoozed); the signal must survive the trip.
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <button
                            type="button"
                            aria-label="Dismiss Woke notification"
                            onClick={handleAcknowledgeWokeClick}
                            className="inline-flex cursor-pointer items-center gap-1 rounded-sm text-xs font-medium text-warning-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
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
                      {variantAction === "unsettle"
                        ? settledTimeLabel(thread)
                        : threadTimeLabel(thread)}
                    </span>
                  )}
                </span>
                {variantAction === "unsnooze" ? (
                  !props.snoozeSupported ? null : (
                    <button
                      type="button"
                      aria-label="Wake thread now"
                      onClick={handleUnsnoozeClick}
                      className={cn(
                        "pointer-events-none absolute inset-y-0 right-0 -mr-1 inline-flex cursor-pointer items-center gap-1 rounded-md bg-transparent px-1.5 text-xs text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover/sidebar-row:pointer-events-auto group-hover/sidebar-row:opacity-100",
                        isWoke && "group-hover/sidebar-row:static",
                      )}
                    >
                      <AlarmClockOffIcon className="mb-px size-3" />
                    </button>
                  )
                ) : !props.settlementSupported ? null : variantAction === "unsettle" ? (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <button
                          type="button"
                          aria-label="Un-settle thread"
                          onClick={handleUnsettleClick}
                          className={cn(
                            "pointer-events-none absolute inset-y-0 right-0 -mr-1 inline-flex cursor-pointer items-center gap-1 rounded-md bg-transparent px-1.5 text-xs text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover/sidebar-row:pointer-events-auto group-hover/sidebar-row:opacity-100",
                            isWoke && "group-hover/sidebar-row:static",
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
                    className={cn(
                      "pointer-events-none absolute inset-y-0 right-0 inline-flex cursor-pointer items-center gap-1 rounded-md bg-transparent px-2 text-xs text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover/sidebar-row:pointer-events-auto group-hover/sidebar-row:opacity-100",
                      isWoke && "group-hover/sidebar-row:static",
                    )}
                  >
                    <CheckIcon className="size-3" />
                  </button>
                )}
              </span>
            )}
            {props.jumpLabel ? <JumpHintBadge label={props.jumpLabel} /> : null}
          </TooltipTrigger>
          {detailsTooltip}
        </Tooltip>
        {tabList}
      </li>
    );
  }

  const diff = latestTurnDiff(thread);

  return (
    <li
      data-thread-item
      {...sortableRootProps}
      className={cn(
        // Matches the content box; the py-0.5 padding is added on top. An open
        // tab list drops the title line, so the header is only project and branch.
        "list-none py-0.5 [content-visibility:auto]",
        unifyTabs ? "[contain-intrinsic-size:auto_52px]" : "[contain-intrinsic-size:auto_78px]",
        sortable?.isDragging && "relative z-20",
      )}
    >
      <Tooltip disabled={snoozeMenuOpen || sortable?.isDragging}>
        <TooltipTrigger
          render={
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
            />
          }
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
                <span className="ml-auto flex h-5 shrink-0 items-stretch justify-end text-xs">
                  <span className="group/sidebar-status-slot relative flex h-5 min-w-8 items-stretch justify-end">
                    {/* Read-only status labels yield to the hover actions. Woke is
                    itself an action, so it stays pointer-enabled and visible
                    while the other controls appear beside it. */}
                    <span
                      className={cn(
                        isWokeStatus
                          ? "pointer-events-auto"
                          : "pointer-events-none group-has-[:focus-visible]/sidebar-status-slot:absolute group-has-[:focus-visible]/sidebar-status-slot:right-0 group-has-[:focus-visible]/sidebar-status-slot:opacity-0 group-hover/sidebar-row:absolute group-hover/sidebar-row:right-0 group-hover/sidebar-row:opacity-0",
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
                                    "inline-flex cursor-pointer items-center gap-1 rounded-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring",
                                    headerStatus.className,
                                  )}
                                >
                                  <AlarmClockIcon aria-hidden className="size-4 shrink-0" />
                                  <span role="status">{headerStatus.label}</span>
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
                            <span role="status">{headerStatus.label}</span>
                            {status === "working" ? (
                              <span aria-hidden>
                                <WorkingDuration startedAt={resolveWorkingStartedAt(thread)} />
                              </span>
                            ) : null}
                          </span>
                        )
                      ) : unifyTabs ? null : (
                        threadTimeLabel(thread)
                      )}
                    </span>
                    {props.settlementSupported ||
                    showSnoozeButton ||
                    hasUnsentDraft ||
                    onNewTab ||
                    showUnpinnedPinAction ? (
                      <span
                        className={cn(
                          // focus-visible, not focus-within: a mouse click leaves
                          // the Settle button focused, and a plain focus-within
                          // would keep the controls pinned over the status label
                          // once the pointer moves away (e.g. after a failed
                          // settle) instead of cross-fading back.
                          "pointer-events-none absolute inset-y-0 right-0 flex items-stretch opacity-0 transition-opacity has-[:focus-visible]:pointer-events-auto has-[:focus-visible]:static has-[:focus-visible]:opacity-100 group-hover/sidebar-row:pointer-events-auto group-hover/sidebar-row:static group-hover/sidebar-row:opacity-100",
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
                        {props.settlementSupported ? (
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <button
                                  type="button"
                                  aria-label="Settle thread"
                                  onClick={handleSettleClick}
                                  className={cn(
                                    "inline-flex cursor-pointer items-center gap-1 rounded-md bg-transparent px-1.5 text-xs text-muted-foreground hover:text-foreground",
                                    // The pin owns the trailing inset when it is present.
                                    !showPin && !showUnpinnedPinAction && "-mr-1",
                                  )}
                                />
                              }
                            >
                              <CheckIcon className="size-3.5" />
                              Settle
                            </TooltipTrigger>
                            <TooltipPopup>Settle thread</TooltipPopup>
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
            </div>
            {/* An open tab list starts with this thread, so its title moves there. */}
            {props.tabs != null ? (
              <SidebarDisclosure open={!unifyTabs}>
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
              ) : (
                <span className="flex-1" />
              )}
              {tabCountBadge}
              {unifyTabs ? null : terminalStatusIcon}
              {prBadge}
              {diff ? (
                <span className="shrink-0 font-mono">
                  <span className="text-diff-addition-foreground">+{diff.insertions}</span>{" "}
                  <span className="text-diff-deletion-foreground">−{diff.deletions}</span>
                </span>
              ) : null}
              <span
                aria-hidden
                className="pointer-events-none ml-auto inline-flex shrink-0 items-center gap-1"
              >
                {isRemote ? (
                  <span className="inline-flex shrink-0 items-center text-sidebar-muted-foreground/70">
                    <EnvironmentMachineIcon
                      aria-hidden
                      kind={props.environmentMachine}
                      className="size-3.5"
                    />
                  </span>
                ) : null}
                {driverKind && !unifyTabs ? (
                  <span className="inline-flex shrink-0 items-center">
                    <ProviderInstanceIcon
                      driverKind={driverKind}
                      displayName={
                        providerEntry?.displayName ??
                        thread.session?.providerName ??
                        modelInstanceId
                      }
                      accentColor={providerEntry?.accentColor}
                      showBadge={showInstanceBadge}
                      // Glyph dims, badge stays saturated; offset matches the composer trigger.
                      iconClassName="size-3.5 opacity-60"
                      badgeClassName="right-[-0.1875rem] bottom-[-0.1875rem] h-3 min-w-3 px-0.5 text-5xs"
                    />
                  </span>
                ) : null}
              </span>
            </div>
          </div>
          {unifyTabs || !props.jumpLabel ? null : <JumpHintBadge label={props.jumpLabel} />}
        </TooltipTrigger>
        {detailsTooltip}
      </Tooltip>
      {tabList}
    </li>
  );
});

/** Inline title editor, mounted only while a row is being renamed. */
function SidebarRenameInput(props: {
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

/** The group's tab count. With `onToggle`, it opens and folds that group's tabs. */
function SidebarTabCountBadge(props: {
  count: number;
  toggleCount: number;
  open: boolean;
  onToggle?: ((event: ReactMouseEvent) => void) | undefined;
}) {
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
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            aria-expanded={props.open}
            data-testid="sidebar-tab-group-toggle"
            onClick={props.onToggle}
            onDoubleClick={(event) => event.stopPropagation()}
            className={cn(
              className,
              "-mx-1 cursor-pointer rounded-sm px-1 outline-none transition-colors hover:bg-sidebar-row-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
            )}
          />
        }
      >
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
      </TooltipTrigger>
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
    else animation.addEventListener("finish", () => flushSync(settle), { once: true });
  }, [open, onSettled]);
  useEffect(() => () => animationRef.current?.cancel(), []);
  if (!mounted) return null;
  return (
    <div ref={ref} className="overflow-hidden">
      {props.children}
    </div>
  );
}

/**
 * A group's tabs under its header, including the thread the row stands for. Tabs drag within
 * the list in their own drag context, so picking one up never drags the whole group, and they
 * move with the thread list's motion when a sort, the limit or a drop changes their order.
 */
function SidebarTabList(props: {
  /** Sortable ids of the rendered tabs, in display order. */
  tabKeys: readonly string[];
  /** Changes when the "more" row appears, disappears or flips, so its move animates too. */
  overflowKey: string;
  onReorder: (activeKey: string, overKey: string) => void;
  /** The pointer entered or left the list; a live sort holds still while it rests here. */
  onPointerRestChange: (resting: boolean) => void;
  /** The list's height may have changed; rows below it re-measure and glide. */
  onLayoutChange: () => void;
  children: ReactNode;
}) {
  const { onLayoutChange, onReorder } = props;
  const motionRef = useRef<ReturnType<typeof createSidebarListMotion> | null>(null);
  const attachMotionRef = useCallback((node: HTMLUListElement | null) => {
    motionRef.current?.dispose();
    motionRef.current = node === null ? null : createSidebarListMotion(node);
    motionRef.current?.update(false);
  }, []);
  const [dragging, setDragging] = useState(false);
  const sensorRef = useRef<SidebarPointerSensor | null>(null);
  const finishDrag = useCallback((started: boolean) => {
    sensorRef.current = null;
    if (!started) return;
    // Rows glide from where the drag left them into their committed slots.
    motionRef.current?.release();
    setDragging(false);
  }, []);
  const attachSensor = useCallback((sensor: SidebarPointerSensor) => {
    sensorRef.current = sensor;
  }, []);
  useEffect(() => () => sensorRef.current?.cancel(), []);
  const sensors = useSensors(
    useSensor(SidebarPointerSensor, {
      distance: 6,
      onAttach: attachSensor,
      onFinish: finishDrag,
    }),
  );
  const orderKey = `${props.tabKeys.join("\0")}\0${props.overflowKey}`;
  // A list that just mounted is opening inside its disclosure, which owns that height change.
  const mountedRef = useRef(false);
  useLayoutEffect(() => {
    void orderKey;
    if (dragging) return;
    motionRef.current?.update(true);
    if (mountedRef.current) onLayoutChange();
    mountedRef.current = true;
  }, [dragging, onLayoutChange, orderKey]);
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      onDragStart={() => {
        motionRef.current?.suspend();
        setDragging(true);
      }}
      onDragEnd={(event) => {
        if (event.over !== null && event.over.id !== event.active.id) {
          onReorder(String(event.active.id), String(event.over.id));
        }
      }}
    >
      <SortableContext items={[...props.tabKeys]} strategy={verticalListSortingStrategy}>
        <ul
          ref={attachMotionRef}
          role="presentation"
          onPointerEnter={() => props.onPointerRestChange(true)}
          onPointerLeave={() => props.onPointerRestChange(false)}
          className="relative ms-[calc(var(--sidebar-row-content-inset)+0.4375rem)] flex flex-col gap-px border-s border-sidebar-border ps-1 pb-0.5"
        >
          {props.children}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

/**
 * The tabs folded behind a group's collapsed "n more" row, in the same order and with the same
 * title, status, time, and provider as the list they would join. Clicking one opens it.
 */
function SidebarTabOverflowPreview(props: {
  hidden: readonly SidebarThreadSummary[];
  providerEntriesByEnvironment: ReadonlyMap<string, ReadonlyMap<string, ProviderInstanceEntry>>;
  tabSortOrder: SidebarTabSortOrder;
  openedAtByThreadKey: Readonly<Record<string, number>>;
  onOpenTab: (threadRef: ScopedThreadRef) => void;
}) {
  const lastVisitedAtById = useUiStateStore((state) => state.threadLastVisitedAtById);
  return (
    <ul
      aria-label={`${props.hidden.length} more tabs`}
      data-testid="sidebar-tab-overflow-preview"
      className="flex max-h-80 flex-col gap-px overflow-y-auto overscroll-contain"
    >
      {props.hidden.map((thread) => {
        const threadKey = sidebarThreadKey(thread);
        const entries = props.providerEntriesByEnvironment.get(thread.environmentId);
        const instanceId = thread.session?.providerInstanceId ?? thread.modelSelection.instanceId;
        const providerEntry = entries?.get(instanceId) ?? null;
        const showInstanceBadge =
          providerEntry !== null &&
          entries !== undefined &&
          shouldShowInstanceBadge(providerEntry, entries.values());
        const isUnread = hasUnseenCompletion({
          ...thread,
          lastVisitedAt: lastVisitedAtById[threadKey],
        });
        const status = resolveSidebarThreadStatus(thread);
        const topStatus = resolveSidebarTopStatus(status, false, isUnread);
        const shouldRecede = shouldRecedeSidebarThread({
          status,
          isUnread,
          isWoke: false,
          isActive: false,
          isSelected: false,
        });
        const timeLabel =
          tabSortTimeLabel(thread, props.tabSortOrder, props.openedAtByThreadKey[threadKey]) ??
          threadTimeLabel(thread);
        return (
          <li key={threadKey} className="list-none">
            <button
              type="button"
              onClick={() => props.onOpenTab(scopeThreadRef(thread.environmentId, thread.id))}
              className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-sm",
                  shouldRecede
                    ? "text-secondary-label"
                    : isUnread || status === "input"
                      ? "text-foreground"
                      : "text-foreground/85",
                )}
              >
                {thread.title}
              </span>
              {topStatus ? (
                <span
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1 text-xs font-medium",
                    topStatus.className,
                  )}
                >
                  <SidebarTopStatusIcon icon={topStatus.icon} className="size-3.5 shrink-0" />
                  <span>{topStatus.label}</span>
                </span>
              ) : null}
              <span className="shrink-0 text-xs tabular-nums text-secondary-label">
                {timeLabel}
              </span>
              {providerEntry ? (
                <span aria-hidden className="inline-flex shrink-0 items-center">
                  <ProviderInstanceIcon
                    driverKind={providerEntry.driverKind}
                    displayName={providerEntry.displayName}
                    accentColor={providerEntry.accentColor}
                    showBadge={showInstanceBadge}
                    iconClassName="size-3.5 opacity-60"
                    badgeClassName="right-[-0.1875rem] bottom-[-0.1875rem] h-3 min-w-3 px-0.5 text-5xs"
                  />
                </span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Stands in for a group's tabs past the limit. It names what it hides that needs you, and the
 * providers behind them, so folding tabs away never hides work in progress. Hovering the
 * collapsed row lists those tabs.
 */
function SidebarTabOverflowRow(props: {
  hidden: readonly SidebarThreadSummary[];
  expanded: boolean;
  providerEntriesByEnvironment: ReadonlyMap<string, ReadonlyMap<string, ProviderInstanceEntry>>;
  tabSortOrder: SidebarTabSortOrder;
  openedAtByThreadKey: Readonly<Record<string, number>>;
  onToggle: () => void;
  onOpenTab: (threadRef: ScopedThreadRef) => void;
  onPreviewOpenChange?: ((open: boolean) => void) | undefined;
}) {
  const { hidden, providerEntriesByEnvironment } = props;
  const summary = useMemo(() => {
    // Most urgent first, the same precedence as a row's own status.
    const precedence = ["approval", "input", "failed", "working", "monitoring"] as const;
    const counts = new Map<string, number>();
    for (const thread of hidden) {
      const status = resolveSidebarThreadStatus(thread);
      counts.set(status, (counts.get(status) ?? 0) + 1);
    }
    const status = precedence.find((candidate) => counts.has(candidate)) ?? null;
    const topStatus = status === null ? null : resolveSidebarTopStatus(status, false, false);
    const providers = new Map<
      string,
      { driverKind: ProviderInstanceEntry["driverKind"]; displayName: string }
    >();
    for (const thread of hidden) {
      const instanceId = thread.session?.providerInstanceId ?? thread.modelSelection.instanceId;
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
  }, [hidden, providerEntriesByEnvironment]);
  const label = props.expanded ? "Show less" : `${hidden.length} more`;
  const onPreviewOpenChangeRef = useRef(props.onPreviewOpenChange);
  onPreviewOpenChangeRef.current = props.onPreviewOpenChange;
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
            className="w-80 max-w-[calc(100vw-2rem)] p-1"
          >
            <SidebarTabOverflowPreview
              hidden={hidden}
              providerEntriesByEnvironment={providerEntriesByEnvironment}
              tabSortOrder={props.tabSortOrder}
              openedAtByThreadKey={props.openedAtByThreadKey}
              onOpenTab={props.onOpenTab}
            />
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
const SidebarTabRow = memo(function SidebarTabRow(props: {
  thread: SidebarThreadSummary;
  isActive: boolean;
  jumpLabel: string | null;
  environmentLabel: string | null;
  environmentMachine: EnvironmentMachineKind;
  project: EnvironmentProject | null;
  projectDisplayName: string | null;
  providerEntryByInstanceId: ReadonlyMap<string, ProviderInstanceEntry>;
  isRenaming: boolean;
  renamingTitle: string;
  onThreadClick: (event: ReactMouseEvent, threadRef: ScopedThreadRef) => void;
  onThreadActivate: (threadRef: ScopedThreadRef) => void;
  onStartRename: (threadRef: ScopedThreadRef, title: string) => void;
  onRenameTitleChange: (title: string) => void;
  onCommitRename: (threadRef: ScopedThreadRef, title: string, originalTitle: string) => void;
  onCancelRename: () => void;
  onContextMenu: (threadRef: ScopedThreadRef, position: { x: number; y: number }) => void;
  onFileDropThreads: (threadRef: ScopedThreadRef, files: File[]) => void;
  /** Closes this tab; its hover control stands in for the time label. */
  onCloseTab: (threadRef: ScopedThreadRef) => void;
  /** The sorted-by time, so labels read in the list's order. Defaults to your last message. */
  timeLabel?: string | undefined;
  sortable?: SortableThreadRowBag | undefined;
}) {
  const { thread, onFileDropThreads, sortable } = props;
  const threadRef = useMemo(
    () => scopeThreadRef(thread.environmentId, thread.id),
    [thread.environmentId, thread.id],
  );
  const threadKey = scopedThreadKey(threadRef);
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

  // An unsent composer pick wins, so the icon follows the composer before the next turn.
  const draftModelSelection = useComposerDraftActiveModelSelection(threadRef);
  const modelSelection = draftModelSelection ?? thread.modelSelection;
  const modelInstanceId =
    draftModelSelection?.instanceId ??
    thread.session?.providerInstanceId ??
    thread.modelSelection.instanceId;
  const providerEntry = props.providerEntryByInstanceId.get(modelInstanceId) ?? null;
  const driverKind = providerEntry?.driverKind ?? null;
  const showInstanceBadge =
    providerEntry !== null &&
    shouldShowInstanceBadge(providerEntry, props.providerEntryByInstanceId.values());
  const selectedModel = providerEntry?.models.find((model) => model.slug === modelSelection.model);
  const modelLabel = selectedModel
    ? getTriggerDisplayModelLabel(selectedModel)
    : modelSelection.model;

  const [isFileDragOver, setIsFileDragOver] = useState(false);
  const fileDropHandlers = useMemo(
    () =>
      makeWorkspaceFileDropHandlers({
        setDragActive: setIsFileDragOver,
        addFiles: (files) => onFileDropThreads(threadRef, files),
        addFolders: () => {},
      }),
    [onFileDropThreads, threadRef],
  );
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
      <Tooltip disabled={sortable?.isDragging}>
        <TooltipTrigger
          render={
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
                  : isSelected
                    ? "bg-sidebar-row-selected text-sidebar-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-row-hover",
                isFileDragOver && "ring-1 ring-inset ring-primary/70",
                isFileDragOver && !props.isActive && !isSelected && "bg-sidebar-row-hover",
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
                props.onContextMenu(threadRef, { x: event.clientX, y: event.clientY });
              }}
            />
          }
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
                "min-w-0 flex-1 truncate text-sm",
                shouldRecede
                  ? "text-secondary-label"
                  : props.isActive || isUnread || status === "input"
                    ? "text-foreground"
                    : "text-foreground/85",
              )}
            >
              {thread.title}
            </span>
          )}
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
          <span className="shrink-0 text-xs tabular-nums text-secondary-label group-hover/sidebar-row:hidden group-focus-visible/sidebar-row:hidden group-has-[:focus-visible]/sidebar-row:hidden">
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
            className="-mx-1 hidden size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:inline-flex group-hover/sidebar-row:inline-flex group-focus-visible/sidebar-row:inline-flex"
          >
            <XIcon className="size-3.5" />
          </button>
          {driverKind ? (
            <span aria-hidden className="inline-flex shrink-0 items-center">
              <ProviderInstanceIcon
                driverKind={driverKind}
                displayName={
                  providerEntry?.displayName ?? thread.session?.providerName ?? modelInstanceId
                }
                accentColor={providerEntry?.accentColor}
                showBadge={showInstanceBadge}
                iconClassName="size-3.5 opacity-60"
                badgeClassName="right-[-0.1875rem] bottom-[-0.1875rem] h-3 min-w-3 px-0.5 text-5xs"
              />
            </span>
          ) : null}
          {props.jumpLabel ? <JumpHintBadge label={props.jumpLabel} /> : null}
        </TooltipTrigger>
        <SidebarThreadTooltip
          thread={thread}
          project={props.project}
          projectDisplayName={props.projectDisplayName}
          environmentLabel={props.environmentLabel}
          environmentMachine={props.environmentMachine}
          providerEntry={providerEntry}
          showInstanceBadge={showInstanceBadge}
          modelInstanceId={modelInstanceId}
          modelLabel={modelLabel}
          branchMismatch={null}
          terminalStatus={terminalStatus}
          terminalProcessCount={runningTerminalIds.length}
        />
      </Tooltip>
    </li>
  );
});

function latestTurnDiff(
  thread: SidebarThreadSummary,
): { insertions: number; deletions: number } | null {
  // Shells don't carry checkpoint summaries; diff stats render only when the
  // shell projection grows them. Kept as a seam so the row layout is ready.
  void thread;
  return null;
}

const SidebarSearchResultRow = memo(function SidebarSearchResultRow(props: {
  thread: SidebarThreadSummary;
  project: EnvironmentProject | null;
  projectDisplayName: string | null;
  environmentLabel: string | null;
  environmentMachine: EnvironmentMachineKind;
  providerEntryByInstanceId: ReadonlyMap<string, ProviderInstanceEntry>;
  isHighlighted: boolean;
  isRouteActive: boolean;
  resultId: string;
  searchMatch: EnvironmentThreadSearchMatch | null;
  searchQuery: string;
  onHighlight: () => void;
  onSelect: () => void;
  onFileDropThreads: (threadRef: ScopedThreadRef, files: File[]) => void;
}) {
  const { thread } = props;
  const accessibility = resolveSidebarRowAccessibility({
    title: thread.title,
    statusLabel: null,
    projectDisplayName: props.projectDisplayName,
    isActive: props.isRouteActive,
  });
  const threadRef = useMemo(
    () => scopeThreadRef(thread.environmentId, thread.id),
    [thread.environmentId, thread.id],
  );
  const { leaseLiveStatus, rowRef } = useSidebarRowSubscriptionLease(
    props.isHighlighted || props.isRouteActive,
  );
  // Same details tooltip as the regular rows: a search hit is still a thread,
  // and the hover card is how you disambiguate identically-titled results.
  const gitCwd = thread.worktreePath ?? props.project?.workspaceRoot ?? null;
  const gitStatus = useEnvironmentQuery(
    leaseLiveStatus && (thread.branch != null || thread.worktreePath !== null) && gitCwd !== null
      ? vcsEnvironment.status({
          environmentId: thread.environmentId,
          input: { cwd: gitCwd },
        })
      : null,
  );
  const visibleGitStatus = useRetainedValue(
    JSON.stringify([thread.environmentId, gitCwd]),
    gitStatus.data,
  );
  const branchMismatch = resolveLocalCheckoutBranchMismatch({
    effectiveEnvMode: thread.worktreePath === null ? "local" : "worktree",
    activeWorktreePath: thread.worktreePath,
    activeThreadBranch: thread.branch,
    currentGitBranch: visibleGitStatus?.refName ?? null,
  });
  // An unsent composer pick wins, so the icon follows the composer before the next turn.
  const draftModelSelection = useComposerDraftActiveModelSelection(threadRef);
  const modelSelection = draftModelSelection ?? thread.modelSelection;
  const modelInstanceId =
    draftModelSelection?.instanceId ??
    thread.session?.providerInstanceId ??
    thread.modelSelection.instanceId;
  const providerEntry = props.providerEntryByInstanceId.get(modelInstanceId) ?? null;
  const showInstanceBadge =
    providerEntry !== null &&
    shouldShowInstanceBadge(providerEntry, props.providerEntryByInstanceId.values());
  const selectedModel = providerEntry?.models.find((model) => model.slug === modelSelection.model);
  const modelLabel = selectedModel
    ? getTriggerDisplayModelLabel(selectedModel)
    : modelSelection.model;
  const runningTerminalIds = useThreadRunningTerminalIds({
    environmentId: thread.environmentId,
    threadId: thread.id,
  });
  const terminalStatus = terminalStatusFromRunningIds(runningTerminalIds);
  const [isFileDragOver, setIsFileDragOver] = useState(false);
  const fileDropHandlers = useMemo(
    () =>
      makeWorkspaceFileDropHandlers({
        setDragActive: setIsFileDragOver,
        addFiles: (files) => {
          props.onFileDropThreads(threadRef, files);
        },
        addFolders: () => {},
      }),
    [props.onFileDropThreads, threadRef],
  );
  useEffect(() => {
    if (!isFileDragOver) return;
    const clearFileDrag = () => setIsFileDragOver(false);
    window.addEventListener("dragend", clearFileDrag);
    return () => window.removeEventListener("dragend", clearFileDrag);
  }, [isFileDragOver]);
  return (
    <li role="presentation" className="list-none" {...fileDropHandlers}>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              ref={rowRef}
              id={props.resultId}
              type="button"
              role="option"
              // aria-activedescendant options: focus stays on the search input,
              // which owns all keyboard interaction for the listbox.
              tabIndex={-1}
              aria-selected={props.isHighlighted}
              aria-current={accessibility.current}
              aria-label={accessibility.label}
              onMouseMove={props.onHighlight}
              onClick={props.onSelect}
              className={cn(
                "flex min-h-9 w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1 text-left text-sm outline-none",
                props.isHighlighted || props.isRouteActive
                  ? "bg-sidebar-row-active text-sidebar-foreground"
                  : "text-sidebar-muted-foreground/75 hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
                isFileDragOver && "ring-1 ring-inset ring-primary/70",
                isFileDragOver && !props.isRouteActive && "bg-sidebar-row-hover",
              )}
            />
          }
        >
          {props.project ? (
            <ProjectFavicon project={props.project} className="size-4 shrink-0" />
          ) : null}
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex min-w-0 items-center gap-2.5">
              <span className="min-w-0 flex-1 truncate">{thread.title}</span>
              <span className="shrink-0 text-xs text-muted-foreground/55 tabular-nums">
                {threadTimeLabel(thread)}
              </span>
            </span>
            {props.searchMatch ? (
              <ThreadSearchMatchExcerpt
                match={{
                  source: props.searchMatch.source,
                  snippet: props.searchMatch.snippet,
                  query: props.searchQuery,
                }}
              />
            ) : null}
          </span>
        </TooltipTrigger>
        <SidebarThreadTooltip
          thread={thread}
          project={props.project}
          projectDisplayName={props.projectDisplayName}
          environmentLabel={props.environmentLabel}
          environmentMachine={props.environmentMachine}
          providerEntry={providerEntry}
          showInstanceBadge={showInstanceBadge}
          modelInstanceId={modelInstanceId}
          modelLabel={modelLabel}
          branchMismatch={branchMismatch}
          terminalStatus={terminalStatus}
          terminalProcessCount={runningTerminalIds.length}
        />
      </Tooltip>
    </li>
  );
});

export default function Sidebar() {
  const projects = useProjects();
  const projectOrder = useUiStateStore((store) => store.projectOrder);
  const threads = useThreadShells();
  const { hiddenTabThreads: tabThreadGroups, tabEnvironmentIds } = useHiddenTabThreads(threads);
  const { createTab, closeTab } = useThreadTabActions();
  const splitViewActions = useSplitViewActions();
  const showTabs = useClientSettings((s) => s.sidebarShowTabs);
  const tabLimit = useClientSettings((s) => s.sidebarTabLimit);
  const tabSortOrder = useClientSettings((s) => s.sidebarTabSortOrder);
  const tabSortDirection = useClientSettings((s) => s.sidebarTabSortDirection);
  const [tabManualRanks, setTabManualRanks] = useLocalStorage(
    SIDEBAR_TAB_MANUAL_RANKS_KEY,
    NO_SIDEBAR_TAB_MANUAL_RANKS,
    SidebarTabManualRanksSchema,
  );
  // The group whose tabs past the limit are showing. Any click into a tab or thread folds it.
  const [expandedTabRowKey, setExpandedTabRowKey] = useState<string | null>(null);
  // The order a resting pointer holds, so a live sort cannot move a tab out from under it.
  const [heldTabOrder, setHeldTabOrder] = useState<{
    readonly rowKey: string;
    readonly keys: readonly string[];
  } | null>(null);
  const openedAtByThreadKey = useThreadTabRecencyStore((s) => s.openedAtByThreadKey);
  const updateClientSettings = useUpdateClientSettings();
  const [storedTabGroupOverrides, setStoredTabGroupOverrides] = useLocalStorage(
    TAB_GROUP_OVERRIDES_KEY,
    INITIAL_TAB_GROUP_OVERRIDES,
    TabGroupOverridesSchema,
  );
  const tabGroupOverrides =
    storedTabGroupOverrides.showTabs === showTabs
      ? storedTabGroupOverrides.groups
      : NO_TAB_GROUP_OVERRIDES;
  // Changing Show tabs from anywhere overrides every group's own choice for good: dropped here,
  // a toggle back would otherwise revive them. Only once settings load, so a page load that
  // briefly reads the default never wipes them.
  const clientSettingsHydrated = useClientSettingsHydrated();
  useEffect(() => {
    if (!clientSettingsHydrated || storedTabGroupOverrides.showTabs === showTabs) return;
    setStoredTabGroupOverrides({ showTabs, groups: NO_TAB_GROUP_OVERRIDES });
  }, [
    clientSettingsHydrated,
    setStoredTabGroupOverrides,
    showTabs,
    storedTabGroupOverrides.showTabs,
  ]);
  // Listed tabs open themselves; hidden tabs fold into their group's row, which reopens the
  // tab you last had open. Each group follows Show tabs unless its badge was toggled.
  const hiddenTabThreads = useMemo(
    () => foldedSidebarTabThreads(tabThreadGroups, tabGroupOverrides, showTabs),
    [showTabs, tabGroupOverrides, tabThreadGroups],
  );
  const router = useRouter();
  const { isMobile, setOpenMobile } = useSidebar();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const confirmThreadDelete = useClientSettings((s) => s.confirmThreadDelete);
  const confirmThreadArchive = useClientSettings((s) => s.confirmThreadArchive);
  const sidebarProjectSortOrder = useClientSettings((s) => s.sidebarProjectSortOrder);
  const timestampFormat = useClientSettings((s) => s.timestampFormat);
  const workingShelfEnabled = useClientSettings((s) => s.sidebarWorkingShelfEnabled);
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const {
    settleThread,
    unsettleThread,
    snoozeThread,
    unsnoozeThread,
    pinThread,
    unpinThread,
    confirmAndUnpinThread,
    reorderPinnedThread,
    reorderActiveThread,
    setThreadAutoSettle,
    archiveThread,
    deleteThread,
  } = useThreadActions();
  const updateThreadMetadata = useAtomCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const { copyToClipboard: copyPathToClipboard } = useCopyToClipboard<{ path: string }>({
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
  const { copyToClipboard: copyBranchToClipboard } = useCopyToClipboard<{ branch: string }>({
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
  const { copyToClipboard: copyThreadIdToClipboard } = useCopyToClipboard<{ threadId: ThreadId }>({
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
  const newThreadContext = useHandleNewThread();
  const openAddProjectCommandPalette = useCallback(
    () => openCommandPalette({ open: "add-project" }),
    [],
  );
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const clearSelection = useThreadSelectionStore((s) => s.clearSelection);
  const setSelectionAnchor = useThreadSelectionStore((s) => s.setAnchor);
  const toggleThreadSelection = useThreadSelectionStore((s) => s.toggleThread);
  const rangeSelectTo = useThreadSelectionStore((s) => s.rangeSelectTo);
  const markThreadUnread = useUiStateStore((s) => s.markThreadUnread);
  const markThreadVisited = useUiStateStore((s) => s.markThreadVisited);
  const acknowledgeWoke = useCallback(
    (threadRef: ScopedThreadRef, visitedAt: string) => {
      markThreadVisited(scopedThreadKey(threadRef), visitedAt);
    },
    [markThreadVisited],
  );
  const routeTarget = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });
  const routeDraftThread = useComposerDraftStore((store) =>
    routeTarget?.kind === "draft" ? store.getDraftSession(routeTarget.draftId) : null,
  );
  const routeThreadRef = useMemo(
    () => resolveActiveThreadRouteRef(routeTarget, routeDraftThread),
    [routeDraftThread, routeTarget],
  );
  const routeThreadKey = routeThreadRef ? scopedThreadKey(routeThreadRef) : null;
  // The open thread's group row, which must stay rendered even inside a collapsed shelf.
  const sidebarRouteThreadKey =
    routeThreadKey === null ? null : (tabThreadGroups.get(routeThreadKey) ?? routeThreadKey);
  // A listed tab carries its own highlight; a folded one lights its group's row.
  const highlightedRouteThreadKey =
    routeThreadKey === null ? null : (hiddenTabThreads.get(routeThreadKey) ?? routeThreadKey);
  const routeTargetRef = useRef(routeTarget);
  routeTargetRef.current = routeTarget;
  // Post-settle navigation validates against the CURRENT route, not the one
  // captured when the settle started: if the user navigated elsewhere while
  // the command was in flight, completing it must not yank them away.
  const routeThreadKeyRef = useRef(routeThreadKey);
  routeThreadKeyRef.current = routeThreadKey;

  const environmentLabelById = useMemo(
    () =>
      new Map(
        environments.map((environment) => [environment.environmentId, environment.label] as const),
      ),
    [environments],
  );
  const environmentMachineById = useMemo(
    () =>
      new Map(
        environments.map(
          (environment) =>
            [
              environment.environmentId,
              resolveEnvironmentMachineKind(environment.serverConfig),
            ] as const,
        ),
      ),
    [environments],
  );
  const orderedProjects = useMemo(
    () =>
      orderItemsByPreferredIds({
        items: projects,
        preferredIds: projectOrder,
        getId: getProjectOrderKey,
        getPreferenceIds: (project) => [
          getProjectOrderKey(project),
          legacyProjectCwdPreferenceKey(project.workspaceRoot),
        ],
      }),
    [projectOrder, projects],
  );
  const unsortedProjectGroups = useMemo(
    () =>
      buildSidebarProjectSnapshots({
        projects: sidebarProjectSortOrder === "manual" ? orderedProjects : projects,
        settings: projectGroupingSettings,
        primaryEnvironmentId,
        resolveEnvironmentLabel: (environmentId) => environmentLabelById.get(environmentId) ?? null,
      }),
    [
      environmentLabelById,
      orderedProjects,
      primaryEnvironmentId,
      projectGroupingSettings,
      projects,
      sidebarProjectSortOrder,
    ],
  );
  const projectGroups = useMemo(
    () => sortLogicalProjectsForSidebar(unsortedProjectGroups, threads, sidebarProjectSortOrder),
    [sidebarProjectSortOrder, threads, unsortedProjectGroups],
  );
  const projectGroupsRef = useRef(projectGroups);
  projectGroupsRef.current = projectGroups;
  const serverConfigs = useAtomValue(environmentServerConfigsAtom);
  // Threads on non-primary environments (T3 Connect, hosted) resolve their
  // provider entry from their own environment's config: default instance ids
  // are driver slugs, so a flat map would collide across environments.
  const providerEntriesByEnvironment = useMemo(
    () =>
      deriveProviderEntriesByEnvironment(
        [...serverConfigs].map(
          ([environmentId, config]) => [environmentId, config.providers] as const,
        ),
      ),
    [serverConfigs],
  );
  // Rows read the project record for its icon and cwd. Group labels can include
  // a repository owner or a different title, so they travel separately.
  const projectByKey = useMemo(
    () => new Map(projects.map((project) => [`${project.environmentId}:${project.id}`, project])),
    [projects],
  );
  const projectDisplayNameByKey = useMemo(
    () =>
      new Map(
        projectGroups.flatMap((group) =>
          group.memberProjects.map(
            (project) => [`${project.environmentId}:${project.id}`, group.displayName] as const,
          ),
        ),
      ),
    [projectGroups],
  );

  const nowMinute = useNowMinute();
  // Snooze wake times are second-precise, so classifying with the quantized
  // minute would hold a woken thread on the shelf for up to a minute. The
  // tick is a plain counter bumped exactly at the next wake boundary (armed
  // below, after the partition knows the boundary); the partition reads a
  // fresh clock whenever it recomputes.
  const [snoozeWakeTick, bumpSnoozeWakeTick] = useState(0);

  // Project scope: one menu above the list. Scoping filters the list without
  // making the header width depend on the number or length of project names.
  // The selection lives in the persisted UI store next to the other sidebar
  // project preferences, so routes that unmount the sidebar (Settings) and
  // app restarts keep it.
  const projectScopeKeys = useUiStateStore((store) => store.sidebarProjectScopeKeys);
  const setProjectScopeKeys = useUiStateStore((store) => store.setSidebarProjectScopeKeys);
  // {value, label} items let Base UI drive the combobox selection contract
  // while the popup search filters the same collection.
  const projectScopeItems = useMemo(
    () => [
      { value: "all", label: "All projects" },
      ...projectGroups.map((project) => ({
        value: project.projectKey,
        label: project.displayName,
      })),
    ],
    [projectGroups],
  );
  // Same-named projects on two machines are only told apart by where they
  // live, so rows on another machine carry its icon once the catalog spans
  // more than one environment; a single-machine catalog stays as it was.
  const showProjectEnvironments = useMemo(
    () => projectGroupsSpanEnvironments(projectGroups),
    [projectGroups],
  );
  const projectGroupByScopeKey = useMemo(
    () => new Map(projectGroups.map((project) => [project.projectKey, project] as const)),
    [projectGroups],
  );
  // "All projects" is the selected row exactly when nothing is scoped.
  const selectedProjectScopeValues = useMemo(
    () => new Set(projectScopeKeys.length === 0 ? ["all"] : projectScopeKeys),
    [projectScopeKeys],
  );
  const selectedProjectScopeItems = useMemo(
    () => projectScopeItems.filter((item) => selectedProjectScopeValues.has(item.value)),
    [projectScopeItems, selectedProjectScopeValues],
  );
  const [projectScopeMenuState, dispatchProjectScopeMenu] = useReducer(
    reduceSidebarProjectScopeMenuState,
    { open: false, query: "" },
  );
  const projectScopeFilter = useComboboxFilter();
  // Filtering derives from the same React state that controls the input, so
  // the visible query and the visible list can never desync — the peer wiring
  // in DiffPanel and BranchToolbarBranchSelector. "All projects" is the default
  // row, not a searchable entry: it heads the list while the query is empty and
  // drops out while filtering, so it can't outrank a project match under
  // autoHighlight and no-hit queries reach the empty state.
  const filteredProjectScopeItems = useMemo(
    () =>
      filterSidebarProjectScopeItems({
        items: projectScopeItems,
        query: projectScopeMenuState.query,
        matches: (item, query) =>
          projectScopeFilter.contains(item, query, (candidate) => candidate.label),
      }),
    [projectScopeFilter, projectScopeItems, projectScopeMenuState.query],
  );
  const scopedProjectGroups = useMemo(
    () =>
      projectScopeKeys.flatMap((key) => {
        const project = projectGroupByScopeKey.get(key);
        return project ? [project] : [];
      }),
    [projectGroupByScopeKey, projectScopeKeys],
  );
  const scopedProjectKeys = useMemo(
    () =>
      scopedProjectGroups.length === 0
        ? null
        : new Set(
            scopedProjectGroups.flatMap((project) =>
              project.memberProjectRefs.map(
                (projectRef) => `${projectRef.environmentId}:${projectRef.projectId}`,
              ),
            ),
          ),
    [scopedProjectGroups],
  );
  // Scoped projects that are gone drop out of the scope, but only after every
  // catalog environment has a live project snapshot. Cached or disconnected
  // environments cannot establish that a project is gone.
  const allProjectSnapshotsReady = useAllEnvironmentProjectSnapshotsReady();
  useEffect(() => {
    if (allProjectSnapshotsReady && scopedProjectGroups.length < projectScopeKeys.length) {
      setProjectScopeKeys(scopedProjectGroups.map((project) => project.projectKey));
    }
  }, [allProjectSnapshotsReady, projectScopeKeys, scopedProjectGroups, setProjectScopeKeys]);
  // Count-only subscription: the parent needs "are there draft rows" for the
  // empty state, while SidebarDraftBlock owns the per-keystroke content
  // subscription. Selecting a number keeps typing in a draft composer from
  // re-rendering the whole sidebar. Approximates the block's row filter
  // (every non-promoted session with content); it can overcount by one for
  // an open never-left draft, which only softens the empty state.
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
  // Scope flips drop the selection: rows selected under the old scope may be
  // hidden now, and bulk actions must never count or touch invisible rows.
  useEffect(() => {
    clearSelection();
  }, [clearSelection, projectScopeKeys]);

  const openProjectSettings = useCallback(
    (projectGroup: SidebarProjectSnapshot) => {
      if (isMobile) {
        setOpenMobile(false);
      }
      void router.navigate({
        to: "/projects/$projectKey",
        params: { projectKey: projectGroup.projectKey },
      });
    },
    [isMobile, router, setOpenMobile],
  );
  // Anchor for the scope popup: the header search field, not its icon trigger.
  const headerSearchRef = useRef<HTMLDivElement | null>(null);
  // Safari can send a click after Ctrl+click opens settings. Ignore that one
  // selection, then clear the guard when the picker opens again.
  const suppressNextScopeChangeRef = useRef(false);
  const highlightedProjectScopeKeyRef = useRef<string | null>(null);
  const handleProjectSettings = useCallback(
    (
      event: ReactMouseEvent<HTMLElement> | ReactKeyboardEvent<HTMLInputElement>,
      projectGroup: SidebarProjectSnapshot,
    ) => {
      event.preventDefault();
      event.stopPropagation();
      suppressNextScopeChangeRef.current = true;
      dispatchProjectScopeMenu({ type: "project-settings-opened" });
      openProjectSettings(projectGroup);
    },
    [openProjectSettings],
  );

  // Keep a dropped row at its destination while its server applies the
  // lifecycle command and any order-key writes. The next pickup waits for
  // this hold so a second drop cannot replace an unconfirmed placement.
  const [optimisticDrop, setOptimisticDrop] = useState<{
    readonly key: string;
    readonly sourceSection: SidebarSection;
    readonly section: "pinned" | "active" | "settled";
    readonly occurredAt: string;
    readonly clearsSnooze: boolean;
    /** Full destination order for pinned and active drops. */
    readonly order: readonly string[] | null;
    /** Destination order keys before the drop, to recognize concurrent writes. */
    readonly keysAtDrop: ReadonlyMap<string, string | null>;
    /** The keys this drop writes (one per planned assignment). The
        override holds until all of them appear in canonical state. */
    readonly assignedKeys: ReadonlyMap<string, string>;
  } | null>(null);
  const {
    pinnedThreads,
    draggableThreadKeys,
    activeReorderableThreadKeys,
    activeThreads,
    workingThreads,
    snoozedThreads,
    settledThreads,
    snoozeNow,
  } = useMemo(() => {
    // Snooze classification uses a REAL clock, not the quantized minute:
    // wake times are second-precise and a woken thread must not linger on
    // the shelf for the rest of the minute. snoozeWakeTick re-runs this
    // memo exactly at the next wake boundary.
    void snoozeWakeTick;
    const preciseNow = new Date().toISOString();
    const visible = threads.filter(
      (thread) =>
        thread.archivedAt === null &&
        !tabThreadGroups.has(`${thread.environmentId}:${thread.id}`) &&
        (scopedProjectKeys === null ||
          scopedProjectKeys.has(`${thread.environmentId}:${thread.projectId}`)),
    );
    observeInboxReturns(workingShelfEnabled ? threads : null);
    const pinned: EnvironmentThreadShell[] = [];
    const active: EnvironmentThreadShell[] = [];
    const working: EnvironmentThreadShell[] = [];
    // Working beta: only inbox threads fold away. Pins stay where the user
    // put them, and snoozed or settled threads keep their shelves.
    const inbox = (thread: EnvironmentThreadShell) =>
      workingShelfEnabled && isSidebarThreadWorking(thread) ? working : active;
    const snoozed: EnvironmentThreadShell[] = [];
    const settled: EnvironmentThreadShell[] = [];
    const draggable = new Set<string>();
    const activeReorderable = new Set<string>();
    for (const thread of visible) {
      const capabilities = serverConfigs.get(thread.environmentId)?.environment.capabilities;
      // Threads on servers without the settlement capability (old server,
      // or descriptor not loaded yet) never classify as settled: the user
      // could neither un-settle nor pin them, so auto-settling them would
      // strand rows in a tail with no working affordances.
      const supportsSettlement = capabilities?.threadSettlement === true;
      const supportsSnooze = capabilities?.threadSnooze === true;
      const threadKey = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
      if (capabilities?.threadActiveReorder === true) activeReorderable.add(threadKey);
      // Older servers retain their existing drag actions. Active placement
      // additionally requires its own ordering capability at the drop target.
      if (capabilities?.threadPinning === true && capabilities.threadPinReorder === true) {
        draggable.add(threadKey);
      }
      if (optimisticDrop?.key === threadKey) {
        const projected = applySidebarThreadDrop(
          thread,
          optimisticDrop.section,
          optimisticDrop.occurredAt,
          optimisticDrop.assignedKeys.get(threadKey),
        );
        (optimisticDrop.section === "pinned"
          ? pinned
          : optimisticDrop.section === "settled"
            ? settled
            : inbox(projected)
        ).push(
          optimisticDrop.clearsSnooze
            ? projected
            : { ...projected, snoozedAt: thread.snoozedAt, snoozedUntil: thread.snoozedUntil },
        );
      } else {
        const shelf = sidebarThreadShelf(thread, {
          supportsSnooze,
          supportsSettlement,
          workingShelfEnabled,
          now: preciseNow,
        });
        ({ snoozed, settled, pinned, working, active })[shelf].push(thread);
      }
    }
    // One shared rule on every platform (see sortPinnedThreadsByOrderKey):
    // user-arranged keys first, keyless threads in creation order below.
    // Server capability only gates DRAGGING — it must not influence the
    // sort, or mixed-version fleets would render different pinned orders on
    // web and mobile from the same data.
    const sortedPinned = sortPinnedThreadsForSidebar(pinned);
    const sortedActive = workingShelfEnabled
      ? sortInboxThreadsByReturn(active, (thread) =>
          observedInboxReturns.get(
            scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
          ),
        )
      : sortThreadsForSidebar(active);
    return {
      pinnedThreads:
        optimisticDrop?.section !== "pinned" || optimisticDrop.order === null
          ? sortedPinned
          : orderItemsByPreferredIds({
              items: sortedPinned,
              preferredIds: optimisticDrop.order,
              getId: (thread) => scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
            }),
      draggableThreadKeys: draggable,
      activeReorderableThreadKeys: activeReorderable,
      activeThreads:
        optimisticDrop?.section !== "active" || optimisticDrop.order === null
          ? sortedActive
          : orderItemsByPreferredIds({
              items: sortedActive,
              preferredIds: optimisticDrop.order,
              getId: (thread) => scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
            }),
      // Newest work first, by the same clock as the inbox.
      workingThreads: sortInboxThreadsByReturn(working),
      // Soonest wake first: "what comes back next" is the shelf's question.
      snoozedThreads: snoozed.toSorted(
        (left, right) =>
          firstValidTimestampMs(left.snoozedUntil ?? null) -
          firstValidTimestampMs(right.snoozedUntil ?? null),
      ),
      settledThreads: sortSettledThreads(settled),
      snoozeNow: preciseNow,
    };
  }, [
    tabThreadGroups,
    nowMinute,
    optimisticDrop,
    scopedProjectKeys,
    serverConfigs,
    snoozeWakeTick,
    threads,
    workingShelfEnabled,
  ]);

  const tabsByRowKey = useMemo(
    () =>
      tabThreadGroups.size === 0
        ? EMPTY_TABS_BY_ROW
        : groupSidebarTabThreads(
            new Map(threads.map((thread) => [sidebarThreadKey(thread), thread] as const)),
            tabThreadGroups,
          ),
    [tabThreadGroups, threads],
  );
  const listedTabsByRowKey = useMemo(() => {
    const listed = [...tabsByRowKey].filter(([rowKey]) =>
      isSidebarTabGroupOpen(rowKey, tabGroupOverrides, showTabs),
    );
    return listed.length === 0 ? EMPTY_TABS_BY_ROW : new Map(listed);
  }, [showTabs, tabGroupOverrides, tabsByRowKey]);
  const displayTabsByRowKey = useMemo(() => {
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
  }, [listedTabsByRowKey, openedAtByThreadKey, tabsByRowKey]);

  const threadSearchInputRef = useRef<HTMLInputElement>(null);
  const [threadSearchQuery, setThreadSearchQuery] = useState("");
  const [activeSearchResultIndex, setActiveSearchResultIndex] = useState(0);
  const isSearchingThreads = threadSearchQuery.trim().length > 0;
  const searchableThreads = useMemo(
    () =>
      withSidebarTabThreads(
        [
          ...pinnedThreads,
          ...activeThreads,
          ...workingThreads,
          ...snoozedThreads,
          ...settledThreads,
        ],
        sidebarThreadKey,
        listedTabsByRowKey,
      ),
    [
      activeThreads,
      listedTabsByRowKey,
      pinnedThreads,
      settledThreads,
      snoozedThreads,
      workingThreads,
    ],
  );
  const searchEnvironmentIds = useMemo(
    () =>
      environments
        .filter((environment) => environment.connection.phase === "connected")
        .map((environment) => environment.environmentId),
    [environments],
  );
  // useThreadSearch owns the debounce and the two-character floor.
  const threadSearch = useThreadSearch(searchEnvironmentIds, threadSearchQuery);
  const threadSearchMatchByKey = useMemo(
    () =>
      new Map(threadSearch.matches.map((match) => [threadSearchMatchKey(match), match] as const)),
    [threadSearch.matches],
  );
  const threadSearchResults = useMemo(
    () =>
      searchSidebarThreads(
        searchableThreads,
        threadSearchQuery,
        new Set(threadSearchMatchByKey.keys()),
      ),
    [searchableThreads, threadSearchQuery, threadSearchMatchByKey],
  );
  const threadSearchResultOrderKey = threadSearchResults
    .map((thread) => scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)))
    .join("\0");

  useEffect(() => {
    setActiveSearchResultIndex(0);
  }, [threadSearchResultOrderKey]);

  useEffect(() => {
    if (!isSearchingThreads) return;
    document
      .getElementById(`sidebar-thread-search-result-${activeSearchResultIndex}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeSearchResultIndex, isSearchingThreads, threadSearchResultOrderKey]);

  // Arm a timeout for the earliest upcoming wake so the shelf empties the
  // moment a snooze expires instead of on the next minute tick. Sorted
  // soonest-first, so entry 0 is the boundary.
  useEffect(() => {
    const nextWakeAtMs =
      snoozedThreads.length > 0 && snoozedThreads[0]?.snoozedUntil != null
        ? Date.parse(snoozedThreads[0].snoozedUntil)
        : Number.NaN;
    if (Number.isNaN(nextWakeAtMs)) return;
    // setTimeout delays are signed 32-bit: anything larger overflows and
    // fires immediately, turning a far-future wake (event-condition snoozes
    // synced from elsewhere) into a tight re-arm loop. Clamped, the timer
    // just re-arms every ~24.8 days until the wake is in range.
    const delayMs = Math.min(Math.max(0, nextWakeAtMs - Date.now()) + 50, 2_147_483_647);
    const id = window.setTimeout(() => bumpSnoozeWakeTick((tick) => tick + 1), delayMs);
    return () => window.clearTimeout(id);
  }, [snoozedThreads]);

  // The settled tail renders in pages: history shouldn't dominate the
  // sidebar, and the common lookups are recent. Expansion resets when the
  // filter context changes so a scope/search flip never inherits a deep
  // page state.
  const [settledVisibleCount, setSettledVisibleCount] = useState(SETTLED_TAIL_INITIAL_COUNT);
  const settledResetKey = projectScopeKeys.join("\n") || "all";
  const lastSettledResetKeyRef = useRef(settledResetKey);
  if (lastSettledResetKeyRef.current !== settledResetKey) {
    lastSettledResetKeyRef.current = settledResetKey;
    setSettledVisibleCount(SETTLED_TAIL_INITIAL_COUNT);
  }
  const visibleSettledThreads = useMemo(() => {
    if (settledThreads.length <= settledVisibleCount) return settledThreads;
    const visible = settledThreads.slice(0, settledVisibleCount);
    // The open thread must never hide under "Show more": navigating into a
    // deep settled thread (search, deep link) pulls its row into the visible
    // tail so the highlight and the un-settle affordance stay reachable.
    if (sidebarRouteThreadKey !== null) {
      const routeThread = settledThreads
        .slice(settledVisibleCount)
        .find(
          (thread) =>
            scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)) ===
            sidebarRouteThreadKey,
        );
      if (routeThread !== undefined) visible.push(routeThread);
    }
    return visible;
  }, [sidebarRouteThreadKey, settledThreads, settledVisibleCount]);
  const hiddenSettledCount = settledThreads.length - visibleSettledThreads.length;
  const showMoreSettled = useCallback(
    () => setSettledVisibleCount((count) => count + SETTLED_TAIL_PAGE_COUNT),
    [],
  );
  const [settledShelfExpanded, setSettledShelfExpanded] = useLocalStorage(
    SETTLED_SHELF_EXPANDED_KEY,
    false,
    Schema.Boolean,
  );
  const toggleSettledShelf = useCallback(
    () => setSettledShelfExpanded((value) => !value),
    [setSettledShelfExpanded],
  );
  const renderedSettledThreads = useMemo(() => {
    if (settledShelfExpanded) return visibleSettledThreads;
    if (sidebarRouteThreadKey === null) return EMPTY_THREADS;
    const routeThread = visibleSettledThreads.find(
      (thread) =>
        scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)) === sidebarRouteThreadKey,
    );
    return routeThread === undefined ? EMPTY_THREADS : [routeThread];
  }, [sidebarRouteThreadKey, settledShelfExpanded, visibleSettledThreads]);

  // The snoozed shelf is collapsed by default: out of the way, never gone.
  // Collapsed threads don't render (and so don't participate in jump
  // shortcuts or multi-select), matching the settled tail's paging model.
  const [snoozedShelfExpanded, setSnoozedShelfExpanded] = useLocalStorage(
    SNOOZED_SHELF_EXPANDED_KEY,
    false,
    Schema.Boolean,
  );
  const toggleSnoozedShelf = useCallback(
    () => setSnoozedShelfExpanded((value) => !value),
    [setSnoozedShelfExpanded],
  );
  const visibleSnoozedThreads = useMemo(() => {
    if (snoozedShelfExpanded) return snoozedThreads;
    // The open thread must never vanish behind the collapsed shelf: a
    // snoozed thread reached by route (deep link, open before snoozing
    // elsewhere) keeps its row — with highlight and wake affordance — same
    // exception the settled tail's "Show more" makes.
    if (sidebarRouteThreadKey === null) return EMPTY_THREADS;
    const routeThread = snoozedThreads.find(
      (thread) =>
        scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)) === sidebarRouteThreadKey,
    );
    return routeThread === undefined ? EMPTY_THREADS : [routeThread];
  }, [sidebarRouteThreadKey, snoozedShelfExpanded, snoozedThreads]);

  // Navigating anywhere folds an expanded tab list back to its limit.
  const [expandedForRouteKey, setExpandedForRouteKey] = useState(routeThreadKey);
  if (expandedForRouteKey !== routeThreadKey) {
    setExpandedForRouteKey(routeThreadKey);
    setExpandedTabRowKey(null);
  }
  // Each listed group's tabs as the sidebar shows them: sorted, held still under a resting
  // pointer, then cut to the limit. A card lists its own thread among its tabs; a slim row
  // stands for its thread and lists only the others.
  const tabLayoutByRowKey = useMemo(() => {
    const layouts = new Map<
      string,
      {
        readonly ordered: readonly EnvironmentThreadShell[];
        readonly shown: readonly EnvironmentThreadShell[];
        readonly hidden: readonly EnvironmentThreadShell[];
        /** Past the limit and showing everything; the "more" row reads Show less. */
        readonly expanded: boolean;
        /** A card lists its own thread as a tab, so the list stands in for the row. */
        readonly listsRow: boolean;
      }
    >();
    if (listedTabsByRowKey.size === 0) return layouts;
    const cardByKey = new Map(
      [...pinnedThreads, ...activeThreads].map((thread) => [sidebarThreadKey(thread), thread]),
    );
    for (const [rowKey, rowTabs] of listedTabsByRowKey) {
      const card = cardByKey.get(rowKey);
      const layout = layoutSidebarTabs(card ? [card, ...rowTabs] : rowTabs, {
        order: tabSortOrder,
        direction: tabSortDirection,
        getKey: sidebarThreadKey,
        getTimestamp: (tab, order) =>
          sidebarTabSortTimestamp(tab, order, openedAtByThreadKey[sidebarThreadKey(tab)]),
        manualRanks: tabManualRanks,
        heldKeys: heldTabOrder?.rowKey === rowKey ? heldTabOrder.keys : null,
        limit: tabLimit,
        activeKey: highlightedRouteThreadKey,
        expanded: expandedTabRowKey === rowKey,
      });
      layouts.set(rowKey, { ...layout, listsRow: card !== undefined });
    }
    return layouts;
  }, [
    activeThreads,
    expandedTabRowKey,
    heldTabOrder,
    highlightedRouteThreadKey,
    listedTabsByRowKey,
    openedAtByThreadKey,
    pinnedThreads,
    tabLimit,
    tabManualRanks,
    tabSortDirection,
    tabSortOrder,
  ]);
  const tabLayoutByRowKeyRef = useRef(tabLayoutByRowKey);
  tabLayoutByRowKeyRef.current = tabLayoutByRowKey;
  const shownTabsByRowKey = useMemo(
    () =>
      tabLayoutByRowKey.size === 0
        ? EMPTY_TABS_BY_ROW
        : new Map([...tabLayoutByRowKey].map(([rowKey, layout]) => [rowKey, layout.shown])),
    [tabLayoutByRowKey],
  );

  // The Working shelf (beta) collapses the same way, with the same route
  // exception: sending a message folds the open thread into the shelf, and
  // its row must stay visible there.
  const [workingShelfExpanded, setWorkingShelfExpanded] = useLocalStorage(
    WORKING_SHELF_EXPANDED_KEY,
    false,
    Schema.Boolean,
  );
  const toggleWorkingShelf = useCallback(
    () => setWorkingShelfExpanded((value) => !value),
    [setWorkingShelfExpanded],
  );
  const visibleWorkingThreads = useMemo(() => {
    if (workingShelfExpanded) return workingThreads;
    if (sidebarRouteThreadKey === null) return EMPTY_THREADS;
    const routeThread = workingThreads.find(
      (thread) =>
        scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)) === sidebarRouteThreadKey,
    );
    return routeThread === undefined ? EMPTY_THREADS : [routeThread];
  }, [sidebarRouteThreadKey, workingShelfExpanded, workingThreads]);

  const orderedThreads = useMemo(
    () =>
      withSidebarTabThreads(
        [
          ...pinnedThreads,
          ...activeThreads,
          ...visibleWorkingThreads,
          ...visibleSnoozedThreads,
          ...renderedSettledThreads,
        ],
        sidebarThreadKey,
        shownTabsByRowKey,
        (rowKey) => tabLayoutByRowKey.get(rowKey)?.listsRow === true,
      ),
    [
      pinnedThreads,
      activeThreads,
      visibleWorkingThreads,
      visibleSnoozedThreads,
      renderedSettledThreads,
      shownTabsByRowKey,
      tabLayoutByRowKey,
    ],
  );
  const orderedThreadKeys = useMemo(
    () =>
      orderedThreads.map((thread) =>
        scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      ),
    [orderedThreads],
  );
  // Rows call back into the click handler without carrying the ordered list as
  // a prop — a fresh array identity per shell update would defeat every row's
  // memoization. The ref keeps shift-range-select working against the list as
  // rendered at click time.
  const orderedThreadKeysRef = useRef(orderedThreadKeys);
  orderedThreadKeysRef.current = orderedThreadKeys;
  // Every row's thread as well as the shown tabs: a card whose tab list stands in for it can
  // sort its own thread past the tab limit, yet the row still renders and drags by that key.
  const threadByKey = useMemo(
    () =>
      new Map(
        [
          ...pinnedThreads,
          ...activeThreads,
          ...visibleSnoozedThreads,
          ...renderedSettledThreads,
          ...orderedThreads,
        ].map((thread) => [sidebarThreadKey(thread), thread] as const),
      ),
    [pinnedThreads, activeThreads, visibleSnoozedThreads, renderedSettledThreads, orderedThreads],
  );
  // Handlers read these through refs: depending on per-update Map/Set
  // identities would give every row a fresh callback prop on each shell
  // event and defeat row memoization during streaming.
  const threadByKeyRef = useRef(threadByKey);
  threadByKeyRef.current = threadByKey;
  // handleNewThread is inherently unstable (depends on the projects list);
  // a ref keeps it out of attemptSettle's dependency array.
  const handleNewThreadRef = useRef(newThreadContext.handleNewThread);
  handleNewThreadRef.current = newThreadContext.handleNewThread;
  const settledThreadKeys = useMemo(
    () =>
      new Set(
        settledThreads.map((thread) =>
          scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
        ),
      ),
    [settledThreads],
  );
  const settledThreadKeysRef = useRef(settledThreadKeys);
  settledThreadKeysRef.current = settledThreadKeys;
  const snoozedThreadKeys = useMemo(
    () =>
      new Set(
        snoozedThreads.map((thread) =>
          scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
        ),
      ),
    [snoozedThreads],
  );
  const snoozedThreadKeysRef = useRef(snoozedThreadKeys);
  snoozedThreadKeysRef.current = snoozedThreadKeys;

  const jumpLabelByKey = useMemo(() => {
    const mapping = new Map<string, string>();
    for (const [index, threadKey] of orderedThreadKeys.entries()) {
      const jumpCommand = threadJumpCommandForIndex(index);
      if (!jumpCommand) break;
      const label = shortcutLabelForCommand(keybindings, jumpCommand);
      if (label) mapping.set(threadKey, label);
    }
    return mapping;
  }, [keybindings, orderedThreadKeys]);
  const { showThreadJumpHints, updateThreadJumpHintsVisibility } = useThreadJumpHintVisibility();

  // Settled threads are live shells, so opening one is plain navigation:
  // history stays readable without un-settling, and sending a message or
  // starting a session un-settles server-side.
  const tabThreadGroupsRef = useRef(tabThreadGroups);
  tabThreadGroupsRef.current = tabThreadGroups;
  const navigateToThread = useCallback(
    (threadRef: ScopedThreadRef, keepOpenGroupTab = false) => {
      if (useThreadSelectionStore.getState().selectedThreadKeys.size > 0) {
        clearSelection();
      }
      setSelectionAnchor(scopedThreadKey(threadRef));
      if (isMobile) {
        setOpenMobile(false);
      }
      const target = keepOpenGroupTab
        ? (parseScopedThreadKey(
            threadTabGroupHeaderTarget(
              scopedThreadKey(threadRef),
              routeThreadKeyRef.current,
              tabThreadGroupsRef.current,
              hiddenTabThreads,
              useThreadTabRecencyStore.getState().openedAtByThreadKey,
            ),
          ) ?? threadRef)
        : resolveThreadTabTarget(threadRef, hiddenTabThreads);
      return router.navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(target),
      });
    },
    [clearSelection, hiddenTabThreads, isMobile, router, setOpenMobile, setSelectionAnchor],
  );
  // New tabs join the clicked thread's group and start on its model.
  const handleNewTab = useCallback(
    (threadRef: ScopedThreadRef) => {
      // Compact rows act on the displayed tab, which can be hidden from the ordered list.
      const thread = readThreadShell(threadRef);
      if (!thread) return;
      if (isMobile) setOpenMobile(false);
      void createTab(threadRef, thread.modelSelection);
    },
    [createTab, isMobile, setOpenMobile],
  );
  const handleCloseTab = useCallback(
    (threadRef: ScopedThreadRef) => {
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
    },
    [closeTab],
  );

  // Dropping files on a row opens that thread and attaches the files there.
  // The composer only accepts drops for its OWN thread, so when the row is
  // not the open thread we stash the files and let ChatView hand them over
  // once the navigation actually lands; if the route bounced (thread gone),
  // nothing will consume them, so clear instead of surprising the user later.
  const queuePendingFileDrop = useSidebarPendingFileDropStore((s) => s.queuePendingFileDrop);
  const clearPendingFileDrop = useSidebarPendingFileDropStore((s) => s.clearPendingFileDrop);
  const handleThreadFileDrop = useCallback(
    async (rowThreadRef: ScopedThreadRef, files: File[]) => {
      const threadRef = resolveThreadTabTarget(rowThreadRef, hiddenTabThreads);
      // Queued, not replaced: a second drop before the thread opens keeps
      // both files, and the id lets cleanup below touch only this drop.
      const dropId = queuePendingFileDrop({ threadRef, files });
      // Key match alone is not "already there": during draft promotion the
      // resolved route key is the server thread while the URL is still the
      // draft route, and its composer would swallow the drop then discard it.
      const landedBefore =
        router.buildLocation({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(threadRef),
        }).pathname === router.state.location.pathname;
      if (landedBefore) return;
      try {
        await navigateToThread(threadRef);
        // A newer drop may have arrived while the navigation was in flight;
        // clearing by id leaves those files untouched.
        const landed =
          router.buildLocation({
            to: "/$environmentId/$threadId",
            params: buildThreadRouteParams(threadRef),
          }).pathname === router.state.location.pathname;
        if (!landed) {
          clearPendingFileDrop(dropId);
        }
      } catch {
        // Navigation failed outright; nothing will consume this drop, but a
        // newer drop for the same thread may still be deliverable.
        clearPendingFileDrop(dropId);
      }
    },
    [clearPendingFileDrop, hiddenTabThreads, navigateToThread, queuePendingFileDrop, router],
  );

  const navigateToDraft = useCallback(
    (draftId: DraftId) => {
      // Unconditional: also drops a stale selection anchor left by
      // plain-click navigation, so a later shift-click starts fresh
      // instead of ranging from a row that is no longer the context.
      // (clearSelection no-ops when there is nothing to clear.)
      clearSelection();
      if (isMobile) {
        setOpenMobile(false);
      }
      void router.navigate({ to: "/draft/$draftId", params: { draftId } });
    },
    [clearSelection, isMobile, router, setOpenMobile],
  );

  const clearThreadSearch = useCallback(() => {
    setThreadSearchQuery("");
    setActiveSearchResultIndex(0);
  }, []);
  const selectThreadSearchResult = useCallback(
    (thread: EnvironmentThreadShell) => {
      clearThreadSearch();
      navigateToThread(scopeThreadRef(thread.environmentId, thread.id));
    },
    [clearThreadSearch, navigateToThread],
  );
  const handleThreadSearchKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      // IME composition (Japanese/Chinese input) uses the same keys; committing
      // a candidate must not move the highlight or navigate away mid-compose.
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
        setActiveSearchResultIndex((index) => (index + 1) % threadSearchResults.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveSearchResultIndex(
          (index) => (index - 1 + threadSearchResults.length) % threadSearchResults.length,
        );
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const result = threadSearchResults[activeSearchResultIndex];
        if (result) selectThreadSearchResult(result);
      }
    },
    [
      activeSearchResultIndex,
      clearThreadSearch,
      isSearchingThreads,
      selectThreadSearchResult,
      threadSearchResults,
    ],
  );

  const [renamingThreadKey, setRenamingThreadKey] = useState<string | null>(null);
  const [renamingTitle, setRenamingTitle] = useState("");
  const startThreadRename = useCallback((threadRef: ScopedThreadRef, title: string) => {
    setRenamingThreadKey(scopedThreadKey(threadRef));
    setRenamingTitle(title);
  }, []);
  const cancelThreadRename = useCallback(() => setRenamingThreadKey(null), []);
  const commitThreadRename = useCallback(
    (threadRef: ScopedThreadRef, title: string, originalTitle: string) => {
      void (async () => {
        const trimmed = title.trim();
        setRenamingThreadKey(null);
        if (trimmed.length === 0) {
          toastManager.add({ type: "warning", title: "Thread title cannot be empty" });
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
    },
    [updateThreadMetadata],
  );

  const handleThreadClick = useCallback(
    (event: ReactMouseEvent, threadRef: ScopedThreadRef, keepOpenGroupTab = false) => {
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
    },
    [navigateToThread, rangeSelectTo, toggleThreadSelection],
  );

  // A settle per thread at a time: double clicks and repeated menu picks
  // must not dispatch a second settle that fails and toasts a false error.
  const settlingThreadKeysRef = useRef(new Set<string>());
  // Parking the thread you're looking at (settle or snooze) moves you
  // forward: the next remaining card (never a settled or snoozed row, never
  // one leaving in the same batch), or a fresh draft in this project when it
  // was the last active one. Callers snapshot the plan BEFORE the command
  // mutates the partition; background parks never navigate (null plan).
  const planForwardNavigation = useCallback(
    (threadKey: string, coParkingKeys?: ReadonlySet<string>): (() => void) | null => {
      if (routeThreadKeyRef.current !== threadKey) return null;
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
          ? () =>
              void handleNewThreadRef.current(scopeProjectRef(shell.environmentId, shell.projectId))
          : () => void router.navigate({ to: "/" });
    },
    [navigateToThread, router],
  );

  const attemptSettle = useCallback(
    (threadRef: ScopedThreadRef, opts: { coSettlingKeys?: ReadonlySet<string> } = {}) => {
      void (async () => {
        const threadKey = scopedThreadKey(threadRef);
        if (settlingThreadKeysRef.current.has(threadKey)) return;
        settlingThreadKeysRef.current.add(threadKey);
        try {
          const navigateAfterSettle = planForwardNavigation(threadKey, opts.coSettlingKeys);
          const result = await settleThread(threadRef);
          if (result._tag === "Failure") {
            // Never navigate away from a thread that did not settle.
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
          // Only move forward if the user is still on the settled thread —
          // a navigation made during the await wins over ours.
          if (
            shouldNavigateAfterThreadPark({
              threadKey,
              currentThreadKey: routeThreadKeyRef.current,
              action: "settle",
              now: new Date().toISOString(),
              thread: readThreadShell(threadRef),
            })
          ) {
            navigateAfterSettle?.();
          }
        } finally {
          settlingThreadKeysRef.current.delete(threadKey);
        }
      })();
    },
    [planForwardNavigation, settleThread],
  );
  const attemptUnsettle = useCallback(
    (threadRef: ScopedThreadRef) => {
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
    },
    [unsettleThread],
  );
  const attemptUnsnooze = useCallback(
    (threadRef: ScopedThreadRef) => {
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
    },
    [unsnoozeThread],
  );
  const threadListRef = useRef<HTMLUListElement | null>(null);
  const dragLabelOffsetRef = useRef(0);
  const restrictBelowPins = useCallback<Modifier>(
    (args) => restrictBelowSidebarLabel(args, dragLabelOffsetRef.current),
    [],
  );
  const listMotionRef = useRef<ReturnType<typeof createSidebarListMotion> | null>(null);
  const attachListMotionRef = useCallback((node: HTMLUListElement | null) => {
    threadListRef.current = node;
    listMotionRef.current?.dispose();
    listMotionRef.current = node === null ? null : createSidebarListMotion(node);
    listMotionRef.current?.update(false);
  }, []);
  // A group's tabs resize its row in place. Re-baseline without animating so
  // the next list change measures from where rows actually are.
  const refreshListMotion = useCallback(() => listMotionRef.current?.update(false), []);
  // A group's tab list changed height in place (its "more" row, a limit, a new tab), so the
  // rows below glide to where it pushed them. Never mid-drag, which owns every row's position.
  const listMotionPausedRef = useRef(false);
  const animateListMotion = useCallback(() => {
    if (!listMotionPausedRef.current) listMotionRef.current?.update(true);
  }, []);

  // Hold the chosen section and order until every key write arrives. This
  // also covers first-time ordering, which assigns keys to keyless neighbors.
  // A failed write, concurrent reorder, or membership change releases the hold.
  const [dragState, setDragState] = useState<{
    readonly activeKey: string;
    readonly activeSection: SidebarSection;
    readonly occurredAt: string;
    readonly activationY: number | null;
    readonly targetSection: SidebarSection | null;
  } | null>(null);
  const dragTargetSection = dragState?.targetSection ?? null;
  const dragSensorRef = useRef<SidebarPointerSensor | null>(null);
  const finishThreadDrag = useCallback((started: boolean) => {
    dragSensorRef.current = null;
    if (started) {
      listMotionRef.current?.release();
      setDragState(null);
    }
  }, []);
  const attachDragSensor = useCallback((sensor: SidebarPointerSensor) => {
    dragSensorRef.current = sensor;
  }, []);
  const cancelThreadDrag = useCallback(() => {
    dragSensorRef.current?.cancel();
  }, []);
  const dndSensors = useSensors(
    useSensor(SidebarPointerSensor, {
      distance: 6,
      onAttach: attachDragSensor,
      onFinish: finishThreadDrag,
    }),
  );
  const sectionByThreadKey = useMemo(() => {
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
    add(settledThreads, "settled");
    return map;
  }, [activeThreads, pinnedThreads, settledThreads, snoozedThreads, workingThreads]);
  const pinnedKeys = useMemo(
    () =>
      pinnedThreads.map((thread) =>
        scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      ),
    [pinnedThreads],
  );
  const activeKeys = useMemo(
    () =>
      activeThreads.map((thread) =>
        scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      ),
    [activeThreads],
  );
  useEffect(() => {
    if (optimisticDrop === null) return;
    const canonicalByKey = new Map(
      threads.map((thread) => [
        scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
        thread,
      ]),
    );
    const thread = canonicalByKey.get(optimisticDrop.key);
    if (thread === undefined || thread.archivedAt !== null) {
      setOptimisticDrop(null);
      return;
    }
    const canonicalSection = effectiveSnoozed(thread, { now: new Date().toISOString() })
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
      setOptimisticDrop(null);
      return;
    }
    if (optimisticDrop.order === null) {
      // Settle also emits unpin/unsnooze events. Wait for the entire move
      // before releasing the projected fields and sort timestamps.
      if (
        canonicalSection === optimisticDrop.section &&
        thread.pinnedAt == null &&
        (!optimisticDrop.clearsSnooze || thread.snoozedUntil == null)
      ) {
        setOptimisticDrop(null);
      }
      return;
    }
    if (canonicalSection !== optimisticDrop.section) return;
    if (optimisticDrop.clearsSnooze && thread.snoozedUntil != null) return;
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
    if (membershipChanged || foreignKeyLanded || allAssignmentsLanded) {
      setOptimisticDrop(null);
    }
  }, [activeKeys, optimisticDrop, pinnedKeys, threads]);
  const attemptPin = useCallback(
    (threadRef: ScopedThreadRef) => {
      void (async () => {
        // Fresh pins take the top of the arranged run: pinThread computes a
        // key before the smallest key across ALL pinned shells — including
        // snoozed pins hidden from this list, whose keys are still part of
        // the run — so the new pin can't land beneath a hidden head.
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
    },
    [pinThread],
  );
  const attemptUnpin = useCallback(
    (threadRef: ScopedThreadRef) => {
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
    },
    [confirmAndUnpinThread],
  );

  const handleThreadDragStart = useCallback(
    (event: DragStartEvent) => {
      const activeKey = String(event.active.id);
      const activeSection = sectionByThreadKey.get(activeKey);
      if (activeSection === undefined) return;
      // Stop normal section motion before dnd-kit measures the picked-up row.
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
        occurredAt: new Date().toISOString(),
        activationY:
          event.activatorEvent instanceof PointerEvent ? event.activatorEvent.clientY : null,
      });
    },
    [sectionByThreadKey],
  );
  // Include every visible row in the measured order. Older servers disable
  // pickup on their rows without changing where those rows render.
  const sidebarListItems = useMemo((): readonly SidebarListItem[] => {
    const rowsOf = (
      list: readonly EnvironmentThreadShell[],
      section: SidebarSection,
    ): SidebarListItem[] =>
      list.map((thread) => {
        const key = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
        return { kind: "thread", key, section };
      });
    if (
      pinnedThreads.length +
        activeThreads.length +
        workingThreads.length +
        snoozedThreads.length +
        settledThreads.length ===
      0
    ) {
      return [];
    }
    const items: SidebarListItem[] = [{ kind: "marker", marker: "pinned-header" }];
    const pinnedRows = rowsOf(pinnedThreads, "pinned");
    items.push(...pinnedRows);
    items.push({ kind: "marker", marker: "pinned-divider" });
    const activeRows = rowsOf(activeThreads, "active");
    items.push({ kind: "marker", marker: "active-placeholder" });
    items.push(...activeRows);
    if (workingThreads.length > 0) {
      items.push({ kind: "marker", marker: "working-header" });
      items.push(...rowsOf(visibleWorkingThreads, "working"));
    }
    if (snoozedThreads.length > 0) {
      items.push({ kind: "marker", marker: "snoozed-header" });
      items.push(...rowsOf(visibleSnoozedThreads, "snoozed"));
    }
    items.push({ kind: "marker", marker: "settled-header" });
    const settledRows = rowsOf(renderedSettledThreads, "settled");
    items.push({ kind: "marker", marker: "settled-placeholder" });
    items.push(...settledRows);
    return items;
  }, [
    activeThreads,
    pinnedThreads,
    renderedSettledThreads,
    settledThreads.length,
    snoozedThreads.length,
    visibleSnoozedThreads,
    visibleWorkingThreads,
    workingThreads.length,
  ]);
  useEffect(() => {
    if (
      dragState !== null &&
      !sidebarListItems.some((item) => item.kind === "thread" && item.key === dragState.activeKey)
    ) {
      cancelThreadDrag();
    }
  }, [cancelThreadDrag, dragState, sidebarListItems]);
  const listMotionPaused = dragState !== null;
  listMotionPausedRef.current = listMotionPaused;
  // Every shell event rebuilds sidebarListItems, but rows only move when the
  // rendered order or a row's section changes. Keying the motion pass on that
  // keeps ordinary updates from forcing a layout read and animating rows
  // whose position drifted for other reasons.
  const sidebarListOrderKey = useMemo(
    () =>
      sidebarListItems
        .map((item) => (item.kind === "thread" ? `${item.key}:${item.section}` : item.marker))
        .join("\0"),
    [sidebarListItems],
  );
  const sidebarListHasRows = sidebarListItems.length + visibleDraftSessionCount > 0;
  useLayoutEffect(() => {
    // Drag release clears the baseline, so its commit cannot replay the
    // sortable preview; rows glide from their released positions instead.
    // Later thread actions can animate while writes settle.
    // Draft navigation can reveal a frozen row without changing the draft count.
    void sidebarListOrderKey;
    listMotionRef.current?.update(!listMotionPaused && sidebarListHasRows);
  }, [
    listMotionPaused,
    routeDraftIdForRows,
    sidebarListHasRows,
    sidebarListOrderKey,
    visibleDraftSessionCount,
  ]);
  const handleThreadDragOver = useCallback(
    (event: DragOverEvent) => {
      const target = event.over
        ? resolveSidebarDropTarget(sidebarListItems, String(event.active.id), String(event.over.id))
        : null;
      setDragState((current) =>
        current === null || current.activeKey !== String(event.active.id)
          ? current
          : { ...current, targetSection: target?.section ?? null },
      );
    },
    [sidebarListItems],
  );
  const sortableIds = useMemo(() => sidebarListItems.map(sidebarListItemId), [sidebarListItems]);
  const draggedSettledOrder = useMemo(() => {
    const thread = dragState === null ? undefined : threadByKey.get(dragState.activeKey);
    if (dragState === null || thread === undefined) return [];
    const key = (candidate: EnvironmentThreadShell) =>
      scopedThreadKey(scopeThreadRef(candidate.environmentId, candidate.id));
    return sortSettledThreads([
      ...settledThreads.filter((candidate) => key(candidate) !== dragState.activeKey),
      applySidebarThreadDrop(thread, "settled", dragState.occurredAt),
    ]).map(key);
  }, [dragState, settledThreads, threadByKey]);
  // Working beta: the inbox is time-ordered too, so the preview shows the
  // slot a drop will land in, not the slot under the pointer.
  const draggedActiveOrder = useMemo(() => {
    const thread = dragState === null ? undefined : threadByKey.get(dragState.activeKey);
    if (!workingShelfEnabled || dragState === null || thread === undefined) return undefined;
    const key = (candidate: EnvironmentThreadShell) =>
      scopedThreadKey(scopeThreadRef(candidate.environmentId, candidate.id));
    return sortInboxThreadsByReturn(
      [
        ...activeThreads.filter((candidate) => key(candidate) !== dragState.activeKey),
        applySidebarThreadDrop(thread, "active", dragState.occurredAt),
      ],
      (candidate) => observedInboxReturns.get(key(candidate)),
    ).map(key);
  }, [activeThreads, dragState, threadByKey, workingShelfEnabled]);
  const sidebarSortingStrategy = useMemo(
    () =>
      createSidebarSortingStrategy({
        items: sidebarListItems,
        boundaryLabelHeight: SIDEBAR_DRAG_LABEL_HEIGHT,
        settledOrder: draggedSettledOrder,
        ...(draggedActiveOrder === undefined ? {} : { activeOrder: draggedActiveOrder }),
        settledExpanded: settledShelfExpanded,
        settledVisibleCount,
        routeThreadKey: sidebarRouteThreadKey,
        snoozedThreadCount: snoozedThreads.length,
      }),
    [
      draggedActiveOrder,
      draggedSettledOrder,
      sidebarRouteThreadKey,
      settledShelfExpanded,
      settledVisibleCount,
      sidebarListItems,
      snoozedThreads.length,
    ],
  );
  // Hidden and filtered threads keep their keys. Reserve those slots without
  // including the rows in the visible drop order or writing to them.
  const { pinnedKeysById, activeKeysById } = useMemo(
    () => ({
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
    }),
    [threads],
  );
  const draggedThreadKey = dragState?.activeKey;
  const draggedFromSection = dragState?.activeSection;
  const dragActivationY = dragState?.activationY;
  const dndCollisionDetection = useMemo(() => {
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
            supportsSettlement:
              serverConfigs.get(source.environmentId)?.environment.capabilities.threadSettlement ===
              true,
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
  }, [
    activeKeysById,
    pinnedKeysById,
    serverConfigs,
    activeKeys,
    activeReorderableThreadKeys,
    draggedThreadKey,
    draggedFromSection,
    dragActivationY,
    draggableThreadKeys,
    pinnedKeys,
    sidebarListItems,
    threadByKey,
    workingShelfEnabled,
  ]);
  const handleThreadDragEnd = useCallback(
    (event: DragEndEvent) => {
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
        supportsSettlement:
          serverConfigs.get(activeThread.environmentId)?.environment.capabilities
            .threadSettlement === true,
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
      const drop = {
        key: activeKey,
        sourceSection: activeSection,
        section: target.section,
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
          // A late failure must not cancel a newer drag's preview.
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
                currentThreadKey: routeThreadKeyRef.current,
                action: "settle",
                now: new Date().toISOString(),
                thread: readThreadShell(threadRef),
              })
            )
              navigateAfterSettle?.();
            return;
          }
          case "move-active":
            // The drag expresses unpin intent; button/menu confirmation is unchanged.
            if (plan.unpin && !(await run(unpinThread(threadRef), "Failed to unpin thread")))
              return;
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
                pinThread(
                  threadRef,
                  plan.orderKey === undefined ? {} : { orderKey: plan.orderKey },
                ),
                "Failed to pin thread",
              ))
            )
              return;
            break;
          case "reorder-pinned":
            break;
        }
        // Stop on failure; each successful key write remains a valid placement.
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
    },
    [
      activeKeysById,
      pinnedKeysById,
      serverConfigs,
      activeKeys,
      activeReorderableThreadKeys,
      draggableThreadKeys,
      pinThread,
      pinnedKeys,
      planForwardNavigation,
      reorderPinnedThread,
      reorderActiveThread,
      sectionByThreadKey,
      settleThread,
      sidebarListItems,
      threadByKey,
      unpinThread,
      unsettleThread,
      unsnoozeThread,
      workingShelfEnabled,
    ],
  );
  // One snooze per thread at a time — same double-dispatch guard as settle.
  const snoozingThreadKeysRef = useRef(new Set<string>());
  const performSnooze = useCallback(
    async (
      threadRef: ScopedThreadRef,
      preset: Pick<SnoozePreset, "snoozedUntil">,
      opts: { coSnoozingKeys?: ReadonlySet<string> } = {},
    ) => {
      const threadKey = scopedThreadKey(threadRef);
      if (snoozingThreadKeysRef.current.has(threadKey)) {
        return { status: "skipped" } as const;
      }
      snoozingThreadKeysRef.current.add(threadKey);
      try {
        // Snoozing the open thread moves you forward, same as settle —
        // both park the thread you're done with for now.
        const navigateAfterSnooze = planForwardNavigation(threadKey, opts.coSnoozingKeys);
        const result = await snoozeThread(threadRef, preset.snoozedUntil);
        if (result._tag === "Failure") {
          // Never navigate away from a thread that did not snooze.
          return isAtomCommandInterrupted(result)
            ? ({ status: "interrupted" } as const)
            : ({ status: "failure", error: squashAtomCommandFailure(result) } as const);
        }
        // Only move forward if the user is still on the snoozed thread —
        // a navigation made during the await wins over ours.
        if (
          shouldNavigateAfterThreadPark({
            threadKey,
            currentThreadKey: routeThreadKeyRef.current,
            action: "snooze",
            now: new Date().toISOString(),
            thread: readThreadShell(threadRef),
          })
        ) {
          navigateAfterSnooze?.();
        }
        return { status: "success" } as const;
      } finally {
        snoozingThreadKeysRef.current.delete(threadKey);
      }
    },
    [planForwardNavigation, snoozeThread],
  );
  const attemptSnooze = useCallback(
    (
      threadRef: ScopedThreadRef,
      preset: Pick<SnoozePreset, "snoozedUntil">,
      opts: { coSnoozingKeys?: ReadonlySet<string> } = {},
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
    },
    [performSnooze],
  );

  const removeFromSelection = useThreadSelectionStore((s) => s.removeFromSelection);
  const handleMultiSelectContextMenu = useCallback(
    async (position: { x: number; y: number }) => {
      const api = readLocalApi();
      if (!api) return;
      // One exact actionable set: keys whose rows are actually rendered
      // right now. Selections can outlive their rows (settled-tail paging,
      // thread deletion elsewhere) and the menu labels must count only what
      // the actions will touch.
      const selectedThreadKeys = [...useThreadSelectionStore.getState().selectedThreadKeys];
      const threadKeys = selectedThreadKeys.filter((threadKey) =>
        threadByKeyRef.current.has(threadKey),
      );
      if (threadKeys.length === 0) return;
      const count = threadKeys.length;
      // Snooze (N) is offered when every selected thread can actually take
      // it — a mixed selection with blocked-on-you work would half-apply.
      const selectionNow = new Date();
      const selectedThreads = threadKeys.flatMap((threadKey) => {
        const thread = threadByKeyRef.current.get(threadKey);
        return thread ? [thread] : [];
      });
      const canSnoozeSelection = selectedThreads.every(
        (thread) =>
          serverConfigs.get(thread.environmentId)?.environment.capabilities.threadSnooze === true &&
          canSnooze(thread, { now: selectionNow.toISOString() }),
      );
      const titleRegenerationThreads = selectedThreads.filter(
        (thread) =>
          serverConfigs.get(thread.environmentId)?.environment.capabilities
            .threadTitleRegeneration === true,
      );
      const regeneratableTitleThreads = titleRegenerationThreads.filter(
        (thread) => thread.titleRegeneration == null,
      );
      const titleRegenerationMenuItem = buildBulkTitleRegenerationContextMenuItem({
        supportedCount: titleRegenerationThreads.length,
        actionableCount: regeneratableTitleThreads.length,
      });
      // Unpin (k) counts only the pinned rows in pin-capable environments —
      // on a mixed selection the unpinned rows are untouched, and the item
      // is omitted entirely when nothing selected is pinned.
      const pinnedSelectedThreads = selectedThreads.filter(
        (thread) =>
          serverConfigs.get(thread.environmentId)?.environment.capabilities.threadPinning ===
            true && thread.pinnedAt != null,
      );
      const unpinMenuItem = buildBulkUnpinContextMenuItem({
        pinnedCount: pinnedSelectedThreads.length,
      });
      const snoozePresets = resolveSnoozePresets(new Date(), timestampFormat);
      const clicked = await settlePromise(() =>
        api.contextMenu.show(
          [
            ...(unpinMenuItem ? [unpinMenuItem] : []),
            { id: "settle", label: `Settle (${count})` },
            ...(canSnoozeSelection
              ? [
                  {
                    id: "snooze",
                    label: `Snooze (${count})`,
                    children: [
                      ...snoozePresets.map((preset) => ({
                        id: `snooze:${preset.id}`,
                        label: `${preset.label} (${preset.whenLabel})`,
                      })),
                      { id: "snooze:custom", label: "Custom…", separatorBefore: true },
                    ],
                  },
                ]
              : []),
            ...(titleRegenerationMenuItem ? [titleRegenerationMenuItem] : []),
            { id: "mark-unread", label: `Mark unread (${count})` },
            { id: "delete", label: `Delete (${count})`, destructive: true },
          ],
          position,
        ),
      );
      if (clicked._tag === "Failure") return;
      if (clicked.value?.startsWith("snooze:")) {
        const preset =
          clicked.value === "snooze:custom"
            ? await requestCustomSnooze()
            : snoozePresets.find((candidate) => `snooze:${candidate.id}` === clicked.value);
        if (preset) {
          // Post-snooze navigation must skip threads snoozing in this same
          // batch — they are all leaving the card block together.
          const coSnoozingKeys = new Set(threadKeys);
          clearSelection();
          const outcomes = await Promise.all(
            selectedThreads.map(async (thread) => {
              const threadRef = scopeThreadRef(thread.environmentId, thread.id);
              const outcome = await performSnooze(threadRef, preset, { coSnoozingKeys });
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
        // Each unpin reports its own failure, like the single-row action.
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
        // Post-settle navigation must skip threads settling in this same
        // batch — they are all leaving the card block together. Rows that
        // are already explicitly settled are skipped: nothing to do on a
        // valid mixed selection. Pinned rows ARE included: the decider
        // clears the pin as part of settling, so they park like the rest.
        const coSettlingKeys = new Set(threadKeys);
        for (const threadKey of threadKeys) {
          const thread = threadByKeyRef.current.get(threadKey);
          if (!thread || thread.settledOverride === "settled") continue;
          attemptSettle(scopeThreadRef(thread.environmentId, thread.id), { coSettlingKeys });
        }
        clearSelection();
        return;
      }
      if (clicked.value === "mark-unread") {
        for (const threadKey of threadKeys) {
          const thread = threadByKeyRef.current.get(threadKey);
          markThreadUnread(threadKey, thread?.latestTurn?.completedAt);
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
    [
      attemptSettle,
      attemptUnpin,
      clearSelection,
      confirmThreadDelete,
      deleteThread,
      markThreadUnread,
      performSnooze,
      removeFromSelection,
      serverConfigs,
      updateThreadMetadata,
      timestampFormat,
    ],
  );

  const handleThreadContextMenu = useCallback(
    (threadRef: ScopedThreadRef, position: { x: number; y: number }) => {
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
        const threadWorkspacePath =
          thread.worktreePath ??
          projectByKey.get(`${thread.environmentId}:${thread.projectId}`)?.workspaceRoot ??
          null;
        // Un-settle pins the thread active until real activity clears the pin.
        // Environments without
        // the settlement capability get no lifecycle items at all.
        const supportsSettlement =
          serverConfigs.get(thread.environmentId)?.environment.capabilities.threadSettlement ===
          true;
        const supportsSnooze =
          serverConfigs.get(thread.environmentId)?.environment.capabilities.threadSnooze === true;
        const supportsPinning =
          serverConfigs.get(thread.environmentId)?.environment.capabilities.threadPinning === true;
        const supportsAutoSettleOptOut =
          serverConfigs.get(thread.environmentId)?.environment.capabilities
            .threadAutoSettleOptOut === true;
        const supportsTitleRegeneration =
          serverConfigs.get(thread.environmentId)?.environment.capabilities
            .threadTitleRegeneration === true;
        const isRegeneratingTitle = thread.titleRegeneration != null;
        const isSettled = settledThreadKeysRef.current.has(threadKey);
        const isSnoozed = snoozedThreadKeysRef.current.has(threadKey);
        const isPinned = thread.pinnedAt != null;
        // Presets resolve at menu-open time (same as the popover).
        const snoozePresets = resolveSnoozePresets(new Date(), timestampFormat);
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
            buildThreadActionMenuItems({
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
              isPinned,
              isSettled,
              autoSettleEnabled: thread.autoSettleDisabledAt == null,
              isSnoozed,
              canSnoozeNow: canSnooze(thread, { now: new Date().toISOString() }),
              isRegeneratingTitle,
              isRunning:
                thread.session?.status === "running" && thread.session.activeTurnId != null,
              supports: {
                settlement: supportsSettlement,
                autoSettleOptOut: supportsAutoSettleOptOut,
                snooze: supportsSnooze,
                pinning: supportsPinning,
                titleRegeneration: supportsTitleRegeneration,
              },
              snoozePresets,
            }),
            position,
          ),
        );
        if (clicked._tag === "Failure") return;
        if (clicked.value?.startsWith("snooze:")) {
          const preset =
            clicked.value === "snooze:custom"
              ? await requestCustomSnooze()
              : snoozePresets.find((candidate) => `snooze:${candidate.id}` === clicked.value);
          if (preset) attemptSnooze(threadRef, preset);
          return;
        }
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
            if (threadProjectGroup) openProjectSettings(threadProjectGroup);
            return;
          case "new-tab":
            handleNewTab(threadRef);
            return;
          case "close-tab":
            handleCloseTab(threadRef);
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
            // Explicit branch carry-over: reuse the thread's worktree when it
            // has one, otherwise its branch on the local checkout.
            const result = await settlePromise(() =>
              handleNewThreadRef.current(scopeProjectRef(thread.environmentId, thread.projectId), {
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
          case "rename":
            startThreadRename(threadRef, thread.title);
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
            markThreadUnread(threadKey, thread.latestTurn?.completedAt);
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
            copyPathToClipboard(threadWorkspacePath, { path: threadWorkspacePath });
            return;
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
    [
      archiveThread,
      attemptPin,
      attemptSettle,
      attemptSnooze,
      attemptUnpin,
      attemptUnsettle,
      attemptUnsnooze,
      confirmThreadArchive,
      confirmThreadDelete,
      copyBranchToClipboard,
      copyPathToClipboard,
      copyThreadIdToClipboard,
      deleteThread,
      handleCloseTab,
      handleMultiSelectContextMenu,
      handleNewTab,
      isMobile,
      markThreadUnread,
      openProjectSettings,
      projectScopeKeys,
      projectByKey,
      serverConfigs,
      setOpenMobile,
      setProjectScopeKeys,
      setThreadAutoSettle,
      splitViewActions,
      startThreadRename,
      tabEnvironmentIds,
      updateThreadMetadata,
      timestampFormat,
    ],
  );

  const toggleShowTabs = useCallback(() => {
    void updateClientSettings({ sidebarShowTabs: !showTabs });
  }, [showTabs, updateClientSettings]);
  const toggleTabGroup = useCallback(
    (rowKey: string) =>
      setStoredTabGroupOverrides((stored) => {
        const overrides = stored.showTabs === showTabs ? stored.groups : NO_TAB_GROUP_OVERRIDES;
        const open = !isSidebarTabGroupOpen(rowKey, overrides, showTabs);
        return { showTabs, groups: setSidebarTabGroupOverride(overrides, rowKey, open, showTabs) };
      }),
    [setStoredTabGroupOverrides, showTabs],
  );
  const toggleTabsShortcutLabel = shortcutLabelForCommand(keybindings, "sidebar.toggleTabs");
  const toggleTabOverflow = useCallback((rowKey: string) => {
    setExpandedTabRowKey((current) => (current === rowKey ? null : rowKey));
  }, []);
  const tabSortOrderRef = useRef(tabSortOrder);
  tabSortOrderRef.current = tabSortOrder;
  // The list's pointer and the portaled "n more" preview both count as resting, so a live
  // sort does not reshuffle the tabs while you are reading or clicking the preview.
  const tabListPointerRowRef = useRef<string | null>(null);
  const tabOverflowPreviewRowRef = useRef<string | null>(null);
  const syncTabOrderHold = useCallback((rowKey: string) => {
    const holding =
      tabListPointerRowRef.current === rowKey || tabOverflowPreviewRowRef.current === rowKey;
    if (!holding) {
      setHeldTabOrder((held) => (held?.rowKey === rowKey ? null : held));
      return;
    }
    // Manual order only changes when you drop a tab, so there is nothing to hold.
    if (tabSortOrderRef.current === "manual") return;
    const ordered = tabLayoutByRowKeyRef.current.get(rowKey)?.ordered;
    if (ordered) setHeldTabOrder({ rowKey, keys: ordered.map(sidebarThreadKey) });
  }, []);
  const handleTabPointerRest = useCallback(
    (rowKey: string, resting: boolean) => {
      if (resting) tabListPointerRowRef.current = rowKey;
      else if (tabListPointerRowRef.current === rowKey) tabListPointerRowRef.current = null;
      syncTabOrderHold(rowKey);
    },
    [syncTabOrderHold],
  );
  const handleTabOverflowPreview = useCallback(
    (rowKey: string, open: boolean) => {
      const previous = tabOverflowPreviewRowRef.current;
      if (open) tabOverflowPreviewRowRef.current = rowKey;
      else if (previous === rowKey) tabOverflowPreviewRowRef.current = null;
      if (previous !== null && previous !== rowKey) syncTabOrderHold(previous);
      syncTabOrderHold(rowKey);
    },
    [syncTabOrderHold],
  );
  const threadsRef = useRef(threads);
  threadsRef.current = threads;
  // A drop in a timed order switches to Manual, starting from the order you were looking at.
  const handleTabReorder = useCallback(
    (rowKey: string, activeKey: string, overKey: string) => {
      const layout = tabLayoutByRowKeyRef.current.get(rowKey);
      if (!layout) return;
      const orderedKeys = moveSidebarTab(
        layout.ordered.map(sidebarThreadKey),
        layout.shown.map(sidebarThreadKey),
        activeKey,
        overKey,
      );
      const liveKeys = new Set(threadsRef.current.map(sidebarThreadKey));
      setTabManualRanks((ranks) => withSidebarTabRanks(ranks, orderedKeys, liveKeys));
      setHeldTabOrder(null);
      if (tabSortOrder === "manual") return;
      const previous = {
        sidebarTabSortOrder: tabSortOrder,
        sidebarTabSortDirection: tabSortDirection,
      };
      void updateClientSettings({ sidebarTabSortOrder: "manual" });
      const toastId = toastManager.add(
        stackedThreadToast({
          type: "info",
          title: "Tab order set to Manual",
          description: `Was ${SIDEBAR_TAB_SORT_ORDER_LABELS[tabSortOrder]}, ${sidebarTabSortDirectionLabel(
            tabSortOrder,
            tabSortDirection,
          ).toLowerCase()}.`,
          actionProps: {
            children: "Undo",
            onClick: () => {
              toastManager.close(toastId);
              void updateClientSettings(previous);
            },
          },
        }),
      );
    },
    [setTabManualRanks, tabSortDirection, tabSortOrder, updateClientSettings],
  );
  const handleTabsShownChange = useCallback(
    (shown: boolean, limit: number | null) => {
      void updateClientSettings({ sidebarShowTabs: shown, sidebarTabLimit: limit });
    },
    [updateClientSettings],
  );
  const handleTabSortOrderChange = useCallback(
    (order: SidebarTabSortOrder) => void updateClientSettings({ sidebarTabSortOrder: order }),
    [updateClientSettings],
  );
  const handleTabSortDirectionChange = useCallback(
    (direction: SidebarTabSortDirection) =>
      void updateClientSettings({ sidebarTabSortDirection: direction }),
    [updateClientSettings],
  );

  // Thread jump (cmd+1..9) and prev/next traversal reuse the same commands as
  // v1 — the keybinding layer is shared, only the ordered list differs.
  const routeTerminalOpen = useTerminalUiStateStore((state) =>
    routeThreadRef
      ? selectThreadTerminalUiState(state.terminalUiStateByThreadKey, routeThreadRef).terminalOpen
      : false,
  );
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
            currentThreadId: routeThreadKey,
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
    routeTerminalOpen,
    routeThreadKey,
    threadByKey,
    toggleShowTabs,
  ]);

  // Same predicate as v1: hints show only while the held modifiers exactly
  // match a thread-jump binding. Adding Shift (screenshots) or Alt no
  // longer matches ⌘1..9, so the overlay hides for chords like ⌘⇧4.
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
      },
    },
  );
  useEffect(() => {
    updateThreadJumpHintsVisibility(shouldShowJumpHintsNow);
  }, [shouldShowJumpHintsNow, updateThreadJumpHintsVisibility]);

  // New thread defaults to the project you're in (active thread's project,
  // falling back to the top project) — same resolution the command palette
  // uses. The command palette already offers a "New thread in..." submenu
  // for multi-project setups.
  const handleNewThreadClick = useCallback(
    (event?: ReactMouseEvent) => {
      // One project: nothing to pick, create immediately. Shift+click creates
      // directly in the current project even with several projects, skipping
      // the palette picker.
      if (shouldCreateNewThreadInCurrentProject(event?.shiftKey ?? false, projectGroups.length)) {
        if (isMobile) setOpenMobile(false);
        void startNewThreadFromContext({
          activeDraftThread: newThreadContext.activeDraftThread,
          activeThread: newThreadContext.activeThread ?? undefined,
          defaultProjectRef: newThreadContext.defaultProjectRef,
          handleNewThread: newThreadContext.handleNewThread,
        });
        return;
      }
      if (isMobile) setOpenMobile(false);
      openCommandPalette({ open: "new-thread-in" });
    },
    [isMobile, newThreadContext, projectGroups.length, setOpenMobile],
  );

  // The button mirrors chat.new: in multi-project setups both route through
  // the command palette's "New thread in..." picker, and in single-project
  // setups both create immediately. In multi-project setups the label is only
  // the picker's shortcut: falling back to chat.newLocal would advertise the
  // same shortcut for both the picker and direct create. In single-project
  // setups both commands create directly, so chat.newLocal is a valid
  // fallback. The second tooltip line (multi-project only) advertises
  // shift+click and its keyboard twin chat.newLocal for direct create.
  const newThreadShortcutLabel =
    shortcutLabelForCommand(keybindings, "chat.new") ??
    (projectGroups.length <= 1 ? shortcutLabelForCommand(keybindings, "chat.newLocal") : undefined);
  const newThreadInProjectShortcutLabel = shortcutLabelForCommand(keybindings, "chat.newLocal");
  return (
    <>
      <SidebarChromeHeader isElectron={isElectron} />
      <SidebarContent
        className="min-h-full"
        fixedHeader={
          // Lifted above the stage backdrop, whose fade bleeds below the
          // header and would otherwise paint across the search row's outline.
          <SidebarGroup className="z-[1]">
            <SidebarThreadHeader
              searchFieldRef={headerSearchRef}
              hasProjects={projectGroups.length > 0}
              projectScope={
                <Combobox
                  multiple
                  items={projectScopeItems}
                  filteredItems={filteredProjectScopeItems}
                  autoHighlight
                  itemToStringLabel={(item) => item.label}
                  isItemEqualToValue={(a, b) => a.value === b.value}
                  open={projectScopeMenuState.open}
                  onOpenChange={(open) => {
                    if (open) suppressNextScopeChangeRef.current = false;
                    dispatchProjectScopeMenu({ type: "open-changed", open });
                  }}
                  onItemHighlighted={(item) => {
                    highlightedProjectScopeKeyRef.current = item?.value ?? null;
                  }}
                  value={selectedProjectScopeItems}
                  onValueChange={(items) => {
                    if (suppressNextScopeChangeRef.current) {
                      suppressNextScopeChangeRef.current = false;
                      return;
                    }
                    setProjectScopeKeys(
                      resolveSidebarProjectScopeKeys({
                        current: projectScopeKeys,
                        next: items.map((item) => item.value),
                      }),
                    );
                  }}
                  inputValue={projectScopeMenuState.query}
                  onInputValueChange={(query) =>
                    dispatchProjectScopeMenu({ type: "query-changed", query })
                  }
                >
                  <ComboboxTrigger
                    render={
                      <SidebarHeaderIconButton
                        label={
                          scopedProjectGroups.length > 0
                            ? `Filter threads by project: ${scopedProjectGroups
                                .map((project) => project.displayName)
                                .join(", ")}`
                            : "Filter threads by project"
                        }
                        tooltip={
                          scopedProjectGroups.length > 1 ? (
                            <span className="flex flex-col gap-1">
                              <span className="text-muted-foreground">Filtering threads by</span>
                              {scopedProjectGroups.map((project) => (
                                <span
                                  key={project.projectKey}
                                  className="flex items-center gap-1.5"
                                >
                                  <ProjectFavicon project={project} className="size-3.5" />
                                  {project.displayName}
                                </span>
                              ))}
                            </span>
                          ) : undefined
                        }
                      />
                    }
                  >
                    {scopedProjectGroups.length > 1 ? (
                      // Several scoped projects get a generic icon with a count; the
                      // tooltip lists them.
                      <span className="relative flex shrink-0">
                        <FoldersIcon className="size-4" />
                        <span className="absolute -right-1.5 -bottom-1 min-w-3 rounded-full bg-primary px-0.5 text-center text-3xs leading-3 font-semibold text-primary-foreground tabular-nums">
                          {scopedProjectGroups.length}
                        </span>
                      </span>
                    ) : scopedProjectGroups[0] ? (
                      // Wrapped so the button's direct-child svg color rule cannot override
                      // a project's own icon color.
                      <span className="flex shrink-0">
                        <ProjectFavicon project={scopedProjectGroups[0]} className="size-4" />
                      </span>
                    ) : (
                      <FolderIcon className="size-4" />
                    )}
                  </ComboboxTrigger>
                  <ComboboxPopup
                    align="start"
                    // Anchored to the search field, not the 28px trigger: the
                    // popup opens under the field, is at least as wide as it,
                    // and grows to fit project names up to a cap, past which
                    // the rows truncate.
                    anchor={headerSearchRef}
                    className="max-w-[min(18rem,var(--available-width))] overflow-hidden"
                  >
                    <ComboboxSearchInput
                      aria-label="Search projects"
                      placeholder="Search projects..."
                      onKeyDown={(event) => {
                        if (
                          event.defaultPrevented ||
                          event.nativeEvent.isComposing ||
                          event.ctrlKey ||
                          event.altKey ||
                          event.metaKey ||
                          (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10"))
                        ) {
                          return;
                        }
                        // Combobox items use virtual focus: keyboard events
                        // stay on this input, not on the highlighted option.
                        const scopeKey = highlightedProjectScopeKeyRef.current;
                        const project = scopeKey ? projectGroupByScopeKey.get(scopeKey) : null;
                        if (project) handleProjectSettings(event, project);
                      }}
                    />
                    <ComboboxEmpty>No matching projects.</ComboboxEmpty>
                    <ComboboxList>
                      {(item: (typeof projectScopeItems)[number]) => {
                        const project = projectGroupByScopeKey.get(item.value) ?? null;
                        return (
                          <ComboboxItem
                            key={item.value}
                            hideIndicator
                            value={item}
                            onContextMenu={(event) => {
                              if (project) handleProjectSettings(event, project);
                            }}
                          >
                            {project ? (
                              <ProjectFavicon project={project} className="size-4 shrink-0" />
                            ) : (
                              <FolderIcon className="size-4 shrink-0" />
                            )}
                            <span className="min-w-0 flex-1 truncate text-sm">{item.label}</span>
                            {project && showProjectEnvironments ? (
                              <ProjectEnvironmentBadge
                                group={project}
                                primaryEnvironmentId={primaryEnvironmentId}
                                machineByEnvironmentId={environmentMachineById}
                              />
                            ) : null}
                            {project ? (
                              // Shown on the highlighted row: scope to just this
                              // project and close, instead of toggling it. Its
                              // space is always reserved, so highlighting a row
                              // truncates nothing new and never widens the popup.
                              <button
                                type="button"
                                tabIndex={-1}
                                className="invisible shrink-0 cursor-pointer text-xs font-medium text-primary in-data-highlighted:visible hover:text-primary/80"
                                onPointerDown={(event) => event.stopPropagation()}
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  setProjectScopeKeys([project.projectKey]);
                                  dispatchProjectScopeMenu({ type: "open-changed", open: false });
                                }}
                              >
                                Only
                              </button>
                            ) : null}
                            <CheckIcon
                              aria-hidden="true"
                              className={cn(
                                "ml-auto size-3.5 text-primary",
                                !selectedProjectScopeValues.has(item.value) && "invisible",
                              )}
                            />
                            {project ? (
                              <Button
                                size="icon-xs"
                                variant="ghost-muted"
                                tabIndex={-1}
                                aria-hidden="true"
                                title={`Project settings for ${project.displayName}`}
                                onPointerDown={(event) => event.stopPropagation()}
                                onClick={(event) => {
                                  void handleProjectSettings(event, project);
                                }}
                              >
                                <SettingsIcon className="size-3.5" />
                              </Button>
                            ) : null}
                          </ComboboxItem>
                        );
                      }}
                    </ComboboxList>
                  </ComboboxPopup>
                </Combobox>
              }
              attentionInbox={<SidebarAttentionInbox />}
              onNewProject={openAddProjectCommandPalette}
              onNewThread={handleNewThreadClick}
              newThreadDisabled={projects.length === 0}
              newThreadShortcutLabel={newThreadShortcutLabel}
              newThreadInProjectShortcutLabel={newThreadInProjectShortcutLabel}
              showNewThreadInProjectHint={projectGroups.length > 1}
              searchInputRef={threadSearchInputRef}
              searchQuery={threadSearchQuery}
              onSearchQueryChange={(value) => {
                setThreadSearchQuery(value);
                setActiveSearchResultIndex(0);
              }}
              onSearchKeyDown={handleThreadSearchKeyDown}
              isSearching={isSearchingThreads}
              searchResultCount={threadSearchResults.length}
              activeSearchResultIndex={activeSearchResultIndex}
              onClearSearch={clearThreadSearch}
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
                        environmentLabel={environmentLabelById.get(thread.environmentId) ?? null}
                        environmentMachine={
                          environmentMachineById.get(thread.environmentId) ?? "server"
                        }
                        providerEntryByInstanceId={
                          providerEntriesByEnvironment.get(thread.environmentId) ??
                          EMPTY_PROVIDER_ENTRIES
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
                <SidebarDragLifecycle onUnmount={cancelThreadDrag} />
                <SortableContext items={sortableIds} strategy={sidebarSortingStrategy}>
                  <ul
                    ref={attachListMotionRef}
                    // VoiceOver treats an exposed list as an interaction boundary,
                    // which hides its rows from ordinary linear navigation. A
                    // presentational list also makes its implicit listitems
                    // presentational while preserving every descendant control.
                    role="presentation"
                    className={cn(
                      "relative flex flex-col gap-px",
                      sidebarListItems.length > 0 && "flex-1",
                    )}
                  >
                    {(() => {
                      const renderThreadRowInner = (
                        thread: EnvironmentThreadShell,
                        section: SidebarSection,
                        sortable?: SortableThreadRowBag,
                      ) => {
                        const threadKey = scopedThreadKey(
                          scopeThreadRef(thread.environmentId, thread.id),
                        );
                        // Settled and snoozed are the ONLY things that collapse a
                        // row: every other thread is a full card. Density comes
                        // from users (or the auto rules) actually parking work,
                        // not from the sidebar second-guessing what still matters.
                        // Working rows stay cards so their live status shows.
                        const isCard =
                          section === "active" || section === "pinned" || section === "working";
                        const rowVariant = isCard ? "card" : "slim";
                        const rowTabs = tabsByRowKey.get(threadKey);
                        const rowTabsOpen = listedTabsByRowKey.has(threadKey);
                        const rowTabLayout = tabLayoutByRowKey.get(threadKey);
                        const rowTabList =
                          rowTabLayout?.shown ?? (isCard ? [thread, ...(rowTabs ?? [])] : rowTabs);
                        const displayThread = displayTabsByRowKey.get(threadKey) ?? thread;
                        const displayThreadKey = sidebarThreadKey(displayThread);
                        return (
                          <SidebarThreadRow
                            // Fade between card and compact rows while the outer
                            // sortable wrapper keeps its identity during a drag.
                            key={`${threadKey}:${rowVariant}`}
                            thread={thread}
                            displayThread={displayThread}
                            variant={rowVariant}
                            // Snoozed rows wake, settled rows un-settle, and cards settle.
                            variantAction={
                              section === "snoozed"
                                ? "unsnooze"
                                : section === "settled"
                                  ? "unsettle"
                                  : "settle"
                            }
                            settlementSupported={
                              serverConfigs.get(thread.environmentId)?.environment.capabilities
                                .threadSettlement === true
                            }
                            snoozeSupported={
                              serverConfigs.get(thread.environmentId)?.environment.capabilities
                                .threadSnooze === true
                            }
                            pinningSupported={
                              serverConfigs.get(thread.environmentId)?.environment.capabilities
                                .threadPinning === true
                            }
                            isPinned={thread.pinnedAt != null}
                            sortable={sortable}
                            dropVerb={
                              dragState?.activeKey === threadKey
                                ? resolveSidebarDropVerb(dragState.activeSection, dragTargetSection)
                                : null
                            }
                            dragOverPinned={
                              dragState?.activeKey === threadKey && dragTargetSection === "pinned"
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
                            groupFocused={
                              rowTabsOpen &&
                              isCard &&
                              rowTabs?.some(
                                (tab) => sidebarThreadKey(tab) === highlightedRouteThreadKey,
                              ) === true
                            }
                            openPullRequestsInRightPanel={routeThreadRef !== null}
                            jumpLabel={
                              showThreadJumpHints ? (jumpLabelByKey.get(threadKey) ?? null) : null
                            }
                            currentEnvironmentId={primaryEnvironmentId}
                            environmentLabel={
                              environmentLabelById.get(thread.environmentId) ?? null
                            }
                            environmentMachine={
                              environmentMachineById.get(thread.environmentId) ?? "server"
                            }
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
                            onRenameTitleChange={setRenamingTitle}
                            onCommitRename={commitThreadRename}
                            onCancelRename={cancelThreadRename}
                            isRenaming={renamingThreadKey === displayThreadKey}
                            renamingTitle={
                              renamingThreadKey === displayThreadKey ? renamingTitle : ""
                            }
                            onContextMenu={handleThreadContextMenu}
                            onSettle={attemptSettle}
                            onUnsettle={attemptUnsettle}
                            onSnooze={attemptSnooze}
                            onUnsnooze={attemptUnsnooze}
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
                                      <SortableThreadRow
                                        key={tabKey}
                                        id={tabKey}
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
                                            jumpLabel={
                                              showThreadJumpHints
                                                ? (jumpLabelByKey.get(tabKey) ?? null)
                                                : null
                                            }
                                            environmentLabel={
                                              environmentLabelById.get(tab.environmentId) ?? null
                                            }
                                            environmentMachine={
                                              environmentMachineById.get(tab.environmentId) ??
                                              "server"
                                            }
                                            project={projectByKey.get(tabProjectKey) ?? null}
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
                                      </SortableThreadRow>
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
                                      onOpenTab={navigateToThread}
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
                      const renderThreadRow = (
                        thread: EnvironmentThreadShell,
                        section: SidebarSection,
                      ) => {
                        const threadKey = scopedThreadKey(
                          scopeThreadRef(thread.environmentId, thread.id),
                        );
                        return (
                          <SortableThreadRow
                            key={threadKey}
                            id={threadKey}
                            disabled={
                              renamingThreadKey ===
                                sidebarThreadKey(displayTabsByRowKey.get(threadKey) ?? thread) ||
                              section === "working" ||
                              !draggableThreadKeys.has(threadKey) ||
                              optimisticDrop !== null
                            }
                          >
                            {(bag) => renderThreadRowInner(thread, section, bag)}
                          </SortableThreadRow>
                        );
                      };
                      const from = dragState?.activeSection ?? null;
                      const items: ReactNode[] = [
                        <SidebarDraftBlock
                          key="draft-sessions"
                          projectByKey={projectByKey}
                          projectDisplayNameByKey={projectDisplayNameByKey}
                          scopedProjectKeys={scopedProjectKeys}
                          routeDraftId={routeDraftIdForRows}
                          onNavigateToDraft={navigateToDraft}
                        />,
                      ];
                      for (const item of sidebarListItems) {
                        if (item.kind === "thread") {
                          items.push(renderThreadRow(threadByKey.get(item.key)!, item.section));
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
                                label={
                                  workingShelfExpanded
                                    ? "Working"
                                    : `Working (${workingThreads.length})`
                                }
                                toggle={{
                                  expanded: workingShelfExpanded,
                                  onToggle: toggleWorkingShelf,
                                }}
                              />,
                            );
                            break;
                          case "snoozed-header":
                            items.push(
                              <SidebarSectionHeader
                                key="snoozed-shelf-header"
                                marker="snoozed-header"
                                className={cn(workingThreads.length === 0 && "mt-auto")}
                                label={
                                  snoozedShelfExpanded
                                    ? "Snoozed"
                                    : `Snoozed (${snoozedThreads.length})`
                                }
                                toggle={{
                                  expanded: snoozedShelfExpanded,
                                  onToggle: toggleSnoozedShelf,
                                }}
                              />,
                            );
                            break;
                          case "settled-header":
                            items.push(
                              <SidebarSectionHeader
                                key="settled-shelf-header"
                                marker="settled-header"
                                className={cn(
                                  workingThreads.length + snoozedThreads.length === 0 && "mt-auto",
                                )}
                                label={
                                  settledShelfExpanded
                                    ? "Settled"
                                    : `Settled (${settledThreads.length})`
                                }
                                dragging={from !== null}
                                isDropTarget={dragTargetSection === "settled"}
                                toggle={{
                                  expanded: settledShelfExpanded,
                                  onToggle: toggleSettledShelf,
                                }}
                              />,
                            );
                            break;
                          case "settled-placeholder":
                            items.push(
                              <SidebarSectionPlaceholder
                                key="settled-placeholder"
                                marker="settled-placeholder"
                                label="Settled"
                                showHint={
                                  from !== null &&
                                  (renderedSettledThreads.length === 0 ||
                                    (from === "settled" &&
                                      renderedSettledThreads.length === 1 &&
                                      dragTargetSection !== null &&
                                      dragTargetSection !== "settled"))
                                }
                                isDropTarget={dragTargetSection === "settled"}
                              />,
                            );
                            break;
                        }
                      }
                      return items;
                    })()}
                    {settledShelfExpanded && hiddenSettledCount > 0 ? (
                      <li className="list-none">
                        <button
                          type="button"
                          onClick={showMoreSettled}
                          className="flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-left text-sm text-sidebar-muted-foreground/55 hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
                        >
                          <PlusIcon aria-hidden className="size-4 shrink-0" />
                          Show {Math.min(hiddenSettledCount, SETTLED_TAIL_PAGE_COUNT)} more
                        </button>
                      </li>
                    ) : null}
                  </ul>
                </SortableContext>
              </DndContext>
            </TooltipProvider>
          ) : null}
          {!isSearchingThreads &&
          visibleDraftSessionCount === 0 &&
          pinnedThreads.length +
            activeThreads.length +
            workingThreads.length +
            snoozedThreads.length +
            settledThreads.length ===
            0 ? (
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
