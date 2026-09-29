import type { SubagentTranscriptEntry } from "@t3tools/contracts";

/** Newest entries kept per transcript read. */
export const SUBAGENT_TRANSCRIPT_ENTRY_LIMIT = 400;
/** Per-field character bound, so one huge tool output cannot dominate a read. */
export const SUBAGENT_TRANSCRIPT_TEXT_LIMIT = 4000;

export interface SubagentTranscriptRead {
  readonly entries: ReadonlyArray<SubagentTranscriptEntry>;
  readonly truncated: boolean;
}

function boundText(value: string): string {
  return value.length <= SUBAGENT_TRANSCRIPT_TEXT_LIMIT
    ? value
    : `${value.slice(0, SUBAGENT_TRANSCRIPT_TEXT_LIMIT - 1)}…`;
}

/**
 * Adapters hand their normalized entries here: drops empty entries, keeps the
 * newest SUBAGENT_TRANSCRIPT_ENTRY_LIMIT, and bounds every text field.
 */
export function boundSubagentTranscript(
  entries: ReadonlyArray<SubagentTranscriptEntry>,
): SubagentTranscriptRead {
  const meaningful = entries.filter(
    (entry) =>
      entry.text.trim().length > 0 ||
      entry.toolName !== undefined ||
      entry.input !== undefined ||
      entry.output !== undefined,
  );
  const kept = meaningful.slice(-SUBAGENT_TRANSCRIPT_ENTRY_LIMIT);
  return {
    truncated: kept.length < meaningful.length,
    entries: kept.map((entry) => ({
      ...entry,
      text: boundText(entry.text),
      ...(entry.input !== undefined ? { input: boundText(entry.input) } : {}),
      ...(entry.output !== undefined ? { output: boundText(entry.output) } : {}),
    })),
  };
}

/** Bounds a launch prompt for TaskStartedPayload.prompt. */
export function boundSubagentPrompt(value: unknown, limit: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.length <= limit ? trimmed : `${trimmed.slice(0, limit - 1)}…`;
}
