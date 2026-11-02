import type { RuntimeMode, ScopedThreadRef } from "@t3tools/contracts";
import { AppWindowIcon, XIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { DraftHeroHeadline } from "../chat/DraftHeroHeadline";
import { resolveCompatibleRuntimeMode } from "../chat/runtimeModeConfig";
import { ComposerContextPermissions } from "../ComposerContextPermissions";
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

function DetachedComposerAccess(props: {
  readonly runtimeMode: RuntimeMode;
  readonly supportedRuntimeModes: ReadonlyArray<RuntimeMode> | undefined;
  readonly onOpen: () => void;
}) {
  return (
    <ComposerContextPermissions
      runtimeMode={
        resolveCompatibleRuntimeMode(props.runtimeMode, props.supportedRuntimeModes).mode
      }
      onOpen={props.onOpen}
    />
  );
}

/** The floating composer's access control, and the compact one's project picker, in ChatComposer's slots. */
export function floatingComposerSlots(
  surface: { readonly workspace: boolean; readonly compact: boolean },
  input: ComponentProps<typeof DetachedComposerProject> & {
    readonly runtimeMode: RuntimeMode;
    readonly supportedRuntimeModes: ReadonlyArray<RuntimeMode> | undefined;
    readonly onOpenPermissions: () => void;
  },
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
    footerLeading: (
      <DetachedComposerAccess
        runtimeMode={input.runtimeMode}
        supportedRuntimeModes={input.supportedRuntimeModes}
        onOpen={input.onOpenPermissions}
      />
    ),
  };
}
