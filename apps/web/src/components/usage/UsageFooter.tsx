import { useAtomValue } from "@effect/atom-react";
import type { ServerProviderUsageWindow, UsageFooterDisplay } from "@t3tools/contracts";
import {
  collectLimitAccounts,
  collectLimitPools,
  cursorUsageWindowDetails,
  displayLimitWindows,
  formatResetsIn,
  type LimitAccount,
  type LimitPool,
  type LimitPoolWindow,
  limitsNotice,
} from "@t3tools/shared/usageLimits";
import { useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import {
  ChartNoAxesColumnIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  SettingsIcon,
  SlidersHorizontalIcon,
} from "lucide-react";
import { useState } from "react";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useNowMinute } from "../../hooks/useNowMinute";
import {
  getClientSettings,
  updateClientSettings,
  useClientSettings,
} from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import { environmentPresentations } from "../../state/presentation";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { providerClients } from "../settings/providerDriverMeta";
import { RedactedSensitiveText } from "../settings/RedactedSensitiveText";
import { Button } from "../ui/button";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "../ui/menu";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { PreviewCard, PreviewCardPopup, PreviewCardTrigger } from "../ui/preview-card";
import { RefreshIcon } from "../ui/refresh-icon";
import { Separator } from "../ui/separator";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import { resetCreditsSummary } from "./UsageLimits";
import {
  accountShortName,
  busiestPoolWindow,
  footerPercent,
  formatSpend,
  formatUsedPercent,
  nextResetLabel,
  type UsageFooterItem,
  type UsageSeverity,
  usageSeverity,
  usageFooterItems,
  usagePanelAccounts,
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
  shownPercent = usedPercent,
  suffix,
  className,
}: {
  readonly usedPercent: number;
  readonly shownPercent?: number;
  readonly suffix?: string;
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
      {formatUsedPercent(shownPercent)}
      {suffix}
    </span>
  );
}

function poolWindowLabel(driver: LimitPool["driver"], window: LimitPoolWindow): string {
  return driver === "cursor"
    ? (cursorUsageWindowDetails(window.id)?.label ?? window.label)
    : window.label;
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
  if (account.displayName && account.displayName !== providerLabel(account.driver)) {
    return <span className="max-w-1/2 shrink-0 truncate">{account.displayName}</span>;
  }
  if (account.email) {
    return (
      <RedactedSensitiveText
        value={account.email}
        ariaLabel="Toggle account visibility"
        revealTooltip="Click to reveal account"
        hideTooltip="Click to hide account"
        className="max-w-1/2 shrink-0 truncate"
      />
    );
  }
  return account.displayName ? null : <span className="shrink-0">Default account</span>;
}

