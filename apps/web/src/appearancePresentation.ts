import { DesktopAppearanceSnapshot } from "@t3tools/contracts";
import * as Equal from "effect/Equal";
import * as Schema from "effect/Schema";

import { readPresentedAppearance, setPresentedAppearanceSnapshot } from "./appearanceSnapshot";
import { refreshTheme } from "./hooks/useTheme";
import { getCustomThemes, replacePresentedCustomThemes } from "./themePalette";

const decodePresentedAppearance = Schema.decodeUnknownSync(DesktopAppearanceSnapshot);

/** Paints another window's committed appearance without making it this window's preference. */
export function adoptPresentedAppearance(snapshot: unknown): void {
  const presented = decodePresentedAppearance(snapshot);
  const current = readPresentedAppearance();
  const previousThemes = current === null ? null : getCustomThemes();
  setPresentedAppearanceSnapshot(presented);
  const nextThemes = replacePresentedCustomThemes(presented.customThemes);
  // A republished snapshot is a new object with the same preference; repainting it wastes a frame.
  if (
    current !== null &&
    current.theme === presented.theme &&
    current.appearanceMode === presented.appearanceMode &&
    Equal.equals(current.halves, presented.halves) &&
    previousThemes !== null &&
    Equal.equals(previousThemes, nextThemes)
  ) {
    return;
  }
  refreshTheme({ preservePreview: true });
}
