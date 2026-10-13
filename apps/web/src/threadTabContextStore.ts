import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";

import type { ThreadId, ThreadTabContextRecord } from "@t3tools/contracts";

const EMPTY: ReadonlyArray<ThreadTabContextRecord> = [];

/** Sibling-tab summaries captured for drafts. Persist the payload alongside the prompt
 * so reopening the app preserves the references to these snapshots.
 */
interface ThreadTabContextStoreState {
  recordsByThreadId: Readonly<Record<string, ReadonlyArray<ThreadTabContextRecord>>>;
  upsert: (threadId: ThreadId, record: ThreadTabContextRecord) => void;
  clear: (threadId: ThreadId) => void;
}

export const useThreadTabContextStore = create<ThreadTabContextStoreState>()(
  persist(
    (set) => ({
      recordsByThreadId: {},
      upsert: (threadId, record) =>
        set((state) => ({
          recordsByThreadId: {
            ...state.recordsByThreadId,
            [threadId]: [
              ...(state.recordsByThreadId[threadId] ?? EMPTY).filter(
                (existing) => existing.contextId !== record.contextId,
              ),
              record,
            ],
          },
        })),
      clear: (threadId) =>
        set((state) => {
          if (!(threadId in state.recordsByThreadId)) return state;
          const { [threadId]: _removed, ...rest } = state.recordsByThreadId;
          return { recordsByThreadId: rest };
        }),
    }),
    {
      name: "t3code:threadTab-context:v1",
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ recordsByThreadId: state.recordsByThreadId }),
    },
  ),
);

export function useThreadTabContextRecords(threadId: ThreadId | null | undefined) {
  return useThreadTabContextStore((state) =>
    threadId ? (state.recordsByThreadId[threadId] ?? EMPTY) : EMPTY,
  );
}

export function readThreadTabContextRecords(threadId: ThreadId) {
  return useThreadTabContextStore.getState().recordsByThreadId[threadId] ?? EMPTY;
}
