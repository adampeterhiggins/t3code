import {
  handoffIsolatedFloatingLocation,
  toastAutomationSeedFailure,
} from "../components/detachedChat/openMainThread";
import { guardIsolatedFloatingWindow } from "../components/detachedChat/isolatedFloatingRootGuard";
import { redirectLegacyQuickMessageWindow } from "./legacyQuickMessageRootGuard";

/**
 * Root `beforeLoad`, before pair, auth, and child routes. The legacy redirect
 * still wins for the shared panel. The isolated window then refuses any page
 * that is not chat.
 */
export function guardDesktopRootLocation(input: {
  readonly isQuickMessageWindow: boolean;
  readonly isDetachedChatWindow: boolean;
  readonly pathname: string;
  readonly href: string;
  readonly pendingAutomationSeed: boolean;
}): void {
  redirectLegacyQuickMessageWindow({
    isQuickMessageWindow: input.isQuickMessageWindow,
    isDetachedChatWindow: input.isDetachedChatWindow,
    pathname: input.pathname,
  });
  guardIsolatedFloatingWindow({
    isDetachedChatWindow: input.isDetachedChatWindow,
    pathname: input.pathname,
    href: input.href,
    pendingAutomationSeed: input.pendingAutomationSeed,
    handoff: handoffIsolatedFloatingLocation,
    onSeedFailure: toastAutomationSeedFailure,
  });
}
