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
 * Wraps only the routed children. Root `beforeLoad` still has to refuse a
 * non-chat URL: this wrapper runs too late to stop a child redirect. The
 * readiness frame stays mounted when this guard rejects the destination.
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
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the history blocker reads the latest primary environment and seed without resubscribing
  useLayoutEffect(() => {
    primaryRef.current = primaryEnvironmentId;
    seedRef.current = pendingAutomationSeed;
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- installs the history blocker for this router's lifetime
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
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- asks the main window to open a blocked destination and reports a dropped seed
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