function AccountCard({
  account,
  now,
  showProvider,
  bare = false,
}: {
  readonly account: LimitAccount;
  readonly now: number;
  readonly showProvider: boolean;
  /** Drops the card chrome when it is the only thing in a popup. */
  readonly bare?: boolean;
}) {
  // A one-account pool gives this account's windows in the same order and labels as Usage → Limits.
  const pool = collectLimitPools([account], now)[0];
  const windows = pool
    ? displayLimitWindows(pool).flatMap((window) => window.members.map((m) => m.window))
    : [];
  const notice = limitsNotice(account.limits);
  const credits = account.limits.resetCredits;
  return (
    <div
      className={cn("flex min-w-0 flex-col gap-3", bare ? null : "rounded-lg border bg-card p-3")}
    >
      <div className="flex min-w-0 items-center gap-1.5 text-sm font-medium whitespace-nowrap">
        {showProvider ? (
          <>
            <ProviderIcon driver={account.driver} />
            <span>{providerLabel(account.driver)}</span>
          </>
        ) : null}
        <AccountName account={account} />
        {account.plan ? (
          <span className="min-w-0 truncate font-normal text-muted-foreground">
            · {account.plan}
          </span>
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

function ProviderDetail({
  driver,
  accounts,
  now,
}: {
  readonly driver: LimitPool["driver"];
  readonly accounts: readonly LimitAccount[];
  readonly now: number;
}) {
  return (
    <div className="flex w-80 flex-col gap-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <ProviderIcon driver={driver} />
        {providerLabel(driver)}
      </div>
      {accounts.map((account) => (
        <AccountCard
          key={account.key}
          account={account}
          now={now}
          showProvider={false}
          bare={accounts.length === 1}
        />
      ))}
    </div>
  );
}

function AccountRow({
  account,
  showAccount,
  now,
  active,
  onSelect,
}: {
  readonly account: LimitAccount;
  /** Set when the provider has several accounts, so each row names its own. */
  readonly showAccount: boolean;
  readonly now: number;
  readonly active: boolean;
  readonly onSelect: () => void;
}) {
  const own = collectLimitPools([account], now)[0];
  const window = own ? busiestPoolWindow(own) : null;
  const name = showAccount ? (accountShortName(account) ?? "Default account") : null;
  return (
    <Button
      variant="ghost"
      size="sm"
      className="w-full justify-start"
      data-pressed={active || undefined}
      aria-expanded={active}
      onClick={onSelect}
    >
      {name ? (
        <ProviderInstanceIcon
          driverKind={account.driver}
          displayName={name}
          accentColor={account.accentColor}
          showBadge
          size="compact"
          indicatorBackground="var(--popover)"
          className="size-3.5"
          iconClassName="text-foreground/80"
        />
      ) : (
        <ProviderIcon driver={account.driver} />
      )}
      <span>{providerLabel(account.driver)}</span>
      {name || account.plan ? (
        <span className="truncate text-muted-foreground">· {name ?? account.plan}</span>
      ) : null}
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
  display,
  now,
  refreshing,
  onRefresh,
  onNavigate,
}: {
  readonly pools: readonly LimitPool[];
  readonly display: UsageFooterDisplay;
  readonly now: number;
  readonly refreshing: boolean;
  readonly onRefresh: () => void;
  readonly onNavigate: (to: "/usage" | "/settings/providers") => void;
}) {
  const [layout, setLayout] = useLocalStorage(LAYOUT_STORAGE_KEY, "compact", LayoutSchema);
  const [selected, setSelected] = useState<string | null>(null);
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const detailed = layout === "detailed";
  const rows = usagePanelAccounts(pools, display);
  const selectedAccount = detailed
    ? undefined
    : rows.find((row) => row.account.key === selected)?.account;
  return (
    <div ref={setPanel} className={cn("flex flex-col gap-2", detailed ? "w-96" : "w-80")}>
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">Usage limits</span>
        <div className="ms-auto flex items-center gap-1">
          <UsageFooterCustomizeMenu pools={pools} />
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Refresh limits"
            aria-busy={refreshing}
            disabled={refreshing}
            onClick={onRefresh}
          >
            <RefreshIcon refreshing={refreshing} />
          </Button>
        </div>
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
      {rows.length === 0 ? (
        <p className="px-2 py-4 text-center text-sm text-muted-foreground">All hidden.</p>
      ) : detailed ? (
        <div className="flex max-h-[min(40rem,calc(100dvh-14rem))] flex-col gap-2 overflow-y-auto">
          {rows.map(({ account }) => (
            <AccountCard key={account.key} account={account} now={now} showProvider />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-0.5">
          {rows.map(({ account, showAccount }) => (
            <AccountRow
              key={account.key}
              account={account}
              showAccount={showAccount}
              now={now}
              active={account.key === selectedAccount?.key}
              onSelect={() => setSelected(account.key === selected ? null : account.key)}
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
      {selectedAccount && panel ? (
        <Popover open onOpenChange={(open) => (open ? undefined : setSelected(null))}>
          <PopoverPopup
            anchor={panel}
            side="right"
            align="end"
            sideOffset={24}
            initialFocus={false}
          >
            <div className="max-h-[calc(100dvh-4rem)] overflow-y-auto">
              <ProviderDetail
                driver={selectedAccount.driver}
                accounts={[selectedAccount]}
                now={now}
              />
            </div>
          </PopoverPopup>
        </Popover>
      ) : null}
    </div>
  );
}

function FooterItem({
  item,
  display,
  now,
}: {
  readonly item: UsageFooterItem;
  readonly display: UsageFooterDisplay;
  readonly now: number;
}) {
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap">
      {item.accountName ? (
        <ProviderInstanceIcon
          driverKind={item.driver}
          displayName={item.accountName}
          accentColor={item.accentColor}
          showBadge
          size="compact"
          indicatorBackground="var(--background)"
          className="size-3.5"
          iconClassName="text-foreground/80"
        />
      ) : (
        <ProviderIcon driver={item.driver} />
      )}
      <span className={display.showNames ? "text-foreground" : "sr-only"}>
        {providerLabel(item.driver)}
      </span>
      {item.accountName ? <span className="sr-only">{item.accountName}</span> : null}
      {item.windows.length === 0 ? (
        <span className="text-muted-foreground">n/a</span>
      ) : (
        item.windows.map((window, index) => {
          const label = poolWindowLabel(item.driver, window);
          const reset = display.showReset ? nextResetLabel(window, now) : null;
          return (
            <span key={window.id} className="flex items-center gap-1.5">
              {index > 0 ? <span className="text-muted-foreground/60">·</span> : null}
              {item.windows.length > 1 ? (
                <span className="text-muted-foreground">{label}</span>
              ) : null}
              <UsedPercent
                usedPercent={window.usedPercent}
                shownPercent={footerPercent(window, display.value)}
                suffix={display.value === "remaining" ? " left" : ""}
                className="text-foreground"
              />
              {reset ? <span className="text-muted-foreground">{reset}</span> : null}
            </span>
          );
        })
      )}
    </span>
  );
}

export function updateUsageFooterDisplay(patch: Partial<UsageFooterDisplay>): void {
  void updateClientSettings({
    usageFooterDisplay: { ...getClientSettings().usageFooterDisplay, ...patch },
  });
}

function toggleKey(list: readonly string[], key: string, shown: boolean): string[] {
  return shown ? list.filter((entry) => entry !== key) : [...list, key];
}

/** The live limit pools across connected environments, as the footer reads them. */
export function useUsageLimitPools(): readonly LimitPool[] {
  const presentations = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  const minute = useNowMinute();
  return collectLimitPools(collectLimitAccounts(presentations), Date.parse(`${minute}:00Z`));
}

/** Checkboxes for each provider and, with one entry per account, each of its accounts. */
export function UsageFooterProviderItems({ pools }: { readonly pools: readonly LimitPool[] }) {
  const display = useClientSettings((settings) => settings.usageFooterDisplay);
  const separate = display.accounts === "separate";
  return (
    <>
      {pools.map((pool) => {
        const providerShown = !display.hiddenProviders.includes(pool.driver);
        return (
          <MenuGroup key={pool.driver}>
            <MenuCheckboxItem
              checked={providerShown}
              onCheckedChange={(shown) =>
                updateUsageFooterDisplay({
                  hiddenProviders: toggleKey(display.hiddenProviders, pool.driver, shown),
                })
              }
            >
              <span className="flex items-center gap-2">
                <ProviderIcon driver={pool.driver} />
                {providerLabel(pool.driver)}
              </span>
            </MenuCheckboxItem>
            {providerShown ? <UsageFooterWindowsSubmenu pool={pool} /> : null}
            {separate && pool.accounts.length > 1
              ? pool.accounts.map((account) => (
                  <MenuCheckboxItem
                    key={account.key}
                    disabled={!providerShown}
                    checked={providerShown && !display.hiddenAccounts.includes(account.key)}
                    onCheckedChange={(shown) =>
                      updateUsageFooterDisplay({
                        hiddenAccounts: toggleKey(display.hiddenAccounts, account.key, shown),
                      })
                    }
                  >
                    <span className="block truncate ps-5">
                      {accountShortName(account) ?? "Default account"}
                    </span>
                  </MenuCheckboxItem>
                ))
              : null}
          </MenuGroup>
        );
      })}
    </>
  );
}

function UsageFooterWindowsSubmenu({ pool }: { readonly pool: LimitPool }) {
  const chosen = useClientSettings(
    (settings) => settings.usageFooterDisplay.windows[pool.driver] ?? EMPTY_WINDOW_IDS,
  );
  const windows = displayLimitWindows(pool);
  if (windows.length < 2) return null;
  const setChosen = (next: readonly string[]) => {
    const rest = Object.fromEntries(
      Object.entries(getClientSettings().usageFooterDisplay.windows).filter(
        ([driver]) => driver !== pool.driver,
      ),
    );
    updateUsageFooterDisplay({
      windows: next.length > 0 ? { ...rest, [pool.driver]: next } : rest,
    });
  };
  const shown = windows.filter((window) => chosen.includes(window.id));
  return (
    <MenuSub>
      <MenuSubTrigger>
        <span className="min-w-0 flex-1 truncate ps-5 text-muted-foreground">
          {shown.length === 0
            ? "Limit: busiest"
            : `Limits: ${shown.map((window) => poolWindowLabel(pool.driver, window)).join(", ")}`}
        </span>
      </MenuSubTrigger>
      <MenuSubPopup>
        <MenuRadioGroup
          value={shown.length === 0 ? "busiest" : null}
          onValueChange={(value) => {
            if (value === "busiest") setChosen([]);
          }}
        >
          <RadioChoice value="busiest" label="Busiest limit" />
        </MenuRadioGroup>
        <MenuSeparator />
        {windows.map((window) => (
          <MenuCheckboxItem
            key={window.id}
            checked={chosen.includes(window.id)}
            onCheckedChange={(checked) => setChosen(toggleKey(chosen, window.id, !checked))}
          >
            {poolWindowLabel(pool.driver, window)}
          </MenuCheckboxItem>
        ))}
      </MenuSubPopup>
    </MenuSub>
  );
}

const EMPTY_WINDOW_IDS: readonly string[] = [];

function UsageFooterCustomizeMenu({ pools }: { readonly pools: readonly LimitPool[] }) {
  const display = useClientSettings((settings) => settings.usageFooterDisplay);
  return (
    <Menu>
      <MenuTrigger
        render={<Button variant="ghost" size="icon-xs" aria-label="Customize usage footer" />}
      >
        <SlidersHorizontalIcon />
      </MenuTrigger>
      <MenuPopup align="end">
        <MenuGroup>
          <MenuGroupLabel>Providers</MenuGroupLabel>
          <UsageFooterProviderItems pools={pools} />
        </MenuGroup>
        <MenuSeparator />
        <MenuGroup>
          <MenuGroupLabel>Accounts</MenuGroupLabel>
          <MenuRadioGroup
            value={display.accounts}
            onValueChange={(value) => {
              if (value === "combined" || value === "separate")
                updateUsageFooterDisplay({ accounts: value });
            }}
          >
            <RadioChoice value="combined" label="One per provider" />
            <RadioChoice value="separate" label="One per account" />
          </MenuRadioGroup>
        </MenuGroup>
        <MenuSeparator />
        <MenuGroup>
          <MenuGroupLabel>Format</MenuGroupLabel>
          <MenuRadioGroup
            value={display.value}
            onValueChange={(value) => {
              if (value === "used" || value === "remaining") updateUsageFooterDisplay({ value });
            }}
          >
            <RadioChoice value="used" label="Percent used" />
            <RadioChoice value="remaining" label="Percent left" />
          </MenuRadioGroup>
          <MenuCheckboxItem
            checked={display.showReset}
            onCheckedChange={(showReset) => updateUsageFooterDisplay({ showReset })}
          >
            Time to reset
          </MenuCheckboxItem>
          <MenuCheckboxItem
            checked={display.showNames}
            onCheckedChange={(showNames) => updateUsageFooterDisplay({ showNames })}
          >
            Provider names
          </MenuCheckboxItem>
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
}

function RadioChoice({ value, label }: { readonly value: string; readonly label: string }) {
  return (
    <MenuRadioItem value={value}>
      <span className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1">{label}</span>
        <MenuRadioItemIndicator />
      </span>
    </MenuRadioItem>
  );
}

function UsageFooterBar({
  pools,
  display,
  now,
}: {
  readonly pools: readonly LimitPool[];
  readonly display: UsageFooterDisplay;
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
  const items = usageFooterItems(pools, display, now);
  return (
    <div
      role="status"
      aria-label="Usage limits"
      className="flex h-7 shrink-0 items-center border-t bg-background px-2 text-xs max-md:hidden"
    >
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          // Opening reads fresh limits, as opening Usage → Limits does; the refresh is throttled.
          if (next) refresh(true);
        }}
      >
        {items.length === 0 ? (
          // Every entry hidden: keep a labelled way into the panel, where the menu shows them again.
          <PopoverTrigger render={<Button variant="ghost" size="micro" />}>
            <span className="flex items-center gap-1.5 font-normal text-muted-foreground">
              <ChartNoAxesColumnIcon className="size-3.5" />
              Usage
            </span>
          </PopoverTrigger>
        ) : (
          <PopoverTrigger
            render={<Button variant="ghost" size="icon-micro" aria-label="Show all usage limits" />}
          >
            <ChevronUpIcon />
          </PopoverTrigger>
        )}
        <PopoverPopup side="top" align="start" sideOffset={6} initialFocus={false}>
          <UsagePanel
            pools={pools}
            display={display}
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
      {items.length > 0 ? (
        <>
          <Separator orientation="vertical" className="mx-1 h-3.5" />
          <span className="flex items-center gap-0.5">
            {items.map((item) => (
              <PreviewCard
                key={item.key}
                onOpenChange={(next) => (next ? refresh(true) : undefined)}
              >
                <PreviewCardTrigger
                  delay={200}
                  closeDelay={100}
                  render={<Button variant="ghost" size="micro" />}
                >
                  <span className="font-normal">
                    <FooterItem item={item} display={display} now={now} />
                  </span>
                </PreviewCardTrigger>
                <PreviewCardPopup side="top" align="start" sideOffset={6}>
                  <div className="p-3">
                    <ProviderDetail driver={item.driver} accounts={item.accounts} now={now} />
                  </div>
                </PreviewCardPopup>
              </PreviewCard>
            ))}
          </span>
        </>
      ) : null}
    </div>
  );
}

export function toggleUsageFooter(): void {
  void updateClientSettings({ usageFooterEnabled: !getClientSettings().usageFooterEnabled });
}

/** The usage strip at the bottom of the main column, between the sidebars. */
export function UsageFooter() {
  const enabled = useClientSettings((settings) => settings.usageFooterEnabled);
  const display = useClientSettings((settings) => settings.usageFooterDisplay);
  const presentations = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  const minute = useNowMinute();
  const now = Date.parse(`${minute}:00Z`);
  const pools = enabled ? collectLimitPools(collectLimitAccounts(presentations), now) : [];
  return pools.length > 0 ? <UsageFooterBar pools={pools} display={display} now={now} /> : null;
}
