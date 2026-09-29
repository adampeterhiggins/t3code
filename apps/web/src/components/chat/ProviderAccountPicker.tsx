import { type ProviderInstanceId } from "@t3tools/contracts";
import { memo } from "react";
import { CheckIcon } from "lucide-react";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  ComposerControl,
  ComposerControlChevron,
  type ComposerControlSize,
} from "./ComposerControl";
import { useComposerMenuProps } from "./composerEventScope";
import { useComposerMenuState } from "./useComposerMenuState";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";
import { shouldShowInstanceBadge, type ProviderInstanceEntry } from "../../providerInstances";
import { cn } from "~/lib/utils";

/**
 * Composer control for switching accounts of the active provider.
 * Rendered when that provider has more than one enabled account. With fewer
 * than two switchable `accounts` (a thread locked to one account's home) it
 * becomes a plain label — icon and name, no control chrome — so the thread
 * still shows which account it runs on.
 */
export const ProviderAccountPicker = memo(function ProviderAccountPicker(props: {
  activeInstanceId: ProviderInstanceId;
  accounts: ReadonlyArray<ProviderInstanceEntry>;
  onAccountChange: (instanceId: ProviderInstanceId) => void;
  size?: ComposerControlSize;
  isComposerOwned?: boolean;
  disabled?: boolean;
  hidden?: boolean;
  triggerClassName?: string;
}) {
  const composerFloatingLayerProps = useComposerMenuProps();
  const [isMenuOpen, setIsMenuOpen] = useComposerMenuState(props.hidden);
  const size = props.size ?? "sm";
  const activeEntry =
    props.accounts.find((entry) => entry.instanceId === props.activeInstanceId) ??
    props.accounts[0];
  if (!activeEntry) {
    return null;
  }

  const triggerLabel = activeEntry.displayName;
  const triggerContent = (
    <span className={cn("flex min-w-0 w-full items-center", size === "xs" ? "gap-1" : "gap-1.5")}>
      <ProviderInstanceIcon
        driverKind={activeEntry.driverKind}
        displayName={activeEntry.displayName}
        accentColor={activeEntry.accentColor}
        showBadge
        className="size-4"
        iconClassName="size-4"
        badgeClassName={cn(
          "right-[-0.125rem] bottom-[-0.125rem] h-3 min-w-3 px-0.5 text-5xs",
          size === "xs" && "shadow-none",
        )}
      />
      <span data-composer-control-label className="min-w-0 truncate">
        {triggerLabel}
      </span>
      {props.accounts.length > 1 ? <ComposerControlChevron size={size} /> : null}
    </span>
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
              className={cn(
                "inline-flex min-w-0 max-w-40 shrink cursor-default items-center justify-start px-1 text-left font-normal select-none",
                size === "xs"
                  ? "gap-1 text-muted-foreground/70 text-sm sm:text-xs"
                  : "gap-1.5 text-secondary-label sm:text-sm",
                props.triggerClassName,
              )}
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
    <Menu
      open={isMenuOpen}
      onOpenChange={(open) => {
        if (props.disabled) {
          setIsMenuOpen(false);
          return;
        }
        setIsMenuOpen(open);
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={
                <ComposerControl
                  aria-label={`Account: ${triggerLabel}`}
                  data-chat-provider-account-picker="true"
                  size={size}
                  disabled={props.disabled}
                  className={cn("min-w-0 max-w-40 shrink justify-start", props.triggerClassName)}
                />
              }
            />
          }
        >
          {triggerContent}
        </TooltipTrigger>
        <TooltipPopup side="top">{`Account: ${triggerLabel}`}</TooltipPopup>
      </Tooltip>
      <MenuPopup align="start" {...(props.isComposerOwned ? composerFloatingLayerProps : {})}>
        {props.accounts.map((account) => {
          const isSelected = account.instanceId === activeEntry.instanceId;
          return (
            <MenuItem
              key={account.instanceId}
              onClick={() => {
                if (props.disabled || account.instanceId === activeEntry.instanceId) return;
                props.onAccountChange(account.instanceId);
                setIsMenuOpen(false);
              }}
            >
              <ProviderInstanceIcon
                driverKind={account.driverKind}
                displayName={account.displayName}
                accentColor={account.accentColor}
                showBadge={shouldShowInstanceBadge(account, props.accounts)}
                className="size-4"
                iconClassName="size-4"
                badgeClassName="right-[-0.125rem] bottom-[-0.125rem] h-3 min-w-3 px-0.5 text-5xs"
              />
              <span className="min-w-0 flex-1 truncate">{account.displayName}</span>
              {isSelected ? <CheckIcon className="size-3.5 shrink-0" aria-hidden="true" /> : null}
            </MenuItem>
          );
        })}
      </MenuPopup>
    </Menu>
  );
});
