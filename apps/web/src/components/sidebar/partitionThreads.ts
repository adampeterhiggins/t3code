import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  type createInboxReturnTracker,
  isThreadWorking,
} from "@t3tools/client-runtime/state/thread-inbox";
import { sortSettledThreads } from "@t3tools/client-runtime/state/thread-sort";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ServerConfig } from "@t3tools/contracts";
import {
  applySidebarThreadDrop,
  filterSidebarV2VisibleThreads,
  firstValidTimestampMs,
  orderItemsByPreferredIds,
  sortInboxThreadsByReturn,
  sortPinnedThreadsForSidebar,
  sortThreadsForSidebar,
  sortWorkingThreadsBySend,
  type SidebarSection,
} from "../Sidebar.logic";
import {
  sidebarThreadShelf,
  sidebarShelfPage,
  type SidebarThreadShelf,
} from "./organization.logic";
import { sidebarGroupPage, type SidebarPage, type SidebarFacetThread } from "./organization.logic";

export type SidebarOptimisticDrop = {
  readonly key: string;
  readonly sourceSection: SidebarSection;
  readonly section: "pinned" | "active" | "settled";
  readonly occurredAt: string;
  readonly clearsSnooze: boolean;
  readonly order: readonly string[] | null;
  readonly keysAtDrop: ReadonlyMap<string, string | null>;
  readonly assignedKeys: ReadonlyMap<string, string>;
};

export function partitionSidebarThreads(input: {
  threads: ReadonlyArray<EnvironmentThreadShell>;
  tabThreadGroups: ReadonlyMap<string, string>;
  groupsShownInThreads: ReadonlySet<string>;
  serverConfigs: ReadonlyMap<EnvironmentId, Pick<ServerConfig, "environment">>;
  scopedProjectKeys: ReadonlySet<string> | null;
  optimisticDrop: SidebarOptimisticDrop | null;
  workingShelfEnabled: boolean;
  clockKey: string;
  delegatedUnderParent?: ReadonlySet<string>;
  inboxReturns: ReturnType<typeof createInboxReturnTracker>;
}) {
  const {
    threads,
    tabThreadGroups,
    groupsShownInThreads,
    serverConfigs,
    scopedProjectKeys,
    optimisticDrop,
    workingShelfEnabled,
    inboxReturns,
    delegatedUnderParent,
  } = input;
  const preciseNow = new Date().toISOString();
  // sidebar roster (v2 models them as real threads with lineage). Chat tabs
  // list under their group's row instead of as rows of their own.
  // Every project's threads are classified, so the filter menu can count the ones outside
  // the current scope; only scoped threads reach the shelves.
  const visible = filterSidebarV2VisibleThreads(threads, null, delegatedUnderParent).filter(
    (thread) => !tabThreadGroups.has(`${thread.environmentId}:${thread.id}`),
  );
  const inboxObservation = inboxReturns.observe(workingShelfEnabled ? threads : null);
  const pinned: EnvironmentThreadShell[] = [];
  const active: EnvironmentThreadShell[] = [];
  const working: EnvironmentThreadShell[] = [];
  const inbox = (thread: EnvironmentThreadShell) =>
    workingShelfEnabled && isThreadWorking(thread) ? "working" : "active";
  const snoozed: EnvironmentThreadShell[] = [];
  const hidden: EnvironmentThreadShell[] = [];
  const grouped: EnvironmentThreadShell[] = [];
  const automations: EnvironmentThreadShell[] = [];
  // Members of groups shown in Threads, which keep their own shelf too.
  const shownGrouped: Array<{
    thread: EnvironmentThreadShell;
    page: SidebarPage;
  }> = [];
  const settled: EnvironmentThreadShell[] = [];
  const facetThreads: SidebarFacetThread[] = [];
  const draggable = new Set<string>();
  const activeReorderable = new Set<string>();
  for (const thread of visible) {
    const capabilities = serverConfigs.get(thread.environmentId)?.environment.capabilities;
    const supportsSettlement = capabilities?.threadSettlement === true;
    const supportsSnooze = capabilities?.threadSnooze === true;
    const threadKey = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
    let row = thread;
    let shelf: SidebarThreadShelf;
    if (optimisticDrop?.key === threadKey) {
      const projected = applySidebarThreadDrop(
        thread,
        optimisticDrop.section,
        optimisticDrop.occurredAt,
        optimisticDrop.assignedKeys.get(threadKey),
      );
      shelf =
        optimisticDrop.section === "pinned"
          ? "pinned"
          : optimisticDrop.section === "settled"
            ? "settled"
            : inbox(projected);
      row = optimisticDrop.clearsSnooze
        ? projected
        : {
            ...projected,
            snoozedAt: thread.snoozedAt,
            snoozedUntil: thread.snoozedUntil,
          };
    } else {
      shelf = sidebarThreadShelf(thread, {
        supportsSnooze,
        supportsSettlement,
        workingShelfEnabled,
        now: preciseNow,
        groupsShownInThreads,
        working: inboxObservation.isWorking(thread),
      });
    }
    const page = sidebarShelfPage(shelf, row.groupName);
    const alsoGroupedIn =
      shelf !== "grouped" && shelf !== "hidden" && row.groupName != null ? row.groupName : null;
    facetThreads.push({
      environmentId: thread.environmentId,
      projectId: thread.projectId,
      pages: alsoGroupedIn === null ? [page] : [page, sidebarGroupPage(alsoGroupedIn)],
    });
    if (
      scopedProjectKeys !== null &&
      !scopedProjectKeys.has(`${thread.environmentId}:${thread.projectId}`)
    ) {
      continue;
    }
    if (capabilities?.threadActiveReorder === true) activeReorderable.add(threadKey);
    // Older servers retain their existing drag actions. Active placement
    // additionally requires its own ordering capability at the drop target.
    if (capabilities?.threadPinning === true && capabilities.threadPinReorder === true) {
      draggable.add(threadKey);
    }
    ({ hidden, grouped, automations, snoozed, settled, pinned, working, active })[shelf].push(row);
    if (alsoGroupedIn !== null) shownGrouped.push({ thread: row, page });
  }
  // Server capability only gates DRAGGING — it must not influence the
  // sort, or mixed-version fleets would render different pinned orders on
  // web and mobile from the same data.
  const sortedPinned = sortPinnedThreadsForSidebar(pinned);
  const sortedActive = workingShelfEnabled
    ? sortInboxThreadsByReturn(active, inboxObservation.returnedAt)
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
    workingThreads: sortWorkingThreadsBySend(working),
    snoozedThreads: snoozed.toSorted(
      (left, right) =>
        firstValidTimestampMs(left.snoozedUntil ?? null) -
        firstValidTimestampMs(right.snoozedUntil ?? null),
    ),
    // Most recently hidden first.
    hiddenThreads: hidden.toSorted(
      (left, right) =>
        firstValidTimestampMs(right.hiddenAt ?? null) -
        firstValidTimestampMs(left.hiddenAt ?? null),
    ),
    // Each group keeps the same order the active list uses.
    groupedThreads: sortThreadsForSidebar(grouped),
    shownGroupThreads: shownGrouped,
    automationThreads: sortThreadsForSidebar(automations),
    settledThreads: sortSettledThreads(settled),
    facetThreads,
    snoozeNow: preciseNow,
  };
}
