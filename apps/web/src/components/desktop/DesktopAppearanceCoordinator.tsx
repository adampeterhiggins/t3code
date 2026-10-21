import { useEffect } from "react";

import { adoptClientSettings } from "~/hooks/useSettings";
import {
  adoptPresentedAppearance,
  readCommittedAppearanceSnapshot,
  subscribeCommittedAppearanceChanges,
} from "~/hooks/useTheme";

import {
  startDesktopAppearanceSession,
  type DesktopAppearanceCoordinatorRole,
} from "./desktopAppearanceSession";

export type { DesktopAppearanceCoordinatorRole };

/**
 * Mount once, with an explicit role. `isQuickMessageWindow` can choose
 * `floating` for the quick-message panel; this base has no getter for any
 * other isolated window, so the component does not decide that for itself.
 * Missing bridge methods leave the local theme engine in place.
 */
export function DesktopAppearanceCoordinator(props: {
  readonly role: DesktopAppearanceCoordinatorRole;
}) {
  const { role } = props;
  useEffect(
    () =>
      startDesktopAppearanceSession({
        role,
        bridge: typeof window === "undefined" ? undefined : window.desktopBridge,
        readCommitted: readCommittedAppearanceSnapshot,
        subscribeCommitted: subscribeCommittedAppearanceChanges,
        adoptAppearance: adoptPresentedAppearance,
        adoptSettings: adoptClientSettings,
      }),
    [role],
  );
  return null;
}
