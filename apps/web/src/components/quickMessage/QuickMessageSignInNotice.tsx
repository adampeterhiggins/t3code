import type { PointerEvent, ReactNode } from "react";

import { useTheme } from "~/hooks/useTheme";

import { ComposerSurface } from "../chat/ComposerSurface";

/** Dismisses when the click lands on the transparent window around the notice. */
function dismissOnBackdrop(event: PointerEvent<HTMLElement>) {
  if (event.target === event.currentTarget) void window.desktopBridge?.quickMessage?.dismiss();
}

function QuickMessageNoticeFrame({ children }: { readonly children: ReactNode }) {
  useTheme();
  return (
    <div
      className="flex h-full w-full items-start justify-center px-6 pt-6"
      onPointerDown={dismissOnBackdrop}
    >
      {children}
    </div>
  );
}

function QuickMessageNotice(props: { readonly children: string }) {
  return (
    <QuickMessageNoticeFrame>
      <ComposerSurface.Shell>
        <ComposerSurface.Host>
          <ComposerSurface.Main>
            <p className="px-4 py-4 text-muted-foreground text-sm">{props.children}</p>
          </ComposerSurface.Main>
        </ComposerSurface.Host>
      </ComposerSurface.Shell>
    </QuickMessageNoticeFrame>
  );
}

export function QuickMessageSignInNotice() {
  return (
    <QuickMessageNotice>Open T3 Code to finish signing in, then try again.</QuickMessageNotice>
  );
}

/**
 * A quick-message window without an isolated session cannot mount the composer.
 * The root guard leaves it on `/quick-message`, which only shows this notice.
 */
export function LegacyQuickMessageUnavailableNotice() {
  return (
    <QuickMessageNotice>
      This quick message window is no longer available. Reopen T3 Code and press the shortcut again.
    </QuickMessageNotice>
  );
}
