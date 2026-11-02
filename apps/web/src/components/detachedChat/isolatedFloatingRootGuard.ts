import { notFound } from "@tanstack/react-router";
import {
  classifyDesktopMainDestinationPath,
  desktopMainDestinationCarriesSeed,
  joinDesktopMainDestinationHref,
  parseDesktopMainDestinationHref,
} from "@t3tools/contracts";

import { scheduledTaskSeedWouldBeDropped } from "./floatingNavigation";

/**
 * Root beforeLoad, before pair and auth. Child redirects pass ignoreBlocker,
 * and `/pair` renders before the shell mounts, so the guard cannot live there.
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
