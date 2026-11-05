import {
  displayLimitWindows,
  formatDuration,
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
