import { RouterProvider } from "@tanstack/react-router";
import { useEffect } from "react";

import { subscribeComposerDraftModelReconciliation } from "./composerDraftStore";
import { environmentThreadShells } from "./state/threads";
import { environmentShell } from "./state/shell";

import { BrowserProfileReporter } from "./browser/BrowserProfileReporter";
import { ElectronBrowserHost } from "./browser/ElectronBrowserHost";
import { QuitHoldOverlay } from "./components/QuitHoldOverlay";
import {
  isDetachedChatWindow,
  isQuickMessageWindow,
} from "./components/quickMessage/quickMessageWindow";
import { appAtomRegistry, AppAtomRegistryProvider } from "./rpc/atomRegistry";
import type { AppRouter } from "./router";

/**
 * The Electron browser host intentionally sits outside the router so its
 * webviews survive route transitions, but it must share the same atom registry
 * as routed UI.
 */
export function AppRoot({ router }: { readonly router: AppRouter }) {
  // The legacy panel shares the main window's draft storage and would race it.
  // The floating chat has its own partition, so reconciliation is safe there.
  const legacyQuickMessageWindow = isQuickMessageWindow && !isDetachedChatWindow;
  useEffect(
    () =>
      legacyQuickMessageWindow
        ? undefined
        : subscribeComposerDraftModelReconciliation({
            registry: appAtomRegistry,
            threadShellAtom: environmentThreadShells.threadShellAtom,
            threadRefsAtom: environmentThreadShells.threadRefsAtom,
            shellStateAtom: environmentShell.stateAtom,
          }),
    [legacyQuickMessageWindow],
  );
  return (
    <AppAtomRegistryProvider>
      <RouterProvider router={router} />
      {isQuickMessageWindow ? null : (
        <>
          <ElectronBrowserHost />
          <BrowserProfileReporter />
          <QuitHoldOverlay />
        </>
      )}
    </AppAtomRegistryProvider>
  );
}
