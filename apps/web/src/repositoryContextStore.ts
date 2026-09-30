import { create } from "zustand";

import type { RepositoryContextRecord, ThreadId } from "@t3tools/contracts";

const EMPTY: ReadonlyArray<RepositoryContextRecord> = [];

/**
 * Repositories attached to a draft, keyed by the thread being composed in. The prompt owns where
 * each chip sits; this holds the payload behind it. In-memory like Linear issue snapshots: a
 * reloaded draft shows the chip as unavailable rather than cloning something unexpected.
 */
interface RepositoryContextStoreState {
  recordsByThreadId: Readonly<Record<string, ReadonlyArray<RepositoryContextRecord>>>;
  upsert: (threadId: ThreadId, record: RepositoryContextRecord) => void;
  clear: (threadId: ThreadId) => void;
}

export const useRepositoryContextStore = create<RepositoryContextStoreState>()((set) => ({
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

export function useRepositoryContextRecords(threadId: ThreadId | null | undefined) {
  return useRepositoryContextStore((state) =>
    threadId ? (state.recordsByThreadId[threadId] ?? EMPTY) : EMPTY,
  );
}

export function readRepositoryContextRecords(threadId: ThreadId) {
  return useRepositoryContextStore.getState().recordsByThreadId[threadId] ?? EMPTY;
}
