import { parseScopedThreadKey, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { threadTabGroupTarget } from "@t3tools/client-runtime/thread-tabs";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";

const MAX_REMEMBERED_TABS = 200;

/** When each chat tab was last open, so a tab group's sidebar row reopens the tab left open. */
interface ThreadTabRecencyState {
  openedAtByThreadKey: Readonly<Record<string, number>>;
  markOpened: (ref: ScopedThreadRef) => void;
}

export const useThreadTabRecencyStore = create<ThreadTabRecencyState>()(
  persist(
    (set) => ({
      openedAtByThreadKey: {},
      markOpened: (ref) =>
        set((state) => {
          const entries = Object.entries(state.openedAtByThreadKey)
            .filter(([key]) => key !== scopedThreadKey(ref))
            .toSorted(([, left], [, right]) => right - left)
            .slice(0, MAX_REMEMBERED_TABS - 1);
          return {
            openedAtByThreadKey: Object.fromEntries([
              [scopedThreadKey(ref), Date.now()],
              ...entries,
            ]),
          };
        }),
    }),
    {
      name: "t3code:thread-tab-recency:v1",
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
    },
  ),
);

/** The thread to open for a sidebar row: its group's most recently opened tab, or itself. */
export function resolveThreadTabTarget(
  ref: ScopedThreadRef,
  hiddenTabThreads: ReadonlyMap<string, string>,
): ScopedThreadRef {
  const target = threadTabGroupTarget(
    scopedThreadKey(ref),
    hiddenTabThreads,
    useThreadTabRecencyStore.getState().openedAtByThreadKey,
  );
  return parseScopedThreadKey(target) ?? ref;
}
