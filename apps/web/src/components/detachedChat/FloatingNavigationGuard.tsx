import { useLocation, useRouter } from "@tanstack/react-router";
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";

import { usePrimaryEnvironmentId } from "../../state/environments";
import { pendingScheduledTaskDraftAtom } from "../settings/scheduledTaskDraftSeed";
import {
  classifyFloatingDestination,
  installFloatingNavigationBlocker,
} from "./floatingNavigation";
import { openMainLocation, toastAutomationSeedFailure } from "./openMainThread";

/**
 * Wraps only the routed frame inside `DetachedChatShell`. On restack, keep
 * W3b's presentation and readiness nodes outside this wrapper when they must
 * stay mounted for a fail-closed non-chat URL. The root `beforeLoad` line in
 * `guardIsolatedFloatingWindow` is still required; this wrapper runs too late
 * to stop a child redirect.
 */
export function FloatingNavigationGuard(props: { readonly children: ReactNode }) {
  const router = useRouter();
  const pathname = useLocation({ select: (location) => location.pathname });
  const search = useLocation({ select: (location) => location.searchStr });
  const hash = useLocation({ select: (location) => location.hash });
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const pendingAutomationSeed = useAtomValue(pendingScheduledTaskDraftAtom) !== null;
  const decision = classifyFloatingDestination({
    pathname,
    search,
    hash,
    primaryEnvironmentId,
    pendingAutomationSeed,
  });
  const primaryRef = useRef(primaryEnvironmentId);
  const seedRef = useRef(pendingAutomationSeed);
  useLayoutEffect(() => {
    primaryRef.current = primaryEnvironmentId;
    seedRef.current = pendingAutomationSeed;
  });

  useEffect(() => {
    return installFloatingNavigationBlocker(
      router.history,
      () => ({
        primaryEnvironmentId: primaryRef.current,
        pendingAutomationSeed: seedRef.current,
      }),
      {
        handoff: (href) => {
          void openMainLocation(href, {
            open: (request) => window.desktopBridge?.openMainDestination?.(request),
          });
        },
        onFail: toastAutomationSeedFailure,
      },
    );
  }, [router]);

  const handoffHref = decision.action === "handoff" ? decision.href : null;
  const failed = decision.action === "fail";
  useEffect(() => {
    if (handoffHref !== null) {
      void openMainLocation(handoffHref, {
        open: (request) => window.desktopBridge?.openMainDestination?.(request),
      });
    }
    if (failed) toastAutomationSeedFailure();
  }, [failed, handoffHref]);

  if (decision.action !== "allow") return null;
  return props.children;
}
