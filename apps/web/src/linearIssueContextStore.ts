import { create } from "zustand";

import type { LinearIssueContextRecord, ThreadId } from "@t3tools/contracts";

const EMPTY: ReadonlyArray<LinearIssueContextRecord> = [];

/**
 * Linear issue snapshots attached to a draft, keyed by the thread being composed in. The prompt
 * owns where each chip sits; this holds the payload behind it. In-memory on purpose, like chat
 * tab summaries: a reloaded draft shows the chip as unavailable rather than a stale issue.
 */
interface LinearIssueContextStoreState {
  recordsByThreadId: Readonly<Record<string, ReadonlyArray<LinearIssueContextRecord>>>;
  upsert: (threadId: ThreadId, record: LinearIssueContextRecord) => void;
  clear: (threadId: ThreadId) => void;
}

export const useLinearIssueContextStore = create<LinearIssueContextStoreState>()((set) => ({
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

export function useLinearIssueContextRecords(threadId: ThreadId | null | undefined) {
  return useLinearIssueContextStore((state) =>
    threadId ? (state.recordsByThreadId[threadId] ?? EMPTY) : EMPTY,
  );
}

export function readLinearIssueContextRecords(threadId: ThreadId) {
  return useLinearIssueContextStore.getState().recordsByThreadId[threadId] ?? EMPTY;
}
