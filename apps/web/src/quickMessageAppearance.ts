import { MAX_APPEARANCE_CONTRAST, type ClientSettings } from "@t3tools/contracts/settings";
import {
  isKnownThemePreference,
  resolveThemeAppearance,
  resolveThemeHalf,
  type ThemeAppearance,
  type ThemeHalves,
} from "./themePalette";

export type QuickMessageThemeSettings = Pick<
  ClientSettings,
  | "quickMessageThemeSource"
  | "quickMessageTheme"
  | "quickMessageAppearance"
  | "quickMessageExtraContrast"
  | "appearanceContrast"
>;

export function resolveQuickMessageAppearance(
  settings: QuickMessageThemeSettings,
  app: { theme: string; appearance: ThemeAppearance; halves: ThemeHalves | null },
  systemDark: boolean,
) {
  const independent = settings.quickMessageThemeSource === "theme";
  const theme =
    independent && isKnownThemePreference(settings.quickMessageTheme)
      ? settings.quickMessageTheme
      : app.theme;
  const halves =
    independent && isKnownThemePreference(settings.quickMessageTheme) ? null : app.halves;
  const mode = settings.quickMessageThemeSource === "app" ? "app" : settings.quickMessageAppearance;
  const appearance =
    mode === "app"
      ? resolveThemeAppearance(theme, systemDark, false, app.appearance, halves)
      : resolveThemeAppearance(theme, systemDark, mode === "system", mode, halves);
  return {
    theme: resolveThemeHalf(theme, halves, appearance),
    appearance,
    contrast:
      settings.quickMessageThemeSource === "adapt"
        ? Math.min(
            MAX_APPEARANCE_CONTRAST,
            settings.appearanceContrast + settings.quickMessageExtraContrast,
          )
        : settings.appearanceContrast,
  };
}
