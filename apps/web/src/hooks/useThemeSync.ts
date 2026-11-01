import type { EnvironmentId, SyncedTheme } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  nextThemeSyncAction,
  rememberThemeSyncSetAt,
  STANDARD_SYNCED_THEME_ID,
  type ThemePair,
} from "@t3tools/client-runtime/theme-sync";
import { useSyncExternalStore } from "react";

import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { primaryEnvironmentIdAtom } from "../state/primaryEnvironment";
import {
  primaryServerConfigAtom,
  primaryServerEnvironmentThemesAtom,
  serverEnvironment,
} from "../state/server";
import {
  environmentThemeFileFromDefinition,
  environmentThemeShareState,
  getCustomThemes,
  getThemeDefinition,
  getThemeModes,
  resolveThemeHalf,
  subscribeToCustomThemes,
  type ThemeAppearance,
} from "../themePalette";
import { getThemeSnapshot, setTheme, setThemeHalf, subscribeToThemeChanges } from "./useTheme";

const STORAGE_KEY = "t3code:theme-sync:v1";

interface ThemeSyncState {
  readonly enabled: boolean;
  readonly seenSetAts: ReadonlyArray<string>;
}

const DISABLED: ThemeSyncState = { enabled: false, seenSetAts: [] };
let cachedState: ThemeSyncState | null = null;
const stateListeners = new Set<() => void>();

function readState(): ThemeSyncState {
  if (cachedState !== null) return cachedState;
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");
    const record =
      value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
    cachedState = {
      enabled: record.enabled === true,
      seenSetAts: Array.isArray(record.seenSetAts)
        ? record.seenSetAts.filter((entry): entry is string => typeof entry === "string")
        : [],
    };
  } catch {
    cachedState = DISABLED;
  }
  return cachedState;
}

function writeState(next: ThemeSyncState): void {
  cachedState = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {}
  for (const listener of stateListeners) listener();
}

export function useThemeSyncEnabled(): boolean {
  return useSyncExternalStore(
    (listener) => {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
    () => readState().enabled,
    () => false,
  );
}

/** Turning sync on adopts the environment's synced theme, or starts it from this device. */
export function setThemeSyncEnabled(enabled: boolean): void {
  baseline = null;
  writeState({ enabled, seenSetAts: [] });
  evaluate();
}

function isStandardPreference(preference: string): boolean {
  return preference === "system" || preference === "light" || preference === "dark";
}

function readLocalPair(): ThemePair {
  const { theme, themeHalves } = getThemeSnapshot();
  const half = (appearance: ThemeAppearance): string => {
    const preference = resolveThemeHalf(theme, themeHalves, appearance);
    if (isStandardPreference(preference)) return STANDARD_SYNCED_THEME_ID;
    const definition = getThemeDefinition(preference);
    // A published theme that has not loaded yet keeps its id rather than reading as standard.
    if (definition === null) return preference;
    return getThemeModes(definition).includes(appearance)
      ? definition.id
      : STANDARD_SYNCED_THEME_ID;
  };
  return { light: half("light"), dark: half("dark") };
}

function applyPair(pair: SyncedTheme): void {
  const current = readLocalPair();
  const target = (appearance: ThemeAppearance): string | null => {
    const id = pair[appearance];
    const definition = id === STANDARD_SYNCED_THEME_ID ? null : getThemeDefinition(id);
    const resolved =
      id === STANDARD_SYNCED_THEME_ID ||
      (definition !== null && getThemeModes(definition).includes(appearance))
        ? id
        : current[appearance];
    return resolved === STANDARD_SYNCED_THEME_ID ? null : resolved;
  };
  const light = target("light");
  const dark = target("dark");
  const standard = getThemeSnapshot().appearanceMode;
  if (light === dark) {
    setTheme(light ?? standard);
    return;
  }
  if (!setTheme(standard)) return;
  if (light !== null) setThemeHalf("light", light);
  if (dark !== null) setThemeHalf("dark", dark);
}

function notifySyncFailure(result: Awaited<ReturnType<typeof runPush>>): void {
  if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
  const failure = squashAtomCommandFailure(result);
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title: "Couldn’t sync theme",
      description: failure instanceof Error ? failure.message : "Try again.",
    }),
  );
}

/** Other devices can only render a custom theme once it is shared, and current, on the server. */
async function shareCustomThemes(environmentId: EnvironmentId, ids: ReadonlyArray<string>) {
  const published = appAtomRegistry.get(primaryServerEnvironmentThemesAtom);
  for (const definition of getCustomThemes()) {
    if (!ids.includes(definition.id)) continue;
    if (environmentThemeShareState(definition, published) === "shared") continue;
    const result = await runAtomCommand(
      appAtomRegistry,
      serverEnvironment.publishEnvironmentTheme,
      {
        environmentId,
        input: { id: definition.id, theme: environmentThemeFileFromDefinition(definition) },
      },
      { label: "theme sync share", reportFailure: true, reportDefect: true },
    );
    if (result._tag === "Failure") return result;
  }
  return null;
}

async function runPush(environmentId: EnvironmentId, theme: SyncedTheme) {
  const shareFailure = await shareCustomThemes(environmentId, [theme.light, theme.dark]);
  if (shareFailure !== null) return shareFailure;
  return runAtomCommand(
    appAtomRegistry,
    serverEnvironment.updateSettings,
    { environmentId, input: { patch: { syncedTheme: theme } } },
    { label: "theme sync", reportFailure: true, reportDefect: true },
  );
}

let baseline: ThemePair | null = null;
let applying = false;

function evaluate(): void {
  if (applying || typeof window === "undefined") return;
  const state = readState();
  if (!state.enabled) return;
  const environmentId = appAtomRegistry.get(primaryEnvironmentIdAtom);
  const config = appAtomRegistry.get(primaryServerConfigAtom);
  if (environmentId === null || config === null) return;
  const local = readLocalPair();
  baseline ??= local;
  const action = nextThemeSyncAction({
    local,
    baseline,
    synced: config.settings.syncedTheme,
    seenSetAts: state.seenSetAts,
    now: new Date().toISOString(),
  });
  if (action === null) return;

  writeState({
    ...state,
    seenSetAts: rememberThemeSyncSetAt(state.seenSetAts, action.theme.setAt),
  });
  if (action.type === "push") {
    baseline = local;
    void runPush(environmentId, action.theme).then(notifySyncFailure);
    return;
  }
  applying = true;
  try {
    applyPair(action.theme);
  } finally {
    applying = false;
  }
  baseline = readLocalPair();
}

/** Start after the environment theme sync so a synced published theme resolves on first run. */
export function startThemeSync(): () => void {
  const unsubscribes = [
    appAtomRegistry.subscribe(primaryEnvironmentIdAtom, evaluate),
    appAtomRegistry.subscribe(primaryServerConfigAtom, evaluate),
    subscribeToCustomThemes(evaluate),
    subscribeToThemeChanges(evaluate),
  ];
  evaluate();
  return () => {
    for (const unsubscribe of unsubscribes) unsubscribe();
  };
}
