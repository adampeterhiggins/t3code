import {
  DEFAULT_USAGE_FOOTER_DISPLAY,
  ProviderDriverKind,
  type ServerProviderUsageWindow,
} from "@t3tools/contracts";
import { collectLimitPools, type LimitAccount } from "@t3tools/shared/usageLimits";
import { describe, expect, it } from "vite-plus/test";

import {
  busiestPoolWindow,
  footerPercent,
  footerWindows,
  formatSpend,
  nextResetLabel,
  usageFooterItems,
} from "./usageFooter.logic";

const NOW = Date.parse("2026-11-05T17:10:00Z");
const at = (mins: number) => new Date(NOW + mins * 60_000).toISOString();

function account(
  key: string,
  windows: ServerProviderUsageWindow[],
  driver = "claudeAgent",
): LimitAccount {
  return {
    key,
    driver: ProviderDriverKind.make(driver),
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

describe("usageFooterItems", () => {
  const weekly = (usedPercent: number): ServerProviderUsageWindow[] => [
    { id: "seven_day", kind: "weekly", label: "Weekly", usedPercent },
  ];
  const pools = collectLimitPools(
    [
      account("claude", weekly(10)),
      account("work", weekly(80), "cursor"),
      account("home", weekly(20), "cursor"),
    ],
    NOW,
  );
  const shown = (display: Partial<typeof DEFAULT_USAGE_FOOTER_DISPLAY>) =>
    usageFooterItems(pools, { ...DEFAULT_USAGE_FOOTER_DISPLAY, ...display }, NOW).map((item) => [
      item.key,
      item.accountName,
      item.windows.map((window) => window.usedPercent),
    ]);

  it("shows one pooled entry per provider by default", () => {
    expect(shown({})).toEqual([
      ["claudeAgent", null, [10]],
      ["cursor", null, [50]],
    ]);
  });

  it("splits a provider's accounts and names them only when it has several", () => {
    expect(shown({ accounts: "separate" })).toEqual([
      ["claude", null, [10]],
      ["home", "home", [20]],
      ["work", "work", [80]],
    ]);
  });

  it("leaves out hidden providers and, when separate, hidden accounts", () => {
    expect(shown({ hiddenProviders: ["claudeAgent"] })).toEqual([["cursor", null, [50]]]);
    expect(shown({ accounts: "separate", hiddenAccounts: ["work"] })).toEqual([
      ["claude", null, [10]],
      ["home", "home", [20]],
    ]);
    expect(shown({ hiddenAccounts: ["work"] })).toEqual([
      ["claudeAgent", null, [10]],
      ["cursor", null, [50]],
    ]);
  });

  it("reads remaining as the unused share", () => {
    const [item] = usageFooterItems(pools, DEFAULT_USAGE_FOOTER_DISPLAY, NOW);
    expect(footerPercent(item!.windows[0]!, "remaining")).toBe(90);
  });
});

describe("footerWindows", () => {
  const [pool] = collectLimitPools(
    [
      account("a", [
        { id: "five_hour", kind: "session", label: "Session", usedPercent: 38, resetsAt: at(124) },
        { id: "seven_day", kind: "weekly", label: "Weekly", usedPercent: 95, resetsAt: at(5460) },
      ]),
    ],
    NOW,
  );
  const labels = (windows: Record<string, string[]>) =>
    footerWindows(pool!, { ...DEFAULT_USAGE_FOOTER_DISPLAY, windows }).map((w) => w.label);

  it("shows the chosen windows in display order", () => {
    expect(labels({ claudeAgent: ["seven_day", "five_hour"] })).toEqual(["Session", "Weekly"]);
    expect(labels({ claudeAgent: ["five_hour"] })).toEqual(["Session"]);
  });

  it("falls back to the busiest when nothing chosen is reported", () => {
    expect(labels({})).toEqual(["Weekly"]);
    expect(labels({ claudeAgent: ["gone"] })).toEqual(["Weekly"]);
  });
});
