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
 * Draft writers run only in a quick-message window built with an isolated session.
 * The legacy panel shares the main profile, and loading a thread URL there does
 * not change that. Shells that omit the getter stay on the shared profile.
 * The hash is not consulted: navigation and reload cannot grant or revoke it.
 */
export function isDetachedChatWindowRole(
  getWindowRole: (() => DesktopWindowRole) | undefined,
  isQuickMessageSessionIsolated: (() => boolean) | undefined,
): boolean {
  if (typeof getWindowRole !== "function" || getWindowRole() !== "quick-message") {
    return false;
  }
  return (
    typeof isQuickMessageSessionIsolated === "function" && isQuickMessageSessionIsolated() === true
  );
}

export const isQuickMessageWindow =
  isElectron &&
  typeof window !== "undefined" &&
  isQuickMessageWindowRole(window.desktopBridge?.getWindowRole, window.location.hash);

export const isDetachedChatWindow =
  isElectron &&
  typeof window !== "undefined" &&
  isDetachedChatWindowRole(
    window.desktopBridge?.getWindowRole,
    window.desktopBridge?.isQuickMessageSessionIsolated,
  );
