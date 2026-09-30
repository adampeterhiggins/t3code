import { create } from "zustand";

/**
 * Two chats shown side by side, as scoped thread keys in screen order (start, end). The split
 * shows whenever the routed thread is one of them; the routed one is the focused pane. Opening
 * any other chat shows it alone, and going back to either chat brings the split back.
 */
export type SplitPanes = readonly [string, string];

/**
 * The split after opening `otherKey` beside `currentKey`. A split that already holds
 * `currentKey` keeps it in place and swaps out its partner.
 */
export function openSplitPanes(
  panes: SplitPanes | null,
  currentKey: string,
  otherKey: string,
): SplitPanes | null {
  if (currentKey === otherKey) return panes;
  if (panes?.[1] === currentKey) return [otherKey, currentKey];
  return [currentKey, otherKey];
}

/** The chat shown beside `key`, or null when `key` is not in the split. */
export function splitPartnerKey(panes: SplitPanes | null, key: string | null): string | null {
  if (panes === null || key === null) return null;
  if (panes[0] === key) return panes[1];
  if (panes[1] === key) return panes[0];
  return null;
}

/**
 * The split after `fromKey`'s pane switches to `toKey` (a tab picked from that pane's own tab
 * menu). Picking the chat already in the other pane leaves the split alone.
 */
export function replaceSplitPane(
  panes: SplitPanes | null,
  fromKey: string,
  toKey: string,
): SplitPanes | null {
  if (panes === null || splitPartnerKey(panes, toKey) !== null) return panes;
  if (panes[0] === fromKey) return [toKey, panes[1]];
  if (panes[1] === fromKey) return [panes[0], toKey];
  return panes;
}

/**
 * The sibling tab to open beside `currentKey`: the one opened most recently, else the first
 * other tab in group order.
 */
export function pickSplitPartner(
  currentKey: string,
  tabKeys: ReadonlyArray<string>,
  openedAtByThreadKey: Readonly<Record<string, number>>,
): string | null {
  let best: string | null = null;
  let bestOpenedAt = Number.NEGATIVE_INFINITY;
  for (const key of tabKeys) {
    if (key === currentKey) continue;
    const openedAt = openedAtByThreadKey[key] ?? Number.NEGATIVE_INFINITY;
    if (best === null || openedAt > bestOpenedAt) {
      best = key;
      bestOpenedAt = openedAt;
    }
  }
  return best;
}

/**
 * What a thread's menu offers for split view: "close" on either chat of the split on screen,
 * "open" on any other thread while a started chat is routed, null otherwise.
 */
export function splitMenuAction(
  panes: SplitPanes | null,
  threadKey: string,
  routeKey: string | null,
): "open" | "close" | null {
  if (routeKey === null) return null;
  const routePartner = splitPartnerKey(panes, routeKey);
  if (routePartner !== null && (threadKey === routeKey || threadKey === routePartner)) {
    return "close";
  }
  return threadKey === routeKey ? null : "open";
}

interface SplitViewState {
  panes: SplitPanes | null;
  /** A pane reached from the keyboard, whose composer takes focus once it is the focused pane. */
  composerFocusKey: string | null;
  open: (currentKey: string, otherKey: string) => void;
  replace: (fromKey: string, toKey: string) => void;
  close: () => void;
  requestComposerFocus: (key: string) => void;
  clearComposerFocus: () => void;
}

/** In memory only: a reload starts on a single chat. */
export const useSplitViewStore = create<SplitViewState>()((set) => ({
  panes: null,
  composerFocusKey: null,
  open: (currentKey, otherKey) =>
    set((state) => ({ panes: openSplitPanes(state.panes, currentKey, otherKey) })),
  replace: (fromKey, toKey) =>
    set((state) => ({ panes: replaceSplitPane(state.panes, fromKey, toKey) })),
  close: () => set({ panes: null, composerFocusKey: null }),
  requestComposerFocus: (key) => set({ composerFocusKey: key }),
  clearComposerFocus: () => set({ composerFocusKey: null }),
}));
