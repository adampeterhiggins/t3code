import { parseThreadTabSummary } from "@t3tools/client-runtime/thread-tab-summary";
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

export interface ThreadSummaryPreviewContent {
  readonly latestTurnState: string | null;
  readonly files: ReadonlyArray<string>;
  readonly moreFiles: number;
  readonly opening: string | null;
  readonly latestUser: string | null;
  readonly latestAssistant: string | null;
  readonly earlierTurns: number;
}

/**
 * Reads the handoff text from `summarizeSiblingChat` into what a person scans for: how the chat
 * began, where it ended up, and what it touched. A chat with no messages yet has no dialogue.
 */
export function parseThreadSummaryPreview(summary: string): ThreadSummaryPreviewContent {
  const chat = parseThreadTabSummary(summary)?.[0];
  const turns: { role: string; text: string }[][] = [];
  let omittedTurns = 0;
  for (const block of chat?.blocks ?? []) {
    if (block.kind === "omitted") {
      omittedTurns = block.turns;
      continue;
    }
    if (block.role === "user" || turns.length === 0) turns.push([]);
    turns.at(-1)!.push(block);
  }
  const said = (turn: ReadonlyArray<{ role: string; text: string }> | undefined, role: string) =>
    turn?.findLast((entry) => entry.role === role)?.text ?? null;
  const lastTurn = turns.length > 1 ? turns.at(-1) : undefined;
  return {
    latestTurnState: chat?.latestTurn ?? null,
    files: chat?.files ?? [],
    moreFiles: chat?.moreFiles ?? 0,
    opening: said(turns[0], "user"),
    latestUser: said(lastTurn, "user"),
    latestAssistant: said(lastTurn ?? turns[0], "assistant"),
    earlierTurns: Math.max(0, turns.length - 2) + omittedTurns,
  };
}
