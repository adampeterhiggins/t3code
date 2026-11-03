import { type ProviderInstanceId } from "@t3tools/contracts";
import { memo } from "react";
import { CheckIcon, ChevronUpIcon, GitForkIcon } from "lucide-react";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { composerFloatingLayerProps } from "./composerEventScope";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";
import { shouldShowInstanceBadge, type ProviderInstanceEntry } from "../../providerInstances";
import { cn } from "~/lib/utils";

const FOOTER_TRIGGER =
  "flex h-7 min-w-0 max-w-40 items-center gap-1.5 rounded-md px-2 text-muted-foreground text-xs outline-none";

/**
 * Switches accounts of the active provider from the model picker's footer. With fewer than two
 * switchable accounts it is a plain label, so the thread still shows its account. `requiresFork`
 * lists accounts a started thread cannot switch to in place; choosing one forks the chat into a
 * new tab.
 */
export const ProviderAccountPicker = memo(function ProviderAccountPicker(props: {
  activeInstanceId: ProviderInstanceId;
  accounts: ReadonlyArray<ProviderInstanceEntry>;
  onAccountChange: (instanceId: ProviderInstanceId) => void;
  requiresFork?: (instanceId: ProviderInstanceId) => boolean;
  disabled?: boolean;
}) {
  const activeEntry =
    props.accounts.find((entry) => entry.instanceId === props.activeInstanceId) ??
    props.accounts[0];
  if (!activeEntry) {
    return null;
  }

  const triggerLabel = activeEntry.displayName;
  const forksToOtherAccounts = props.accounts.some(
    (account) =>
      account.instanceId !== activeEntry.instanceId && props.requiresFork?.(account.instanceId),
  );
  const accountIcon = (account: ProviderInstanceEntry, showBadge: boolean) => (
    <ProviderInstanceIcon
      driverKind={account.driverKind}
      displayName={account.displayName}
      accentColor={account.accentColor}
      showBadge={showBadge}
      className="size-4"
      iconClassName="size-4"
      badgeClassName="right-[-0.125rem] bottom-[-0.125rem] h-3 min-w-3 px-0.5 text-5xs"
    />
  );
  const triggerContent = (
    <>
      {accountIcon(activeEntry, true)}
      <span className="min-w-0 truncate">{triggerLabel}</span>
    </>
  );

  if (props.accounts.length < 2) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              aria-label={`Account: ${triggerLabel}, locked for this thread`}
              data-account-locked="true"
              data-chat-provider-account-picker="true"
              tabIndex={-1}
              className={cn(FOOTER_TRIGGER, "cursor-default select-none")}
            />
          }
        >
          {triggerContent}
        </TooltipTrigger>
        <TooltipPopup side="top">{`Account: ${triggerLabel} (locked for this thread)`}</TooltipPopup>
      </Tooltip>
    );
  }

  return (
    <Menu>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={
                <button
                  type="button"
                  aria-label={`Account: ${triggerLabel}`}
                  data-chat-provider-account-picker="true"
                  disabled={props.disabled}
                  className={cn(
                    FOOTER_TRIGGER,
                    "cursor-pointer hover:bg-foreground/[0.09] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:pointer-events-none disabled:opacity-64 data-popup-open:bg-foreground/[0.09] data-popup-open:text-foreground",
                  )}
                />
              }
            />
          }
        >
          {triggerContent}
          <ChevronUpIcon aria-hidden="true" className="size-3 shrink-0" />
        </TooltipTrigger>
        <TooltipPopup side="top">
          {forksToOtherAccounts
            ? `Account: ${triggerLabel}. Another account opens in a new tab.`
            : `Account: ${triggerLabel}`}
        </TooltipPopup>
      </Tooltip>
      <MenuPopup side="top" align="start" {...composerFloatingLayerProps}>
        {props.accounts.map((account) => {
          const isSelected = account.instanceId === activeEntry.instanceId;
          const forks = !isSelected && props.requiresFork?.(account.instanceId) === true;
          return (
            <MenuItem
              key={account.instanceId}
              onClick={() => {
                if (props.disabled || isSelected) return;
                props.onAccountChange(account.instanceId);
              }}
            >
              {accountIcon(account, shouldShowInstanceBadge(account, props.accounts))}
              <span className="min-w-0 flex-1 truncate">{account.displayName}</span>
              {isSelected ? <CheckIcon className="size-3.5 shrink-0" aria-hidden="true" /> : null}
              {forks ? (
                <span className="flex shrink-0 items-center gap-1 text-muted-foreground text-xs">
                  <GitForkIcon className="size-3" aria-hidden="true" />
                  New tab
                </span>
              ) : null}
            </MenuItem>
          );
        })}
      </MenuPopup>
    </Menu>
  );
});
