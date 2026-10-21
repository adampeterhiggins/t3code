import { safeErrorLogAttributes } from "@t3tools/client-runtime/errors";
import { DesktopAppearanceSnapshot, type DesktopBridge } from "@t3tools/contracts";
import * as Equal from "effect/Equal";
import * as Schema from "effect/Schema";
import { useEffect, useSyncExternalStore } from "react";

import {
  isPresentedAppearanceActive,
  notifyCommittedAppearanceChange,
  readPresentedAppearance,
  setPresentedAppearanceSnapshot,
} from "../appearanceSnapshot";
import { isQuickMessageWindow } from "../components/quickMessage/quickMessageWindow";
import {
  applyThemePalette,
  clearPresentedCustomThemes,
  CUSTOM_THEMES_STORAGE_KEY,
  getCustomThemes,
  invalidateCustomThemes,
  canonicalThemePreference,
  isKnownThemePreference,
  getCommittedThemePreferenceMode,
  getThemePreferenceMode,
  getThemePreviewAppearance,
  parseThemeHalves,
  readStoredCustomThemes,
  replacePresentedCustomThemes,
  resolveDesktopTheme,
  resolveThemeAppearance,
  resolveThemeHalf,
  subscribeToThemePreview,
  THEME_PREVIEW_ID,
  THEME_APPEARANCE_MODE_STORAGE_KEY,
  THEME_FOLLOW_SYSTEM_STORAGE_KEY,
  THEME_HALVES_STORAGE_KEY,
  ThemePreference,
  type ThemeAppearance,
  type ThemeHalves,
  type ThemePreferenceMode,
} from "../themePalette";

export { subscribeCommittedAppearanceChanges } from "../appearanceSnapshot";

type Theme = ThemePreference;
type ThemeSnapshot = {
  theme: Theme;
  resolvedTheme: ThemeAppearance;
  systemDark: boolean;
  followSystem: boolean;
  appearanceMode: ThemePreferenceMode;
  themeHalves: ThemeHalves | null;
};

type DesktopThemeBridge = Pick<DesktopBridge, "setTheme">;

const STORAGE_KEY = "t3code:theme";
const MEDIA_QUERY = "(prefers-color-scheme: dark)";
const DEFAULT_THEME_SNAPSHOT: ThemeSnapshot = {
  theme: "system",
  resolvedTheme: "light",
  systemDark: false,
  followSystem: true,
  appearanceMode: "system",
  themeHalves: null,
};

export function readThemeHalves(): ThemeHalves | null {
  return readStoredThemeHalves();
}

/**
 * Flows that rebuild the whole mix must capture this before a `setTheme` clears
 * it: a published id resolves only once its set has streamed in, and treating
 * "not resolvable yet" as "absent" silently rewrites that half.
 */
export function readThemeHalvesRaw(): { light?: string; dark?: string } {
  if (typeof window === "undefined") return {};
  return readStoredThemeHalvesRaw();
}

function readStoredThemeHalves(): ThemeHalves | null {
  if (typeof window === "undefined") return null;
  try {
    return parseThemeHalves(window.localStorage.getItem(THEME_HALVES_STORAGE_KEY));
  } catch {
    return null;
  }
}

/**
 * An environment published id resolves only once its set has streamed in, so a
 * write that merged over the pruned parse would silently erase that half
 * whenever the other one changed before the set arrived.
 */
function readStoredThemeHalvesRaw(): { light?: string; dark?: string } {
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem(THEME_HALVES_STORAGE_KEY) ?? "null",
    );
    if (value === null || typeof value !== "object") return {};
    const halves: { light?: string; dark?: string } = {};
    for (const appearance of ["light", "dark"] as const) {
      const themeId = (value as Record<string, unknown>)[appearance];
      if (typeof themeId === "string") halves[appearance] = themeId;
    }
    return halves;
  } catch {
    return {};
  }
}

function themeHalvesSignature(halves: ThemeHalves | null): string {
  return `${halves?.light ?? ""}|${halves?.dark ?? ""}`;
}

const THEME_COLOR_META_NAME = "theme-color";
const DYNAMIC_THEME_COLOR_SELECTOR = `meta[name="${THEME_COLOR_META_NAME}"][data-dynamic-theme-color="true"]`;

