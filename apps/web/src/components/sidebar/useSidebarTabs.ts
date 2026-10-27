import { AuthOrchestrationOperateScope, type ScopedThreadRef } from "@t3tools/contracts";
import { setThreadTabGroupName } from "@t3tools/client-runtime/thread-tabs";
import { requestThreadTabGroupName } from "../ThreadTabGroupNameDialog";
import { readEnvironmentScope, readPreparedConnection } from "../../state/session";
import { runtime } from "../../lib/runtime";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import * as Schema from "effect/Schema";

import { type EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";

import { useThreadTabRecencyStore } from "../../threadTabRecencyStore";

import {
  type SidebarTabSortDirection,
  type SidebarTabSortOrder,
} from "@t3tools/contracts/settings";

import { useEffect, useRef, useState } from "react";

import {
  useClientSettings,
  useClientSettingsHydrated,
  updateClientSettings,
} from "../../hooks/useSettings";

import { useLocalStorage } from "../../hooks/useLocalStorage";

import {
  isSidebarTabGroupOpen,
  setSidebarTabGroupOverride,
  type SidebarTabGroupOverrides,
  layoutSidebarTabs,
  sidebarTabSortTimestamp,
  moveSidebarTab,
  withSidebarTabRanks,
  NO_SIDEBAR_TAB_MANUAL_RANKS,
  SIDEBAR_TAB_MANUAL_RANKS_KEY,
  SidebarTabManualRanksSchema,
} from "../Sidebar.logic";

import { stackedThreadToast, toastManager } from "../ui/toast";

import { SIDEBAR_TAB_SORT_ORDER_LABELS, sidebarTabSortDirectionLabel } from "./SidebarTabsMenu";

// Per-group exceptions to Show tabs. Client-local, like the shelves: a view preference.
// Stored with the Show tabs value they were made under, so changing that setting from
// anywhere (header, Settings, palette, keybinding) resets every group to it.
const TAB_GROUP_OVERRIDES_KEY = "t3code:sidebar:tab-group-overrides";
const TabGroupOverridesSchema = Schema.Struct({
  showTabs: Schema.Boolean,
  groups: Schema.Record(Schema.String, Schema.Boolean),
});
const NO_TAB_GROUP_OVERRIDES: SidebarTabGroupOverrides = {};
const INITIAL_TAB_GROUP_OVERRIDES = {
  showTabs: false,
  groups: NO_TAB_GROUP_OVERRIDES,
};

function sidebarThreadKey(thread: EnvironmentThreadShell): string {
  return scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
}

type SidebarTabLayout = ReturnType<typeof layoutSidebarTabs<EnvironmentThreadShell>> & {
  readonly listsRow: boolean;
};

export function useSidebarTabs(
  threads: readonly EnvironmentThreadShell[],
  tabGroupNames: ReadonlyMap<string, string>,
) {
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
  const toggleTabGroup = (rowKey: string) =>
    setStoredTabGroupOverrides((stored) => {
      const overrides = stored.showTabs === showTabs ? stored.groups : NO_TAB_GROUP_OVERRIDES;
      const open = !isSidebarTabGroupOpen(rowKey, overrides, showTabs);
      return {
        showTabs,
        groups: setSidebarTabGroupOverride(overrides, rowKey, open, showTabs),
      };
    });

  const tabLayoutByRowKeyRef = useRef<ReadonlyMap<string, SidebarTabLayout>>(new Map());
  const tabSortOrderRef = useRef(tabSortOrder);
  const commitTabLayout = (layout: ReadonlyMap<string, SidebarTabLayout>) => {
    tabLayoutByRowKeyRef.current = layout;
    tabSortOrderRef.current = tabSortOrder;
  };
  const toggleTabOverflow = (rowKey: string) => {
    setExpandedTabRowKey((current) => (current === rowKey ? null : rowKey));
  };

  // The list's pointer and the portaled "n more" preview both count as resting, so a live
  // sort does not reshuffle the tabs while you are reading or clicking the preview.
  const tabListPointerRowRef = useRef<string | null>(null);
  const tabOverflowPreviewRowRef = useRef<string | null>(null);
  const syncTabOrderHold = (rowKey: string) => {
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
  };
  const handleTabPointerRest = (rowKey: string, resting: boolean) => {
    if (resting) tabListPointerRowRef.current = rowKey;
    else if (tabListPointerRowRef.current === rowKey) tabListPointerRowRef.current = null;
    syncTabOrderHold(rowKey);
  };
  const handleTabOverflowPreview = (rowKey: string, open: boolean) => {
    const previous = tabOverflowPreviewRowRef.current;
    if (open) tabOverflowPreviewRowRef.current = rowKey;
    else if (previous === rowKey) tabOverflowPreviewRowRef.current = null;
    if (previous !== null && previous !== rowKey) syncTabOrderHold(previous);
    syncTabOrderHold(rowKey);
  };

  // A drop in a timed order switches to Manual, starting from the order you were looking at.
  const handleTabReorder = (rowKey: string, activeKey: string, overKey: string) => {
    const layout = tabLayoutByRowKeyRef.current.get(rowKey);
    if (!layout) return;
    const orderedKeys = moveSidebarTab(
      layout.ordered.map(sidebarThreadKey),
      layout.shown.map(sidebarThreadKey),
      activeKey,
      overKey,
    );
    const liveKeys = new Set(threads.map(sidebarThreadKey));
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
        description: `Was ${SIDEBAR_TAB_SORT_ORDER_LABELS[tabSortOrder]}, ${sidebarTabSortDirectionLabel(tabSortOrder, tabSortDirection).toLowerCase()}.`,
        actionProps: {
          children: "Undo",
          onClick: () => {
            toastManager.close(toastId);
            void updateClientSettings(previous);
          },
        },
      }),
    );
  };
  const handleTabsShownChange = (shown: boolean, limit: number | null) => {
    void updateClientSettings({
      sidebarShowTabs: shown,
      sidebarTabLimit: limit,
    });
  };
  const handleTabSortOrderChange = (order: SidebarTabSortOrder) =>
    void updateClientSettings({ sidebarTabSortOrder: order });
  const handleTabSortDirectionChange = (direction: SidebarTabSortDirection) =>
    void updateClientSettings({ sidebarTabSortDirection: direction });

  const nameTabGroup = (threadRef: ScopedThreadRef) => {
    void (async () => {
      if (!readEnvironmentScope(threadRef.environmentId, AuthOrchestrationOperateScope)) return;
      const name = await requestThreadTabGroupName(
        tabGroupNames.get(scopedThreadKey(threadRef)) ?? null,
      );
      if (name === undefined) return;
      const prepared = readPreparedConnection(threadRef.environmentId);
      if (!prepared) return;
      try {
        await runtime.runPromise(setThreadTabGroupName(prepared, threadRef.threadId, name));
      } catch {
        toastManager.add({
          type: "error",
          title: "Could not name thread group",
        });
      }
    })();
  };

  // Each listed group's tabs as the sidebar shows them: sorted, held still under a resting
  // pointer, then cut to the limit. A card lists its own thread among its tabs; a slim row
  // stands for its thread and lists only the others.
  const layoutTabGroups = (
    listedTabsByRowKey: ReadonlyMap<string, readonly EnvironmentThreadShell[]>,
    cards: readonly EnvironmentThreadShell[],
    openRowKeys: readonly string[],
  ) => {
    const layouts = new Map<string, SidebarTabLayout>();
    if (listedTabsByRowKey.size === 0) return layouts;
    const cardByKey = new Map(cards.map((thread) => [sidebarThreadKey(thread), thread]));
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
        openKeys: openRowKeys,
        expanded: expandedTabRowKey === rowKey,
      });
      layouts.set(rowKey, { ...layout, listsRow: card !== undefined });
    }
    return layouts;
  };

  return {
    layoutTabGroups,
    tabLayoutByRowKeyRef,
    commitTabLayout,
    toggleTabOverflow,
    handleTabPointerRest,
    handleTabOverflowPreview,
    handleTabReorder,
    handleTabsShownChange,
    handleTabSortOrderChange,
    handleTabSortDirectionChange,
    showTabs,
    tabLimit,
    tabSortOrder,
    tabSortDirection,
    tabManualRanks,
    expandedTabRowKey,
    setExpandedTabRowKey,
    openedAtByThreadKey,
    tabGroupOverrides,
    toggleTabGroup,
    nameTabGroup,
  };
}
