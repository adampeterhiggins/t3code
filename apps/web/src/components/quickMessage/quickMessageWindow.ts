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

/**
 * Temporary split while the desktop app still opens the legacy panel at `#/quick-message`.
 * A floating chat loads a real thread route in the same quick-message role. The hash is the
 * one present at startup: navigation and a reload of that thread must not flip the window
 * back to the legacy panel.
 */
export function isDetachedChatWindowRole(
  getWindowRole: (() => DesktopWindowRole) | undefined,
  initialHash: string,
): boolean {
  return (
    isQuickMessageWindowRole(getWindowRole, initialHash) &&
    !initialHash.startsWith("#/quick-message")
  );
}

export const isQuickMessageWindow =
  isElectron &&
  typeof window !== "undefined" &&
  isQuickMessageWindowRole(window.desktopBridge?.getWindowRole, window.location.hash);

export const isDetachedChatWindow =
  isElectron &&
  typeof window !== "undefined" &&
  isDetachedChatWindowRole(window.desktopBridge?.getWindowRole, window.location.hash);
