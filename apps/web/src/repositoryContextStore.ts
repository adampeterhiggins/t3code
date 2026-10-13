import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";

import type { RepositoryContextRecord, ThreadId } from "@t3tools/contracts";

const EMPTY: ReadonlyArray<RepositoryContextRecord> = [];

/** Repositories captured for drafts. Persist the payload alongside the prompt
 * so reopening the app preserves the references to these snapshots.
 */
interface RepositoryContextStoreState {
  recordsByThreadId: Readonly<Record<string, ReadonlyArray<RepositoryContextRecord>>>;
  upsert: (threadId: ThreadId, record: RepositoryContextRecord) => void;
  clear: (threadId: ThreadId) => void;
}

export const useRepositoryContextStore = create<RepositoryContextStoreState>()(
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
      name: "t3code:repository-context:v1",
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ recordsByThreadId: state.recordsByThreadId }),
    },
  ),
);

export function useRepositoryContextRecords(threadId: ThreadId | null | undefined) {
  return useRepositoryContextStore((state) =>
    threadId ? (state.recordsByThreadId[threadId] ?? EMPTY) : EMPTY,
  );
}

export function readRepositoryContextRecords(threadId: ThreadId) {
  return useRepositoryContextStore.getState().recordsByThreadId[threadId] ?? EMPTY;
}
