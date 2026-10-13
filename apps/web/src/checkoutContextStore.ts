import { create } from "zustand";

import type { CheckoutContextRecord, ThreadId } from "@t3tools/contracts";

const EMPTY: ReadonlyArray<CheckoutContextRecord> = [];

/**
 * Checkouts attached to a draft, keyed by the thread being composed in. The prompt owns where
 * each chip sits; this holds the snapshot behind it.
 */
interface CheckoutContextStoreState {
  recordsByThreadId: Readonly<Record<string, ReadonlyArray<CheckoutContextRecord>>>;
  upsert: (threadId: ThreadId, record: CheckoutContextRecord) => void;
  clear: (threadId: ThreadId) => void;
}

export const useCheckoutContextStore = create<CheckoutContextStoreState>()((set) => ({
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

export function useCheckoutContextRecords(threadId: ThreadId | null | undefined) {
  return useCheckoutContextStore((state) =>
    threadId ? (state.recordsByThreadId[threadId] ?? EMPTY) : EMPTY,
  );
}

export function readCheckoutContextRecords(threadId: ThreadId) {
  return useCheckoutContextStore.getState().recordsByThreadId[threadId] ?? EMPTY;
}
