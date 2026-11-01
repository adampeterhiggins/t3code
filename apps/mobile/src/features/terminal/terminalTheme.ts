import { TERMINAL_ANSI_ROLES } from "@t3tools/shared/themePalettes";
import { AsyncResult } from "effect/reactivity";

import {
  bundledPaletteThemeId,
  environmentThemeColors,
  findEnvironmentTheme,
  getEnvironmentThemeVariables,
  getMobileThemeColors,
  getMobileThemeVariables,
  themeColorToNativeColor,
  type MobileThemeId,
} from "../../lib/mobileTheme";
import { appAtomRegistry } from "../../state/atom-registry";
import { mobilePreferencesAtom } from "../../state/preferences";
import { publishedEnvironmentThemesAtom } from "../../state/server";

export type TerminalAppearanceScheme = "light" | "dark";

export interface TerminalTheme {
  readonly background: string;
  readonly foreground: string;
  readonly mutedForeground: string;
  readonly border: string;
  readonly cursorForeground: string;
  readonly cursorBackground: string;
  readonly palette: TerminalPalette;
}

type TerminalPalette = readonly [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];

const PIERRE_LIGHT_THEME: TerminalTheme = {
  background: "#fcfcfc",
  foreground: "#6C6C71",
  mutedForeground: "#8E8E95",
  border: "#eeeeef",
  cursorForeground: "#009fff",
  cursorBackground: "#fcfcfc",
  palette: [
    "#1F1F21",
    "#ff2e3f",
    "#0dbe4e",
    "#ffca00",
    "#009fff",
    "#c635e4",
    "#08c0ef",
    "#c6c6c8",
    "#1F1F21",
    "#ff2e3f",
    "#0dbe4e",
    "#ffca00",
    "#009fff",
    "#c635e4",
    "#08c0ef",
    "#c6c6c8",
  ],
};

const PIERRE_DARK_THEME: TerminalTheme = {
  background: "#0a0a0a",
  foreground: "#adadb1",
  mutedForeground: "#8E8E95",
  border: "#2e2e30",
  cursorForeground: "#009fff",
  cursorBackground: "#0a0a0a",
  palette: [
    "#141415",
    "#ff2e3f",
    "#0dbe4e",
    "#ffca00",
    "#009fff",
    "#c635e4",
    "#08c0ef",
    "#c6c6c8",
    "#141415",
    "#ff2e3f",
    "#0dbe4e",
    "#ffca00",
    "#009fff",
    "#c635e4",
    "#08c0ef",
    "#c6c6c8",
  ],
};

function getPierreTerminalTheme(scheme: TerminalAppearanceScheme): TerminalTheme {
  return scheme === "light" ? PIERRE_LIGHT_THEME : PIERRE_DARK_THEME;
}

/** Callers re-render on theme changes through the appearance context, so a read is current. */
function readEnvironmentTheme(themeId: MobileThemeId) {
  const published = appAtomRegistry.get(publishedEnvironmentThemesAtom);
  const preferences = appAtomRegistry.get(mobilePreferencesAtom);
  const copies = AsyncResult.isSuccess(preferences)
    ? (preferences.value.environmentThemes ?? [])
    : [];
  return findEnvironmentTheme(themeId, [...published, ...copies]);
}

export function getMobileTerminalTheme(
  themeId: MobileThemeId,
  scheme: TerminalAppearanceScheme,
): TerminalTheme {
  const base = getPierreTerminalTheme(scheme);
  const environmentTheme = readEnvironmentTheme(themeId);
  const environmentColors =
    environmentTheme === null ? null : environmentThemeColors(environmentTheme, scheme);
  const environmentVariables =
    environmentTheme === null ? null : getEnvironmentThemeVariables(environmentTheme, scheme);
  if (environmentColors !== null && environmentVariables !== null) {
    const background = themeColorToNativeColor(environmentColors.terminalBackground);
    return {
      background,
      foreground: themeColorToNativeColor(environmentColors.terminalForeground),
      mutedForeground: environmentVariables["--color-foreground-muted"],
      border: environmentVariables["--color-border"],
      cursorForeground: themeColorToNativeColor(environmentColors.terminalCursor),
      cursorBackground: background,
      palette: TERMINAL_ANSI_ROLES.map((role) =>
        themeColorToNativeColor(environmentColors[role]),
      ) as unknown as TerminalPalette,
    };
  }
  const paletteId = bundledPaletteThemeId(themeId);
  const palette = getMobileThemeColors(paletteId, scheme);
  const colors = getMobileThemeVariables(paletteId, scheme);
  const background = themeColorToNativeColor(palette.terminalBackground);
  return {
    ...base,
    background,
    foreground: themeColorToNativeColor(palette.terminalForeground),
    mutedForeground: colors["--color-foreground-muted"],
    border: colors["--color-border"],
    cursorForeground: themeColorToNativeColor(palette.terminalCursor),
    cursorBackground: background,
  };
}

export function buildGhosttyThemeConfig(theme: TerminalTheme): string {
  const lines = [
    `background = ${theme.background}`,
    `foreground = ${theme.foreground}`,
    `cursor-color = ${theme.cursorForeground}`,
    `cursor-text = ${theme.cursorBackground}`,
  ];

  for (const [index, color] of theme.palette.entries()) {
    lines.push(`palette = ${index}=${color}`);
  }

  return `${lines.join("\n")}\n`;
}
