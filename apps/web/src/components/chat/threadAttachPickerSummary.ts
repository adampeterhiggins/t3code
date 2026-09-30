import type { ThreadId } from "@t3tools/contracts";

/** One snapshot per thread while the picker is open, shared by hover previews and attachment. */
export function createThreadAttachSummaryLoader(
  fetchSummary: (threadId: ThreadId) => Promise<string>,
) {
  const summaries = new Map<ThreadId, Promise<string>>();
  return (threadId: ThreadId): Promise<string> => {
    const cached = summaries.get(threadId);
    if (cached) return cached;
    const summary = fetchSummary(threadId).catch((cause: unknown) => {
      summaries.delete(threadId);
      throw cause;
    });
    summaries.set(threadId, summary);
    return summary;
  };
}