export class ThemeStorageError extends Schema.TaggedError<ThemeStorageError>()(
  "ThemeStorageError",
  {
    operation: Schema.Literals(["read", "write"]),
    storageKey: Schema.String,
    theme: Schema.optional(ThemePreference),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to ${this.operation} theme preference for ${this.storageKey}.`;
  }
}

export const isThemeStorageError = Schema.is(ThemeStorageError);

export class DesktopThemeSyncError extends Schema.TaggedError<DesktopThemeSyncError>()(
  "DesktopThemeSyncError",
  {
    theme: ThemePreference,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to sync the ${this.theme} theme to the desktop shell.`;
  }
}

export const isDesktopThemeSyncError = Schema.is(DesktopThemeSyncError);

let listeners: Array<() => void> = [];
let lastSnapshot: ThemeSnapshot | null = null;
let snapshotStale = true;
let lastDesktopTheme: "light" | "dark" | "system" | null = null;
let lastAppliedTheme: Omit<ThemeSnapshot, "resolvedTheme"> | null = null;
let themeStorageReadFailure: ThemeStorageError | null = null;

function emitChange() {
  snapshotStale = true;
  for (const listener of listeners) listener();
}

function getSystemDark() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(MEDIA_QUERY).matches
  );
}

function readStoredFollowSystem(theme: Theme): boolean {
  if (typeof window === "undefined") return theme === "system";

  try {
    const raw = window.localStorage.getItem(THEME_FOLLOW_SYSTEM_STORAGE_KEY);
    if (raw === "true") return true;
    if (raw === "false") return false;
  } catch {}

  return theme === "system";
}

function isThemePreferenceMode(value: string | null): value is ThemePreferenceMode {
  return value === "light" || value === "dark" || value === "system";
}

export function readAppearanceModePreference(theme: Theme): ThemePreferenceMode {
  if (typeof window !== "undefined") {
    try {
      const raw = window.localStorage.getItem(THEME_APPEARANCE_MODE_STORAGE_KEY);
      if (isThemePreferenceMode(raw)) return raw;
    } catch {}
  }

  if (readStoredFollowSystem(theme)) return "system";
  return getThemePreferenceMode(theme) ?? "light";
}

function writeAppearanceModePreference(appearanceMode: ThemePreferenceMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(THEME_APPEARANCE_MODE_STORAGE_KEY, appearanceMode);
  } catch (cause) {
    throw new ThemeStorageError({
      operation: "write",
      storageKey: THEME_APPEARANCE_MODE_STORAGE_KEY,
      cause,
    });
  }
}

export function readThemePreference(): Theme {
  if (typeof window === "undefined") return DEFAULT_THEME_SNAPSHOT.theme;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch (cause) {
    throw new ThemeStorageError({
      operation: "read",
      storageKey: STORAGE_KEY,
      cause,
    });
  }
  if (raw !== null && isKnownThemePreference(raw)) {
    return canonicalThemePreference(raw);
  }
  return DEFAULT_THEME_SNAPSHOT.theme;
}

export function writeThemePreference(theme: Theme): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
    themeStorageReadFailure = null;
  } catch (cause) {
    throw new ThemeStorageError({
      operation: "write",
      storageKey: STORAGE_KEY,
      theme,
      cause,
    });
  }
}

function getStored(): Theme {
  if (themeStorageReadFailure !== null) {
    return DEFAULT_THEME_SNAPSHOT.theme;
  }
  try {
    return readThemePreference();
  } catch (cause) {
    const error = isThemeStorageError(cause)
      ? cause
      : new ThemeStorageError({
          operation: "read",
          storageKey: STORAGE_KEY,
          cause,
        });
    themeStorageReadFailure = error;
    console.error(error.message, {
      operation: error.operation,
      storageKey: error.storageKey,
      ...safeErrorLogAttributes(error),
    });
    return DEFAULT_THEME_SNAPSHOT.theme;
  }
}

function ensureThemeColorMetaTag(): HTMLMetaElement {
  let element = document.querySelector<HTMLMetaElement>(DYNAMIC_THEME_COLOR_SELECTOR);
  if (element) {
    return element;
  }

  element = document.createElement("meta");
  element.name = THEME_COLOR_META_NAME;
  element.setAttribute("data-dynamic-theme-color", "true");
  document.head.append(element);
  return element;
}

function normalizeThemeColor(value: string | null | undefined): string | null {
  const normalizedValue = value?.trim().toLowerCase();
  if (
    !normalizedValue ||
    normalizedValue === "transparent" ||
    normalizedValue === "rgba(0, 0, 0, 0)" ||
    normalizedValue === "rgba(0 0 0 / 0)"
  ) {
    return null;
  }

  return value?.trim() ?? null;
}

