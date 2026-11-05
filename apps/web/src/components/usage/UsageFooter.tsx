import { useAtomValue } from "@effect/atom-react";
import type { ServerProviderUsageWindow } from "@t3tools/contracts";
import {
  collectLimitAccounts,
  collectLimitPools,
  cursorUsageWindowDetails,
  displayLimitWindows,
  formatResetsIn,
  type LimitAccount,
  type LimitPool,
  limitsNotice,
} from "@t3tools/shared/usageLimits";
import { useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { ChartNoAxesColumnIcon, ChevronRightIcon, SettingsIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useNowMinute } from "../../hooks/useNowMinute";
import { useClientSettings } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import { environmentPresentations } from "../../state/presentation";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { providerClients } from "../settings/providerDriverMeta";
import { RedactedSensitiveText } from "../settings/RedactedSensitiveText";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { RefreshIcon } from "../ui/refresh-icon";
import { Separator } from "../ui/separator";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import { resetCreditsSummary } from "./UsageLimits";
import {
  busiestPoolWindow,
  formatSpend,
  formatUsedPercent,
  nextResetLabel,
  type UsageSeverity,
  usageSeverity,
} from "./usageFooter.logic";
import { readUsagePagePreferences, saveUsagePagePreferences } from "./usagePagePreferences";
import { useRefreshUsageLimits } from "./useRefreshUsageLimits";

const SEVERITY_COLOR: Record<UsageSeverity, string> = {
  ok: "var(--success)",
  warn: "var(--warning)",
  high: "color-mix(in oklab, var(--warning) 45%, var(--destructive))",
  critical: "var(--destructive)",
};

const LAYOUT_STORAGE_KEY = "t3code:usage-footer-layout:v1";
const LayoutSchema = Schema.Literals(["compact", "detailed"]);

function providerLabel(driver: LimitPool["driver"]): string {
  return providerClients.get(driver)?.label ?? String(driver);
}

function ProviderIcon({ driver }: { readonly driver: LimitPool["driver"] }) {
  return (
    <ProviderInstanceIcon
      driverKind={driver}
      displayName={providerLabel(driver)}
      indicatorBackground="var(--popover)"
      className="size-3.5"
      iconClassName="size-3.5 text-foreground/80"
    />
  );
}

/** Below 70% the number stays plain so only limits worth noticing draw the eye. */
function UsedPercent({
  usedPercent,
  className,
}: {
  readonly usedPercent: number;
  readonly className?: string;
}) {
  const severity = usageSeverity(usedPercent);
  return (
    <span
      className={cn("tabular-nums", className)}
      style={
        severity === "high" || severity === "critical"
          ? { color: SEVERITY_COLOR[severity] }
          : undefined
      }
    >
      {formatUsedPercent(usedPercent)}
    </span>
  );
}

function windowLabel(account: LimitAccount, window: ServerProviderUsageWindow): string {
  return account.driver === "cursor"
    ? (cursorUsageWindowDetails(window.id)?.label ?? window.label)
    : window.label;
}

function UsedWindow({
  account,
  window,
  now,
}: {
  readonly account: LimitAccount;
  readonly window: ServerProviderUsageWindow;
  readonly now: number;
}) {
  const used = window.usedPercent;
  const detail = window.spend ? formatSpend(window.spend) : formatResetsIn(window, now);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2 text-sm">
        <span className="min-w-0 truncate">{windowLabel(account, window)}</span>
        <span className="ms-auto font-medium tabular-nums">{formatUsedPercent(used)}</span>
      </div>
      <div className="relative h-1.5 overflow-hidden rounded-full bg-muted">
        {used > 0 ? (
          <div
            className="absolute inset-y-0 left-0 rounded-full"
            style={{
              width: `${Math.min(used, 100)}%`,
              backgroundColor: SEVERITY_COLOR[usageSeverity(used)],
            }}
          />
        ) : null}
      </div>
      {detail ? <span className="text-xs text-muted-foreground tabular-nums">{detail}</span> : null}
    </div>
  );
}

function AccountName({ account }: { readonly account: LimitAccount }) {
  if (account.displayName) return <span className="min-w-0 truncate">{account.displayName}</span>;
  if (account.email) {
    return (
      <RedactedSensitiveText
        value={account.email}
        ariaLabel="Toggle account visibility"
        revealTooltip="Click to reveal account"
        hideTooltip="Click to hide account"
        className="min-w-0 truncate"
      />
    );
  }
  return <span className="min-w-0 truncate">Default account</span>;
}

