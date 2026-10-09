import { describe, expect, it } from "vite-plus/test";

import {
  deriveThreadUsageSummary,
  latestProviderContextUsage,
  formatReportedThreadCost,
  isContextWindowNearlyFull,
  shouldRearmContextWindowNudge,
} from "./threadUsage.js";

type Input = Parameters<typeof deriveThreadUsageSummary>[0];

function providerThread(
  id: string,
  options: { ownerNodeId?: string; cost?: { amount: number; currency: string } } = {},
): Input["providerThreads"][number] {
  return {
    id: id as never,
    ownerNodeId: (options.ownerNodeId ?? null) as never,
    contextUsage: options.cost ? { usedTokens: 1, cost: options.cost } : null,
  };
}

function turn(
  providerThreadId: string,
  usage: { input?: number; output?: number; status?: "complete" | "partial" | "unavailable" },
): Input["providerTurns"][number] {
  const status = usage.status ?? "complete";
  return {
    providerThreadId: providerThreadId as never,
    turnTokenUsage:
      status === "complete"
        ? {
            usageScope: "main_agent",
            usageStatus: "complete",
            hasSubagents: false,
            inputTokens: usage.input ?? 0,
            outputTokens: usage.output ?? 0,
          }
        : {
            usageScope: "main_agent",
            usageStatus: status,
            hasSubagents: false,
            ...(usage.input === undefined ? {} : { inputTokens: usage.input }),
            ...(usage.output === undefined ? {} : { outputTokens: usage.output }),
          },
  };
}

describe("deriveThreadUsageSummary", () => {
  it("sums main-agent turns and keeps subagent threads out of them", () => {
    const summary = deriveThreadUsageSummary({
      providerThreads: [providerThread("main"), providerThread("child", { ownerNodeId: "node-a" })],
      providerTurns: [
        turn("main", { input: 1_000, output: 200 }),
        turn("main", { input: 3_000, output: 400 }),
        // A provider-native subagent's own turns count through its usage instead.
        turn("child", { input: 50_000, output: 5_000 }),
      ],
      subagents: [
        { id: "node-a" as never, providerThreadId: null, usage: { totalTokens: 55_000 } },
        { id: "node-b" as never, providerThreadId: null },
      ],
    });

    expect(summary).toMatchObject({
      mainTokens: 4_600,
      mainInputTokens: 4_000,
      mainOutputTokens: 600,
      mainPartial: false,
      subagentTokens: 55_000,
      subagentsWithUsage: 1,
      costs: [],
    });
  });

  it("excludes turns on a subagent's linked provider thread", () => {
    const summary = deriveThreadUsageSummary({
      providerThreads: [providerThread("main"), providerThread("codex-child")],
      providerTurns: [turn("main", { input: 10 }), turn("codex-child", { input: 900 })],
      subagents: [
        {
          id: "node-a" as never,
          providerThreadId: "codex-child" as never,
          usage: { totalTokens: 900 },
        },
      ],
    });
    expect(summary.mainTokens).toBe(10);
    expect(summary.subagentTokens).toBe(900);
  });

  it("reports null rather than zero when nothing reported usage", () => {
    const summary = deriveThreadUsageSummary({
      providerThreads: [providerThread("main")],
      providerTurns: [
        { providerThreadId: "main" as never },
        turn("main", { status: "unavailable" }),
      ],
      subagents: [],
    });
    expect(summary.mainTokens).toBeNull();
    expect(summary.subagentTokens).toBeNull();
  });

  it("flags partial turns so the total reads as a floor", () => {
    const summary = deriveThreadUsageSummary({
      providerThreads: [providerThread("main")],
      providerTurns: [
        turn("main", { input: 100, output: 10 }),
        turn("main", { output: 5, status: "partial" }),
      ],
      subagents: [],
    });
    expect(summary.mainTokens).toBe(115);
    expect(summary.mainPartial).toBe(true);
  });

  it("marks a total as incomplete when other main turns have no usage", () => {
    const summary = deriveThreadUsageSummary({
      providerThreads: [providerThread("main")],
      providerTurns: [
        turn("main", { input: 100, output: 10 }),
        { providerThreadId: "main" as never },
      ],
      subagents: [],
    });
    expect(summary.mainTokens).toBe(110);
    expect(summary.mainPartial).toBe(true);
  });

  it("keeps a reported zero cost and rejects invalid amounts", () => {
    const summary = deriveThreadUsageSummary({
      providerThreads: [
        providerThread("free", { cost: { amount: 0, currency: "USD" } }),
        providerThread("invalid", { cost: { amount: NaN, currency: "USD" } }),
      ],
      providerTurns: [],
      subagents: [],
    });
    expect(summary.costs).toEqual([{ amount: 0, currency: "USD" }]);
    expect(
      formatReportedThreadCost([
        { amount: 0.0012, currency: "USD" },
        { amount: 2, currency: "EUR" },
      ]),
    ).toBe("USD 0.0012 · EUR 2.00");
  });

  it("sums provider-reported cost per currency and never invents one", () => {
    const summary = deriveThreadUsageSummary({
      providerThreads: [
        providerThread("a", { cost: { amount: 0.25, currency: "USD" } }),
        providerThread("b", { cost: { amount: 0.5, currency: "USD" } }),
        providerThread("c", { cost: { amount: 1, currency: "EUR" } }),
        providerThread("d"),
      ],
      providerTurns: [],
      subagents: [],
    });
    expect(summary.costs).toEqual([
      { amount: 0.75, currency: "USD" },
      { amount: 1, currency: "EUR" },
    ]);
  });
});

