import { useAtomValue } from "@effect/atom-react";
import { EnvironmentThemeFile } from "@t3tools/contracts";
import * as Equal from "effect/Equal";
import * as Schema from "effect/Schema";

import { appAtomRegistry, subscribeAtomChanges } from "../rpc/atomRegistry";
import { primaryServerConfigAtom, themeServerEnvironmentThemesAtom } from "../state/server";
import {
  environmentThemeDefinitionsAtom,
  environmentThemeShareState,
  followSharedThemeEdit,
  getCustomThemes,
  publishedThemeFile,
  subscribeToCustomThemes,
  updateCustomTheme,
  storePublishedEnvironmentThemes,
  type ThemeDefinition,
} from "../themePalette";
import { refreshTheme } from "./useTheme";

export function useEnvironmentThemeDefinitions(): ReadonlyArray<ThemeDefinition> {
  return useAtomValue(environmentThemeDefinitionsAtom);
}

/**
 * The palette is painted from a snapshot taken when the theme last changed, so new colors
 * only land if the active theme is re-applied.
 */
export function startEnvironmentThemeRepaint(): () => void {
  return subscribeAtomChanges(environmentThemeDefinitionsAtom, (definitions) => {
    storePublishedEnvironmentThemes(definitions);
    refreshTheme({ preservePreview: true });
  });
}

const SHARED_THEME_BASES_KEY = "t3code:shared-theme-bases:v1";
const isEnvironmentThemeFile = Schema.is(EnvironmentThemeFile);

function readSharedThemeBases(): Record<string, EnvironmentThemeFile> {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(SHARED_THEME_BASES_KEY) ?? "{}");
    if (value === null || typeof value !== "object") return {};
    return Object.fromEntries(
      Object.entries(value).filter((entry): entry is [string, EnvironmentThemeFile] =>
        isEnvironmentThemeFile(entry[1]),
      ),
    );
  } catch {
    return {};
  }
}

function followSharedThemes(): void {
  if (appAtomRegistry.get(primaryServerConfigAtom) === null) return;
  const published = appAtomRegistry.get(themeServerEnvironmentThemesAtom) ?? [];
  const bases = readSharedThemeBases();
  let basesChanged = false;
  for (const local of getCustomThemes()) {
    const match = published.find((candidate) => candidate.id === local.id);
    if (match === undefined) continue;
    const followed = followSharedThemeEdit({ local, published: match, base: bases[local.id] });
    if (followed !== null) {
      try {
        updateCustomTheme(followed);
      } catch {
        continue;
      }
    } else if (environmentThemeShareState(local, [match]) !== "shared") {
      continue;
    }
    const base = publishedThemeFile(match);
    if (!Equal.equals(bases[local.id], base)) {
      bases[local.id] = base;
      basesChanged = true;
    }
  }
  if (!basesChanged) return;
  try {
    window.localStorage.setItem(SHARED_THEME_BASES_KEY, JSON.stringify(bases));
  } catch {}
}

/** Keeps shared custom themes in step with edits made to them on other devices. */
export function startSharedThemeFollow(): () => void {
  const unsubscribes = [
    appAtomRegistry.subscribe(themeServerEnvironmentThemesAtom, followSharedThemes),
    subscribeToCustomThemes(followSharedThemes),
  ];
  followSharedThemes();
  return () => {
    for (const unsubscribe of unsubscribes) unsubscribe();
  };
}
