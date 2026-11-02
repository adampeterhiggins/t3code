import type { RuntimeMode, ScopedThreadRef } from "@t3tools/contracts";
import type { ComponentProps } from "react";

import { DraftHeroHeadline } from "../chat/DraftHeroHeadline";
import { resolveCompatibleRuntimeMode } from "../chat/runtimeModeConfig";
import { ComposerContextPermissions } from "../ComposerContextPermissions";
import { dismissDetachedChat } from "../quickMessage/detachedChatPresentation";
import { isDetachedChatWindow } from "../quickMessage/quickMessageWindow";
import { Button } from "../ui/button";
import { handoffIsolatedFloatingLocation, openExpandedThreadInMain } from "./openMainThread";

export function DetachedChatHeaderActions(props: { readonly threadRef: ScopedThreadRef | null }) {
  if (!isDetachedChatWindow) return null;
  const { threadRef } = props;
  return (
    <div className="ml-auto flex shrink-0 items-center gap-2">
      {threadRef ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            void openExpandedThreadInMain(threadRef, {
              open: (request) => window.desktopBridge?.openMainDestination?.(request),
            });
          }}
        >
          Open in main
        </Button>
      ) : null}
      <Button variant="ghost" size="sm" onClick={dismissDetachedChat}>
        Hide
      </Button>
    </div>
  );
}

/** The floating window has no command palette, so adding a project continues in the main window. */
export function DetachedComposerProject(
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

export function DetachedComposerAccess(props: {
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
