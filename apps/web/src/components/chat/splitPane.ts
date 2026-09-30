import {
  parseScopedThreadKey,
  scopedThreadKey,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { createContext, useCallback, useContext, useMemo } from "react";

import { RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY } from "../../rightPanelLayout";
import { pickSplitPartner, splitPartnerKey, useSplitViewStore } from "../../splitViewStore";
import { useThreadShell } from "../../state/entities";
import { useThreadTabRecencyStore } from "../../threadTabRecencyStore";
import { buildThreadRouteParams } from "../../threadRoutes";
import { toastManager } from "../ui/toast";

/** Whether the chat view below is the focused pane of a split; null outside a split. */
export const SplitPaneContext = createContext<{ readonly focused: boolean } | null>(null);

/**
 * The split pane a chat view sits in: "unfocused" for the pane beside the routed chat, null
 * outside a split. Window-level shortcuts and focus grabs skip unfocused panes so only the
 * focused one answers them.
 */
export function useSplitPaneFocus(): "focused" | "unfocused" | null {
  const pane = useContext(SplitPaneContext);
  return pane === null ? null : pane.focused ? "focused" : "unfocused";
}

/** Split view needs room for two chat columns; narrower windows show the routed chat alone. */
export const SPLIT_VIEW_HIDDEN_MEDIA_QUERY = RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY;

/**
 * Opens, focuses, and closes split panes. The routed thread is always the focused pane, so
 * focusing a pane replaces the route rather than pushing history.
 */
export function useSplitViewActions() {
  const navigate = useNavigate();

  const focusPane = useCallback(
    (ref: ScopedThreadRef, options?: { focusComposer?: boolean }) => {
      if (options?.focusComposer) {
        useSplitViewStore.getState().requestComposerFocus(scopedThreadKey(ref));
      }
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(ref),
        replace: true,
      });
    },
    [navigate],
  );

  /** Shows `other` beside `current`, the routed chat, which keeps focus. */
  const openBeside = useCallback((current: ScopedThreadRef, other: ScopedThreadRef) => {
    useSplitViewStore.getState().open(scopedThreadKey(current), scopedThreadKey(other));
    if (window.matchMedia(SPLIT_VIEW_HIDDEN_MEDIA_QUERY).matches) {
      toastManager.add({
        type: "info",
        title: "Widen the window to see both chats",
        description: "Split view shows two chats side by side on wider windows.",
      });
    }
  }, []);

  /**
   * Closes `pane`'s side of the split; the other chat stays open on its own. Closing the focused
   * pane moves the route to the chat that stays.
   */
  const closePane = useCallback(
    (pane: ScopedThreadRef, paneFocused: boolean) => {
      const store = useSplitViewStore.getState();
      const partner = parseScopedThreadKey(
        splitPartnerKey(store.panes, scopedThreadKey(pane)) ?? "",
      );
      store.close();
      if (partner && paneFocused) focusPane(partner);
    },
    [focusPane],
  );

  /**
   * Closes the split around `routeRef`, keeping it, or opens its most recently used sibling tab
   * beside it. `tabThreadIds` is the routed chat's tab group, null when it has none.
   */
  const toggle = useCallback(
    (routeRef: ScopedThreadRef, tabThreadIds: ReadonlyArray<ThreadId> | null) => {
      const store = useSplitViewStore.getState();
      const routeKey = scopedThreadKey(routeRef);
      if (splitPartnerKey(store.panes, routeKey) !== null) {
        store.close();
        return;
      }
      const partnerKey = pickSplitPartner(
        routeKey,
        (tabThreadIds ?? []).map((threadId) =>
          scopedThreadKey(scopeThreadRef(routeRef.environmentId, threadId)),
        ),
        useThreadTabRecencyStore.getState().openedAtByThreadKey,
      );
      const partner = partnerKey ? parseScopedThreadKey(partnerKey) : null;
      if (!partner) {
        toastManager.add({
          type: "info",
          title: "No other tab to show beside this chat",
          description:
            "Open a new tab, or right-click a thread in the sidebar and choose Open in split view.",
        });
        return;
      }
      openBeside(routeRef, partner);
    },
    [openBeside],
  );

  /** Moves focus, and the keyboard, to the other pane. */
  const focusOther = useCallback(
    (routeRef: ScopedThreadRef) => {
      const panes = useSplitViewStore.getState().panes;
      const partner = parseScopedThreadKey(splitPartnerKey(panes, scopedThreadKey(routeRef)) ?? "");
      if (partner) focusPane(partner, { focusComposer: true });
    },
    [focusPane],
  );

  return useMemo(
    () => ({ focusPane, openBeside, closePane, toggle, focusOther }),
    [closePane, focusOther, focusPane, openBeside, toggle],
  );
}

/** The chat a split shows beside `routeRef`, while that chat still exists. */
export function useSplitPartner(routeRef: ScopedThreadRef | null): ScopedThreadRef | null {
  const routeKey = routeRef ? scopedThreadKey(routeRef) : null;
  const partnerKey = useSplitViewStore((state) => splitPartnerKey(state.panes, routeKey));
  const partnerRef = useMemo(
    () => (partnerKey ? parseScopedThreadKey(partnerKey) : null),
    [partnerKey],
  );
  // Archiving drops a thread's shell, so a closed or archived partner simply stops showing.
  const partnerShell = useThreadShell(partnerRef);
  return partnerShell ? partnerRef : null;
}

export type SplitViewAction = "toggle" | "focus-other";

const SPLIT_VIEW_ACTION_EVENT = "t3code:split-view-action";

/** Lets the command palette reach the focused chat view, which knows its tab group. */
export function dispatchSplitViewAction(action: SplitViewAction): void {
  window.dispatchEvent(
    new CustomEvent<SplitViewAction>(SPLIT_VIEW_ACTION_EVENT, { detail: action }),
  );
}

export function subscribeSplitViewAction(listener: (action: SplitViewAction) => void): () => void {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<SplitViewAction>).detail;
    if (detail === "toggle" || detail === "focus-other") listener(detail);
  };
  window.addEventListener(SPLIT_VIEW_ACTION_EVENT, handler);
  return () => window.removeEventListener(SPLIT_VIEW_ACTION_EVENT, handler);
}
