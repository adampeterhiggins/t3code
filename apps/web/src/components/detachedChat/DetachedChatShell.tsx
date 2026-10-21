import { Outlet } from "@tanstack/react-router";
import { type CSSProperties, type ReactNode, useLayoutEffect } from "react";

import { useTheme } from "../../hooks/useTheme";
import { adoptClientSettings } from "../../hooks/useSettings";
import {
  PanelAnimationSuppressionProvider,
  usePanelAnimationSettings,
} from "../../panelAnimations";
import { ComposerSurface } from "../chat/ComposerSurface";
import { ChatDialogHosts } from "../chat/ChatDialogHosts";
import {
  compactBackdropShouldDismiss,
  DETACHED_CHAT_CONTENT_MAX_WIDTH,
  dismissDetachedChat,
  focusDetachedComposerInput,
  handleDetachedChatShow,
  adoptDetachedChatPresentation,
  useDetachedChatPresentation,
} from "../quickMessage/detachedChatPresentation";
import { isDetachedChatWindow } from "../quickMessage/quickMessageWindow";
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
  const presentation = useDetachedChatPresentation() ?? "compact";
  useLayoutEffect(() => {
    if (!isDetachedChatWindow) return;
    document.documentElement.dataset.detachedChat = presentation;
  }, [presentation]);
  useLayoutEffect(() => {
    if (!isDetachedChatWindow) return;
    return () => {
      delete document.documentElement.dataset.detachedChat;
    };
  }, []);
  useLayoutEffect(() => {
    if (!isDetachedChatWindow) return;
    const bridge = window.desktopBridge?.quickMessage;
    if (!bridge) return;
    const unsubscribe = bridge.onShow((event) => {
      handleDetachedChatShow(event, {
        adoptSettings: adoptClientSettings,
        adoptPresentation: adoptDetachedChatPresentation,
        focusInput: () => {
          focusDetachedComposerInput(document);
        },
      });
    });
    void bridge.setPanelReady().catch(() => undefined);
    return unsubscribe;
  }, []);
  const frame =
    presentation === "compact" ? (
      <div
        className="flex h-full w-full items-start justify-center bg-transparent px-6 pt-6"
        onPointerDown={(event) => {
          if (compactBackdropShouldDismiss(event)) dismissDetachedChat();
        }}
      >
        <div className="w-full max-w-(--chat-content-max-width)">{props.children}</div>
      </div>
    ) : (
      <div className="flex h-full min-h-0 w-full flex-col bg-background">{props.children}</div>
    );
  return (
    <SidebarProvider
      className="h-dvh! min-h-0!"
      data-panel-animations={active ? "true" : "false"}
      defaultOpen
      style={
        {
          "--panel-animation-duration": `${durationMs}ms`,
          "--chat-content-max-width": DETACHED_CHAT_CONTENT_MAX_WIDTH,
        } as CSSProperties
      }
    >
      {frame}
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
