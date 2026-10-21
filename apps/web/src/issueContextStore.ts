import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";

import type {
  NotionPageContextRecord,
  GranolaNoteContextRecord,
  PromptLinkContextRecord,
  GitHubIssueContextRecord,
  GitHubRefContextRecord,
  UnreadLinkContextRecord,
  ModelContextRecord,
  LinearIssueContextRecord,
  LinearObjectContextRecord,
  DiscordThreadContextRecord,
  SlackThreadContextRecord,
  SubagentContextRecord,
  ThreadId,
} from "@t3tools/contracts";

/**
 * An attached snapshot fetched from another service (a Linear or GitHub issue, a Slack or Discord
 * thread, a Notion page, a Granola note) or, in the fork, a referenced subagent, a T3 Code prompt
 * link, a GitHub release, tag, branch, or commit, or a Linear project, document, or initiative.
 */
export type IssueContextRecord =
  | LinearIssueContextRecord
  | LinearObjectContextRecord
  | GitHubIssueContextRecord
  | SlackThreadContextRecord
  | DiscordThreadContextRecord
  | NotionPageContextRecord
  | GranolaNoteContextRecord
  | SubagentContextRecord
  | PromptLinkContextRecord
  | GitHubRefContextRecord
  | UnreadLinkContextRecord
  | ModelContextRecord;

const EMPTY: ReadonlyArray<IssueContextRecord> = [];

/** External service snapshots captured for drafts. Persist the payload alongside the prompt
 * so reopening the app preserves the references to these snapshots.
 */
interface IssueContextStoreState {
  recordsByThreadId: Readonly<Record<string, ReadonlyArray<IssueContextRecord>>>;
  upsert: (threadId: ThreadId, record: IssueContextRecord) => void;
  clear: (threadId: ThreadId) => void;
}

export const useIssueContextStore = create<IssueContextStoreState>()(
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
      name: "t3code:issue-context:v1",
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ recordsByThreadId: state.recordsByThreadId }),
    },
  ),
);

export function useIssueContextRecords(threadId: ThreadId | null | undefined) {
  return useIssueContextStore((state) =>
    threadId ? (state.recordsByThreadId[threadId] ?? EMPTY) : EMPTY,
  );
}

export function readIssueContextRecords(threadId: ThreadId) {
  return useIssueContextStore.getState().recordsByThreadId[threadId] ?? EMPTY;
}