function AccountCard({
  account,
  now,
  showProvider,
}: {
  readonly account: LimitAccount;
  readonly now: number;
  readonly showProvider: boolean;
}) {
  // A one-account pool gives this account's windows in the same order and labels as Usage → Limits.
  const pool = collectLimitPools([account], now)[0];
  const windows = pool
    ? displayLimitWindows(pool).flatMap((window) => window.members.map((m) => m.window))
    : [];
  const notice = limitsNotice(account.limits);
  const credits = account.limits.resetCredits;
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-lg border bg-card p-3">
      <div className="flex min-w-0 items-center gap-1.5 text-sm font-medium whitespace-nowrap">
        {showProvider ? (
          <>
            <ProviderIcon driver={account.driver} />
            <span>{providerLabel(account.driver)}</span>
          </>
        ) : null}
        <AccountName account={account} />
        {account.plan ? (
          <span className="shrink-0 font-normal text-muted-foreground">· {account.plan}</span>
        ) : null}
      </div>
      {notice ? <span className="text-xs text-muted-foreground">{notice}</span> : null}
      {windows.map((window) => (
        <UsedWindow key={window.id} account={account} window={window} now={now} />
      ))}
      {credits && credits.availableCount > 0 ? (
        <span className="text-xs text-muted-foreground tabular-nums">
          {resetCreditsSummary(credits, now)}
        </span>
      ) : null}
    </div>
  );
}

function ProviderDetail({ pool, now }: { readonly pool: LimitPool; readonly now: number }) {
  return (
    <div className="flex w-80 flex-col gap-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <ProviderIcon driver={pool.driver} />
        {providerLabel(pool.driver)}
      </div>
      {pool.accounts.map((account) => (
        <AccountCard key={account.key} account={account} now={now} showProvider={false} />
      ))}
    </div>
  );
}

function ProviderRow({
  pool,
  now,
  active,
  onSelect,
}: {
  readonly pool: LimitPool;
  readonly now: number;
  readonly active: boolean;
  readonly onSelect: () => void;
}) {
  const window = busiestPoolWindow(pool);
  const plan =
    pool.accounts.length > 1 ? `${pool.accounts.length} accounts` : pool.accounts[0]?.plan;
  return (
    <Button
      variant="ghost"
      size="sm"
      className="w-full justify-start"
      data-pressed={active || undefined}
      aria-expanded={active}
      onClick={onSelect}
    >
      <ProviderIcon driver={pool.driver} />
      <span>{providerLabel(pool.driver)}</span>
      {plan ? <span className="truncate text-muted-foreground">· {plan}</span> : null}
      <span className="ms-auto flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
        {window ? (
          <>
            <span>{nextResetLabel(window, now)}</span>
            <UsedPercent
              usedPercent={window.usedPercent}
              className="min-w-9 text-end font-medium text-foreground"
            />
          </>
        ) : null}
      </span>
      <ChevronRightIcon className="text-muted-foreground" />
    </Button>
  );
}