function resolveBrowserChromeSurface(): HTMLElement {
  return (
    document.querySelector<HTMLElement>("main[data-slot='sidebar-inset']") ??
    document.querySelector<HTMLElement>("[data-slot='sidebar-inner']") ??
    document.body
  );
}

export function syncBrowserChromeTheme() {
  if (typeof document === "undefined" || typeof getComputedStyle === "undefined") return;
  const rootStyles = getComputedStyle(document.documentElement);
  const themeChromeColor = document.documentElement.dataset.themeId
    ? normalizeThemeColor(rootStyles.getPropertyValue("--app-chrome-background"))
    : null;
  const surfaceColor = normalizeThemeColor(
    getComputedStyle(resolveBrowserChromeSurface()).backgroundColor,
  );
  const fallbackColor = normalizeThemeColor(getComputedStyle(document.body).backgroundColor);
  const backgroundColor = themeChromeColor ?? surfaceColor ?? fallbackColor;
  if (!backgroundColor) return;

  document.documentElement.style.backgroundColor = backgroundColor;
  document.body.style.backgroundColor = backgroundColor;
  const themeColorMetas = document.querySelectorAll<HTMLMetaElement>(
    `meta[name="${THEME_COLOR_META_NAME}"]`,
  );
  if (themeColorMetas.length === 0) {
    ensureThemeColorMetaTag().setAttribute("content", backgroundColor);
    return;
  }
  for (const element of themeColorMetas) {
    element.setAttribute("content", backgroundColor);
  }
}

function presentedThemeHalves(halves: DesktopAppearanceSnapshot["halves"]): ThemeHalves | null {
  if (halves === null) return null;
  const next: { light?: string; dark?: string } = {};
  if (halves.light !== undefined) next.light = halves.light;
  if (halves.dark !== undefined) next.dark = halves.dark;
  return next.light !== undefined || next.dark !== undefined ? next : null;
}

function activeTheme(): Theme {
  return readPresentedAppearance()?.theme ?? getStored();
}

function activeAppearanceMode(theme: Theme): ThemePreferenceMode {
  return readPresentedAppearance()?.appearanceMode ?? readAppearanceModePreference(theme);
}

function activeThemeHalves(): ThemeHalves | null {
  const presented = readPresentedAppearance();
  if (presented !== null) return presentedThemeHalves(presented.halves);
  return readStoredThemeHalves();
}

function appearancePreferencesAreReadOnly(): boolean {
  return isPresentedAppearanceActive() || isQuickMessageWindow;
}

function applyTheme(theme: Theme, { suppressTransitions = false, preservePreview = true } = {}) {
  if (typeof document === "undefined" || typeof window === "undefined") return;
  if (preservePreview && document.documentElement.dataset?.themeId === THEME_PREVIEW_ID) {
    return;
  }
  const appearanceMode = activeAppearanceMode(theme);
  const followSystem = appearanceMode === "system";
  const systemDark = followSystem ? getSystemDark() : false;
  const themeHalves = activeThemeHalves();
  if (
    lastAppliedTheme?.theme === theme &&
    lastAppliedTheme.systemDark === systemDark &&
    lastAppliedTheme.followSystem === followSystem &&
    lastAppliedTheme.appearanceMode === appearanceMode &&
    themeHalvesSignature(lastAppliedTheme.themeHalves) === themeHalvesSignature(themeHalves)
  ) {
    syncDesktopTheme(theme, followSystem, appearanceMode);
    return;
  }

  if (suppressTransitions) {
    document.documentElement.classList.add("no-transitions");
  }
  const resolvedAppearance = resolveThemeAppearance(
    theme,
    systemDark,
    followSystem,
    appearanceMode,
    themeHalves,
  );
  applyThemePalette(resolveThemeHalf(theme, themeHalves, resolvedAppearance), resolvedAppearance);
  document.documentElement.classList.toggle("dark", resolvedAppearance === "dark");
  lastAppliedTheme = { theme, systemDark, followSystem, appearanceMode, themeHalves };
  syncBrowserChromeTheme();
  syncDesktopTheme(theme, followSystem, appearanceMode);
  if (suppressTransitions) {
    // Force a reflow so the no-transitions class takes effect before removal
    void document.documentElement.offsetHeight;
    requestAnimationFrame(() => {
      document.documentElement.classList.remove("no-transitions");
    });
  }
}

