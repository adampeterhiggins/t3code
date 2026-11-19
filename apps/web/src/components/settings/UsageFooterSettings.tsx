import { DEFAULT_USAGE_FOOTER_DISPLAY } from "@t3tools/contracts";
import { msg, useGT, useMessages } from "gt-react";
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
import { useSearchableSetting } from "./settingsSearch";

const ACCOUNTS_LABELS = {
  combined: msg("One per provider"),
  separate: msg("One per account"),
} as const;
const VALUE_LABELS = { used: msg("Percent used"), remaining: msg("Percent left") } as const;

/** The usage footer's display choices; the footer's own panel edits the same setting. */
export function UsageFooterSettingsRows() {
  const gt = useGT();
  const m = useMessages();
  const searchableSetting = useSearchableSetting();
  const enabled = useClientSettings((settings) => settings.usageFooterEnabled);
  const display = useClientSettings((settings) => settings.usageFooterDisplay);
  const pools = useUsageLimitPools();
  if (!enabled) return null;
  const hiddenCount = display.hiddenProviders.length + display.hiddenAccounts.length;
  const providersSummary =
    pools.length === 0
      ? gt("No limits reported")
      : hiddenCount === 0
        ? gt("All shown")
        : gt("{count} hidden", { count: hiddenCount });
  return (
    <>
      <SettingsRow
        {...searchableSetting("usage-footer-providers")}
        description={gt(
          "Choose which providers, and with one entry per account which accounts, the footer and its panel show.",
        )}
        resetAction={
          hiddenCount > 0 ? (
            <SettingResetButton
              ariaLabel={gt("Reset usage footer providers to default")}
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
        description={gt(
          "Pool each provider's accounts into one entry, or show every account on its own.",
        )}
        resetAction={
          display.accounts !== DEFAULT_USAGE_FOOTER_DISPLAY.accounts ? (
            <SettingResetButton
              ariaLabel={gt("Reset usage footer accounts to default")}
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
                aria-label={gt("Usage footer accounts")}
              >
                <SelectValue>{m(ACCOUNTS_LABELS[display.accounts])}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem value="combined">{m(ACCOUNTS_LABELS.combined)}</SelectItem>
                <SelectItem value="separate">{m(ACCOUNTS_LABELS.separate)}</SelectItem>
              </SelectPopup>
            </Select>
          </div>
        }
      />
      <SettingsRow
        {...searchableSetting("usage-footer-format")}
        description={gt("Show how much of each limit is used, or how much is left.")}
        resetAction={
          display.value !== DEFAULT_USAGE_FOOTER_DISPLAY.value ? (
            <SettingResetButton
              ariaLabel={gt("Reset usage footer format to default")}
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
              <SelectTrigger
                size="sm"
                className="w-full min-w-0"
                aria-label={gt("Usage footer format")}
              >
                <SelectValue>{m(VALUE_LABELS[display.value])}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem value="used">{m(VALUE_LABELS.used)}</SelectItem>
                <SelectItem value="remaining">{m(VALUE_LABELS.remaining)}</SelectItem>
              </SelectPopup>
            </Select>
          </div>
        }
      />
      <SettingsRow
        {...searchableSetting("usage-footer-reset")}
        description={gt("Show the time until each limit resets.")}
        resetAction={
          display.showReset !== DEFAULT_USAGE_FOOTER_DISPLAY.showReset ? (
            <SettingResetButton
              ariaLabel={gt("Reset usage footer reset time to default")}
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
            aria-label={gt("Show time to reset in the usage footer")}
          />
        }
      />
      <SettingsRow
        {...searchableSetting("usage-footer-names")}
        description={gt("Show each provider's name beside its icon.")}
        resetAction={
          display.showNames !== DEFAULT_USAGE_FOOTER_DISPLAY.showNames ? (
            <SettingResetButton
              ariaLabel={gt("Reset usage footer provider names to default")}
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
            aria-label={gt("Show provider names in the usage footer")}
          />
        }
      />
    </>
  );
}
