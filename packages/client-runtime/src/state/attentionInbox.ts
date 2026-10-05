import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

import { threadRuntimeIsActive, type EnvironmentThreadShell } from "./models.ts";
import { effectiveSnoozed, type ThreadSnoozeShell } from "./threadSettled.ts";

/**
 * Why a thread needs the user now, most urgent first. The agent is blocked on
 * the user for approval and input; failed and completed wait for a look.
 */
export type ThreadAttentionReason = "approval" | "input" | "failed" | "completed";

const REASON_RANK: Record<ThreadAttentionReason, number> = {
  approval: 0,
  input: 1,
  failed: 2,
  completed: 3,
};

export type AttentionThread = ThreadSnoozeShell &
  Pick<
    EnvironmentThreadShell,
    "id" | "archivedAt" | "updatedAt" | "runtime" | "latestRun" | "pendingBackgroundTasks"
  > & {
    readonly environmentId: EnvironmentId;
  };

export interface ThreadAttention {
  readonly reason: ThreadAttentionReason;
  /** When the reason arose, as far as the shell can tell. Sorts the inbox. */
  readonly at: string;
}

export interface AttentionInboxEntry<TThread extends AttentionThread> extends ThreadAttention {
  /** `environmentId:threadId`, the same key client read markers use. */
  readonly key: string;
  readonly thread: TThread;
}

function isAfterVisit(at: string | null | undefined, lastVisitedAt: string | undefined): boolean {
  if (!at) return false;
  const atMs = Date.parse(at);
  if (Number.isNaN(atMs)) return false;
  // A missing visit marker counts as read, so a new client does not light up
  // every historical thread. A corrupt marker counts as never read.
  if (!lastVisitedAt) return false;
  const visitedMs = Date.parse(lastVisitedAt);
  return Number.isNaN(visitedMs) || atMs > visitedMs;
}

/** The latest turn finished after the client last looked at the thread. */
export function hasUnseenCompletion(
  latestRun: EnvironmentThreadShell["latestRun"],
  lastVisitedAt: string | undefined,
): boolean {
  return isAfterVisit(latestRun?.completedAt, lastVisitedAt);
}

/**
 * The one reason a thread needs the user, or null. Mirrors the sidebar's
 * status order: requests beat failure, and anything still running (including
 * background work) is not waiting on anyone. Failures and completions clear
 * once the thread is visited; requests clear only when answered.
 */
export function resolveThreadAttention(
  thread: AttentionThread,
  lastVisitedAt: string | undefined,
): ThreadAttention | null {
  if (thread.hasPendingApprovals) return { reason: "approval", at: thread.updatedAt };
  if (thread.hasPendingUserInput) return { reason: "input", at: thread.updatedAt };
  const runtime = thread.runtime;
  if (threadRuntimeIsActive(runtime)) return null;
  const run = thread.latestRun;
  const failedAt =
    run?.status === "failed" && run.completedAt
      ? run.completedAt
      : runtime?.status === "failed"
        ? runtime.updatedAt
        : null;
  if (failedAt !== null) {
    return isAfterVisit(failedAt, lastVisitedAt) ? { reason: "failed", at: failedAt } : null;
  }
  if (thread.pendingBackgroundTasks.length > 0) return null;
  if (run?.completedAt && hasUnseenCompletion(run, lastVisitedAt)) {
    return { reason: "completed", at: run.completedAt };
  }
  return null;
}

/**
 * Threads that need the user now, one entry per thread, most urgent reason
 * first and newest first within a reason. Archived threads and threads still
 * snoozed are left out; a snoozed thread that raised its hand comes back.
 */
export function buildAttentionInbox<TThread extends AttentionThread>(
  threads: ReadonlyArray<TThread>,
  input: {
    readonly lastVisitedAtByKey: Readonly<Record<string, string>>;
    readonly now: string;
  },
): AttentionInboxEntry<TThread>[] {
  const entries = new Map<string, AttentionInboxEntry<TThread>>();
  for (const thread of threads) {
    if (thread.archivedAt !== null) continue;
    if (effectiveSnoozed(thread, { now: input.now })) continue;
    const key = attentionThreadKey(thread.environmentId, thread.id);
    const attention = resolveThreadAttention(thread, input.lastVisitedAtByKey[key]);
    if (attention === null) continue;
    const existing = entries.get(key);
    if (existing && compareEntries(existing, attention) <= 0) continue;
    entries.set(key, { key, thread, ...attention });
  }
  return [...entries.values()].sort(compareEntries);
}

function attentionThreadKey(environmentId: EnvironmentId, threadId: ThreadId): string {
  return `${environmentId}:${threadId}`;
}

function compareEntries(a: ThreadAttention, b: ThreadAttention): number {
  const rank = REASON_RANK[a.reason] - REASON_RANK[b.reason];
  if (rank !== 0) return rank;
  return timestampMs(b.at) - timestampMs(a.at);
}

function timestampMs(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}