export async function syncDesktopThemePreference(
  bridge: DesktopThemeBridge,
  theme: Theme,
  followSystem?: boolean,
  appearanceMode?: ThemePreferenceMode,
  halves: ThemeHalves | null = readStoredThemeHalves(),
): Promise<void> {
  try {
    await bridge.setTheme(resolveDesktopTheme(theme, followSystem, appearanceMode, halves));
  } catch (cause) {
    throw new DesktopThemeSyncError({ theme, cause });
  }
}

export function syncDesktopTheme(
  theme: Theme,
  followSystem?: boolean,
  appearanceMode?: ThemePreferenceMode,
) {
  if (typeof window === "undefined") return;
  // The quick-message panel shares this page, and a presented renderer paints a
  // snapshot it does not own. Either one calling setTheme races the main window.
  if (isQuickMessageWindow || isPresentedAppearanceActive()) return;
  const bridge = window.desktopBridge;
  const halves = readStoredThemeHalves();
  const desktopTheme = resolveDesktopTheme(theme, followSystem, appearanceMode, halves);
  if (!bridge || typeof bridge.setTheme !== "function" || lastDesktopTheme === desktopTheme) {
    return;
  }

  lastDesktopTheme = desktopTheme;
  void syncDesktopThemePreference(bridge, theme, followSystem, appearanceMode, halves).catch(
    (cause: unknown) => {
      const error = isDesktopThemeSyncError(cause)
        ? cause
        : new DesktopThemeSyncError({ theme, cause });
      console.error(error.message, {
        theme: error.theme,
        ...safeErrorLogAttributes(error),
      });
      if (lastDesktopTheme === desktopTheme) {
        lastDesktopTheme = null;
      }
    },
  );
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  applyTheme(getStored());
}

function getSnapshot(): ThemeSnapshot {
  if (typeof window === "undefined") return DEFAULT_THEME_SNAPSHOT;
  // Reading the preference hits localStorage, so only recompute after a
  // change was signalled; useTheme consumers call this on every render.
  if (!snapshotStale && lastSnapshot) return lastSnapshot;
  snapshotStale = false;
  const theme = activeTheme();
  const appearanceMode = activeAppearanceMode(theme);
  const followSystem = appearanceMode === "system";
  const systemDark = followSystem ? getSystemDark() : false;
  const themeHalves = activeThemeHalves();

  const resolvedTheme = resolveThemeAppearance(
    theme,
    systemDark,
    followSystem,
    appearanceMode,
    themeHalves,
  );
  if (
    lastSnapshot &&
    lastSnapshot.theme === theme &&
    lastSnapshot.resolvedTheme === resolvedTheme &&
    lastSnapshot.systemDark === systemDark &&
    lastSnapshot.followSystem === followSystem &&
    lastSnapshot.appearanceMode === appearanceMode &&
    themeHalvesSignature(lastSnapshot.themeHalves) === themeHalvesSignature(themeHalves)
  ) {
    return lastSnapshot;
  }

  lastSnapshot = { theme, resolvedTheme, systemDark, followSystem, appearanceMode, themeHalves };
  return lastSnapshot;
}

function getServerSnapshot() {
  return DEFAULT_THEME_SNAPSHOT;
}

function handleSystemAppearanceChange() {
  const theme = activeTheme();
  if (activeAppearanceMode(theme) === "system") {
    applyTheme(theme, { suppressTransitions: true });
  }
  emitChange();
}

function handleStorageChange(e: StorageEvent) {
  // The presented palette stays in memory. These events only drop the stored
  // cache and the read-failure latch so release can see what other windows wrote.
  if (isPresentedAppearanceActive()) {
    if (e.key === STORAGE_KEY || e.key === null) {
      themeStorageReadFailure = null;
    }
    if (e.key === CUSTOM_THEMES_STORAGE_KEY || e.key === null) {
      invalidateCustomThemes();
    }
    return;
  }
  if (e.key === STORAGE_KEY) {
    themeStorageReadFailure = null;
    applyTheme(getStored(), { suppressTransitions: true });
    emitChange();
  } else if (e.key === THEME_FOLLOW_SYSTEM_STORAGE_KEY) {
    applyTheme(getStored(), { suppressTransitions: true });
    emitChange();
  } else if (e.key === THEME_APPEARANCE_MODE_STORAGE_KEY || e.key === THEME_HALVES_STORAGE_KEY) {
    applyTheme(getStored(), { suppressTransitions: true });
    emitChange();
  } else if (e.key === CUSTOM_THEMES_STORAGE_KEY || e.key === null) {
    if (e.key === null) themeStorageReadFailure = null;
    invalidateCustomThemes();
    lastAppliedTheme = null;
    applyTheme(getStored(), { suppressTransitions: true });
    emitChange();
  } else {
    return;
  }
  notifyCommittedAppearanceChange();
}

