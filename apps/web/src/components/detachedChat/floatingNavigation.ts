import {
  classifyDesktopMainDestinationPath,
  desktopMainDestinationHrefCarriesSeed,
  desktopMainDestinationThreadEnvironmentId,
  joinDesktopMainDestinationHref,
  parseDesktopMainDestinationHref,
  type DesktopMainDestinationHrefParts,
} from "@t3tools/contracts";

export type FloatingNavigationDecision =
  | { readonly action: "allow" }
  | { readonly action: "wait" }
  | { readonly action: "handoff"; readonly href: string }
  | { readonly action: "reject" }
  | { readonly action: "fail" };

export function scheduledTaskSeedWouldBeDropped(
  href: string,
  pendingAutomationSeed: boolean,
): boolean {
  if (!pendingAutomationSeed) return false;
  const parsed = parseDesktopMainDestinationHref(href);
  if (parsed === null || parsed.pathname !== "/settings/scheduled-tasks") return false;
  const taskId = new URLSearchParams(parsed.search).get("taskId");
  return taskId === null || taskId.trim().length === 0;
}

function hrefFromParts(pathname: string, search = "", hash = ""): string {
  const parsed = parseDesktopMainDestinationHref(`${pathname}${search}${hash}`);
  return parsed === null ? `${pathname}${search}${hash}` : joinDesktopMainDestinationHref(parsed);
}

export function classifyFloatingDestination(input: {
  readonly pathname: string;
  readonly search?: string;
  readonly hash?: string;
  readonly primaryEnvironmentId: string | null;
  readonly pendingAutomationSeed: boolean;
}): FloatingNavigationDecision {
  const href = hrefFromParts(input.pathname, input.search ?? "", input.hash ?? "");
  const parsed = parseDesktopMainDestinationHref(href);
  if (
    scheduledTaskSeedWouldBeDropped(href, input.pendingAutomationSeed) ||
    desktopMainDestinationHrefCarriesSeed(href)
  ) {
    return { action: "fail" };
  }
  if (parsed === null) return { action: "reject" };
  const kind = classifyDesktopMainDestinationPath(parsed.pathname);
  if (kind === "unknown") return { action: "reject" };
  if (kind === "app") return { action: "handoff", href };
  const environmentId = desktopMainDestinationThreadEnvironmentId(parsed.pathname);
  if (environmentId === null) return { action: "allow" };
  if (input.primaryEnvironmentId === null) return { action: "wait" };
  if (environmentId !== input.primaryEnvironmentId) return { action: "handoff", href };
  return { action: "allow" };
}

export interface FloatingNavigationBlocker {
  blockerFn: (args: {
    readonly nextLocation: DesktopMainDestinationHrefParts & { readonly href?: string };
  }) => boolean | Promise<boolean>;
  enableBeforeUnload?: boolean;
}

/**
 * History blockers run only when `document` exists, and a blocked `history.push`
 * never commits, so TanStack's navigate promise stays pending. Callers must not
 * await a navigation this blocker rejects. Draft and local-primary thread
 * navigations are allowed, so the shared actions that await those still settle.
 */
export function installFloatingNavigationBlocker(
  history: { block: (blocker: FloatingNavigationBlocker) => () => void },
  read: () => {
    readonly primaryEnvironmentId: string | null;
    readonly pendingAutomationSeed: boolean;
  },
  effects: {
    readonly handoff: (href: string) => void;
    readonly onFail: () => void;
    readonly onDecision?: (decision: FloatingNavigationDecision) => void;
  },
): () => void {
  return history.block({
    enableBeforeUnload: false,
    blockerFn: ({ nextLocation }) => {
      const decision = classifyFloatingDestination({
        pathname: nextLocation.pathname,
        search: nextLocation.search,
        hash: nextLocation.hash,
        ...read(),
      });
      effects.onDecision?.(decision);
      if (decision.action === "allow" || decision.action === "wait") return false;
      if (decision.action === "handoff") effects.handoff(decision.href);
      if (decision.action === "fail") effects.onFail();
      return true;
    },
  });
}
