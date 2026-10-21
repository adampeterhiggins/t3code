import { assert, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  UsageDay,
  type ServerProvider,
  type UsageBucket,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { compactNumber, formatLimitsReport, limitsReport, sinceDay, usageRows } from "./usage.ts";

const now = Date.parse("2026-09-03T12:00:00.000Z");

const provider = (overrides: Partial<ServerProvider>): ServerProvider => ({
  instanceId: ProviderInstanceId.make("claude"),
  driver: ProviderDriverKind.make("claudeAgent"),
  displayName: "Claude",
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: { status: "authenticated", email: "adam@example.com", label: "Max" },
  checkedAt: "2026-09-03T11:00:00.000Z",
  models: [],
  slashCommands: [],
  skills: [],
  ...overrides,
});

const environment = { environmentId: EnvironmentId.make("env-1"), label: "This Mac" };

it("prints each account's windows with % used and reset time, after any degraded service", () => {
  const report = limitsReport({
    config: {
      environment,
      providers: [
        provider({
          serviceStatus: {
            indicator: "minor",
            description: "Partially Degraded Service",
            pageUrl: "https://status.claude.com",
            checkedAt: "2026-09-03T11:00:00.000Z",
          },
          usageLimits: {
            checkedAt: "2026-09-03T11:00:00.000Z",
            windows: [
              {
                id: "five_hour",
                kind: "session",
                label: "Session",
                usedPercent: 42.4,
                resetsAt: "2026-09-03T14:10:00.000Z",
              },
              { id: "seven_day", kind: "weekly", label: "Weekly", usedPercent: 7 },
            ],
          },
        }),
      ],
    },
    sources: [],
  });

  assert.deepStrictEqual(formatLimitsReport(report, now), [
    "claudeAgent status: Partially Degraded Service (https://status.claude.com)",
    "",
    "Claude (adam@example.com, Max)",
    "  Session   42% used  resets in 2h 10m",
    "  Weekly     7% used",
  ]);
});

it("lists an account that cannot report limits as a notice", () => {
  const report = limitsReport({
    config: {
      environment,
      providers: [
        provider({
          usageLimits: {
            checkedAt: "2026-09-03T11:00:00.000Z",
            windows: [],
            unavailable: { reason: "probeFailed", message: "Rate limited." },
          },
        }),
      ],
    },
    sources: [],
  });
  assert.deepStrictEqual(formatLimitsReport(report, now), ["Claude: Rate limited."]);
});

it.effect("--since counts days back from today inclusive, or takes a start day", () =>
  Effect.gen(function* () {
    assert.strictEqual(yield* sinceDay("7d", "2026-03-02"), "2026-02-24");
    assert.strictEqual(yield* sinceDay("1d", "2026-03-02"), "2026-03-02");
    assert.strictEqual(yield* sinceDay("today", "2026-03-02"), "2026-03-02");
    assert.strictEqual(yield* sinceDay("2026-01-15", "2026-03-02"), "2026-01-15");
    yield* Effect.flip(sinceDay("2026-04-01", "2026-03-02"));
    yield* Effect.flip(sinceDay("last week", "2026-03-02"));
  }),
);

const bucket = (overrides: Partial<UsageBucket>): UsageBucket => ({
  day: UsageDay.make("2026-03-01"),
  provider: "claude",
  model: "opus",
  totals: {
    uncachedInputTokens: 100,
    cachedInputTokens: 1_000,
    cacheCreationTokens: 10,
    outputTokens: 50,
    reasoningTokens: 5,
  },
  costUsd: 1,
  cacheSavingsUsd: 0,
  costSource: "modelPriced",
  records: 1,
  unpricedRecords: 0,
  sessions: 1,
  ...overrides,
});

it("totals buckets per provider and model, most expensive first", () => {
  const rows = usageRows([
    bucket({}),
    bucket({ day: UsageDay.make("2026-03-02"), costUsd: 2.5 }),
    bucket({ provider: "codex", model: "gpt-5", costUsd: 4, unpricedRecords: 2 }),
  ]);
  assert.deepStrictEqual(
    rows.map((row) => [row.provider, row.model, row.costUsd, row.inputTokens, row.unpricedRecords]),
    [
      ["codex", "gpt-5", 4, 100, 2],
      ["claude", "opus", 3.5, 200, 0],
    ],
  );
  assert.strictEqual(rows[1]?.cachedInputTokens, 2_000);
});

it("abbreviates token counts", () => {
  assert.strictEqual(compactNumber(999), "999");
  assert.strictEqual(compactNumber(12_345), "12.3k");
  assert.strictEqual(compactNumber(250_000_000), "250M");
});