let removeWindowListeners: (() => void) | null = null;

function subscribe(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  listeners.push(listener);

  if (!removeWindowListeners) {
    const mq = typeof window.matchMedia === "function" ? window.matchMedia(MEDIA_QUERY) : null;
    mq?.addEventListener("change", handleSystemAppearanceChange);
    window.addEventListener("storage", handleStorageChange);
    removeWindowListeners = () => {
      mq?.removeEventListener("change", handleSystemAppearanceChange);
      window.removeEventListener("storage", handleStorageChange);
    };
  }

  return () => {
    listeners = listeners.filter((l) => l !== listener);
    if (listeners.length === 0) {
      removeWindowListeners?.();
      removeWindowListeners = null;
    }
  };
}

export function useRenderedAppearance() {
  const { resolvedTheme } = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const previewAppearance = useSyncExternalStore(
    subscribeToThemePreview,
    getThemePreviewAppearance,
    () => null,
  );
  return previewAppearance ?? resolvedTheme;
}

function setTheme(next: Theme): boolean {
  if (typeof window === "undefined" || appearancePreferencesAreReadOnly()) return false;
  try {
    // Preserve the current mode before replacing a legacy or inferred theme
    // preference. Otherwise a fresh System preference is re-inferred from
    // the new theme's base appearance, which can switch a dark UI to light.
    writeAppearanceModePreference(readAppearanceModePreference(getStored()));
    // Choosing a whole theme replaces any automatic-mode mix. The mix is
    // captured first so a failed preference write can put it back instead
    // of erasing it or leaving it attached to the new theme.
    const previousHalvesRaw = window.localStorage.getItem(THEME_HALVES_STORAGE_KEY);
    window.localStorage.removeItem(THEME_HALVES_STORAGE_KEY);
    try {
      writeThemePreference(next);
    } catch (cause) {
      if (previousHalvesRaw !== null) {
        try {
          window.localStorage.setItem(THEME_HALVES_STORAGE_KEY, previousHalvesRaw);
        } catch {}
      }
      throw cause;
    }
  } catch (cause) {
    const error = isThemeStorageError(cause)
      ? cause
      : new ThemeStorageError({
          operation: "write",
          storageKey: STORAGE_KEY,
          theme: next,
          cause,
        });
    console.error(error.message, {
      operation: error.operation,
      storageKey: error.storageKey,
      theme: next,
      ...safeErrorLogAttributes(error),
    });
    return false;
  }
  applyTheme(next, { suppressTransitions: true });
  emitChange();
  notifyCommittedAppearanceChange();
  return true;
}

function setAppearanceMode(nextAppearanceMode: ThemePreferenceMode): boolean {
  if (typeof window === "undefined" || appearancePreferencesAreReadOnly()) return false;
  try {
    writeAppearanceModePreference(nextAppearanceMode);
  } catch (cause) {
    const error = isThemeStorageError(cause)
      ? cause
      : new ThemeStorageError({
          operation: "write",
          storageKey: THEME_APPEARANCE_MODE_STORAGE_KEY,
          cause,
        });
    console.error(error.message, {
      operation: error.operation,
      storageKey: error.storageKey,
      ...safeErrorLogAttributes(error),
    });
    return false;
  }
  themeStorageReadFailure = null;
  applyTheme(getStored(), { suppressTransitions: true });
  emitChange();
  notifyCommittedAppearanceChange();
  return true;
}

function setThemeHalf(appearance: ThemeAppearance, themeId: string | null): boolean {
  if (typeof window === "undefined" || appearancePreferencesAreReadOnly()) return false;
  try {
    const current = readStoredThemeHalvesRaw();
    const next: { light?: string; dark?: string } = { ...current };
    if (themeId === null) delete next[appearance];
    else next[appearance] = themeId;
    if (next.light === undefined && next.dark === undefined) {
      window.localStorage.removeItem(THEME_HALVES_STORAGE_KEY);
    } else {
      window.localStorage.setItem(THEME_HALVES_STORAGE_KEY, JSON.stringify(next));
    }
  } catch (cause) {
    const error = new ThemeStorageError({
      operation: "write",
      storageKey: THEME_HALVES_STORAGE_KEY,
      cause,
    });
    console.error(error.message, {
      operation: error.operation,
      storageKey: error.storageKey,
      ...safeErrorLogAttributes(error),
    });
    return false;
  }
  applyTheme(getStored(), { suppressTransitions: true });
  emitChange();
  notifyCommittedAppearanceChange();
  return true;
}

