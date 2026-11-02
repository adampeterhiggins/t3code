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
 * Mount once, with the role from `desktopAppearanceCoordinatorRole`. The
 * component does not choose a window for itself. Missing bridge methods leave
 * the local theme engine in place.
 */
export function DesktopAppearanceCoordinator(props: {
  readonly role: DesktopAppearanceCoordinatorRole;
}) {
  const { role } = props;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- publishes or adopts the desktop appearance session for this window's lifetime
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

/**
 * Environment palettes now come from `environmentThemeDefinitionsAtom` and
 * `startEnvironmentThemeRepaint`, which already run in this window. Default
 * theme adoption stays on the main window.
 */
export function FloatingEnvironmentThemeSync() {
  return null;
}
