import type { TokenUsage } from "@cursor/sdk";
import type { ProviderRuntimeTurnStatus, TurnTokenUsage } from "@t3tools/contracts";

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : undefined;
}

/**
 * Normalizes a finished Cursor run's `result.usage`. One Cursor run is one
 * provider turn, and the SDK sums usage across the run's model calls. Cursor's
 * `inputTokens` excludes cache reads and writes (`totalTokens` is input +
 * cacheRead + cacheWrite + output), so they are added back to match T3's
 * input-includes-cache convention.
 */
export function normalizeCursorTurnTokenUsage(
  usage: Partial<TokenUsage> | undefined,
  hasSubagents: boolean,
  terminalStatus: ProviderRuntimeTurnStatus,
): TurnTokenUsage {
  const uncachedInputTokens = count(usage?.inputTokens);
  const cachedInputTokens = count(usage?.cacheReadTokens) ?? 0;
  const cacheCreationTokens = count(usage?.cacheWriteTokens) ?? 0;
  const outputTokens = count(usage?.outputTokens);
  const reasoningTokens = count(usage?.reasoningTokens);
  if (uncachedInputTokens === undefined || outputTokens === undefined) {
    return { usageStatus: "unavailable", usageScope: "main_agent", hasSubagents };
  }
  const inputTokens = uncachedInputTokens + cachedInputTokens + cacheCreationTokens;
  // A run that died before any model call reports zeros; that is not a measured free turn.
  if (terminalStatus !== "completed" && inputTokens + outputTokens === 0) {
    return { usageStatus: "unavailable", usageScope: "main_agent", hasSubagents };
  }
  return {
    usageStatus: terminalStatus === "completed" ? "complete" : "partial",
    usageScope: "main_agent",
    inputTokens,
    cachedInputTokens,
    cacheCreationTokens,
    outputTokens,
    ...(reasoningTokens === undefined
      ? {}
      : { reasoningTokens: Math.min(outputTokens, reasoningTokens) }),
    hasSubagents,
  };
}
