import { Outlet } from "@tanstack/react-router";
import { type CSSProperties, type ReactNode } from "react";

import { useTheme } from "../../hooks/useTheme";
import {
  PanelAnimationSuppressionProvider,
  usePanelAnimationSettings,
} from "../../panelAnimations";
import { ComposerSurface } from "../chat/ComposerSurface";
import { ChatDialogHosts } from "../chat/ChatDialogHosts";
import { SidebarProvider } from "../ui/sidebar";
import { AnchoredToastProvider, ToastProvider } from "../ui/toast";

/**
 * The real chat column, without the main window's sidebar or coordinators.
 * Appearance sync stays with the caller so the floating window can skip
 * environment theme adoption.
 */
export function DetachedChatShell(props: { readonly children?: ReactNode }) {
  useTheme();
  return (
    <ToastProvider>
      <AnchoredToastProvider>
        {props.children}
        <PanelAnimationSuppressionProvider value={false}>
          <DetachedChatFrame>
            <ChatDialogHosts />
            <Outlet />
          </DetachedChatFrame>
        </PanelAnimationSuppressionProvider>
      </AnchoredToastProvider>
    </ToastProvider>
  );
}

function DetachedChatFrame(props: { readonly children: ReactNode }) {
  const { active, durationMs } = usePanelAnimationSettings();
  return (
    <SidebarProvider
      className="h-dvh! min-h-0!"
      data-panel-animations={active ? "true" : "false"}
      defaultOpen
      style={{ "--panel-animation-duration": `${durationMs}ms` } as CSSProperties}
    >
      {props.children}
    </SidebarProvider>
  );
}

export function DetachedLocalEnvironmentNotice() {
  useTheme();
  return (
    <div className="flex h-dvh w-full items-start justify-center px-6 pt-6">
      <ComposerSurface.Shell>
        <ComposerSurface.Host>
          <ComposerSurface.Main>
            <p className="px-4 py-4 text-muted-foreground text-sm">
              The local environment is unavailable. Turn it on in T3 Code, then try again.
            </p>
          </ComposerSurface.Main>
        </ComposerSurface.Host>
      </ComposerSurface.Shell>
    </div>
  );
}
