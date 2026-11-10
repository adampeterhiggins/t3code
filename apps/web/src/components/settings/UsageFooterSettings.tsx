import { DEFAULT_USAGE_FOOTER_DISPLAY } from "@t3tools/contracts";
import { ChevronDownIcon } from "lucide-react";

import { useClientSettings } from "../../hooks/useSettings";
import { Button } from "../ui/button";
import { Menu, MenuPopup, MenuTrigger } from "../ui/menu";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import {
  UsageFooterProviderItems,
  updateUsageFooterDisplay,
  useUsageLimitPools,
} from "../usage/UsageFooter";
import { SettingResetButton, SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

const ACCOUNTS_LABELS = { combined: "One per provider", separate: "One per account" } as const;
const VALUE_LABELS = { used: "Percent used", remaining: "Percent left" } as const;

/** The usage footer's display choices; the footer's own panel edits the same setting. */
export function UsageFooterSettingsRows() {
  const enabled = useClientSettings((settings) => settings.usageFooterEnabled);
  const display = useClientSettings((settings) => settings.usageFooterDisplay);
  const pools = useUsageLimitPools();
  if (!enabled) return null;
  const hiddenCount = display.hiddenProviders.length + display.hiddenAccounts.length;
  const providersSummary =
    pools.length === 0
      ? "No limits reported"
      : hiddenCount === 0
        ? "All shown"
        : `${hiddenCount} hidden`;
  return (
    <>
      <SettingsRow
        {...searchableSetting("usage-footer-providers")}
        description="Choose which providers, and with one entry per account which accounts, the usage footer shows."
        resetAction={
          hiddenCount > 0 ? (
            <SettingResetButton
              label="usage footer providers"
              onClick={() => updateUsageFooterDisplay({ hiddenProviders: [], hiddenAccounts: [] })}
            />
          ) : null
        }
        control={
          <Menu>
            <MenuTrigger
              disabled={pools.length === 0}
              render={<Button variant="outline" size="sm" className="w-full sm:w-40" />}
            >
              <span className="min-w-0 flex-1 truncate text-start">{providersSummary}</span>
              <ChevronDownIcon />
            </MenuTrigger>
            <MenuPopup align="end">
              <UsageFooterProviderItems pools={pools} />
            </MenuPopup>
          </Menu>
        }
      />
      <SettingsRow
        {...searchableSetting("usage-footer-accounts")}
        description="Pool each provider's accounts into one entry, or show every account on its own."
        resetAction={
          display.accounts !== DEFAULT_USAGE_FOOTER_DISPLAY.accounts ? (
            <SettingResetButton
              label="usage footer accounts"
              onClick={() =>
                updateUsageFooterDisplay({ accounts: DEFAULT_USAGE_FOOTER_DISPLAY.accounts })
              }
            />
          ) : null
        }
        control={
          <div className="w-full sm:w-40">
            <Select
              value={display.accounts}
              onValueChange={(value) => {
                if (value === "combined" || value === "separate")
                  updateUsageFooterDisplay({ accounts: value });
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-full min-w-0"
                aria-label="Usage footer accounts"
              >
                <SelectValue>{ACCOUNTS_LABELS[display.accounts]}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem value="combined">{ACCOUNTS_LABELS.combined}</SelectItem>
                <SelectItem value="separate">{ACCOUNTS_LABELS.separate}</SelectItem>
              </SelectPopup>
            </Select>
          </div>
        }
      />
      <SettingsRow
        {...searchableSetting("usage-footer-format")}
        description="Show how much of each limit is used, or how much is left."
        resetAction={
          display.value !== DEFAULT_USAGE_FOOTER_DISPLAY.value ? (
            <SettingResetButton
              label="usage footer format"
              onClick={() =>
                updateUsageFooterDisplay({ value: DEFAULT_USAGE_FOOTER_DISPLAY.value })
              }
            />
          ) : null
        }
        control={
          <div className="w-full sm:w-40">
            <Select
              value={display.value}
              onValueChange={(value) => {
                if (value === "used" || value === "remaining") updateUsageFooterDisplay({ value });
              }}
            >
              <SelectTrigger size="sm" className="w-full min-w-0" aria-label="Usage footer format">
                <SelectValue>{VALUE_LABELS[display.value]}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem value="used">{VALUE_LABELS.used}</SelectItem>
                <SelectItem value="remaining">{VALUE_LABELS.remaining}</SelectItem>
              </SelectPopup>
            </Select>
          </div>
        }
      />
      <SettingsRow
        {...searchableSetting("usage-footer-reset")}
        description="Show the time until each limit resets."
        resetAction={
          display.showReset !== DEFAULT_USAGE_FOOTER_DISPLAY.showReset ? (
            <SettingResetButton
              label="usage footer reset time"
              onClick={() =>
                updateUsageFooterDisplay({ showReset: DEFAULT_USAGE_FOOTER_DISPLAY.showReset })
              }
            />
          ) : null
        }
        control={
          <Switch
            checked={display.showReset}
            onCheckedChange={(checked) => updateUsageFooterDisplay({ showReset: Boolean(checked) })}
            aria-label="Show time to reset in the usage footer"
          />
        }
      />
      <SettingsRow
        {...searchableSetting("usage-footer-names")}
        description="Show each provider's name beside its icon."
        resetAction={
          display.showNames !== DEFAULT_USAGE_FOOTER_DISPLAY.showNames ? (
            <SettingResetButton
              label="usage footer provider names"
              onClick={() =>
                updateUsageFooterDisplay({ showNames: DEFAULT_USAGE_FOOTER_DISPLAY.showNames })
              }
            />
          ) : null
        }
        control={
          <Switch
            checked={display.showNames}
            onCheckedChange={(checked) => updateUsageFooterDisplay({ showNames: Boolean(checked) })}
            aria-label="Show provider names in the usage footer"
          />
        }
      />
    </>
  );
}