function clearThemeHalves(): boolean {
  if (typeof window === "undefined" || appearancePreferencesAreReadOnly()) return false;
  try {
    window.localStorage.removeItem(THEME_HALVES_STORAGE_KEY);
  } catch (cause) {
    const error = new ThemeStorageError({
      operation: "write",
      storageKey: THEME_HALVES_STORAGE_KEY,
      cause,
    });
    console.error(error.message, {
      operation: error.operation,
      storageKey: error.storageKey,
      ...safeErrorLogAttributes(error),
    });
    return false;
  }
  applyTheme(getStored(), { suppressTransitions: true });
  emitChange();
  notifyCommittedAppearanceChange();
  return true;
}

function refreshTheme({ preservePreview = false } = {}): void {
  if (typeof window === "undefined") return;
  lastAppliedTheme = null;
  applyTheme(activeTheme(), { suppressTransitions: true, preservePreview });
  emitChange();
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
 * The stored id is published as written, including an environment or custom id
 * this window cannot paint yet. Legacy aliases are canonicalized; a missing
 * key is system. Painting still goes through `readThemePreference`.
 */
function readCommittedThemeId(): string {
  if (typeof window === "undefined") return DEFAULT_THEME_SNAPSHOT.theme;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch (cause) {
    throw new ThemeStorageError({
      operation: "read",
      storageKey: STORAGE_KEY,
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

export function readCommittedAppearanceSnapshot(): DesktopAppearanceSnapshot {
  const theme = readCommittedThemeId();
  return {
    theme,
    appearanceMode: readCommittedAppearanceMode(theme),
    halves: committedThemeHalves(),
    customThemes: [...readStoredCustomThemes()],
  };
}

const decodePresentedAppearance = Schema.decodeUnknownSync(DesktopAppearanceSnapshot);

export function adoptPresentedAppearance(snapshot: unknown): void {
  const presented = decodePresentedAppearance(snapshot);
  const current = readPresentedAppearance();
  const previousThemes = current === null ? null : getCustomThemes();
  setPresentedAppearanceSnapshot(presented);
  const nextThemes = replacePresentedCustomThemes(presented.customThemes);
  // A republished snapshot is a new object with the same preference. Repainting
  // it is the wasted frame this client already refuses for environment palettes.
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
  lastAppliedTheme = null;
  if (typeof window === "undefined") return;
  // The snapshot is already the committed state of another window. Do not publish it again.
  applyTheme(presented.theme, { suppressTransitions: true });
  emitChange();
}

export function releasePresentedAppearance(): void {
  // Drop the cached library while the overlay still answers theme reads, so
  // this invalidation cannot paint stored colors over the presented snapshot.
  invalidateCustomThemes();
  setPresentedAppearanceSnapshot(null);
  clearPresentedCustomThemes();
  lastAppliedTheme = null;
  if (typeof window === "undefined") return;
  applyTheme(getStored(), { suppressTransitions: true });
  emitChange();
}

export function useTheme() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const { theme, resolvedTheme } = snapshot;

  const setFollowSystem = (nextFollowSystem: boolean): boolean => {
    const currentMode = readAppearanceModePreference(theme);
    const nextMode = nextFollowSystem
      ? "system"
      : currentMode === "system"
        ? (getThemePreferenceMode(theme) ?? "light")
        : currentMode;
    return setAppearanceMode(nextMode);
  };

  // Mode and halves come from the presented snapshot, or from storage when this
  // window owns the preference. getSnapshot keeps one object until either changes.
  useEffect(() => {
    applyTheme(snapshot.theme);
  }, [snapshot]);

  return {
    theme,
    setTheme,
    setAppearanceMode,
    setFollowSystem,
    setThemeHalf,
    clearThemeHalves,
    refreshTheme,
    followSystem: snapshot.followSystem,
    appearanceMode: snapshot.appearanceMode,
    resolvedTheme,
    themeHalves: snapshot.themeHalves,
  } as const;
}
