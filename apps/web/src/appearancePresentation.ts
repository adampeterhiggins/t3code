import { DesktopAppearanceSnapshot } from "@t3tools/contracts";
import * as Equal from "effect/Equal";
import * as Schema from "effect/Schema";

import {
  readPresentedAppearance,
  readPresentedCustomThemes,
  setPresentedAppearanceSnapshot,
  setPresentedCustomThemes,
} from "./appearanceSnapshot";
import {
  DEFAULT_THEME_SNAPSHOT,
  isThemePreferenceMode,
  readStoredFollowSystem,
  readThemeHalvesRaw,
  refreshTheme,
  THEME_STORAGE_KEY,
  ThemeStorageError,
} from "./hooks/useTheme";
import {
  BUILT_IN_THEME_DEFINITIONS,
  canonicalThemePreference,
  getCustomThemeLibrarySnapshot,
  getCustomThemes,
  getEnvironmentThemes,
  legacyThemeMode,
  notifyCustomThemeListeners,
  parseStoredThemes,
  THEME_APPEARANCE_MODE_STORAGE_KEY,
  themeIdFromPreference,
  type ThemeAppearance,
  type ThemeDefinition,
  type ThemePreferenceMode,
} from "./themePalette";

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

/**
 * In-memory library for a renderer that was handed a snapshot. Invalid entries are dropped by the
 * stored-theme parser. This does not write localStorage or publish a committed appearance change.
 */
function replacePresentedCustomThemes(
  storedThemes: ReadonlyArray<unknown>,
): ReadonlyArray<ThemeDefinition> {
  const themes = parseStoredThemes(storedThemes);
  const current = readPresentedCustomThemes();
  if (current !== null && Equal.equals(current, themes)) return current;
  setPresentedCustomThemes(themes);
  notifyCustomThemeListeners();
  return themes;
}

const EMPTY_STORED_CUSTOM_THEMES: ReadonlyArray<unknown> = [];
const EMPTY_CUSTOM_THEMES: ReadonlyArray<ThemeDefinition> = [];

/** Raw stored library, including entries the parser will drop. Ignores a presented overlay. */
function readStoredCustomThemes(): ReadonlyArray<unknown> {
  const snapshot = getCustomThemeLibrarySnapshot();
  return snapshot.status === "ready" ? snapshot.storedThemes : EMPTY_STORED_CUSTOM_THEMES;
}

function committedThemeDefinition(theme: string): ThemeDefinition | null {
  const themeId = themeIdFromPreference(theme);
  const snapshot = getCustomThemeLibrarySnapshot();
  const storedThemes = snapshot.status === "ready" ? snapshot.themes : EMPTY_CUSTOM_THEMES;
  return (
    BUILT_IN_THEME_DEFINITIONS.find((definition) => definition.id === themeId) ??
    storedThemes.find((definition) => definition.id === themeId) ??
    getEnvironmentThemes().find((definition) => definition.id === themeId) ??
    null
  );
}

/**
 * Mode implied by a committed theme id. Painting uses `getThemePreferenceMode`, which follows the
 * presented overlay; this reads the stored library so a base theme the overlay does not carry
 * still infers its own mode.
 */
function getCommittedThemePreferenceMode(theme: string): ThemeAppearance | null {
  if (theme === "system") return null;
  if (theme === "light" || theme === "dark") return theme;
  const legacyMode = legacyThemeMode(theme);
  if (legacyMode) return legacyMode;
  return committedThemeDefinition(theme)?.appearance ?? null;
}

function committedThemeHalves(): DesktopAppearanceSnapshot["halves"] {
  const raw = readThemeHalvesRaw();
  if (raw.light === undefined && raw.dark === undefined) return null;
  return {
    ...(raw.light !== undefined ? { light: raw.light } : {}),
    ...(raw.dark !== undefined ? { dark: raw.dark } : {}),
  };
}

/**
 * The stored id is published as written, including an environment or custom id this window
 * cannot paint yet. Legacy aliases are canonicalized; a missing key is system. Painting still
 * goes through `readThemePreference`.
 */
function readCommittedThemeId(): string {
  if (typeof window === "undefined") return DEFAULT_THEME_SNAPSHOT.theme;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(THEME_STORAGE_KEY);
  } catch (cause) {
    throw new ThemeStorageError({
      operation: "read",
      storageKey: THEME_STORAGE_KEY,
      cause,
    });
  }
  if (raw === null) return DEFAULT_THEME_SNAPSHOT.theme;
  return canonicalThemePreference(raw);
}

function readCommittedAppearanceMode(theme: string): ThemePreferenceMode {
  if (typeof window !== "undefined") {
    try {
      const raw = window.localStorage.getItem(THEME_APPEARANCE_MODE_STORAGE_KEY);
      if (isThemePreferenceMode(raw)) return raw;
    } catch {}
  }

  if (readStoredFollowSystem(theme)) return "system";
  return getCommittedThemePreferenceMode(theme) ?? "light";
}

/** This window's committed appearance, published to the floating window. */
export function readCommittedAppearanceSnapshot(): DesktopAppearanceSnapshot {
  const theme = readCommittedThemeId();
  return {
    theme,
    appearanceMode: readCommittedAppearanceMode(theme),
    halves: committedThemeHalves(),
    customThemes: [...readStoredCustomThemes()],
  };
}