describe("context window nudge", () => {
  it("fires at the threshold only when the window size is known", () => {
    expect(isContextWindowNearlyFull({ maxTokens: 200_000, usedPercentage: 79.9 })).toBe(false);
    expect(isContextWindowNearlyFull({ maxTokens: 200_000, usedPercentage: 80 })).toBe(true);
    expect(isContextWindowNearlyFull({ maxTokens: null, usedPercentage: null })).toBe(false);
    expect(isContextWindowNearlyFull(null)).toBe(false);
    expect(isContextWindowNearlyFull({ usedPercentage: 90 })).toBe(false);
    expect(isContextWindowNearlyFull({ maxTokens: 0, usedPercentage: 90 })).toBe(false);
  });

  it("re-arms after a real reading below the threshold, not the zero placeholder", () => {
    expect(
      shouldRearmContextWindowNudge({ maxTokens: 200_000, usedPercentage: 30, usedTokens: 60_000 }),
    ).toBe(true);
    expect(
      shouldRearmContextWindowNudge({ maxTokens: 200_000, usedPercentage: 0, usedTokens: 0 }),
    ).toBe(false);
    expect(
      shouldRearmContextWindowNudge({
        maxTokens: 200_000,
        usedPercentage: 85,
        usedTokens: 170_000,
      }),
    ).toBe(false);
    expect(
      shouldRearmContextWindowNudge({ maxTokens: null, usedPercentage: null, usedTokens: 5 }),
    ).toBe(false);
  });
});

describe("active provider context", () => {
  it("ignores child and previous session readings, retaining the latest reported active reading between turns", () => {
    const activeId = "active" as never;
    const reading = { usedTokens: 100, maxTokens: 200, updatedAt: "2026-10-09T10:00:00Z" };
    const turns = [
      { providerThreadId: activeId, ordinal: 1, tokenUsage: reading },
      {
        providerThreadId: "child" as never,
        ordinal: 9,
        tokenUsage: { ...reading, usedTokens: 199 },
      },
      { providerThreadId: activeId, ordinal: 2 },
    ];
    expect(latestProviderContextUsage(turns, activeId)).toBe(reading);
    expect(latestProviderContextUsage(turns, "other" as never)).toBeNull();
  });
});
