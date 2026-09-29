import type { ScopedThreadRef } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { type MouseEvent, useCallback } from "react";

import { recordVisitForThread } from "~/browserHistoryStore";
import { toastManager } from "~/components/ui/toast";
import { useClientSettings } from "~/hooks/useSettings";
import { readLocalApi } from "~/localApi";
import { previewEnvironment } from "~/state/preview";
import { useAtomCommand } from "~/state/use-atom-command";

import {
  canOpenLinksInApp,
  resolveBrowserLinkTargetPreference,
  resolveLinkTarget,
} from "./browserLinkTarget";
import { BrowserSettingsReadError, openUrlInPreview } from "./openFileInPreview";

const NO_MODIFIER = { metaKey: false, ctrlKey: false } as const;

/**
 * Opens a URL where the "Open links in" setting says, for buttons that sit
 * beside a thread but are not markdown anchors: CI check details, a pull
 * request that has no project to open in the panel. Without a thread there is
 * nowhere to put an in-app tab, so the link goes to the system browser.
 *
 * An in-app open that fails falls back to the system browser rather than
 * dropping the click: the user asked for the link, and the setting only says
 * where it should go first. Failed settings reads reject without opening a
 * browser. The promise also rejects if the system-browser fallback fails.
 */
export function useOpenLink(threadRef: ScopedThreadRef | null | undefined): (
  url: string,
  options?: {
    readonly event?: { readonly metaKey: boolean; readonly ctrlKey: boolean };
    /** Thread to open beside when it is not the hook's own, e.g. a sidebar row's. */
    readonly threadRef?: ScopedThreadRef | undefined;
  },
) => Promise<void> {
  const openPreview = useAtomCommand(previewEnvironment.open, { reportFailure: false });
  return useCallback(
    async (url, options = {}) => {
      const targetThreadRef = options.threadRef ?? threadRef;
      const target = resolveLinkTarget({
        url,
        event: options.event ?? NO_MODIFIER,
        preference: await resolveBrowserLinkTargetPreference(),
        canOpenInApp: canOpenLinksInApp(Boolean(targetThreadRef)),
      });
      if (target === "app" && targetThreadRef) {
        const result = await openUrlInPreview({ threadRef: targetThreadRef, url, openPreview });
        if (isAtomCommandInterrupted(result)) return;
        if (result._tag === "Success") {
          recordVisitForThread(targetThreadRef, url);
          return;
        }
        const failure = squashAtomCommandFailure(result);
        if (failure instanceof BrowserSettingsReadError) throw failure;
        console.error(result.cause);
      }
      const api = readLocalApi();
      if (!api) throw new Error("Link opening is unavailable.");
      await api.shell.openExternal(url);
    },
    [openPreview, threadRef],
  );
}

/**
 * A click handler for host links that follows "Open links in", for anchors and buttons alike.
 * A real `_blank` anchor keeps its default whenever the link goes to the system browser — the
 * desktop shell turns it into openExternal, and a browser tab has no shell to call — so only an
 * in-app open is intercepted. An element without an href is opened through `useOpenLink`.
 */
export function useLinkClickHandler(
  threadRef: ScopedThreadRef | null | undefined,
): (event: MouseEvent<HTMLElement>, url: string) => void {
  const preference = useClientSettings((settings) => settings.browserLinkTarget);
  const openLink = useOpenLink(threadRef);
  return useCallback(
    (event, url) => {
      if (event.defaultPrevented) return;
      const target = resolveLinkTarget({
        url,
        event,
        preference,
        canOpenInApp: canOpenLinksInApp(Boolean(threadRef)),
      });
      const isAnchor =
        event.currentTarget instanceof HTMLAnchorElement && event.currentTarget.href.length > 0;
      if (target === "system" && isAnchor) return;
      event.preventDefault();
      event.stopPropagation();
      void openLink(url, { event }).catch((error: unknown) => {
        console.error(error);
        toastManager.add({ type: "error", title: "Unable to open link" });
      });
    },
    [openLink, preference, threadRef],
  );
}
