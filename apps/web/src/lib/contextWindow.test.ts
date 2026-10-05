import { describe, expect, it } from "vite-plus/test";
import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import {
  deriveKnownContextWindowSnapshot,
  deriveLatestContextWindowSnapshot,
  formatContextWindowTokens,
} from "./contextWindow";

describe("V2 context window presentation", () => {
  it("uses retained compaction token data when available", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      {
        item: {
          id: "compaction-1" as never,
          threadId: "thread-1" as never,
          runId: null,
          nodeId: null,
          providerThreadId: null,
          providerTurnId: null,
          nativeItemRef: null,
          parentItemId: null,
          ordinal: 1,
          status: "completed",
          title: null,
          startedAt: null,
          completedAt: null,
          updatedAt: DateTime.makeUnsafe("2026-06-20T00:00:00.000Z"),
          type: "compaction",
          driver: null,
          beforeTokenCount: 10_000,
          afterTokenCount: 2_000,
        },
      },
    ]);
    expect(snapshot?.usedTokens).toBe(2_000);
    expect(snapshot?.totalProcessedTokens).toBe(10_000);
  });

  it("prefers current provider usage and preserves ACP cost", () => {
    const snapshot = deriveLatestContextWindowSnapshot([], undefined, {
      contextUsage: {
        usedTokens: 2_500,
        maxTokens: 10_000,
        cost: { amount: 0.42, currency: "USD" },
      },
      updatedAt: DateTime.makeUnsafe("2026-08-23T00:00:00.000Z"),
    });

    expect(snapshot).toMatchObject({
      usedTokens: 2_500,
      maxTokens: 10_000,
      remainingTokens: 7_500,
      usedPercentage: 25,
      cost: { amount: 0.42, currency: "USD" },
    });
  });

  it("formats compact token values", () => {
    expect(formatContextWindowTokens(1_500)).toBe("1.5k");
  });
});

describe("live provider-turn usage (#8144)", () => {
  it("prefers the provider's live report over compaction items", () => {
    const snapshot = deriveLatestContextWindowSnapshot([], {
      usedTokens: 42_000,
      maxTokens: 200_000,
      inputTokens: 40_000,
      outputTokens: 2_000,
      updatedAt: "2026-08-27T00:00:00.000Z",
    });
    expect(snapshot).not.toBeNull();
    expect(snapshot?.usedTokens).toBe(42_000);
    expect(snapshot?.maxTokens).toBe(200_000);
    expect(snapshot?.remainingTokens).toBe(158_000);
    expect(snapshot?.usedPercentage).toBe(21);
  });

  it("handles a report without a known context window", () => {
    const snapshot = deriveLatestContextWindowSnapshot([], {
      usedTokens: 42_000,
      updatedAt: "2026-08-27T00:00:00.000Z",
    });
    expect(snapshot?.maxTokens).toBeNull();
    expect(snapshot?.usedPercentage).toBeNull();
  });
});

describe("known context window from the provider catalog", () => {
  it("uses the selected Devin model catalog limit before ACP usage arrives", () => {
    const instanceId = ProviderInstanceId.make("devin");
    const snapshot = deriveKnownContextWindowSnapshot({
      selection: { instanceId, model: "glm-5-2" },
      providers: [
        {
          instanceId,
          driver: ProviderDriverKind.make("devin"),
          enabled: true,
          installed: true,
          version: null,
          status: "ready",
          auth: { status: "authenticated" },
          checkedAt: "2026-03-23T00:00:00.000Z",
          models: [
            {
              slug: "glm-5-2",
              name: "GLM-5.2",
              isCustom: false,
              capabilities: { optionDescriptors: [] },
              contextWindowTokens: 200_000,
            },
          ],
          slashCommands: [],
          skills: [],
        },
      ],
      updatedAt: "2026-03-23T00:00:00.000Z",
    });

    expect(snapshot).toMatchObject({
      usedTokens: 0,
      maxTokens: 200_000,
      remainingTokens: 200_000,
      usedPercentage: 0,
      model: "glm-5-2",
    });
  });

  it("uses the selected context-window option instead of the catalog maximum", () => {
    const instanceId = ProviderInstanceId.make("devin");
    const snapshot = deriveKnownContextWindowSnapshot({
      selection: {
        instanceId,
        model: "glm-5-2",
        options: [{ id: "contextWindow", value: "200k" }],
      },
      providers: [
        {
          instanceId,
          driver: ProviderDriverKind.make("devin"),
          enabled: true,
          installed: true,
          version: null,
          status: "ready",
          auth: { status: "authenticated" },
          checkedAt: "2026-03-23T00:00:00.000Z",
          models: [
            {
              slug: "glm-5-2",
              name: "GLM-5.2",
              isCustom: false,
              capabilities: {
                optionDescriptors: [
                  {
                    id: "contextWindow",
                    label: "Context window",
                    type: "select",
                    options: [
                      { id: "200k", label: "200K" },
                      { id: "1m", label: "1M" },
                    ],
                  },
                ],
              },
              contextWindowTokens: 1_000_000,
            },
          ],
          slashCommands: [],
          skills: [],
        },
      ],
      updatedAt: "2026-03-23T00:00:00.000Z",
    });

    expect(snapshot?.maxTokens).toBe(200_000);
    expect(snapshot?.remainingTokens).toBe(200_000);
  });

  it("does not invent a context meter when the catalog has no limit", () => {
    const instanceId = ProviderInstanceId.make("devin");
    expect(
      deriveKnownContextWindowSnapshot({
        selection: { instanceId, model: "custom" },
        providers: [],
        updatedAt: "2026-03-23T00:00:00.000Z",
      }),
    ).toBeNull();
  });
});
