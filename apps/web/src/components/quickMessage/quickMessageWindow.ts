import type { DesktopWindowRole } from "@t3tools/contracts";

import { isElectron } from "~/env";

/**
 * The desktop quick message panel loads this app in its own window. It shares the main window's
 * storage, so it must not run the main window's background work, which writes drafts and
 * settings, or its coordinators, which would act on links and notifications a second time.
 *
 * The role is fixed when the window is created. Shells that predate getWindowRole are still
 * recognized by the quick-message hash.
 */
export function isQuickMessageWindowRole(
  getWindowRole: (() => DesktopWindowRole) | undefined,
  hash: string,
): boolean {
  if (typeof getWindowRole !== "function") {
    return hash.startsWith("#/quick-message");
  }
  return getWindowRole() === "quick-message";
}

export const isQuickMessageWindow =
  isElectron &&
  typeof window !== "undefined" &&
  isQuickMessageWindowRole(window.desktopBridge?.getWindowRole, window.location.hash);
