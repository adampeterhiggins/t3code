import { create } from "zustand";

import type {
  NotionPageContextRecord,
  GitHubIssueContextRecord,
  LinearIssueContextRecord,
  SlackThreadContextRecord,
  SubagentContextRecord,
  ThreadId,
} from "@t3tools/contracts";

/**
 * An attached snapshot fetched from another service (a Linear or GitHub issue, a Slack thread, a
 * Notion page) or, in the fork, a referenced subagent.
 */
export type IssueContextRecord =
  | LinearIssueContextRecord
  | GitHubIssueContextRecord
  | SlackThreadContextRecord
  | NotionPageContextRecord
  | SubagentContextRecord;

const EMPTY: ReadonlyArray<IssueContextRecord> = [];

/**
 * External service snapshots attached to a draft, keyed by the thread being composed in. The prompt owns
 * where each chip sits; this holds the payload behind it. In-memory on purpose, like chat tab
 * summaries: a reloaded draft shows the chip as unavailable rather than a stale issue.
 */
interface IssueContextStoreState {
  recordsByThreadId: Readonly<Record<string, ReadonlyArray<IssueContextRecord>>>;
  upsert: (threadId: ThreadId, record: IssueContextRecord) => void;
  clear: (threadId: ThreadId) => void;
}

export const useIssueContextStore = create<IssueContextStoreState>()((set) => ({
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

export function useIssueContextRecords(threadId: ThreadId | null | undefined) {
  return useIssueContextStore((state) =>
    threadId ? (state.recordsByThreadId[threadId] ?? EMPTY) : EMPTY,
  );
}

export function readIssueContextRecords(threadId: ThreadId) {
  return useIssueContextStore.getState().recordsByThreadId[threadId] ?? EMPTY;
}
