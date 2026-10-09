import { describe, expect, it } from "vite-plus/test";
import { normalizeCursorTurnTokenUsage } from "./turnTokenUsage.ts";

describe("normalizeCursorTurnTokenUsage", () => {
  it("adds Cursor cache reads and writes back into input and bounds reasoning output", () => {
    // A recorded Grok run: totalTokens 263734 = input + cacheRead + cacheWrite + output.
    expect(
      normalizeCursorTurnTokenUsage(
        {
          inputTokens: 155414,
          outputTokens: 416,
          cacheReadTokens: 107904,
          cacheWriteTokens: 0,
          totalTokens: 263734,
          reasoningTokens: 89,
        },
        false,
        "completed",
      ),
    ).toEqual({
      usageStatus: "complete",
      usageScope: "main_agent",
      hasSubagents: false,
      inputTokens: 263318,
      cachedInputTokens: 107904,
      cacheCreationTokens: 0,
      outputTokens: 416,
      reasoningTokens: 89,
    });
    expect(
      normalizeCursorTurnTokenUsage(
        { inputTokens: 10, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 5 },
        true,
        "cancelled",
      ),
    ).toMatchObject({
      usageStatus: "partial",
      inputTokens: 15,
      cacheCreationTokens: 5,
      outputTokens: 2,
      hasSubagents: true,
    });
  });

  it("reports Cursor usage as unavailable when the run gave none or died before a model call", () => {
    expect(normalizeCursorTurnTokenUsage(undefined, false, "completed").usageStatus).toBe(
      "unavailable",
    );
    expect(
      normalizeCursorTurnTokenUsage(
        { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        false,
        "failed",
      ).usageStatus,
    ).toBe("unavailable");
  });
});