function UsagePanel({
  pools,
  now,
  refreshing,
  onRefresh,
  onNavigate,
}: {
  readonly pools: readonly LimitPool[];
  readonly now: number;
  readonly refreshing: boolean;
  readonly onRefresh: () => void;
  readonly onNavigate: (to: "/usage" | "/settings/providers") => void;
}) {
  const [layout, setLayout] = useLocalStorage(LAYOUT_STORAGE_KEY, "compact", LayoutSchema);
  const [selected, setSelected] = useState<LimitPool["driver"] | null>(null);
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const detailed = layout === "detailed";
  const selectedPool = detailed ? undefined : pools.find((pool) => pool.driver === selected);
  const accounts = pools.flatMap((pool) => pool.accounts);
  return (
    <div
      ref={setPanel}
      className={cn("flex flex-col gap-2", detailed && accounts.length > 1 ? "w-[40rem]" : "w-80")}
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">Usage limits</span>
        <Button
          variant="ghost"
          size="icon-xs"
          className="ms-auto"
          aria-label="Refresh limits"
          aria-busy={refreshing}
          disabled={refreshing}
          onClick={onRefresh}
        >
          <RefreshIcon refreshing={refreshing} />
        </Button>
      </div>
      <ToggleGroup
        className="w-full *:flex-1"
        value={[layout]}
        onValueChange={(value) => {
          const next = value[0];
          if (next === "compact" || next === "detailed") setLayout(next);
        }}
      >
        <ToggleGroupItem value="detailed">Detailed</ToggleGroupItem>
        <ToggleGroupItem value="compact">Compact</ToggleGroupItem>
      </ToggleGroup>
      {detailed ? (
        <div
          className={cn(
            "grid max-h-[min(36rem,calc(100dvh-10rem))] gap-2 overflow-y-auto",
            accounts.length > 1 && "grid-cols-2",
          )}
        >
          {accounts.map((account) => (
            <AccountCard key={account.key} account={account} now={now} showProvider />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-0.5">
          {pools.map((pool) => (
            <ProviderRow
              key={pool.driver}
              pool={pool}
              now={now}
              active={pool.driver === selectedPool?.driver}
              onSelect={() => setSelected(pool.driver === selected ? null : pool.driver)}
            />
          ))}
        </div>
      )}
      <Separator />
      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-start"
        onClick={() => onNavigate("/usage")}
      >
        <ChartNoAxesColumnIcon />
        Open Usage
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-start"
        onClick={() => onNavigate("/settings/providers")}
      >
        <SettingsIcon />
        Usage providers
      </Button>
      {selectedPool && panel ? (
        <Popover open onOpenChange={(open) => (open ? undefined : setSelected(null))}>
          <PopoverPopup
            anchor={panel}
            side="right"
            align="end"
            sideOffset={24}
            initialFocus={false}
          >
            <div className="max-h-[calc(100dvh-4rem)] overflow-y-auto">
              <ProviderDetail pool={selectedPool} now={now} />
            </div>
          </PopoverPopup>
        </Popover>
      ) : null}
    </div>
  );
}

function UsageFooterBar({
  pools,
  now,
}: {
  readonly pools: readonly LimitPool[];
  readonly now: number;
}) {
  const navigate = useNavigate();
  const refreshAll = useRefreshUsageLimits();
  const [open, setOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = (automatic: boolean) => {
    if (!automatic) setRefreshing(true);
    void refreshAll(null, automatic).finally(() => {
      if (!automatic) setRefreshing(false);
    });
  };
  return (
    <div
      role="status"
      aria-label="Usage limits"
      className="flex h-(--app-footer-height) shrink-0 items-center border-t bg-background px-2 text-xs max-md:hidden"
    >
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          // Opening reads fresh limits, as opening Usage → Limits does; the refresh is throttled.
          if (next) refresh(true);
        }}
      >
        <PopoverTrigger render={<Button variant="ghost" size="micro" />}>
          <span className="flex items-center gap-3 font-normal">
            {pools.map((pool) => {
              const window = busiestPoolWindow(pool);
              return (
                <span key={pool.driver} className="flex items-center gap-1.5 whitespace-nowrap">
                  <ProviderIcon driver={pool.driver} />
                  <span className="sr-only">{providerLabel(pool.driver)}</span>
                  {window ? (
                    <>
                      <UsedPercent usedPercent={window.usedPercent} className="text-foreground" />
                      <span className="text-muted-foreground">{nextResetLabel(window, now)}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">n/a</span>
                  )}
                </span>
              );
            })}
          </span>
        </PopoverTrigger>
        <PopoverPopup side="top" align="start" sideOffset={6} initialFocus={false}>
          <UsagePanel
            pools={pools}
            now={now}
            refreshing={refreshing}
            onRefresh={() => refresh(false)}
            onNavigate={(to) => {
              setOpen(false);
              if (to === "/usage") {
                saveUsagePagePreferences({ ...readUsagePagePreferences(), metric: "limits" });
              }
              void navigate({ to });
            }}
          />
        </PopoverPopup>
      </Popover>
    </div>
  );
}

/**
 * Wraps the app shell and adds the usage strip below it. The shell reads `--app-footer-height`
 * to leave room, so the children never re-render when limits or the clock change.
 */
export function UsageFooterFrame({ children }: { readonly children: ReactNode }) {
  const enabled = useClientSettings((settings) => settings.usageFooterEnabled);
  const presentations = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  const minute = useNowMinute();
  const now = Date.parse(`${minute}:00Z`);
  const pools = enabled ? collectLimitPools(collectLimitAccounts(presentations), now) : [];
  const shown = pools.length > 0;
  return (
    <div className={cn("contents", shown && "md:[--app-footer-height:--spacing(7)]")}>
      {children}
      {shown ? <UsageFooterBar pools={pools} now={now} /> : null}
    </div>
  );
}
