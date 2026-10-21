import type { DesktopWindowRole } from "@t3tools/contracts";

/**
 * Electron appends each additionalArgument to the renderer argv for the life of
 * that BrowserWindow, including reloads. Only the quick-message window receives
 * this marker; every other window stays main.
 */
export const QUICK_MESSAGE_WINDOW_ROLE_ARGUMENT = "--t3code-window-role=quick-message";

/**
 * Present only on a quick-message window whose session is a separate partition.
 * The legacy panel does not receive it, so a thread URL there still shares the
 * main profile. Electron keeps the argument across reloads.
 */
export const QUICK_MESSAGE_SESSION_ISOLATED_ARGUMENT = "--t3code-quick-message-isolated";

// Electron supplies renderer argv. A missing list is still the main window, so
// bridge setup finishes when a host stub omits argv.
export function parseDesktopWindowRole(argv?: readonly string[]): DesktopWindowRole {
  return argv?.includes(QUICK_MESSAGE_WINDOW_ROLE_ARGUMENT) ? "quick-message" : "main";
}

// The role marker alone is the legacy shared panel. The isolation marker on
// any other window is ignored, and a missing argv list is too.
export function parseQuickMessageSessionIsolated(argv?: readonly string[]): boolean {
  return (
    parseDesktopWindowRole(argv) === "quick-message" &&
    argv?.includes(QUICK_MESSAGE_SESSION_ISOLATED_ARGUMENT) === true
  );
}

/**
 * The quick-message window shares the main profile's storage. It must not take
 * the one-time legacy import, or the main window loses it.
 */
export function consumesLegacyLocalStorage(role: DesktopWindowRole): boolean {
  return role !== "quick-message";
}
