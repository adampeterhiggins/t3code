import type { EnvironmentId, SyncedTheme } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  nextThemeSyncAction,
  rememberThemeSyncSetAt,
  type ThemePair,
} from "@t3tools/client-runtime/theme-sync";
import { AsyncResult } from "effect/reactivity";

import * as Dialog from "../../../components/ui/Dialog";
import { isSystemColorsAvailable } from "../../../lib/materialYouPalette";
import {
  mobileThemeIdFromSynced,
  resolveMobileThemeIds,
  retainEnvironmentThemeCopies,
  syncedThemeIdOf,
} from "../../../lib/mobileTheme";
import type { Preferences } from "../../../persistence/mobile-preferences";
import { appAtomRegistry } from "../../../state/atom-registry";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../../state/preferences";
import {
  environmentServerConfigsAtom,
  publishedEnvironmentThemesAtom,
  serverEnvironment,
} from "../../../state/server";
import { resolveThemeAppearance } from "./AppearancePreferencesProvider";

function readPreferences(): Preferences | null {
  const result = appAtomRegistry.get(mobilePreferencesAtom);
  return AsyncResult.isSuccess(result) ? result.value : null;
}

function localPair(preferences: Preferences): ThemePair {
  const ids = resolveMobileThemeIds(preferences);
  return { light: syncedThemeIdOf(ids.light), dark: syncedThemeIdOf(ids.dark) };
}

/** The newest change any connected environment holds. */
function newestSyncedTheme(): {
  readonly theme: SyncedTheme | null;
  readonly environmentIds: ReadonlyArray<EnvironmentId>;
} {
  let theme: SyncedTheme | null = null;
  const environmentIds: EnvironmentId[] = [];
  for (const [environmentId, config] of appAtomRegistry.get(environmentServerConfigsAtom)) {
    environmentIds.push(environmentId);
    const candidate = config.settings.syncedTheme;
    if (candidate !== null && (theme === null || candidate.setAt > theme.setAt)) theme = candidate;
  }
  return { theme, environmentIds };
}

function adoptPatch(preferences: Preferences, theme: SyncedTheme): Partial<Preferences> {
  const published = appAtomRegistry.get(publishedEnvironmentThemesAtom);
  const copies = preferences.environmentThemes ?? [];
  const available = [
    ...published,
    ...copies.filter((copy) => !published.some((p) => p.id === copy.id)),
  ];
  const current = resolveMobileThemeIds(preferences);
  const light =
    mobileThemeIdFromSynced(theme.light, "light", available, isSystemColorsAvailable) ??
    current.light;
  const dark =
    mobileThemeIdFromSynced(theme.dark, "dark", available, isSystemColorsAvailable) ?? current.dark;
  return {
    lightThemeId: light,
    darkThemeId: dark,
    themeId: resolveThemeAppearance(preferences) === "dark" ? dark : light,
    environmentThemes: retainEnvironmentThemeCopies([light, dark], published, copies),
  };
}

async function push(environmentIds: ReadonlyArray<EnvironmentId>, theme: SyncedTheme) {
  const failures = await Promise.all(
    environmentIds.map(async (environmentId) => {
      const result = await runAtomCommand(
        appAtomRegistry,
        serverEnvironment.updateSettings,
        { environmentId, input: { patch: { syncedTheme: theme } } },
        { label: "theme sync", reportFailure: true, reportDefect: true },
      );
      if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return null;
      const error = squashAtomCommandFailure(result);
      return error instanceof Error ? error.message : String(error);
    }),
  );
  // Any environment that took it carries the change to the other devices.
  if (failures.every((failure) => failure !== null) && failures.length > 0) {
    Dialog.alert("Could not sync theme", failures.join("\n\n"));
  }
}

let baseline: ThemePair | null = null;

function evaluate(): void {
  const preferences = readPreferences();
  if (preferences === null || preferences.themeSyncEnabled !== true) return;
  const { theme: synced, environmentIds } = newestSyncedTheme();
  if (environmentIds.length === 0) return;
  const local = localPair(preferences);
  baseline ??= local;
  const seenSetAts = preferences.themeSyncSeenSetAts ?? [];
  const action = nextThemeSyncAction({
    local,
    baseline,
    synced,
    seenSetAts,
    now: new Date().toISOString(),
  });
  if (action === null) return;

  const seen = { themeSyncSeenSetAts: rememberThemeSyncSetAt(seenSetAts, action.theme.setAt) };
  if (action.type === "push") {
    baseline = local;
    appAtomRegistry.set(updateMobilePreferencesAtom, seen);
    void push(environmentIds, action.theme);
    return;
  }
  const patch = { ...adoptPatch(preferences, action.theme), ...seen };
  baseline = localPair({ ...preferences, ...patch });
  appAtomRegistry.set(updateMobilePreferencesAtom, patch);
}

/** Turning sync on adopts the environments' synced theme, or starts it from this device. */
export function setThemeSyncEnabled(enabled: boolean): void {
  baseline = null;
  appAtomRegistry.set(updateMobilePreferencesAtom, {
    themeSyncEnabled: enabled,
    themeSyncSeenSetAts: [],
  });
}

/** App-lifetime: follows and publishes the theme pair while theme sync is on. */
export function installThemeSync(): () => void {
  const unsubscribes = [
    appAtomRegistry.subscribe(mobilePreferencesAtom, evaluate),
    appAtomRegistry.subscribe(environmentServerConfigsAtom, evaluate),
    appAtomRegistry.subscribe(publishedEnvironmentThemesAtom, evaluate),
  ];
  evaluate();
  return () => {
    for (const unsubscribe of unsubscribes) unsubscribe();
  };
}
