import { type SidebarInboxThread as ThreadStatusInput } from "./sidebar/organization.logic";
import { resolveThreadWorkingStartedAt } from "@t3tools/client-runtime/state/models";
import { backgroundWorkHoldsCompletion } from "@t3tools/shared/orchestrationV2PendingBackgroundWork";
import { threadPullRequestSearchTerms } from "@t3tools/client-runtime/thread-pull-requests";
import * as React from "react";
import {
  isAtomCommandInterrupted,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { defaultAnimateLayoutChanges, type AnimateLayoutChanges } from "@dnd-kit/sortable";
import {
  threadSearchMatchKey,
  threadSearchSubject,
  type ThreadSearchShell,
} from "@t3tools/client-runtime/state/thread-search";
import { foldSearchQuery, rankSearchItems, scoreThreadSearch } from "@t3tools/shared/paletteSearch";

import { hasUnseenCompletion as hasUnseenTurnCompletion } from "@t3tools/client-runtime/state/attention-inbox";
import { type ContextMenuItem, type EnvironmentId, type ThreadId } from "@t3tools/contracts";
import type {
  SidebarProjectSortOrder,
  SidebarTabSortDirection,
  SidebarTabSortOrder,
  SidebarThreadSortOrder,
} from "@t3tools/contracts/settings";
import * as Schema from "effect/Schema";
import type { AsyncResult } from "effect/reactivity";
import { planPinnedReorder } from "@t3tools/client-runtime/state/thread-sort";
import {
  effectiveSnoozed,
  type ThreadSnoozeShell,
} from "@t3tools/client-runtime/state/thread-settled";
import {
  getThreadSortTimestamp,
  sortThreads,
  toSortableTimestamp,
  type ThreadSortInput,
} from "../lib/threadSort";
import type { SidebarThreadSummary, Thread } from "../types";
import { normalizeSearchText } from "../lib/utils";
import { isLatestRunSettled } from "../session-logic";
import { resolveServerBackedAppStageLabel } from "../branding.logic";
import { observeIntersection } from "../lib/observeIntersection";
import { deadlineAfter, deadlineStore } from "@t3tools/client-runtime/clock";
import { useDeadlinePassed } from "../hooks/useDeadline";

export function shouldNavigateAfterThreadPark(input: {
  readonly threadKey: string;
  readonly currentThreadKey: string | null;
  readonly action: "settle" | "snooze";
  readonly now: string;
  readonly thread: (ThreadSnoozeShell & Pick<SidebarThreadSummary, "settledOverride">) | null;
}): boolean {
  return (
    input.threadKey === input.currentThreadKey &&
    input.thread !== null &&
    (input.action === "settle"
      ? input.thread.settledOverride === "settled"
      : effectiveSnoozed(input.thread, { now: input.now }))
  );
}

const THREAD_SELECTION_SAFE_SELECTOR = "[data-thread-item], [data-thread-selection-safe]";
export const THREAD_JUMP_HINT_SHOW_DELAY_MS = 200;

export function resolveSidebarRowAccessibility(input: {
  readonly title: string;
  readonly statusLabel: string | null;
  readonly projectDisplayName: string | null;
  readonly isActive: boolean;
  /** Speaks the row's bot icon, which the row's own label otherwise hides. */
  readonly startedByAgent?: boolean;
}): { readonly label: string; readonly current: "page" | undefined } {
  return {
    label: [
      input.title,
      input.statusLabel,
      input.startedByAgent ? "Started by an agent" : null,
      input.projectDisplayName,
    ]
      .filter(Boolean)
      .join(", "),
    current: input.isActive ? "page" : undefined,
  };
}

// Each prewarm retains growing thread detail and a live subscription, multiplying heap and server load.
const SIDEBAR_THREAD_PREWARM_LIMIT = 3;
const SIDEBAR_ROW_SUBSCRIPTION_OVERSCAN_PX = 160;

export function useSidebarRowSubscriptionLease(isActive: boolean): {
  readonly leaseLiveStatus: boolean;
  readonly rowRef: (row: HTMLElement | null) => (() => void) | undefined;
} {
  const [isNearViewport, setIsNearViewport] = React.useState(isActive);
  if (isActive && !isNearViewport) setIsNearViewport(true);
  const canObserve = typeof IntersectionObserver !== "undefined";

  return {
    leaseLiveStatus: isActive || isNearViewport || !canObserve,
    rowRef: (row) => {
      if (row === null || isActive || !canObserve) return undefined;
      // The overscan has to apply to the sidebar's own scroller; a viewport-rooted
      // margin is still clipped by it.
      return observeIntersection(row, (entry) => setIsNearViewport(entry.isIntersecting), {
        root: row.closest('[data-slot="scroll-area-viewport"]'),
        rootMargin: `${SIDEBAR_ROW_SUBSCRIPTION_OVERSCAN_PX}px 0px`,
      });
    },
  };
}

const fileDragClears = new Set<(active: false) => void>();
function clearFileDrags() {
  const clears = [...fileDragClears];
  fileDragClears.clear();
  for (const clear of clears) clear(false);
}

/**
 * A file drag that ends outside every drop target (Escape, or a drop elsewhere)
 * sends no dragleave to the row it last entered, so the window's dragend clears it.
 */
export function setFileDragActive(setActive: (active: boolean) => void, active: boolean) {
  setActive(active);
  if (typeof window === "undefined") return;
  if (!active) {
    if (fileDragClears.delete(setActive) && fileDragClears.size === 0) {
      window.removeEventListener("dragend", clearFileDrags);
    }
    return;
  }
  if (fileDragClears.size === 0) window.addEventListener("dragend", clearFileDrags, { once: true });
  fileDragClears.add(setActive);
}

/**
 * A clock that advances exactly when a snooze wake time passes, so a woken
 * thread leaves the shelf on time without a per-second clock.
 */
export function useSnoozeWakeClock(
  threads: ReadonlyArray<{ readonly snoozedUntil?: string | null | undefined }>,
): number {
  const [clockMs, setClockMs] = React.useState(() => Date.now());
  const wakeTimes: number[] = [];
  let nextWakeAt: number | null = null;
  for (const thread of threads) {
    const wakeAt = thread.snoozedUntil == null ? Number.NaN : Date.parse(thread.snoozedUntil);
    if (!(wakeAt > clockMs)) continue;
    wakeTimes.push(wakeAt);
    if (nextWakeAt === null || wakeAt < nextWakeAt) nextWakeAt = wakeAt;
  }
  const woke = useDeadlinePassed(nextWakeAt);
  // Advancing to the latest wake that has passed skips every wake that elapsed
  // meanwhile, e.g. across a laptop sleep. Stepping one wake at a time would
  // re-render once per elapsed wake and hit React's limit.
  if (woke && nextWakeAt !== null) {
    let nextClockMs = nextWakeAt;
    for (const wakeAt of wakeTimes) {
      if (wakeAt > nextClockMs && deadlineStore(wakeAt).getSnapshot()) nextClockMs = wakeAt;
    }
    setClockMs(nextClockMs);
    return nextClockMs;
  }
  return clockMs;
}

export function useRetainedValue<T>(key: string | null, value: T | null): T | null {
  const [retained, setRetained] = React.useState<{
    readonly key: string;
    readonly value: T;
  } | null>(null);
  if (key !== null && value !== null && (retained?.key !== key || retained.value !== value)) {
    setRetained({ key, value });
  }
  if (value !== null) return value;
  return key !== null && retained?.key === key ? retained.value : null;
}

// Sortable owns drag transforms; replaying committed order would animate drops twice.
export const animateSidebarLayoutChanges: AnimateLayoutChanges = (args) =>
  args.isSorting ? defaultAnimateLayoutChanges(args) : false;

// Snoozed rows need a wake time; Working and Automation rows follow runtime state.
// Hidden rows leave through Unhide. These shelves cannot accept sidebar drops.

export type SidebarSection =
  | "pinned"
  | "active"
  | "working"
  | "grouped"
  | "automations"
  | "snoozed"
  | "hidden"
  | "settled";

const SIDEBAR_MARKER_PREFIX = "sidebar-marker-";

export type SidebarListMarker =
  | "pinned-header"
  | "active-placeholder"
  | "settled-placeholder"
  | "pinned-divider"
  | "working-header"
  | "automations-header"
  | "snoozed-header"
  | "hidden-header"
  | "settled-header"
  /** Titles one user-made group; the item carries the group's name. */
  | "group-header";

export function sidebarMarkerId(marker: SidebarListMarker): string {
  return `${SIDEBAR_MARKER_PREFIX}${marker}`;
}

export type SidebarListItem =
  | { readonly kind: "thread"; readonly key: string; readonly section: SidebarSection }
  | { readonly kind: "marker"; readonly marker: SidebarListMarker; readonly group?: string };

export function sidebarListItemId(item: SidebarListItem): string {
  if (item.kind === "thread") return item.key;
  // Encoded so a group name can never add the colon that marks thread keys.
  return item.group === undefined
    ? sidebarMarkerId(item.marker)
    : `${sidebarMarkerId(item.marker)}-${encodeURIComponent(item.group)}`;
}

function sectionAtSidebarSlot(items: readonly SidebarListItem[], index: number): SidebarSection {
  let section: SidebarSection = "pinned";
  for (let i = 0; i < index && i < items.length; i += 1) {
    const item = items[i]!;
    if (item.kind !== "marker") continue;
    if (item.marker === "pinned-divider") section = "active";
    else if (item.marker === "working-header") section = "working";
    else if (item.marker === "automations-header") section = "automations";
    else if (item.marker === "snoozed-header") section = "snoozed";
    else if (item.marker === "settled-header") section = "settled";
  }
  return section;
}

export type SidebarDropTarget = {
  readonly section: "pinned" | "active" | "settled";
  readonly pinnedOrder: readonly string[];
  readonly activeOrder: readonly string[];
};

export function resolveSidebarDropTarget(
  items: readonly SidebarListItem[],
  activeKey: string,
  overId: string,
): SidebarDropTarget | null {
  const activeIndex = items.findIndex((item) => sidebarListItemId(item) === activeKey);
  const overIndex = items.findIndex((item) => sidebarListItemId(item) === overId);
  if (activeIndex === -1 || overIndex === -1 || items[activeIndex]?.kind !== "thread") return null;
  const moved = items.filter((_, index) => index !== activeIndex);
  moved.splice(overIndex, 0, items[activeIndex]!);
  const section = sectionAtSidebarSlot(moved, overIndex);
  if (
    section === "working" ||
    section === "grouped" ||
    section === "automations" ||
    section === "snoozed" ||
    section === "hidden"
  )
    return null;
  const pinnedOrder: string[] = [];
  const activeOrder: string[] = [];
  let currentSection: SidebarSection = "pinned";
  for (const item of moved) {
    if (item.kind === "marker") {
      if (item.marker === "pinned-divider") currentSection = "active";
      else if (
        item.marker === "working-header" ||
        item.marker === "automations-header" ||
        item.marker === "snoozed-header" ||
        item.marker === "settled-header"
      )
        break;
    } else if (currentSection === "pinned") pinnedOrder.push(item.key);
    else activeOrder.push(item.key);
  }
  return { section, pinnedOrder, activeOrder };
}

export type SidebarThreadDropPlan =
  | { readonly kind: "none" }
  | {
      readonly kind: "reorder-pinned";
      readonly order: readonly string[];
      readonly assignments: ReadonlyArray<{ readonly id: string; readonly orderKey: string }>;
    }
  | {
      readonly kind: "pin";
      readonly order: readonly string[];
      readonly orderKey: string | undefined;
      readonly extraAssignments: ReadonlyArray<{ readonly id: string; readonly orderKey: string }>;
    }
  | {
      readonly kind: "move-active";
      readonly order: readonly string[] | null;
      readonly assignments: ReadonlyArray<{ readonly id: string; readonly orderKey: string }>;
      readonly unpin: boolean;
      readonly unsettle: boolean;
      readonly unsnooze: boolean;
    }
  | { readonly kind: "settle" };

export type SidebarDropVerb = "pin" | "unpin" | "settle" | "unsettle" | "wake";

export function resolveSidebarDropVerb(
  from: SidebarSection,
  to: SidebarSection | null,
): SidebarDropVerb | null {
  if (to === null || to === from || to === "working" || to === "snoozed" || to === "hidden")
    return null;
  if (to === "pinned") return "pin";
  if (to === "settled") return "settle";
  if (from === "pinned") return "unpin";
  if (from === "settled") return "unsettle";
  return "wake";
}

export function resolveSidebarSweepKeys(
  orderedKeys: readonly string[],
  originKey: string,
  targetKey: string,
  canApply: (key: string) => boolean,
): string[] {
  const origin = orderedKeys.indexOf(originKey);
  const target = orderedKeys.indexOf(targetKey);
  if (origin === -1 || target === -1) return [];
  return orderedKeys.slice(Math.min(origin, target), Math.max(origin, target) + 1).filter(canApply);
}

export function sidebarThreadKeyAtY(list: HTMLElement, y: number): string | null {
  const viewport = list.closest('[data-slot="scroll-area-viewport"]')?.getBoundingClientRect();
  const visibleY = viewport ? Math.min(Math.max(y, viewport.top), viewport.bottom - 1) : y;
  let key: string | null = null;
  for (const row of list.querySelectorAll<HTMLElement>("li[data-thread-item]")) {
    if (key !== null && row.getBoundingClientRect().top > visibleY) break;
    key = row.dataset.threadItem ?? null;
  }
  return key;
}

export function planSidebarThreadDrop(input: {
  readonly activeKey: string;
  readonly activeSection: SidebarSection;
  readonly activePinned?: boolean;
  readonly activeSettled?: boolean;
  readonly supportsSettlement?: boolean;
  readonly target: SidebarDropTarget;
  readonly pinnedOrder: readonly string[];
  readonly pinnedKeysById: ReadonlyMap<string, string | null | undefined>;
  readonly reorderableKeys?: ReadonlySet<string>;
  readonly activeOrder: readonly string[];
  readonly activeKeysById: ReadonlyMap<string, string | null | undefined>;
  readonly activeReorderableKeys?: ReadonlySet<string>;
  readonly activeTimeOrdered?: boolean;
}): SidebarThreadDropPlan {
  const {
    activeKey,
    activeSection,
    activePinned = activeSection === "pinned",
    activeSettled = activeSection === "settled",
    target,
    pinnedOrder,
    pinnedKeysById,
    reorderableKeys,
    activeOrder,
    activeKeysById,
    activeReorderableKeys,
  } = input;
  if (activeSection === "working") return { kind: "none" };
  if (input.supportsSettlement === false && (target.section === "settled" || activeSettled)) {
    return { kind: "none" };
  }
  const arrange = (
    order: readonly string[],
    keysById: ReadonlyMap<string, string | null | undefined>,
    writable: ReadonlySet<string> | undefined,
  ) => {
    if (!writable) return planPinnedReorder({ orderedIds: order, keysById, movedId: activeKey });
    if (!writable.has(activeKey)) return null;
    const assignments = planPinnedReorder({
      orderedIds: order.filter((key) => writable.has(key) || keysById.get(key) != null),
      keysById,
      movedId: activeKey,
    });
    return assignments.every(({ id }) => writable.has(id)) ? assignments : null;
  };
  switch (target.section) {
    case "active": {
      if (input.activeTimeOrdered) {
        return activeSection === "active"
          ? { kind: "none" }
          : {
              kind: "move-active",
              order: null,
              assignments: [],
              unpin: activePinned,
              unsettle: activeSettled,
              unsnooze: activeSection === "snoozed",
            };
      }
      const order = target.activeOrder;
      if (
        activeSection === "active" &&
        order.length === activeOrder.length &&
        order.every((key, index) => key === activeOrder[index])
      ) {
        return { kind: "none" };
      }
      const assignments = arrange(order, activeKeysById, activeReorderableKeys);
      if (assignments === null) return { kind: "none" };
      return {
        kind: "move-active",
        order,
        assignments,
        unpin: activePinned,
        unsettle: activeSettled,
        unsnooze: activeSection === "snoozed",
      };
    }
    case "settled":
      return activeSection === "settled" ? { kind: "none" } : { kind: "settle" };
    case "pinned": {
      const order = target.pinnedOrder;
      if (
        activeSection === "pinned" &&
        order.length === pinnedOrder.length &&
        order.every((key, index) => key === pinnedOrder[index])
      ) {
        return { kind: "none" };
      }
      const assignments = arrange(order, pinnedKeysById, reorderableKeys);
      if (assignments === null) return { kind: "none" };
      if (activeSection === "pinned") {
        return assignments.length === 0
          ? { kind: "none" }
          : { kind: "reorder-pinned", order, assignments };
      }
      return {
        kind: "pin",
        order,
        orderKey: assignments.find((assignment) => assignment.id === activeKey)?.orderKey,
        extraAssignments: activePinned
          ? assignments
          : assignments.filter((assignment) => assignment.id !== activeKey),
      };
    }
  }
}

export function applySidebarThreadDrop<
  T extends Pick<
    SidebarThreadSummary,
    | "pinnedAt"
    | "pinOrderKey"
    | "activeOrderKey"
    | "snoozedAt"
    | "snoozedUntil"
    | "settledAt"
    | "settledOverride"
    | "unsettledAt"
  >,
>(thread: T, section: "pinned" | "active" | "settled", now: string, orderKey?: string): T {
  const wasSettled = thread.settledOverride === "settled";
  const awake = { ...thread, snoozedAt: null, snoozedUntil: null };
  if (section === "settled") {
    return {
      ...awake,
      pinnedAt: null,
      pinOrderKey: null,
      activeOrderKey: null,
      settledOverride: "settled",
      settledAt: wasSettled ? (thread.settledAt ?? now) : now,
      unsettledAt: null,
    };
  }
  const resumed = wasSettled
    ? { ...awake, settledOverride: "active" as const, settledAt: null, unsettledAt: now }
    : awake;
  return {
    ...resumed,
    pinnedAt: section === "pinned" ? (thread.pinnedAt ?? now) : null,
    pinOrderKey: section === "pinned" ? (orderKey ?? thread.pinOrderKey) : null,
    ...(section === "active" && orderKey !== undefined ? { activeOrderKey: orderKey } : {}),
  };
}

type SidebarProject = {
  id: string;
  title: string;
  createdAt?: string | undefined;
  updatedAt?: string | undefined;
};

type ScopedSidebarProject = SidebarProject & {
  environmentId: string;
};

type ScopedSidebarThread = ThreadSortInput & {
  environmentId: string;
  projectId: string;
  archivedAt: string | null;
};

type LogicalSidebarProject = SidebarProject & {
  projectKey: string;
  memberProjectRefs: readonly {
    environmentId: string;
    projectId: string;
  }[];
};

export type ThreadTraversalDirection = "previous" | "next";

/** Exclude only successful deletions from shared-worktree checks. */
export async function deleteSelectedThreadEntries<
  TEntry extends { readonly threadKey: string },
>(input: {
  entries: readonly TEntry[];
  delete: (
    entry: TEntry,
    deletedThreadKeys: ReadonlySet<string>,
  ) => Promise<AtomCommandResult<unknown, unknown> | null>;
}) {
  const deletedThreadKeys = new Set<string>();
  let firstFailure: AsyncResult.Failure<unknown, unknown> | null = null;

  for (const entry of input.entries) {
    const result = await input.delete(entry, deletedThreadKeys);
    if (result === null) continue;
    if (result._tag === "Failure") {
      if (isAtomCommandInterrupted(result)) break;
      firstFailure ??= result;
      continue;
    }
    deletedThreadKeys.add(entry.threadKey);
  }

  return { deletedThreadKeys, firstFailure };
}

export async function archiveSelectedThreadEntries<
  TEntry extends { readonly threadKey: string },
  TResult extends { readonly _tag: "Success" | "Failure" },
>(input: {
  entries: readonly TEntry[];
  archive: (entry: TEntry, onArchived: () => void) => Promise<TResult>;
}): Promise<{
  archivedThreadKeys: readonly string[];
  mutationFailure: Extract<TResult, { readonly _tag: "Failure" }> | null;
  followupFailures: readonly Extract<TResult, { readonly _tag: "Failure" }>[];
}> {
  const archivedThreadKeys: string[] = [];
  const followupFailures: Extract<TResult, { readonly _tag: "Failure" }>[] = [];

  for (const entry of input.entries) {
    let didArchive = false;
    const result = await input.archive(entry, () => {
      didArchive = true;
    });
    if (didArchive || result._tag === "Success") archivedThreadKeys.push(entry.threadKey);
    if (result._tag === "Success") continue;
    const failure = result as Extract<TResult, { readonly _tag: "Failure" }>;
    if (didArchive) {
      followupFailures.push(failure);
      continue;
    }
    return { archivedThreadKeys, mutationFailure: failure, followupFailures };
  }

  return { archivedThreadKeys, mutationFailure: null, followupFailures };
}

export function buildMultiSelectThreadContextMenuItems(input: {
  count: number;
  hasRunningThread: boolean;
}): readonly ContextMenuItem<"mark-unread" | "archive" | "delete">[] {
  return [
    { id: "mark-unread", label: `Mark unread (${input.count})` },
    {
      id: "archive",
      label: `Archive (${input.count})`,
      disabled: input.hasRunningThread,
    },
    { id: "delete", label: `Delete (${input.count})`, destructive: true },
  ];
}

export function isSidebarSubagentThread(thread: Pick<SidebarThreadSummary, "lineage">): boolean {
  return thread.lineage.relationshipToParent === "subagent";
}

// Subagent threads have no sidebar row, so an open subagent is represented by
// its nearest non-subagent ancestor. A broken chain (missing parent, cycle,
// other environment) resolves to the thread itself, which then matches no row.
export function resolveSidebarRowThreadId(
  threadId: ThreadId,
  environmentId: EnvironmentId,
  threads: readonly Pick<SidebarThreadSummary, "id" | "environmentId" | "lineage">[],
): ThreadId {
  const findThread = (id: ThreadId) =>
    threads.find((thread) => thread.id === id && thread.environmentId === environmentId);
  const visited = new Set<ThreadId>();
  let thread = findThread(threadId);
  while (thread !== undefined && isSidebarSubagentThread(thread)) {
    if (thread.lineage.parentThreadId === null || visited.has(thread.id)) return threadId;
    visited.add(thread.id);
    thread = findThread(thread.lineage.parentThreadId);
  }
  return thread?.id ?? threadId;
}

export function filterSidebarV2VisibleThreads<
  T extends Pick<SidebarThreadSummary, "archivedAt" | "lineage"> & {
    environmentId: string;
    projectId: string;
  },
>(threads: readonly T[], scopedProjectKeys: ReadonlySet<string> | null): T[] {
  return threads.filter(
    (thread) =>
      thread.archivedAt === null &&
      !isSidebarSubagentThread(thread) &&
      (scopedProjectKeys === null ||
        scopedProjectKeys.has(`${thread.environmentId}:${thread.projectId}`)),
  );
}

export function getSidebarForkParentThreadId(
  thread: Pick<SidebarThreadSummary, "forkedFrom" | "lineage">,
) {
  if (thread.lineage.relationshipToParent !== "fork") {
    return null;
  }
  return thread.forkedFrom?.type === "run"
    ? thread.forkedFrom.threadId
    : thread.lineage.parentThreadId;
}

export function buildBulkTitleRegenerationContextMenuItem(input: {
  supportedCount: number;
  actionableCount: number;
}): ContextMenuItem<"regenerate-title"> | null {
  if (input.supportedCount === 0) return null;
  if (input.actionableCount === 0) {
    return {
      id: "regenerate-title",
      label: `Regenerating… (${input.supportedCount})`,
      disabled: true,
    };
  }
  return {
    id: "regenerate-title",
    label: `Regenerate titles (${input.actionableCount})`,
  };
}

export function buildBulkUnpinContextMenuItem(input: {
  pinnedCount: number;
}): ContextMenuItem<"unpin"> | null {
  if (input.pinnedCount === 0) return null;
  return { id: "unpin", label: `Unpin (${input.pinnedCount})` };
}

export interface ThreadStatusPill {
  label:
    | "Working"
    | "Connecting"
    | "Completed"
    | "Failed"
    | "Pending Approval"
    | "Awaiting Input"
    | "Guest Request"
    | "Waiting"
    | "Plan Ready";
  colorClass: string;
  dotClass: string;
  pulse: boolean;
}

const THREAD_STATUS_PRIORITY: Record<ThreadStatusPill["label"], number> = {
  "Pending Approval": 5,
  "Awaiting Input": 4,
  "Guest Request": 3.75,
  Failed: 3.5,
  Working: 3,
  Connecting: 3,
  Waiting: 2.5,
  "Plan Ready": 2,
  Completed: 1,
};

export interface ThreadJumpHintVisibilityController {
  sync: (shouldShow: boolean) => void;
  dispose: () => void;
}

export function resolveSidebarStageBadgeLabel(input: {
  primaryServerVersion: string | null | undefined;
  fallbackStageLabel: string;
}): string {
  return resolveServerBackedAppStageLabel(input);
}

export function createThreadJumpHintVisibilityController(input: {
  delayMs: number;
  onVisibilityChange: (visible: boolean) => void;
  setTimeoutFn?: typeof globalThis.setTimeout;
  clearTimeoutFn?: typeof globalThis.clearTimeout;
}): ThreadJumpHintVisibilityController {
  const setTimeoutFn = input.setTimeoutFn ?? globalThis.setTimeout;
  const clearTimeoutFn = input.clearTimeoutFn ?? globalThis.clearTimeout;
  let isVisible = false;
  let timeoutId: NodeJS.Timeout | null = null;

  const clearPendingShow = () => {
    if (timeoutId === null) {
      return;
    }
    clearTimeoutFn(timeoutId);
    timeoutId = null;
  };

  return {
    sync: (shouldShow) => {
      if (!shouldShow) {
        clearPendingShow();
        if (isVisible) {
          isVisible = false;
          input.onVisibilityChange(false);
        }
        return;
      }

      if (isVisible || timeoutId !== null) {
        return;
      }

      timeoutId = setTimeoutFn(() => {
        timeoutId = null;
        isVisible = true;
        input.onVisibilityChange(true);
      }, input.delayMs);
    },
    dispose: () => {
      clearPendingShow();
    },
  };
}

/**
 * Thread jump hints appear once the jump modifier has been held for a moment,
 * so a quick shortcut never flashes them, and hide as soon as it is released.
 */
export function useThreadJumpHintsVisible(shouldShow: boolean): boolean {
  const [showAt, setShowAt] = React.useState<number | null>(null);
  let nextShowAt = shouldShow ? showAt : null;
  if (shouldShow && showAt === null) nextShowAt = deadlineAfter(THREAD_JUMP_HINT_SHOW_DELAY_MS);
  if (nextShowAt !== showAt) setShowAt(nextShowAt);
  return useDeadlinePassed(nextShowAt);
}

export function resolveThreadLastVisitedAt(
  serverLastVisitedAt: string | null | undefined,
  localLastVisitedAt: string | undefined,
): string | undefined {
  // Server visits override local watermarks, including mark-unread rewinds; use local values only on older
  // servers.
  if (serverLastVisitedAt === undefined) return localLastVisitedAt;
  return serverLastVisitedAt ?? undefined;
}

export function hasUnseenCompletion(thread: ThreadStatusInput): boolean {
  return hasUnseenTurnCompletion(thread.latestRun, thread.lastVisitedAt ?? undefined);
}

/** Unopened threads' failures still count as unseen, unlike completions. */
function hasUnseenFailure(thread: ThreadStatusInput): boolean {
  if (thread.latestRun?.status !== "failed") return false;
  if (!thread.lastVisitedAt) return true;
  const completedAt = Date.parse(thread.latestRun.completedAt ?? "");
  const lastVisitedAt = Date.parse(thread.lastVisitedAt);
  if (Number.isNaN(completedAt) || Number.isNaN(lastVisitedAt)) return true;
  return completedAt > lastVisitedAt;
}

export function shouldClearThreadSelectionOnMouseDown(target: HTMLElement | null): boolean {
  if (target === null) return true;
  return !target.closest(THREAD_SELECTION_SAFE_SELECTOR);
}

// Suppress trailing double-click navigation; keyboard and synthetic clicks use detail 0.
export function isTrailingDoubleClick(detail: number): boolean {
  return detail > 1;
}

function nodeClosest(node: object | null, selector: string): unknown {
  if (node === null || !("closest" in node) || typeof node.closest !== "function") return null;
  return node.closest(selector);
}

export function isSidebarNestedLinkClick(target: EventTarget | null): boolean {
  if (target == null || typeof target !== "object") return false;
  if (nodeClosest(target, "a[href]") !== null) return true;
  const parent =
    "parentElement" in target &&
    target.parentElement !== null &&
    typeof target.parentElement === "object"
      ? target.parentElement
      : null;
  return nodeClosest(parent, "a[href]") !== null;
}

export function shouldCreateNewThreadInCurrentProject(
  shiftKey: boolean,
  projectGroupCount: number,
): boolean {
  return shiftKey || projectGroupCount <= 1;
}

export function orderItemsByPreferredIds<TItem, TId>(input: {
  items: readonly TItem[];
  preferredIds: readonly TId[];
  getId: (item: TItem) => TId;
  getPreferenceIds?: (item: TItem) => readonly TId[];
}): TItem[] {
  const { getId, getPreferenceIds, items, preferredIds } = input;
  if (preferredIds.length === 0) {
    return [...items];
  }

  const indexesByPreferenceId = new Map<TId, number[]>();
  for (const [index, item] of items.entries()) {
    const preferenceIds = getPreferenceIds?.(item) ?? [getId(item)];
    for (const preferenceId of new Set(preferenceIds)) {
      const indexes = indexesByPreferenceId.get(preferenceId);
      if (indexes) {
        indexes.push(index);
      } else {
        indexesByPreferenceId.set(preferenceId, [index]);
      }
    }
  }

  const emittedIndexes = new Set<number>();
  const ordered = preferredIds.flatMap((id) => {
    const index = indexesByPreferenceId
      .get(id)
      ?.find((candidate) => !emittedIndexes.has(candidate));
    if (index === undefined) {
      return [];
    }
    emittedIndexes.add(index);
    return [items[index]!];
  });
  const remaining = items.filter((_, index) => !emittedIndexes.has(index));
  return [...ordered, ...remaining];
}

/**
 * Per-group tab choices, keyed by the group's row key. A group without an entry follows the
 * sidebar-wide Show tabs setting.
 */
export type SidebarTabGroupOverrides = Readonly<Record<string, boolean>>;

/** Whether a tab group lists its tabs under its row. */
export function isSidebarTabGroupOpen(
  rowKey: string,
  overrides: SidebarTabGroupOverrides,
  showTabs: boolean,
): boolean {
  return overrides[rowKey] ?? showTabs;
}

/**
 * Records a group's choice. A choice matching the sidebar-wide setting is dropped, so toggling
 * a group back leaves nothing behind for the next global toggle to fight.
 */
export function setSidebarTabGroupOverride(
  overrides: SidebarTabGroupOverrides,
  rowKey: string,
  open: boolean,
  showTabs: boolean,
): SidebarTabGroupOverrides {
  const { [rowKey]: _previous, ...rest } = overrides;
  return open === showTabs ? rest : { ...rest, [rowKey]: open };
}

/** The tabs still folded into their group's row: members of every group that is not open. */
export function foldedSidebarTabThreads(
  tabThreadGroups: ReadonlyMap<string, string>,
  overrides: SidebarTabGroupOverrides,
  showTabs: boolean,
): ReadonlyMap<string, string> {
  if (Object.keys(overrides).length === 0) return showTabs ? new Map() : tabThreadGroups;
  return new Map(
    [...tabThreadGroups].filter(
      ([, rowKey]) => !isSidebarTabGroupOpen(rowKey, overrides, showTabs),
    ),
  );
}

/**
 * The tabs listed under each tab group's sidebar row, in tab order. `hiddenTabThreads` maps a
 * tab's thread key to the key of the row that stands for its group.
 */
export function groupSidebarTabThreads<T>(
  threadByKey: ReadonlyMap<string, T>,
  hiddenTabThreads: ReadonlyMap<string, string>,
): ReadonlyMap<string, readonly T[]> {
  const tabsByRowKey = new Map<string, T[]>();
  for (const [threadKey, rowKey] of hiddenTabThreads) {
    const thread = threadByKey.get(threadKey);
    if (thread === undefined) continue;
    const tabs = tabsByRowKey.get(rowKey);
    if (tabs) tabs.push(thread);
    else tabsByRowKey.set(rowKey, [thread]);
  }
  return tabsByRowKey;
}

/**
 * The sidebar row a tab belongs to. Hide and unhide follow this thread: the shelf reads it,
 * while the tab the row shows may be a different one left open most recently.
 */
export function sidebarTabGroupRowKey(
  threadKey: string,
  tabThreadGroups: ReadonlyMap<string, string>,
): string {
  return tabThreadGroups.get(threadKey) ?? threadKey;
}

/**
 * The tab that takes over when `threadKey`'s tab closes: the next tab in its group, else the
 * previous one. Null when the thread has no sibling tab, where closing would just be archiving.
 */
export function sidebarTabNeighbourKey(
  threadKey: string,
  hiddenTabThreads: ReadonlyMap<string, string>,
): string | null {
  const rowKey = hiddenTabThreads.get(threadKey) ?? threadKey;
  const keys = [rowKey];
  for (const [key, representative] of hiddenTabThreads) {
    if (representative === rowKey) keys.push(key);
  }
  const index = keys.indexOf(threadKey);
  return keys[index + 1] ?? keys[index - 1] ?? null;
}

/**
 * Rows in the order the sidebar shows them: each group's row followed by its tabs. Where the
 * tab list includes the row's own thread (`replacesRow`), the list stands in for the row,
 * wherever the sort put that thread or even when it is folded past the limit.
 */
export function withSidebarTabThreads<T>(
  rows: readonly T[],
  getKey: (row: T) => string,
  tabsByRowKey: ReadonlyMap<string, readonly T[]>,
  replacesRow: (rowKey: string) => boolean = () => false,
): T[] {
  return rows.flatMap((row) => {
    const rowKey = getKey(row);
    const tabs = tabsByRowKey.get(rowKey);
    if (tabs === undefined) return [row];
    return replacesRow(rowKey) ? tabs : [row, ...tabs];
  });
}

// Dragged tab order, as each tab's rank within its group. Client-local, like the other tab
// view preferences: the server's tab positions also decide which tab stands for the group's row.
export const SIDEBAR_TAB_MANUAL_RANKS_KEY = "t3code:sidebar:tab-manual-ranks";
export const SidebarTabManualRanksSchema = Schema.Record(Schema.String, Schema.Number);
export const NO_SIDEBAR_TAB_MANUAL_RANKS: Readonly<Record<string, number>> = {};

/**
 * What a tab sorts by: when its latest turn finished, or was sent while it is still running
 * (a tab with no turn yet counts from its creation, so a new tab lands where its sort puts the
 * newest), when it was created, or when you last opened it here. Null sorts last either way.
 */
export function sidebarTabSortTimestamp(
  thread: Pick<SidebarThreadSummary, "createdAt" | "latestRun">,
  order: Exclude<SidebarTabSortOrder, "manual">,
  openedAt: number | undefined,
): number | null {
  if (order === "last_opened") return openedAt ?? null;
  const timestamp =
    order === "created_at"
      ? thread.createdAt
      : (thread.latestRun?.completedAt ?? thread.latestRun?.requestedAt ?? thread.createdAt);
  const ms = timestamp === null ? Number.NaN : Date.parse(timestamp);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * A group's tabs in display order. Manual follows the dragged ranks, with tabs never dragged
 * after them in the order they were opened; the timed orders keep that order for ties.
 */
export function sortSidebarTabs<T>(
  tabs: readonly T[],
  input: {
    order: SidebarTabSortOrder;
    direction: SidebarTabSortDirection;
    getKey: (tab: T) => string;
    getTimestamp: (tab: T, order: Exclude<SidebarTabSortOrder, "manual">) => number | null;
    manualRanks: Readonly<Record<string, number>>;
  },
): T[] {
  const { order, direction, getKey, getTimestamp, manualRanks } = input;
  if (order === "manual") {
    const rank = (tab: T) => manualRanks[getKey(tab)] ?? Number.POSITIVE_INFINITY;
    return tabs.toSorted((left, right) => {
      const delta = rank(left) - rank(right);
      return Number.isNaN(delta) ? 0 : delta;
    });
  }
  const sign = direction === "desc" ? -1 : 1;
  const timestamps = new Map(tabs.map((tab) => [tab, getTimestamp(tab, order)]));
  return tabs.toSorted((left, right) => {
    const a = timestamps.get(left) ?? null;
    const b = timestamps.get(right) ?? null;
    if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
    return (a - b) * sign;
  });
}

/**
 * Keeps an order the pointer is resting on, so a live sort never moves a tab out from under a
 * click. Tabs that joined since stay in sorted order after the held ones.
 */
export function holdSidebarTabOrder<T>(
  sorted: readonly T[],
  heldKeys: readonly string[],
  getKey: (tab: T) => string,
): T[] {
  const heldIndex = new Map(heldKeys.map((key, index) => [key, index]));
  const position = (tab: T) => heldIndex.get(getKey(tab)) ?? Number.POSITIVE_INFINITY;
  return sorted.toSorted((left, right) => {
    const delta = position(left) - position(right);
    return Number.isNaN(delta) ? 0 : delta;
  });
}

/**
 * Tab rows the count control hides or reveals. A card's list includes its own thread; a slim
 * row lists only the others. A limit cuts that list until its "more" row is expanded.
 */
export function sidebarTabToggleCount(input: {
  listed: number;
  limit: number | null;
  expanded: boolean;
}): number {
  const { listed, limit, expanded } = input;
  if (limit === null || expanded || listed <= limit) return listed;
  return limit;
}

/** "Hide 4 tabs" / "Show 1 tab" for the row's tab-count control. */
export function sidebarTabToggleLabel(open: boolean, count: number): string {
  return `${open ? "Hide" : "Show"} ${count} ${count === 1 ? "tab" : "tabs"}`;
}

/**
 * The tabs a group lists before its "more" row. Open tabs (the routed chat and its split
 * partner) always show: past the limit they take the last slots, so the group stays exactly
 * `limit` rows tall.
 */
export function limitSidebarTabs<T>(
  ordered: readonly T[],
  limit: number | null,
  openKeys: readonly string[],
  getKey: (tab: T) => string,
): { shown: readonly T[]; hidden: readonly T[] } {
  if (limit === null || ordered.length <= limit) return { shown: ordered, hidden: [] };
  const shownSet = new Set(ordered.filter((tab) => openKeys.includes(getKey(tab))));
  for (const tab of ordered) {
    if (shownSet.size >= limit) break;
    shownSet.add(tab);
  }
  return {
    shown: ordered.filter((tab) => shownSet.has(tab)),
    hidden: ordered.filter((tab) => !shownSet.has(tab)),
  };
}

/**
 * A group's tab list as the sidebar shows it: sorted, held still under a resting pointer, then
 * cut to the limit unless `expanded`. Other surfaces listing a group's tabs use it so each tab
 * keeps the place the sidebar gives it.
 */
export function layoutSidebarTabs<T>(
  tabs: readonly T[],
  input: Parameters<typeof sortSidebarTabs<T>>[1] & {
    heldKeys: readonly string[] | null;
    limit: number | null;
    openKeys: readonly string[];
    expanded: boolean;
  },
): { ordered: readonly T[]; shown: readonly T[]; hidden: readonly T[]; expanded: boolean } {
  const sorted = sortSidebarTabs(tabs, input);
  const ordered =
    input.heldKeys === null ? sorted : holdSidebarTabOrder(sorted, input.heldKeys, input.getKey);
  const expanded = input.expanded && input.limit !== null && ordered.length > input.limit;
  const { shown, hidden } = expanded
    ? { shown: ordered, hidden: [] }
    : limitSidebarTabs(ordered, input.limit, input.openKeys, input.getKey);
  return { ordered, shown, hidden, expanded };
}

/**
 * The tabs other than `openKey` in the order the sidebar lists the group, split at its "more"
 * row. `tabs` is the group in tab order: a card (`listsRow`) lists them all, while a slim row
 * stands for the first tab and lists the rest. The open tab never folds away, as in the sidebar.
 */
export function sidebarSiblingTabs<T>(
  tabs: readonly T[],
  input: Parameters<typeof sortSidebarTabs<T>>[1] & {
    listsRow: boolean;
    limit: number | null;
    openKey: string;
  },
): { shown: readonly T[]; hidden: readonly T[] } {
  const [row, ...rest] = tabs;
  if (row === undefined) return { shown: [], hidden: [] };
  const layout = layoutSidebarTabs(input.listsRow ? tabs : rest, {
    ...input,
    heldKeys: null,
    openKeys: [input.openKey],
    expanded: false,
  });
  const shown = input.listsRow ? layout.shown : [row, ...layout.shown];
  return {
    shown: shown.filter((tab) => input.getKey(tab) !== input.openKey),
    hidden: layout.hidden,
  };
}

/** How far into another row, from the dragged tab's side, a drag still aims to pair with it. */
const SIDEBAR_TAB_PAIR_DEPTH = 0.45;

/** Pair within the near half of an untransformed row; crossing its middle resumes sorting. */
export function resolveSidebarTabPairTarget(input: {
  keys: readonly string[];
  slots: readonly ({ top: number; height: number } | undefined)[];
  activeKey: string;
  overKey: string | null;
  centerY: number;
}): string | null {
  const activeIndex = input.keys.indexOf(input.activeKey);
  if (activeIndex === -1) return null;
  const overIndex = input.overKey === null ? -1 : input.keys.indexOf(input.overKey);
  const activeSlot = overIndex === -1 ? activeIndex : overIndex;
  const slot = input.slots.findIndex(
    (rect) =>
      rect !== undefined && input.centerY >= rect.top && input.centerY < rect.top + rect.height,
  );
  const rect = input.slots[slot];
  if (rect === undefined || slot === activeSlot) return null;
  const depth = (input.centerY - rect.top) / rect.height;
  const travelled = slot > activeSlot ? depth : 1 - depth;
  if (travelled >= SIDEBAR_TAB_PAIR_DEPTH) return null;
  const others = input.keys.filter((key) => key !== input.activeKey);
  return others[slot > activeSlot ? slot - 1 : slot] ?? null;
}

/**
 * A group's full order after dropping `activeKey` on `overKey` among the shown tabs. Hidden
 * tabs keep their places; the dropped tab lands next to the shown tab it moved past.
 */
export function moveSidebarTab(
  orderedKeys: readonly string[],
  shownKeys: readonly string[],
  activeKey: string,
  overKey: string,
): string[] {
  const from = shownKeys.indexOf(activeKey);
  const to = shownKeys.indexOf(overKey);
  if (from === -1 || to === -1 || from === to) return [...orderedKeys];
  const shown = shownKeys.filter((key) => key !== activeKey);
  shown.splice(to, 0, activeKey);
  const rest = orderedKeys.filter((key) => key !== activeKey);
  // Moving down lands just after the tab it passed; moving up, just before it.
  const anchor = from < to ? shown[to - 1]! : shown[to + 1]!;
  rest.splice(rest.indexOf(anchor) + (from < to ? 1 : 0), 0, activeKey);
  return rest;
}

/**
 * Stores a group's manual order as ranks. Ranks only compare within a group, so other groups'
 * entries stay as they were; entries for threads that no longer exist are dropped.
 */
export function withSidebarTabRanks(
  ranks: Readonly<Record<string, number>>,
  orderedKeys: readonly string[],
  liveKeys: ReadonlySet<string>,
): Record<string, number> {
  const next: Record<string, number> = {};
  for (const [key, rank] of Object.entries(ranks)) {
    if (liveKeys.has(key)) next[key] = rank;
  }
  for (const [index, key] of orderedKeys.entries()) next[key] = index;
  return next;
}

export function getSidebarThreadIdsToPrewarm<TThreadId>(
  visibleThreadIds: readonly TThreadId[],
  limit = SIDEBAR_THREAD_PREWARM_LIMIT,
): TThreadId[] {
  return visibleThreadIds.slice(0, Math.max(0, limit));
}

export function resolveAdjacentThreadId<T>(input: {
  threadIds: readonly T[];
  currentThreadId: T | null;
  direction: ThreadTraversalDirection;
}): T | null {
  const { currentThreadId, direction, threadIds } = input;

  if (threadIds.length === 0) {
    return null;
  }

  if (currentThreadId === null) {
    return direction === "previous" ? (threadIds.at(-1) ?? null) : (threadIds[0] ?? null);
  }

  const currentIndex = threadIds.indexOf(currentThreadId);
  if (currentIndex === -1) {
    return null;
  }

  if (direction === "previous") {
    return currentIndex > 0 ? (threadIds[currentIndex - 1] ?? null) : null;
  }

  return currentIndex < threadIds.length - 1 ? (threadIds[currentIndex + 1] ?? null) : null;
}

export function isContextMenuPointerDown(input: {
  button: number;
  ctrlKey: boolean;
  isMac: boolean;
}): boolean {
  if (input.button === 2) return true;
  return input.isMac && input.button === 0 && input.ctrlKey;
}

export type SidebarThreadStatus =
  | "approval"
  | "input"
  | "request"
  | "working"
  | "waiting"
  | "failed"
  | "limited"
  | "ready";

export function shouldRecedeSidebarThread(input: {
  status: SidebarThreadStatus;
  isUnread: boolean;
  isWoke: boolean;
  isActive: boolean;
  isSelected: boolean;
}): boolean {
  if (
    input.isActive ||
    input.isSelected ||
    input.status === "input" ||
    input.status === "request"
  ) {
    return false;
  }
  if (input.status === "working" || input.status === "waiting") return true;
  if (input.status === "ready" || input.status === "approval") {
    return !input.isUnread && !input.isWoke;
  }
  return false;
}

type SidebarThreadStatusInput = Pick<
  SidebarThreadSummary,
  | "hasPendingApprovals"
  | "hasPendingUserInput"
  | "pendingSubagentRequest"
  | "pendingGuestMessageCount"
  | "runtime"
  | "blockedOnThreadWait"
>;

export function resolveSidebarThreadStatus(thread: SidebarThreadStatusInput): SidebarThreadStatus {
  if (thread.hasPendingApprovals || thread.pendingSubagentRequest === "approval") {
    return "approval";
  }
  if (thread.hasPendingUserInput || thread.pendingSubagentRequest === "user_input") {
    return "input";
  }
  // A guest is waiting on the owner; the agent's own requests come first.
  if ((thread.pendingGuestMessageCount ?? 0) > 0) {
    return "request";
  }
  if (thread.runtime?.status === "running" && thread.blockedOnThreadWait === true) {
    return "waiting";
  }
  if (
    thread.runtime !== null &&
    ["preparing", "queued", "starting", "running", "waiting"].includes(thread.runtime.status)
  ) {
    return "working";
  }
  if (thread.runtime?.status === "idle") {
    return "waiting";
  }
  if (thread.runtime?.status === "failed") {
    return thread.runtime.lastErrorClass === "usage_limit" ? "limited" : "failed";
  }
  return "ready";
}

export type SidebarV2TopStatusKind =
  | "approval"
  | "done"
  | "failed"
  | "limited"
  | "input"
  | "request"
  | "waiting"
  | "woke"
  | "working";

export function resolveSidebarV2TopStatus(input: {
  readonly status: SidebarThreadStatus;
  readonly isUnread: boolean;
  readonly isWoke: boolean;
}): SidebarV2TopStatusKind | null {
  if (input.status === "working") {
    return "working";
  }
  if (input.status === "waiting") {
    return "waiting";
  }
  if (input.status === "approval") {
    return "approval";
  }
  if (input.status === "input" || input.status === "request") {
    return input.status;
  }
  if (input.status === "failed" || input.status === "limited") {
    return input.status;
  }
  if (input.isWoke) {
    return "woke";
  }
  return input.isUnread ? "done" : null;
}

export function shouldShowSidebarV2Duration(status: SidebarThreadStatus): boolean {
  return status === "working";
}

/** First VALID timestamp wins: `a ?? b` falls through on null, but a present-
    yet-malformed string must also fall through to the next candidate rather
    than sink the row to the epoch. */
export function firstValidTimestampMs(
  ...candidates: ReadonlyArray<string | null | undefined>
): number {
  for (const candidate of candidates) {
    if (candidate == null) continue;
    const parsed = Date.parse(candidate);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 0;
}

export { sortActiveThreadsByOrderKey as sortThreadsForSidebar } from "@t3tools/client-runtime/state/thread-sort";
export {
  isThreadWorking as isSidebarThreadWorking,
  sortInboxThreadsByReturn,
  sortWorkingThreadsBySend,
} from "@t3tools/client-runtime/state/thread-inbox";

export { pinOrderKeyBetween } from "@t3tools/client-runtime/state/thread-sort";
export { sortPinnedThreadsByOrderKey as sortPinnedThreadsForSidebar } from "@t3tools/client-runtime/state/thread-sort";

const EMPTY_CONTENT_MATCH_KEYS: ReadonlySet<string> = new Set<string>();

/**
 * Sidebar search results: title, branch, and pull request matches ranked as
 * the command palette ranks them, then threads listed only because their
 * messages match, in `contentMatchKeys` order.
 */
export function searchSidebarThreads<
  T extends ThreadSearchShell & {
    readonly environmentId: EnvironmentId;
    readonly id: ThreadId;
  },
>(
  threads: readonly T[],
  query: string,
  contentMatchKeys: ReadonlySet<string> = EMPTY_CONTENT_MATCH_KEYS,
  now = Date.now(),
  groupNames: ReadonlyMap<string, string> = new Map(),
): { readonly titleMatches: T[]; readonly contentMatches: T[] } {
  const normalizedQuery = foldSearchQuery(query);
  if (normalizedQuery.length === 0) return { titleMatches: [], contentMatches: [] };
  const titleMatches = rankSearchItems(threads, (thread, options) =>
    scoreThreadSearch(
      normalizedQuery,
      {
        ...threadSearchSubject(thread, null),
        groupNames: [
          ...(threadSearchSubject(thread, null).groupNames ?? []),
          groupNames.get(`${thread.environmentId}:${thread.id}`) ?? "",
        ],
      },
      now,
      {
        ...options,
        picks: false,
      },
    ),
  ).map(({ item }) => item);
  const listed = new Set(titleMatches);
  // In the order the server ranked their messages, as the palette lists them.
  const threadByKey = new Map(
    threads.map((thread) => [
      threadSearchMatchKey({ environmentId: thread.environmentId, threadId: thread.id }),
      thread,
    ]),
  );
  const contentMatches = [...contentMatchKeys].flatMap((key) => {
    const thread = threadByKey.get(key);
    return thread && !listed.has(thread) ? [thread] : [];
  });
  return { titleMatches, contentMatches };
}

export function pullRequestMatchesSearchQuery(
  pullRequest: Parameters<typeof threadPullRequestSearchTerms>[0],
  query: string,
): boolean {
  const normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery.length === 0) return false;
  const haystack = normalizeSearchText(threadPullRequestSearchTerms(pullRequest).join(" "));
  return normalizedQuery.split(" ").every((token) => haystack.includes(token));
}

/** The timestamp a working thread's elapsed label counts from: when its
    current work started (request time until adoption). Background wakes do
    not reset it. Malformed timestamps fall through to the next candidate. */
export function resolveWorkingStartedAt(
  thread: Pick<SidebarThreadSummary, "latestRun" | "runtime">,
): string | null {
  return resolveThreadWorkingStartedAt(thread);
}

export function formatWorkingDurationLabel(elapsedMs: number): string {
  const seconds = Number.isFinite(elapsedMs) ? Math.max(0, Math.floor(elapsedMs / 1000)) : 0;
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function resolveThreadStatusPill(input: {
  thread: ThreadStatusInput;
}): ThreadStatusPill | null {
  const { thread } = input;

  if (thread.hasPendingApprovals || thread.pendingSubagentRequest === "approval") {
    return {
      label: "Pending Approval",
      colorClass: "text-amber-600 dark:text-amber-300/90",
      dotClass: "bg-amber-500 dark:bg-amber-300/90",
      pulse: false,
    };
  }

  if (thread.hasPendingUserInput || thread.pendingSubagentRequest === "user_input") {
    return {
      label: "Awaiting Input",
      colorClass: "text-indigo-600 dark:text-indigo-300/90",
      dotClass: "bg-indigo-500 dark:bg-indigo-300/90",
      pulse: false,
    };
  }

  if ((thread.pendingGuestMessageCount ?? 0) > 0) {
    return {
      label: "Guest Request",
      colorClass: "text-guest-foreground",
      dotClass: "bg-guest",
      pulse: false,
    };
  }

  if (
    (thread.runtime?.status === "running" && thread.blockedOnThreadWait !== true) ||
    thread.runtime?.status === "waiting"
  ) {
    return {
      label: "Working",
      colorClass: "text-sky-600 dark:text-sky-300/80",
      dotClass: "bg-sky-500 dark:bg-sky-300/80",
      pulse: true,
    };
  }

  if (
    thread.runtime?.status === "preparing" ||
    thread.runtime?.status === "starting" ||
    thread.runtime?.status === "queued"
  ) {
    return {
      label: "Connecting",
      colorClass: "text-sky-600 dark:text-sky-300/80",
      dotClass: "bg-sky-500 dark:bg-sky-300/80",
      pulse: true,
    };
  }

  if (
    (thread.runtime?.status === "running" && thread.blockedOnThreadWait === true) ||
    backgroundWorkHoldsCompletion(thread.pendingBackgroundTasks ?? [])
  ) {
    return {
      label: "Waiting",
      colorClass: "text-sidebar-muted-foreground",
      dotClass: "bg-sidebar-muted-foreground",
      pulse: false,
    };
  }

  if (hasUnseenFailure(thread)) {
    return {
      label: "Failed",
      colorClass: "text-red-600 dark:text-red-300/90",
      dotClass: "bg-red-500 dark:bg-red-300/90",
      pulse: false,
    };
  }

  const hasPlanReadyPrompt =
    !thread.hasPendingUserInput &&
    thread.interactionMode === "plan" &&
    isLatestRunSettled(thread.latestRun, thread.runtime) &&
    thread.hasActionableProposedPlan;
  if (hasPlanReadyPrompt) {
    return {
      label: "Plan Ready",
      colorClass: "text-violet-600 dark:text-violet-300/90",
      dotClass: "bg-violet-500 dark:bg-violet-300/90",
      pulse: false,
    };
  }

  if (hasUnseenCompletion(thread)) {
    return {
      label: "Completed",
      colorClass: "text-emerald-600 dark:text-emerald-300/90",
      dotClass: "bg-emerald-500 dark:bg-emerald-300/90",
      pulse: false,
    };
  }

  return null;
}

export function resolveProjectStatusIndicator(
  statuses: ReadonlyArray<ThreadStatusPill | null>,
): ThreadStatusPill | null {
  let highestPriorityStatus: ThreadStatusPill | null = null;

  for (const status of statuses) {
    if (status === null) continue;
    if (
      highestPriorityStatus === null ||
      THREAD_STATUS_PRIORITY[status.label] > THREAD_STATUS_PRIORITY[highestPriorityStatus.label]
    ) {
      highestPriorityStatus = status;
    }
  }

  return highestPriorityStatus;
}

export function getFallbackThreadIdAfterDelete<
  T extends Pick<Thread, "id" | "projectId" | "createdAt" | "updatedAt"> & ThreadSortInput,
>(input: {
  threads: readonly T[];
  deletedThreadId: T["id"];
  sortOrder: SidebarThreadSortOrder;
  deletedThreadIds?: ReadonlySet<T["id"]>;
}): T["id"] | null {
  const { deletedThreadId, deletedThreadIds, sortOrder, threads } = input;
  const deletedThread = threads.find((thread) => thread.id === deletedThreadId);
  if (!deletedThread) {
    return null;
  }

  return (
    sortThreads(
      threads.filter(
        (thread) =>
          thread.projectId === deletedThread.projectId &&
          thread.id !== deletedThreadId &&
          !deletedThreadIds?.has(thread.id),
      ),
      sortOrder,
    )[0]?.id ?? null
  );
}
export function getProjectSortTimestamp(
  project: SidebarProject,
  projectThreads: readonly ThreadSortInput[],
  sortOrder: Exclude<SidebarProjectSortOrder, "manual">,
): number {
  if (projectThreads.length > 0) {
    return projectThreads.reduce(
      (latest, thread) => Math.max(latest, getThreadSortTimestamp(thread, sortOrder)),
      Number.NEGATIVE_INFINITY,
    );
  }

  if (sortOrder === "created_at") {
    return toSortableTimestamp(project.createdAt) ?? Number.NEGATIVE_INFINITY;
  }
  return toSortableTimestamp(project.updatedAt ?? project.createdAt) ?? Number.NEGATIVE_INFINITY;
}

function sortProjectsByActivity<TProject extends SidebarProject>(
  projects: readonly TProject[],
  sortOrder: SidebarProjectSortOrder,
  getProjectThreads: (project: TProject) => readonly ThreadSortInput[],
  compareTies: (left: TProject, right: TProject) => number,
): TProject[] {
  if (sortOrder === "manual") {
    return [...projects];
  }

  // Project timestamps scan all threads; compute once per project instead of per comparison.
  return projects
    .map((project) => ({
      project,
      timestamp: getProjectSortTimestamp(project, getProjectThreads(project), sortOrder),
    }))
    .sort((left, right) => {
      const byTimestamp =
        right.timestamp === left.timestamp ? 0 : right.timestamp > left.timestamp ? 1 : -1;
      return byTimestamp || compareTies(left.project, right.project);
    })
    .map(({ project }) => project);
}

export function sortProjectsForSidebar<
  TProject extends SidebarProject,
  TThread extends Pick<Thread, "projectId" | "createdAt" | "updatedAt"> & ThreadSortInput,
>(
  projects: readonly TProject[],
  threads: readonly TThread[],
  sortOrder: SidebarProjectSortOrder,
): TProject[] {
  const threadsByProjectId = new Map<string, TThread[]>();
  for (const thread of threads) {
    const existing = threadsByProjectId.get(thread.projectId) ?? [];
    existing.push(thread);
    threadsByProjectId.set(thread.projectId, existing);
  }

  return sortProjectsByActivity(
    projects,
    sortOrder,
    (project) => threadsByProjectId.get(project.id) ?? [],
    (left, right) => left.title.localeCompare(right.title) || left.id.localeCompare(right.id),
  );
}

export function sortLogicalProjectsForSidebar<
  TProject extends LogicalSidebarProject,
  TThread extends ScopedSidebarThread,
>(
  projects: readonly TProject[],
  threads: readonly TThread[],
  sortOrder: SidebarProjectSortOrder,
): TProject[] {
  const groupKeyByProjectRef = new Map(
    projects.flatMap((project) =>
      project.memberProjectRefs.map(
        (projectRef) =>
          [`${projectRef.environmentId}\0${projectRef.projectId}`, project.projectKey] as const,
      ),
    ),
  );
  const threadsByProjectKey = new Map<string, TThread[]>();
  for (const thread of threads) {
    if (thread.archivedAt !== null) continue;
    const projectKey = groupKeyByProjectRef.get(`${thread.environmentId}\0${thread.projectId}`);
    if (!projectKey) continue;
    const existing = threadsByProjectKey.get(projectKey);
    if (existing) {
      existing.push(thread);
    } else {
      threadsByProjectKey.set(projectKey, [thread]);
    }
  }

  return sortProjectsByActivity(
    projects,
    sortOrder,
    (project) => threadsByProjectKey.get(project.projectKey) ?? [],
    (left, right) =>
      left.title.localeCompare(right.title) || left.projectKey.localeCompare(right.projectKey),
  );
}

export function sortSidebarV2ProjectGroups<
  TProject extends LogicalSidebarProject,
  TThread extends ScopedSidebarThread & Pick<SidebarThreadSummary, "lineage">,
>(
  projects: readonly TProject[],
  threads: readonly TThread[],
  sortOrder: SidebarProjectSortOrder,
): TProject[] {
  return sortLogicalProjectsForSidebar(
    projects,
    filterSidebarV2VisibleThreads(threads, null),
    sortOrder,
  );
}

export function sortScopedProjectsForSidebar<
  TProject extends ScopedSidebarProject,
  TThread extends ScopedSidebarThread,
>(
  projects: readonly TProject[],
  threads: readonly TThread[],
  sortOrder: SidebarProjectSortOrder,
): TProject[] {
  const scopedKey = (environmentId: string, projectId: string) =>
    `${environmentId}\u0000${projectId}`;
  const threadsByProject = new Map<string, TThread[]>();
  for (const thread of threads) {
    if (thread.archivedAt !== null) {
      continue;
    }
    const key = scopedKey(thread.environmentId, thread.projectId);
    const existing = threadsByProject.get(key) ?? [];
    existing.push(thread);
    threadsByProject.set(key, existing);
  }

  return sortProjectsByActivity(
    projects,
    sortOrder,
    (project) => threadsByProject.get(scopedKey(project.environmentId, project.id)) ?? [],
    (left, right) =>
      left.title.localeCompare(right.title) ||
      left.environmentId.localeCompare(right.environmentId) ||
      left.id.localeCompare(right.id),
  );
}

/** What the sidebar list can show: live threads, one user-made group, Automations, or a parked shelf. */
