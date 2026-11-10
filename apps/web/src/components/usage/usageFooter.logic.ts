import type { UsageFooterDisplay } from "@t3tools/contracts";
import {
  collectLimitPools,
  displayLimitWindows,
  formatDuration,
  type LimitAccount,
  type LimitPool,
  type LimitPoolWindow,
} from "@t3tools/shared/usageLimits";

export type UsageSeverity = "ok" | "warn" | "high" | "critical";

export function usageSeverity(usedPercent: number): UsageSeverity {
  if (usedPercent >= 90) return "critical";
  if (usedPercent >= 70) return "high";
  if (usedPercent >= 40) return "warn";
  return "ok";
}

export function formatUsedPercent(usedPercent: number): string {
  const rounded = Math.round(usedPercent * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`;
}

/** The pooled window that is closest to running out. Spend caps never reset, so they are skipped. */
export function busiestPoolWindow(pool: LimitPool): LimitPoolWindow | null {
  let busiest: LimitPoolWindow | null = null;
  for (const window of displayLimitWindows(pool)) {
    if (window.members.some((member) => member.window.spend !== undefined)) continue;
    if (busiest === null || window.usedPercent > busiest.usedPercent) busiest = window;
  }
  return busiest;
}

/** Time until the next account in the pool gets quota back, e.g. "1d 22h". */
export function nextResetLabel(window: LimitPoolWindow, now: number): string | null {
  const next = window.resets.find((reset) => reset.at > now);
  return next ? formatDuration(next.at - now) : null;
}

export function formatSpend(spend: {
  readonly usedMinor: number;
  readonly limitMinor: number;
  readonly currency: string;
  readonly exponent: number;
}): string {
  const scale = 10 ** spend.exponent;
  const format = (minor: number) => {
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: spend.currency,
        minimumFractionDigits: spend.exponent,
        maximumFractionDigits: spend.exponent,
      }).format(minor / scale);
    } catch {
      return `${(minor / scale).toFixed(spend.exponent)} ${spend.currency}`;
    }
  };
  return `${format(spend.usedMinor)} of ${format(spend.limitMinor)}`;
}

export interface UsageFooterItem {
  readonly key: string;
  readonly driver: LimitPool["driver"];
  /** Set when the item is one account of a provider that has several. */
  readonly accountName: string | null;
  readonly windows: readonly LimitPoolWindow[];
}

/**
 * The provider's chosen windows in display order, or its busiest when none are chosen or none
 * of the chosen ones are reported any more.
 */
export function footerWindows(
  pool: LimitPool,
  display: UsageFooterDisplay,
): readonly LimitPoolWindow[] {
  const chosen = display.windows[pool.driver] ?? [];
  const picked = displayLimitWindows(pool).filter((window) => chosen.includes(window.id));
  if (picked.length > 0) return picked;
  const busiest = busiestPoolWindow(pool);
  return busiest ? [busiest] : [];
}

/** A short name that tells one account of a provider from another. */
export function accountShortName(account: LimitAccount): string | null {
  if (account.displayName) return account.displayName;
  return account.email?.split("@")[0] ?? null;
}

/** The footer's entries: one per provider, or one per account, minus the hidden ones. */
export function usageFooterItems(
  pools: readonly LimitPool[],
  display: UsageFooterDisplay,
  now: number,
): readonly UsageFooterItem[] {
  const items: UsageFooterItem[] = [];
  for (const pool of pools) {
    if (display.hiddenProviders.includes(pool.driver)) continue;
    if (display.accounts === "combined") {
      items.push({
        key: pool.driver,
        driver: pool.driver,
        accountName: null,
        windows: footerWindows(pool, display),
      });
      continue;
    }
    for (const account of pool.accounts) {
      if (display.hiddenAccounts.includes(account.key)) continue;
      const own = collectLimitPools([account], now)[0];
      items.push({
        key: account.key,
        driver: pool.driver,
        accountName: pool.accounts.length > 1 ? accountShortName(account) : null,
        windows: own ? footerWindows(own, display) : [],
      });
    }
  }
  return items;
}

/** The figure the footer shows; colour still follows the used share. */
export function footerPercent(window: LimitPoolWindow, value: UsageFooterDisplay["value"]): number {
  return value === "used" ? window.usedPercent : Math.max(0, 100 - window.usedPercent);
}
