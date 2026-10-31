import type { EnvironmentTheme } from "@t3tools/contracts";

import defaultThemeVariables from "../../generated-uniwind-default-theme-variables.json";
import {
  bundledPaletteThemeId,
  DEFAULT_MOBILE_THEME_ID,
  environmentThemeIdOf,
  findEnvironmentTheme,
  getEnvironmentThemeVariables,
  getMobileThemeVariables,
  themeColorWithAlpha,
  type MobileThemeAppearance,
  type MobileThemeId,
  type MobileThemeVariables,
} from "./mobileTheme";

const defaults = defaultThemeVariables as Readonly<
  Record<MobileThemeAppearance, MobileThemeVariables>
>;

export function getMobileThemeRuntimeVariables(
  themeId: MobileThemeId,
  appearance: MobileThemeAppearance,
  platform: string,
  environmentThemes: ReadonlyArray<EnvironmentTheme> = [],
): MobileThemeVariables {
  const environmentTheme = findEnvironmentTheme(themeId, environmentThemes);
  const environmentVariables = environmentTheme
    ? getEnvironmentThemeVariables(environmentTheme, appearance)
    : null;
  const usesDefaultPalette =
    environmentVariables === null &&
    (themeId === DEFAULT_MOBILE_THEME_ID ||
      themeId === "material-you" ||
      environmentThemeIdOf(themeId) !== null);
  const variables =
    environmentVariables ??
    (usesDefaultPalette
      ? defaults[appearance]
      : getMobileThemeVariables(bundledPaletteThemeId(themeId), appearance));
  const frame = themeColorWithAlpha(
    variables[usesDefaultPalette ? "--color-row-hover" : "--color-drawer"],
    1,
  );
  if (platform === "ios" && usesDefaultPalette && appearance === "light") {
    return {
      ...variables,
      "--color-header": frame,
      "--color-header-foreground": variables["--color-drawer-foreground"],
      "--color-drawer": frame,
      "--color-drawer-foreground-muted": variables["--color-foreground-muted"],
    };
  }
  if (platform !== "android") return variables;

  return {
    ...variables,
    "--color-header": frame,
    "--color-header-foreground": variables["--color-drawer-foreground"],
    "--color-drawer": variables["--color-screen"],
  };
}
