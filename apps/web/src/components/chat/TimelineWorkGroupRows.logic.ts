import {
  toolGroupAction,
  type ToolGroupAction,
} from "@t3tools/client-runtime/work-log/presentation";
import { formatDuration } from "@t3tools/shared/orchestrationTiming";
import * as DateTime from "effect/DateTime";
import { workEntryDisplayIndicatesToolFailure, type WorkLogEntry } from "../../session-logic";

function formatWorkingTimer(startIso: string, endIso: string): string | null {
  const startedAtMs = Date.parse(startIso);
  const endedAtMs = Date.parse(endIso);
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(endedAtMs)) {
    return null;
  }

  const elapsedSeconds = Math.max(0, Math.floor((endedAtMs - startedAtMs) / 1000));
  if (elapsedSeconds < 60) {
    return `${elapsedSeconds}s`;
  }

  return formatDuration(elapsedSeconds * 1_000);
}

export function formatWorkingTimerNow(startIso: string): string {
  return formatWorkingTimer(startIso, new Date().toISOString()) ?? "0s";
}

/** Calls at least this long stand out in a group's hover card. */
export const SLOW_TOOL_CALL_MS = 10_000;

/** When the call started and ended, falling back to when its entry was created. */
export function workEntryTiming(entry: WorkLogEntry): {
  startedAt: string;
  completedAt: string | null;
} {
  const item = entry.projectedItem?.item;
  return {
    startedAt: item?.startedAt ? DateTime.formatIso(item.startedAt) : entry.createdAt,
    completedAt: item?.completedAt ? DateTime.formatIso(item.completedAt) : null,
  };
}

/** Only calls the provider timed have a duration; the rest keep their timestamp. */
export function workEntryDurationMs(entry: WorkLogEntry): number | null {
  const item = entry.projectedItem?.item;
  if (!item?.startedAt || !item.completedAt) return null;
  return Math.max(
    0,
    DateTime.toEpochMillis(item.completedAt) - DateTime.toEpochMillis(item.startedAt),
  );
}

const ACTION_NOUNS: Record<ToolGroupAction, readonly [string, string]> = {
  "link-pr": ["PR action", "PR actions"],
  "unlink-pr": ["PR action", "PR actions"],
  "list-prs": ["PR action", "PR actions"],
  "watch-pr": ["PR action", "PR actions"],
  "unwatch-pr": ["PR action", "PR actions"],
  read: ["read", "reads"],
  edit: ["edit", "edits"],
  command: ["command", "commands"],
  "thread-create": ["new thread", "new threads"],
  browser: ["browser action", "browser actions"],
  device: ["device action", "device actions"],
  "code-search": ["search", "searches"],
  search: ["web search", "web searches"],
  other: ["tool call", "tool calls"],
  update: ["update", "updates"],
};

export interface WorkGroupPreviewSummary {
  startedAt: string;
  /** Null while a call is still running. */
  completedAt: string | null;
  elapsedMs: number | null;
  counts: string[];
  failedCount: number;
  runningCount: number;
  /** Only when the provider reported line counts for an edit. */
  diff: { additions: number; deletions: number } | null;
}

export function summarizeWorkGroupPreview(
  entries: ReadonlyArray<WorkLogEntry>,
  isRunning: (entry: WorkLogEntry) => boolean,
): WorkGroupPreviewSummary | null {
  if (entries.length === 0) return null;
  let startMs = Infinity;
  let endMs = -Infinity;
  let timed = false;
  let runningCount = 0;
  let failedCount = 0;
  let additions = 0;
  let deletions = 0;
  let hasDiff = false;
  const counts = new Map<string, { nouns: readonly [string, string]; count: number }>();
  for (const entry of entries) {
    const timing = workEntryTiming(entry);
    startMs = Math.min(startMs, Date.parse(timing.startedAt));
    endMs = Math.max(endMs, Date.parse(timing.completedAt ?? timing.startedAt));
    if (timing.completedAt) timed = true;
    if (isRunning(entry)) runningCount += 1;
    else if (workEntryDisplayIndicatesToolFailure(entry)) failedCount += 1;

    const item = entry.projectedItem?.item;
    if (item?.type === "file_change" && item.additions !== undefined) {
      hasDiff = true;
      additions += item.additions;
      deletions += item.deletions ?? 0;
    }

    const nouns: readonly [string, string] =
      entry.itemType === "reasoning"
        ? ["thought", "thoughts"]
        : ACTION_NOUNS[toolGroupAction(entry)];
    const existing = counts.get(nouns[0]);
    if (existing) existing.count += 1;
    else counts.set(nouns[0], { nouns, count: 1 });
  }
  const running = runningCount > 0;
  return {
    startedAt: new Date(startMs).toISOString(),
    completedAt: running ? null : new Date(endMs).toISOString(),
    elapsedMs: running || !timed ? null : endMs - startMs,
    counts: [...counts.values()].map(
      ({ nouns, count }) => `${count} ${count === 1 ? nouns[0] : nouns[1]}`,
    ),
    failedCount,
    runningCount,
    diff: hasDiff ? { additions, deletions } : null,
  };
}
