import { notFound } from "@tanstack/react-router";
import {
  classifyDesktopMainDestinationPath,
  desktopMainDestinationCarriesSeed,
  joinDesktopMainDestinationHref,
  parseDesktopMainDestinationHref,
} from "@t3tools/contracts";

import { scheduledTaskSeedWouldBeDropped } from "./floatingNavigation";

/**
 * Call from the root route `beforeLoad`, immediately after
 * `redirectLegacyQuickMessageWindow` and before pair, auth, and snapshot
 * resume:
 *
 * ```ts
 * guardIsolatedFloatingWindow({
 *   isDetachedChatWindow,
 *   pathname: location.pathname,
 *   href: location.href,
 *   pendingAutomationSeed: appAtomRegistry.get(pendingScheduledTaskDraftAtom) !== null,
 *   handoff: (href) => {
 *     const open = window.desktopBridge?.openMainDestination;
 *     if (!open) return;
 *     void open({ requestId: crypto.randomUUID(), href });
 *   },
 * });
 * ```
 *
 * The floating shell cannot do this itself. Child `beforeLoad` redirects run
 * first and pass `ignoreBlocker`, and the root view renders `/pair`, `/connect`,
 * and `/connect-agent` before it ever mounts `DetachedChatShell`.
 * `FloatingNavigationGuard` only wraps the shell's routed children, so this
 * call stays in the root route, immediately after the legacy quick-message
 * redirect and before that early return. W3b's presentation nodes stay on the
 * frame, outside the guard.
 */
export function guardIsolatedFloatingWindow(input: {
  readonly isDetachedChatWindow: boolean;
  readonly pathname: string;
  readonly href: string;
  readonly pendingAutomationSeed?: boolean;
  readonly handoff: (href: string) => void;
  readonly onSeedFailure?: () => void;
}): void {
  if (!input.isDetachedChatWindow) return;
  const parsed = parseDesktopMainDestinationHref(input.href);
  const pathname = parsed?.pathname ?? input.pathname;
  const kind = classifyDesktopMainDestinationPath(pathname);
  if (kind === "chat") return;

  const href = parsed === null ? input.href : joinDesktopMainDestinationHref(parsed);
  const dropsSeed =
    desktopMainDestinationCarriesSeed({ href: input.href }) ||
    scheduledTaskSeedWouldBeDropped(href, input.pendingAutomationSeed === true);
  if (dropsSeed) input.onSeedFailure?.();
  else if (kind === "app") input.handoff(href);
  throw notFound();
}
