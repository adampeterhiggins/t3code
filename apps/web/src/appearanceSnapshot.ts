import type { DesktopAppearanceSnapshot } from "@t3tools/contracts";

import { isQuickMessageWindow } from "./components/quickMessage/quickMessageWindow";
import type {
  ThemeDefinition,
  ThemeHalves,
  ThemePreference,
  ThemePreferenceMode,
} from "./themePalette";

type AppearanceListener = () => void;

const committedAppearanceListeners = new Set<AppearanceListener>();

let presentedAppearance: DesktopAppearanceSnapshot | null = null;

export function subscribeCommittedAppearanceChanges(listener: AppearanceListener): () => void {
  committedAppearanceListeners.add(listener);
  return () => {
    committedAppearanceListeners.delete(listener);
  };
}

/** Local preference and custom-theme library writes. Preview must not call this. */
export function notifyCommittedAppearanceChange(): void {
  for (const listener of committedAppearanceListeners) listener();
}

export function readPresentedAppearance(): DesktopAppearanceSnapshot | null {
  return presentedAppearance;
}

export function isPresentedAppearanceActive(): boolean {
  return presentedAppearance !== null;
}

export function setPresentedAppearanceSnapshot(snapshot: DesktopAppearanceSnapshot | null): void {
  presentedAppearance = snapshot;
}

// null means the stored library. An array, including empty, is a presented snapshot.
let presentedCustomThemes: ReadonlyArray<ThemeDefinition> | null = null;

export function readPresentedCustomThemes(): ReadonlyArray<ThemeDefinition> | null {
  return presentedCustomThemes;
}

export function setPresentedCustomThemes(themes: ReadonlyArray<ThemeDefinition> | null): void {
  presentedCustomThemes = themes;
}

/** The theme this window paints: a presented snapshot's, else the stored preference. */
export function presentedTheme(readStored: () => ThemePreference): ThemePreference {
  return readPresentedAppearance()?.theme ?? readStored();
}

export function presentedAppearanceMode(
  theme: ThemePreference,
  readStored: (theme: ThemePreference) => ThemePreferenceMode,
): ThemePreferenceMode {
  return readPresentedAppearance()?.appearanceMode ?? readStored(theme);
}

export function presentedThemeHalves(readStored: () => ThemeHalves | null): ThemeHalves | null {
  const presented = readPresentedAppearance();
  if (presented === null) return readStored();
  const halves = presented.halves;
  if (halves === null) return null;
  const next: { light?: string; dark?: string } = {};
  if (halves.light !== undefined) next.light = halves.light;
  if (halves.dark !== undefined) next.dark = halves.dark;
  return next.light !== undefined || next.dark !== undefined ? next : null;
}

/** A presented window, and the legacy quick-message panel, paint preferences they do not own. */
export function appearancePreferencesAreReadOnly(): boolean {
  return isPresentedAppearanceActive() || isQuickMessageWindow;
}

export function assertCustomThemeLibraryWritable(): void {
  if (appearancePreferencesAreReadOnly()) {
    throw new Error("Installed themes are read-only in this window.");
  }
}
