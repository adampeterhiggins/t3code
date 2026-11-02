import type { ScopedThreadRef } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { Schema } from "effect";
import { AppWindowIcon, PanelBottomCloseIcon, PanelBottomOpenIcon, XIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { DraftHeroHeadline } from "../chat/DraftHeroHeadline";
import { useLocalStorage, writeLocalStorageValue } from "../../hooks/useLocalStorage";
import { shortcutLabelForCommand } from "../../keybindings";
import { primaryServerKeybindingsAtom } from "../../state/server";
import {
  dismissDetachedChat,
  startDetachedFreshComposer,
} from "../quickMessage/detachedChatPresentation";
import { isDetachedChatWindow } from "../quickMessage/quickMessageWindow";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { handoffIsolatedFloatingLocation, openExpandedThreadInMain } from "./openMainThread";

export function DetachedChatHeaderActions(props: { readonly threadRef: ScopedThreadRef | null }) {
  if (!isDetachedChatWindow) return null;
  const { threadRef } = props;
  return (
    <div className="ml-auto flex shrink-0 items-center gap-1">
      {threadRef ? (
        <DetachedHeaderIconButton
          label="Open in main window"
          onClick={() => {
            void openExpandedThreadInMain(threadRef, {
              open: (request) => window.desktopBridge?.openMainDestination?.(request),
            }).then((result) => {
              // The thread now lives in the main window; the shortcut should bring back a new draft.
              if (result !== null && result.status !== "failed") void startDetachedFreshComposer();
            });
          }}
        >
          <AppWindowIcon />
        </DetachedHeaderIconButton>
      ) : null}
      <DetachedHeaderIconButton label="Hide" onClick={dismissDetachedChat}>
        <XIcon />
      </DetachedHeaderIconButton>
    </div>
  );
}

function DetachedHeaderIconButton(props: {
  readonly label: string;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label={props.label} onClick={props.onClick} />
        }
      >
        {props.children}
      </TooltipTrigger>
      <TooltipPopup side="bottom">{props.label}</TooltipPopup>
    </Tooltip>
  );
}

/** The floating window has no command palette, so adding a project continues in the main window. */
function DetachedComposerProject(
  props: Omit<ComponentProps<typeof DraftHeroHeadline>, "compact" | "onAddProject">,
) {
  return (
    <DraftHeroHeadline
      {...props}
      compact
      onAddProject={() => handoffIsolatedFloatingLocation("/settings/projects")}
    />
  );
}

// Local to the floating window: its client settings are read-only there.
const WORKSPACE_BAR_VISIBLE_KEY = "t3code:quick-message-workspace-bar-visible";

/** Whether the floating composer shows its workspace bar (worktree, branch, access). */
export function useQuickMessageWorkspaceBarVisible(): boolean {
  return useLocalStorage(WORKSPACE_BAR_VISIBLE_KEY, false, Schema.Boolean)[0];
}

export function toggleQuickMessageWorkspaceBar(): void {
  writeLocalStorageValue(WORKSPACE_BAR_VISIBLE_KEY, (visible) => !visible, false, Schema.Boolean);
}

function WorkspaceBarToggle() {
  const visible = useQuickMessageWorkspaceBarVisible();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const shortcut = shortcutLabelForCommand(keybindings, "quickMessage.toggleWorkspaceBar", {
    context: { terminalFocus: false, terminalOpen: false, modelPickerOpen: false },
  });
  const label = visible ? "Hide workspace bar" : "Show workspace bar";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            aria-pressed={visible}
            onClick={toggleQuickMessageWorkspaceBar}
          />
        }
      >
        {visible ? <PanelBottomCloseIcon /> : <PanelBottomOpenIcon />}
      </TooltipTrigger>
      <TooltipPopup>
        {label}
        {shortcut ? ` (${shortcut})` : null}
      </TooltipPopup>
    </Tooltip>
  );
}

/** The floating composer's workspace bar toggle, and the compact one's project picker, in ChatComposer's slots. */
export function floatingComposerSlots(
  surface: { readonly workspace: boolean; readonly compact: boolean },
  input: ComponentProps<typeof DetachedComposerProject>,
): { headerLeading?: ReactNode; footerLeading?: ReactNode } {
  if (surface.workspace) return {};
  return {
    ...(surface.compact
      ? {
          headerLeading: (
            <DetachedComposerProject
              draftId={input.draftId}
              activeProjectRef={input.activeProjectRef}
              activeProjectTitle={input.activeProjectTitle}
            />
          ),
        }
      : {}),
    footerLeading: <WorkspaceBarToggle />,
  };
}
