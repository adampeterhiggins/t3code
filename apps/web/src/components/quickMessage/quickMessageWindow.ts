import type { DesktopWindowRole } from "@t3tools/contracts";

import { isElectron } from "~/env";

/**
 * Role is fixed at window construction. Shells without getWindowRole still match the
 * quick-message hash. A hash alone is not proof of an isolated session.
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

/** The sidebar group a quick message panel thread started without a project files under. */
export const QUICK_MESSAGE_THREAD_GROUP = "Quick messages";
