import type * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";
import { normalizeGrokTurnTokenUsage } from "./GrokTurnTokenUsage.ts";
import { subagentUsageFromChildTurns } from "../../orchestration-v2/SubagentProjection.ts";

const response = (usage: Record<string, Schema.Json>) => ({
  stopReason: "end_turn" as const,
  _meta: { totalTokens: 24428, inputTokens: 24397, outputTokens: 23, usage },
});

describe("native Grok prompt usage", () => {
  it("uses all model calls, including cache and reasoning subsets, exactly once", () => {
    const turnTokenUsage = normalizeGrokTurnTokenUsage(
      response({
        inputTokens: 117264,
        outputTokens: 1322,
        totalTokens: 118586,
        cachedReadTokens: 72448,
        cacheCreationTokens: 0,
        reasoningTokens: 898,
        modelUsage: { "grok-4.7-build": { inputTokens: 117264, outputTokens: 1322 } },
      }),
      false,
      "completed",
    );
    expect(turnTokenUsage).toEqual({
      usageStatus: "complete",
      usageScope: "main_agent",
      hasSubagents: false,
      inputTokens: 117264,
      outputTokens: 1322,
      cachedInputTokens: 72448,
      cacheCreationTokens: 0,
      reasoningTokens: 898,
    });
    expect(subagentUsageFromChildTurns([{ turnTokenUsage }], 4)).toEqual({
      inputTokens: 117264,
      outputTokens: 1322,
      totalTokens: 118586,
      cachedInputTokens: 72448,
      reasoningOutputTokens: 898,
      toolUses: 4,
    });
  });

  it("adds separate prompts without differencing session totals or adding modelUsage again", () => {
    const turns = [
      response({
        inputTokens: 22168,
        outputTokens: 36,
        cachedReadTokens: 1664,
        reasoningTokens: 32,
      }),
      response({
        inputTokens: 22548,
        outputTokens: 19,
        cachedReadTokens: 1152,
        reasoningTokens: 15,
      }),
    ].map((value) => ({ turnTokenUsage: normalizeGrokTurnTokenUsage(value, false, "completed") }));
    expect(subagentUsageFromChildTurns(turns, 0)).toEqual({
      inputTokens: 44716,
      outputTokens: 55,
      totalTokens: 44771,
      cachedInputTokens: 2816,
      reasoningOutputTokens: 47,
      toolUses: 0,
    });
  });

  it.each(["failed", "interrupted", "cancelled"] as const)(
    "keeps measured %s counts partial",
    (status) => {
      expect(
        normalizeGrokTurnTokenUsage(response({ inputTokens: 30, outputTokens: 4 }), false, status),
      ).toMatchObject({ usageStatus: "partial", inputTokens: 30, outputTokens: 4 });
      expect(
        normalizeGrokTurnTokenUsage(response({ inputTokens: 0, outputTokens: 0 }), false, status),
      ).toMatchObject({ usageStatus: "unavailable" });
    },
  );

  it("marks incomplete provider reports and missing input/output partial", () => {
    expect(
      normalizeGrokTurnTokenUsage(
        response({ inputTokens: 30, outputTokens: 4, usageIsIncomplete: true }),
        true,
        "completed",
      ),
    ).toMatchObject({ usageStatus: "partial", hasSubagents: true });
    expect(normalizeGrokTurnTokenUsage(response({ outputTokens: 4 }), false, "completed")).toEqual({
      usageStatus: "partial",
      usageScope: "main_agent",
      hasSubagents: false,
      outputTokens: 4,
    });
  });

  it("does not invent usage from context occupancy, the last call, or malformed counts", () => {
    for (const value of [
      undefined,
      { stopReason: "cancelled" as const, _meta: { totalTokens: 2263 } },
      { stopReason: "end_turn" as const, _meta: { inputTokens: 100, outputTokens: 5 } },
      response({ inputTokens: -1, outputTokens: 4 }),
      response({ inputTokens: 1.5, outputTokens: 4 }),
      response({ totalTokens: 50 }),
    ]) {
      expect(normalizeGrokTurnTokenUsage(value, false, "completed")).toEqual({
        usageStatus: "unavailable",
        usageScope: "main_agent",
        hasSubagents: false,
      });
    }
  });
});
