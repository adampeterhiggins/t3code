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

const SUMMARY_LINE = /^(User|Assistant|Reasoning \(excerpt\)|Tools|Error): /;

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
  let latestTurnState: string | null = null;
  const files: string[] = [];
  let moreFiles = 0;
  const turns: { role: string; text: string }[][] = [];
  let omittedTurns = 0;
  let inFiles = false;
  for (const line of summary.split("\n")) {
    const entry = SUMMARY_LINE.exec(line);
    if (entry) {
      inFiles = false;
      const role = entry[1]!;
      if (role === "User" || turns.length === 0) turns.push([]);
      turns.at(-1)!.push({ role, text: line.slice(entry[0].length) });
      continue;
    }
    if (turns.length === 0) {
      if (line.startsWith("Latest turn: ")) latestTurnState = line.slice("Latest turn: ".length);
      else if (line === "Files changed:") inFiles = true;
      else if (inFiles && line.startsWith("- …and ")) moreFiles = Number.parseInt(line.slice(7));
      else if (inFiles && line.startsWith("- ")) files.push(line.slice(2));
      else if (line === "") inFiles = false;
      continue;
    }
    const omitted = /^\[(\d+) turns? omitted\]$/.exec(line);
    if (omitted) {
      omittedTurns = Number(omitted[1]);
      continue;
    }
    const last = turns.at(-1)!.at(-1)!;
    last.text += `\n${line}`;
  }
  const said = (turn: ReadonlyArray<{ role: string; text: string }> | undefined, role: string) =>
    turn?.findLast((entry) => entry.role === role && entry.text.trim().length > 0)?.text.trim() ??
    null;
  const opening = said(turns[0], "User");
  const lastTurn = turns.length > 1 ? turns.at(-1) : undefined;
  const latestUser = said(lastTurn, "User");
  const latestAssistant = said(lastTurn ?? turns[0], "Assistant");
  return {
    latestTurnState,
    files,
    moreFiles: Number.isNaN(moreFiles) ? 0 : moreFiles,
    opening,
    latestUser,
    latestAssistant,
    earlierTurns: Math.max(0, turns.length - 2) + omittedTurns,
  };
}
