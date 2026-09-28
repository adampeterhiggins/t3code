import { create } from "zustand";

import type { ThreadId, ThreadTabContextRecord } from "@t3tools/contracts";

const EMPTY: ReadonlyArray<ThreadTabContextRecord> = [];

/**
 * Sibling-tab summaries captured for a draft, keyed by the thread being composed in. The prompt
 * owns where each chip sits; this only holds the payload behind it. In-memory on purpose: a
 * summary is a snapshot, so a reloaded draft shows the chip as unavailable instead of stale text.
 */
interface ThreadTabContextStoreState {
  recordsByThreadId: Readonly<Record<string, ReadonlyArray<ThreadTabContextRecord>>>;
  upsert: (threadId: ThreadId, record: ThreadTabContextRecord) => void;
  clear: (threadId: ThreadId) => void;
}

export const useThreadTabContextStore = create<ThreadTabContextStoreState>()((set) => ({
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
}));

export function useThreadTabContextRecords(threadId: ThreadId | null | undefined) {
  return useThreadTabContextStore((state) =>
    threadId ? (state.recordsByThreadId[threadId] ?? EMPTY) : EMPTY,
  );
}

export function readThreadTabContextRecords(threadId: ThreadId) {
  return useThreadTabContextStore.getState().recordsByThreadId[threadId] ?? EMPTY;
}
