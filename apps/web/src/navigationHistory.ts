import { useSyncExternalStore } from "react";

export type HistoryDirection = "back" | "forward";

function subscribeToNavigationHistory(onChange: () => void): () => void {
  window.navigation?.addEventListener("currententrychange", onChange);
  return () => window.navigation?.removeEventListener("currententrychange", onChange);
}

export function canNavigateHistory(direction: HistoryDirection): boolean {
  // Browsers without the Navigation API cannot expose their available history depth.
  return direction === "back"
    ? (window.navigation?.canGoBack ?? true)
    : (window.navigation?.canGoForward ?? true);
}

export function navigateHistory(direction: HistoryDirection) {
  if (direction === "back") window.history.back();
  else window.history.forward();
}

export function useCanNavigateHistory(direction: HistoryDirection): boolean {
  return useSyncExternalStore(subscribeToNavigationHistory, () => canNavigateHistory(direction));
}
