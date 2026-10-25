import { RouterProvider } from "@tanstack/react-router";
import { useEffect } from "react";

import { subscribeComposerDraftModelReconciliation } from "./composerDraftStore";
import { environmentThreadShells } from "./state/threads";
import { environmentShell } from "./state/shell";

import { BrowserProfileReporter } from "./browser/BrowserProfileReporter";
import { ElectronBrowserHost } from "./browser/ElectronBrowserHost";
import { QuitHoldOverlay } from "./components/QuitHoldOverlay";
import { isQuickMessageWindow } from "./components/quickMessage/quickMessageWindow";
import { appAtomRegistry, AppAtomRegistryProvider } from "./rpc/atomRegistry";
import type { AppRouter } from "./router";

// Keep webviews outside the router but inside its atom registry so route changes preserve them.
export function AppRoot({ router }: { readonly router: AppRouter }) {
  useEffect(
    () =>
      isQuickMessageWindow
        ? undefined
        : subscribeComposerDraftModelReconciliation({
            registry: appAtomRegistry,
            threadShellAtom: environmentThreadShells.threadShellAtom,
            threadRefsAtom: environmentThreadShells.threadRefsAtom,
            shellStateAtom: environmentShell.stateAtom,
          }),
    [],
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
