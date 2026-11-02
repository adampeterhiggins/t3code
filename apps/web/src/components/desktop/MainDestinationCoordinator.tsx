import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";

import { settleMainDestination } from "./mainDestinationNavigation";

/**
 * Mounted in the authenticated main window.
 * The listener is attached before readiness is announced. Cleanup clears
 * readiness for this renderer; a replacement renderer has to announce again.
 * Each request is acknowledged once, after the router has committed.
 */
export function MainDestinationCoordinator() {
  const router = useRouter();

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the main-window destination listener and readiness flag in step with this renderer
  useEffect(() => {
    const bridge = window.desktopBridge;
    const listen = bridge?.onMainDestination;
    const setReady = bridge?.setMainDestinationReceiverReady;
    const complete = bridge?.completeMainDestination;
    if (!listen || !setReady || !complete) return;

    let subscribed = true;
    let chain = Promise.resolve();
    const unsubscribe = listen((request) => {
      chain = chain
        .then(() =>
          settleMainDestination(request, {
            navigate: (options) =>
              router.navigate(options as Parameters<typeof router.navigate>[0]),
            getState: () => router.state,
          }),
        )
        .then((result) => complete(result))
        .then(
          () => undefined,
          () => undefined,
        );
    });
    queueMicrotask(() => {
      if (subscribed) void setReady(true).catch(() => undefined);
    });
    return () => {
      subscribed = false;
      void setReady(false).catch(() => undefined);
      unsubscribe();
    };
  }, [router]);

  return null;
}
