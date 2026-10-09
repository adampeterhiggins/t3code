import type {
  OrchestrationV2ProviderThread,
  OrchestrationV2ProviderTurn,
  OrchestrationV2Subagent,
} from "@t3tools/contracts";

type ContextWindowReading = {
  readonly maxTokens?: number | null;
  readonly usedPercentage: number | null;
  readonly usedTokens: number;
};

/** Context-window share at which the composer suggests compacting or starting a new tab. */
export const CONTEXT_WINDOW_NUDGE_PERCENT = 80;

export interface ThreadUsageCost {
  readonly amount: number;
  readonly currency: string;
}

/**
 * What a thread has spent, as its providers report it. Token totals follow the
 * subagent convention: input (cache reads and writes included) plus output.
 * Each total is null when nothing reported it; a reported zero stays zero.
 */
export interface ThreadUsageSummary {
  readonly mainTokens: number | null;
  readonly mainInputTokens: number | null;
  readonly mainOutputTokens: number | null;
  /** Some counted turn reported only part of its usage, so the total is a floor. */
  readonly mainPartial: boolean;
  readonly subagentTokens: number | null;
  readonly subagentsWithUsage: number;
  /**
   * Provider-reported cumulative session cost (ACP `usage_update`), summed per
   * currency over the thread's provider threads. Never estimated from prices.
   */
  readonly costs: ReadonlyArray<ThreadUsageCost>;
}

/**
 * Sums a thread's usage from its projection. Main-agent tokens come from each
 * provider turn's `turnTokenUsage`; turns on a subagent's own provider thread
 * are left out there and counted through the subagent's `usage` instead, so
 * nothing is counted twice.
 */
export function deriveThreadUsageSummary(input: {
  readonly providerThreads: ReadonlyArray<
    Pick<OrchestrationV2ProviderThread, "id" | "ownerNodeId" | "contextUsage">
  >;
  readonly providerTurns: ReadonlyArray<
    Pick<OrchestrationV2ProviderTurn, "providerThreadId" | "turnTokenUsage">
  >;
  readonly subagents: ReadonlyArray<
    Pick<OrchestrationV2Subagent, "id" | "providerThreadId" | "usage">
  >;
}): ThreadUsageSummary {
  const subagentNodeIds = new Set<string>(input.subagents.map((subagent) => subagent.id));
  const subagentProviderThreadIds = new Set<string>();
  for (const subagent of input.subagents) {
    if (subagent.providerThreadId !== null)
      subagentProviderThreadIds.add(subagent.providerThreadId);
  }
  for (const thread of input.providerThreads) {
    if (thread.ownerNodeId !== null && subagentNodeIds.has(thread.ownerNodeId)) {
      subagentProviderThreadIds.add(thread.id);
    }
  }

  let mainReported = false;
  let mainInputTokens = 0;
  let mainOutputTokens = 0;
  let mainPartial = false;
  for (const turn of input.providerTurns) {
    const usage = turn.turnTokenUsage;
    if (subagentProviderThreadIds.has(turn.providerThreadId)) continue;
    if (usage === undefined) {
      mainPartial = true;
      continue;
    }
    if (usage.inputTokens === undefined && usage.outputTokens === undefined) {
      mainPartial = true;
      continue;
    }
    mainReported = true;
    mainInputTokens += usage.inputTokens ?? 0;
    mainOutputTokens += usage.outputTokens ?? 0;
    if (usage.usageStatus !== "complete") mainPartial = true;
  }

  let subagentTokens = 0;
  let subagentsWithUsage = 0;
  for (const subagent of input.subagents) {
    if (subagent.usage === undefined) continue;
    subagentsWithUsage += 1;
    subagentTokens += subagent.usage.totalTokens;
  }

  const costByCurrency = new Map<string, number>();
  for (const thread of input.providerThreads) {
    const cost = thread.contextUsage?.cost;
    if (cost === undefined || !Number.isFinite(cost.amount) || cost.amount < 0) continue;
    costByCurrency.set(cost.currency, (costByCurrency.get(cost.currency) ?? 0) + cost.amount);
  }

  return {
    mainTokens: mainReported ? mainInputTokens + mainOutputTokens : null,
    mainInputTokens: mainReported ? mainInputTokens : null,
    mainOutputTokens: mainReported ? mainOutputTokens : null,
    mainPartial,
    subagentTokens: subagentsWithUsage > 0 ? subagentTokens : null,
    subagentsWithUsage,
    costs: [...costByCurrency].map(([currency, amount]) => ({ amount, currency })),
  };
}

/**
 * Whether the composer should suggest compacting or a new tab. Only a provider
 * that reports its window size can be measured against the threshold.
 */
export function isContextWindowNearlyFull(
  snapshot: Pick<ContextWindowReading, "maxTokens" | "usedPercentage"> | null,
): boolean {
  return (
    snapshot !== null &&
    (snapshot.maxTokens ?? 0) > 0 &&
    snapshot.usedPercentage !== null &&
    snapshot.usedPercentage >= CONTEXT_WINDOW_NUDGE_PERCENT
  );
}

/**
 * Whether a dismissed nudge should come back next time the window fills: the
 * provider reported a real reading below the threshold, as after a compaction.
 * A zero reading is the catalog placeholder shown before usage arrives, so it
 * never re-arms.
 */
export function shouldRearmContextWindowNudge(
  snapshot: Pick<ContextWindowReading, "maxTokens" | "usedPercentage" | "usedTokens"> | null,
): boolean {
  return (
    snapshot !== null &&
    (snapshot.maxTokens ?? 0) > 0 &&
    snapshot.usedPercentage !== null &&
    snapshot.usedTokens > 0 &&
    snapshot.usedPercentage < CONTEXT_WINDOW_NUDGE_PERCENT
  );
}

/** A reported cost is an incomplete subtotal when some provider sessions omit it. */
export function formatReportedThreadCost(costs: ReadonlyArray<ThreadUsageCost>): string {
  return costs
    .map((cost) => {
      const digits = cost.amount > 0 && cost.amount < 0.01 ? 4 : 2;
      return `${cost.currency} ${cost.amount.toFixed(digits)}`;
    })
    .join(" · ");
}

/** Keep context occupancy on the active provider session, including between turns. */
export function latestProviderContextUsage(
  turns: ReadonlyArray<
    Pick<OrchestrationV2ProviderTurn, "providerThreadId" | "ordinal" | "tokenUsage">
  >,
  activeProviderThreadId: OrchestrationV2ProviderTurn["providerThreadId"] | null | undefined,
) {
  let latest: (typeof turns)[number] | undefined;
  for (const turn of turns) {
    if (turn.providerThreadId !== activeProviderThreadId || turn.tokenUsage === undefined) continue;
    if (latest === undefined || turn.ordinal > latest.ordinal) latest = turn;
  }
  return latest?.tokenUsage ?? null;
}
