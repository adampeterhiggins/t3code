import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { useCallback, useRef } from "react";

import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";

/**
 * Shared persisted Working shelf state for the compact Home list and iPad
 * sidebar. Snoozed and Settled are picked in the Show menu and always open.
 * Refs advance before persistence starts so consecutive presses always toggle
 * the latest value, even if React has not rendered the optimistic patch yet.
 */
export function useThreadListV2ShelfPreferences() {
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const loaded = AsyncResult.isSuccess(preferencesResult);
  // Working section beta: off until the preference loads and is enabled.
  const workingShelfEnabled = loaded && preferencesResult.value.workingShelfEnabled === true;
  const workingShelfExpanded =
    loaded && preferencesResult.value.threadListWorkingShelfExpanded === true;
  const workingShelfExpandedRef = useRef(workingShelfExpanded);
  workingShelfExpandedRef.current = workingShelfExpanded;

  const toggleWorkingShelf = useCallback(() => {
    if (!loaded) return;
    const expanded = !workingShelfExpandedRef.current;
    workingShelfExpandedRef.current = expanded;
    savePreferences({ threadListWorkingShelfExpanded: expanded });
  }, [loaded, savePreferences]);

  return {
    loaded,
    workingShelfEnabled,
    workingShelfExpanded,
    toggleWorkingShelf,
  } as const;
}
