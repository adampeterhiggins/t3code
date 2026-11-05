import { ProviderDriverKind, type ServerProviderUsageWindow } from "@t3tools/contracts";
import { collectLimitPools, type LimitAccount } from "@t3tools/shared/usageLimits";
import { describe, expect, it } from "vite-plus/test";

import { busiestPoolWindow, formatSpend, nextResetLabel } from "./usageFooter.logic";

const NOW = Date.parse("2026-11-05T17:10:00Z");
const at = (mins: number) => new Date(NOW + mins * 60_000).toISOString();

function account(key: string, windows: ServerProviderUsageWindow[]): LimitAccount {
  return {
    key,
    driver: ProviderDriverKind.make("claudeAgent"),
    displayName: null,
    email: `${key}@example.com`,
    plan: undefined,
    accentColor: undefined,
    environments: [],
    sourceLabel: null,
    redeem: null,
    limits: { checkedAt: new Date(NOW).toISOString(), windows },
  };
}

describe("busiestPoolWindow", () => {
  it("picks the most-used resetting window and skips spend caps", () => {
    const [pool] = collectLimitPools(
      [
        account("a", [
          {
            id: "five_hour",
            kind: "session",
            label: "Session",
            usedPercent: 38,
            resetsAt: at(124),
          },
          { id: "seven_day", kind: "weekly", label: "Weekly", usedPercent: 95, resetsAt: at(5460) },
          {
            id: "monthly_spend",
            kind: "monthly",
            label: "Extra usage",
            usedPercent: 99,
            spend: { usedMinor: 149_000, limitMinor: 150_000, currency: "GBP", exponent: 2 },
          },
        ]),
      ],
      NOW,
    );
    const window = busiestPoolWindow(pool!);
    expect(window?.label).toBe("Weekly");
    expect(nextResetLabel(window!, NOW)).toBe("3d 19h");
  });

  it("reads the pooled average across accounts", () => {
    const [pool] = collectLimitPools(
      [
        account("a", [{ id: "seven_day", kind: "weekly", label: "Weekly", usedPercent: 100 }]),
        account("b", [{ id: "seven_day", kind: "weekly", label: "Weekly", usedPercent: 20 }]),
      ],
      NOW,
    );
    expect(busiestPoolWindow(pool!)?.usedPercent).toBe(60);
  });
});

describe("formatSpend", () => {
  it.each([
    [
      { usedMinor: 19_248, limitMinor: 150_000, currency: "GBP", exponent: 2 },
      "£192.48 of £1,500.00",
    ],
    [
      { usedMinor: 100, limitMinor: 2_000, currency: "NOTACODE", exponent: 2 },
      "1.00 NOTACODE of 20.00 NOTACODE",
    ],
  ])("formats %o in its currency", (spend, expected) => {
    expect(formatSpend(spend).replace(/ /g, " ")).toBe(expected);
  });
});
