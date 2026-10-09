import type { OrchestrationV2ProviderTurn, TurnTokenUsage } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type * as EffectAcpSchema from "effect-acp/compat";

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const GrokPromptUsage = Schema.Struct({
  inputTokens: Schema.optional(Count),
  outputTokens: Schema.optional(Count),
  cachedReadTokens: Schema.optional(Count),
  cacheCreationTokens: Schema.optional(Count),
  reasoningTokens: Schema.optional(Count),
  usageIsIncomplete: Schema.optional(Schema.Boolean),
});
const decodeUsage = Schema.decodeUnknownOption(GrokPromptUsage);

/**
 * Grok's terminal `usage` sums model calls in this prompt, not the session.
 * Input already includes cache reads/writes; output includes reasoning. The
 * adjacent `_meta.inputTokens` is only the last call, and `totalTokens` on
 * streamed updates is context occupancy, so neither is a fallback here.
 */
export function normalizeGrokTurnTokenUsage(
  response: EffectAcpSchema.PromptResponse | undefined,
  hasSubagents: boolean,
  status: OrchestrationV2ProviderTurn["status"],
): TurnTokenUsage {
  const decoded = decodeUsage(response?._meta?.usage);
  const base = { usageScope: "main_agent", hasSubagents } as const;
  if (Option.isNone(decoded)) return { ...base, usageStatus: "unavailable" };
  const usage = decoded.value;
  if (usage.inputTokens === undefined && usage.outputTokens === undefined) {
    return { ...base, usageStatus: "unavailable" };
  }
  if (status !== "completed" && usage.inputTokens === 0 && usage.outputTokens === 0) {
    return { ...base, usageStatus: "unavailable" };
  }
  const counts = {
    ...(usage.inputTokens === undefined ? {} : { inputTokens: usage.inputTokens }),
    ...(usage.outputTokens === undefined ? {} : { outputTokens: usage.outputTokens }),
    ...(usage.cachedReadTokens === undefined ? {} : { cachedInputTokens: usage.cachedReadTokens }),
    ...(usage.cacheCreationTokens === undefined
      ? {}
      : { cacheCreationTokens: usage.cacheCreationTokens }),
    ...(usage.reasoningTokens === undefined ? {} : { reasoningTokens: usage.reasoningTokens }),
  };
  return usage.inputTokens !== undefined &&
    usage.outputTokens !== undefined &&
    status === "completed" &&
    usage.usageIsIncomplete !== true
    ? {
        ...base,
        ...counts,
        usageStatus: "complete",
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      }
    : { ...base, ...counts, usageStatus: "partial" };
}
