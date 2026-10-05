import { ProviderInteractionMode, RuntimeMode, type ProviderInstanceId } from "@t3tools/contracts";
import { memo, type ReactNode } from "react";
import { EllipsisIcon, GitForkIcon } from "lucide-react";
import {
  Menu,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator as MenuDivider,
  MenuTrigger,
} from "../ui/menu";
import { ComposerControl, ComposerControlIcon } from "./ComposerControl";
import { useComposerMenuProps } from "./composerEventScope";
import { useComposerMenuState } from "./useComposerMenuState";
import type { ProviderInstanceEntry } from "../../providerInstances";

export const CompactComposerControlsMenu = memo(function CompactComposerControlsMenu(props: {
  interactionMode: ProviderInteractionMode;
  runtimeMode: RuntimeMode;
  runtimeModeOptions: ReadonlyArray<{
    readonly mode: RuntimeMode;
    readonly label: string;
  }>;
  showInteractionModeToggle: boolean;
  traitsMenuContent?: ReactNode;
  accountMenu?: {
    activeInstanceId: ProviderInstanceId;
    accounts: ReadonlyArray<ProviderInstanceEntry>;
    onAccountChange: (instanceId: ProviderInstanceId) => void;
    /** See `ProviderAccountPicker`. */
    requiresFork?: (instanceId: ProviderInstanceId) => boolean;
  };
  size?: "sm" | "xs";
  /**
   * The resting strip keeps this menu mounted out of flow while every block
   * fits inline. Its portaled popup would outlive that transition, so an
   * open menu closes when its trigger hides.
   */
  hidden?: boolean;
  onToggleInteractionMode: () => void;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
}) {
  const composerFloatingLayerProps = useComposerMenuProps();
  const size = props.size ?? "sm";
  const [open, setOpen] = useComposerMenuState(props.hidden);
  const accountMenu = props.accountMenu;
  const lockedAccount =
    accountMenu !== undefined && accountMenu.accounts.length < 2
      ? (accountMenu.accounts.find(
          (account) => account.instanceId === accountMenu.activeInstanceId,
        ) ?? accountMenu.accounts[0])
      : undefined;

  return (
    <Menu open={open} onOpenChange={setOpen}>
      <MenuTrigger
        render={
          <ComposerControl
            size={size}
            className="shrink-0"
            aria-label="More composer controls"
            data-composer-shortcut={
              props.traitsMenuContent ? "composer.mode composer.effort" : "composer.mode"
            }
          />
        }
      >
        <ComposerControlIcon icon={EllipsisIcon} size={size} />
      </MenuTrigger>
      <MenuPopup align="start" {...composerFloatingLayerProps}>
        {props.traitsMenuContent ? (
          <>
            {props.traitsMenuContent}
            <MenuDivider />
          </>
        ) : null}
        {props.showInteractionModeToggle ? (
          <>
            <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">Mode</div>
            <MenuRadioGroup
              value={props.interactionMode}
              onValueChange={(value) => {
                if (!value || value === props.interactionMode) return;
                props.onToggleInteractionMode();
              }}
            >
              <MenuRadioItem value="default">Chat</MenuRadioItem>
              <MenuRadioItem value="plan">Plan</MenuRadioItem>
            </MenuRadioGroup>
            <MenuDivider />
          </>
        ) : null}
        <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">Access</div>
        <MenuRadioGroup
          value={props.runtimeMode}
          onValueChange={(value) => {
            if (!value || value === props.runtimeMode) return;
            props.onRuntimeModeChange(value as RuntimeMode);
          }}
        >
          {props.runtimeModeOptions.map((option) => (
            <MenuRadioItem key={option.mode} value={option.mode}>
              {option.label}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
        {accountMenu && accountMenu.accounts.length > 1 ? (
          <>
            <MenuDivider />
            <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">Account</div>
            <MenuRadioGroup
              value={accountMenu.activeInstanceId}
              onValueChange={(value) => {
                if (!value || value === accountMenu.activeInstanceId) return;
                accountMenu.onAccountChange(value as ProviderInstanceId);
              }}
            >
              {accountMenu.accounts.map((account) => (
                <MenuRadioItem key={account.instanceId} value={account.instanceId}>
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate">{account.displayName}</span>
                    {account.instanceId !== accountMenu.activeInstanceId &&
                    accountMenu.requiresFork?.(account.instanceId) ? (
                      <span className="flex shrink-0 items-center gap-1 text-muted-foreground text-xs">
                        <GitForkIcon className="size-3" aria-hidden="true" />
                        New tab
                      </span>
                    ) : null}
                  </span>
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </>
        ) : lockedAccount ? (
          <>
            <MenuDivider />
            <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">Account</div>
            <div className="px-2 text-sm">{lockedAccount.displayName}</div>
            <p className="px-2 pt-0.5 pb-1.5 text-muted-foreground text-xs">
              Locked for this thread
            </p>
          </>
        ) : null}
      </MenuPopup>
    </Menu>
  );
});
