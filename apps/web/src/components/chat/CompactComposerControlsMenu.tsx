import { ProviderInteractionMode, RuntimeMode, type ProviderInstanceId } from "@t3tools/contracts";
import { memo, type ReactNode, useRef } from "react";
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
import { focusRequestedPermission, useComposerMenuProps } from "./composerEventScope";
import { useComposerMenuState } from "./useComposerMenuState";
import { ComposerPermissionsSection, type RuntimeModeOption } from "./ComposerFooterControls";
import type { ProviderInstanceEntry } from "../../providerInstances";

export const CompactComposerControlsMenu = memo(function CompactComposerControlsMenu(props: {
  traitsMenuContent?: ReactNode;
  interactionMode: ProviderInteractionMode;
  runtimeMode: RuntimeMode;
  runtimeModeOptions: ReadonlyArray<RuntimeModeOption>;
  showInteractionModeToggle: boolean;
  showPermissions?: boolean;
  accountMenu?: {
    activeInstanceId: ProviderInstanceId;
    accounts: ReadonlyArray<ProviderInstanceEntry>;
    onAccountChange: (instanceId: ProviderInstanceId) => void;
    /** See `ProviderAccountPicker`. */
    requiresFork?: (instanceId: ProviderInstanceId) => boolean;
  };
  size?: "sm" | "xs";
  /** Close the portaled popup when its trigger hides. */
  hidden?: boolean;
  onToggleInteractionMode: () => void;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
}) {
  const composerFloatingLayerProps = useComposerMenuProps();
  const size = props.size ?? "sm";
  const [open, setOpen] = useComposerMenuState(props.hidden);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const accountMenu = props.accountMenu;
  const lockedAccount =
    accountMenu !== undefined && accountMenu.accounts.length < 2
      ? (accountMenu.accounts.find(
          (account) => account.instanceId === accountMenu.activeInstanceId,
        ) ?? accountMenu.accounts[0])
      : undefined;
  const showAccountSection =
    accountMenu !== undefined && (accountMenu.accounts.length > 1 || lockedAccount !== undefined);
  const showPermissions = props.showPermissions !== false;

  return (
    <Menu
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(isOpen) => focusRequestedPermission(isOpen, triggerRef.current)}
    >
      <MenuTrigger
        render={
          <ComposerControl
            ref={triggerRef}
            size={size}
            className="shrink-0"
            aria-label="More composer controls"
            data-composer-shortcut={
              [
                showPermissions ? "composer.mode" : null,
                props.traitsMenuContent ? "composer.effort" : null,
              ]
                .filter(Boolean)
                .join(" ") || undefined
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
            {props.showInteractionModeToggle || showPermissions ? <MenuDivider /> : null}
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
            {showPermissions ? <MenuDivider /> : null}
          </>
        ) : null}
        {showPermissions ? (
          <ComposerPermissionsSection
            runtimeMode={props.runtimeMode}
            runtimeModeOptions={props.runtimeModeOptions}
            onRuntimeModeChange={props.onRuntimeModeChange}
          />
        ) : null}
        {showAccountSection &&
        (props.traitsMenuContent || props.showInteractionModeToggle || showPermissions) ? (
          <MenuDivider />
        ) : null}
        {accountMenu && accountMenu.accounts.length > 1 ? (
          <>
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
