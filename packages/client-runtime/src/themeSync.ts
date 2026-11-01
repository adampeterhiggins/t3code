import type { SyncedTheme } from "@t3tools/contracts";
import { MOBILE_DEFAULT_THEME_ID } from "@t3tools/shared/themePalettes";

/** The synced id for the standard T3 Code theme, which web stores as a bare appearance. */
export const STANDARD_SYNCED_THEME_ID = MOBILE_DEFAULT_THEME_ID;

export interface ThemePair {
  readonly light: string;
  readonly dark: string;
}

export type ThemeSyncAction =
  | { readonly type: "adopt"; readonly theme: SyncedTheme }
  | { readonly type: "push"; readonly theme: SyncedTheme }
  | null;

function themePairsEqual(left: ThemePair, right: ThemePair): boolean {
  return left.light === right.light && left.dark === right.dark;
}

const SEEN_SET_AT_LIMIT = 8;

/** Remembers a change this device adopted or pushed, newest first. */
export function rememberThemeSyncSetAt(
  seen: ReadonlyArray<string>,
  setAt: string,
): ReadonlyArray<string> {
  return [setAt, ...seen.filter((entry) => entry !== setAt)].slice(0, SEEN_SET_AT_LIMIT);
}

/**
 * A change is adopted once, unless this device pushed it: `seenSetAts` holds both, so the
 * value a push replaces is not re-adopted while the server's echo is in flight. `baseline` is
 * the local pair after the last adopt or push, so only a choice made on this device is pushed,
 * and a half it could not resolve while adopting stays local without being pushed back.
 */
export function nextThemeSyncAction(input: {
  readonly local: ThemePair;
  readonly baseline: ThemePair;
  readonly synced: SyncedTheme | null;
  readonly seenSetAts: ReadonlyArray<string>;
  readonly now: string;
}): ThemeSyncAction {
  const { synced } = input;
  if (synced !== null && !input.seenSetAts.includes(synced.setAt)) {
    return { type: "adopt", theme: synced };
  }
  // Nothing synced and nothing pushed yet: this device starts the sync.
  const started = synced !== null || input.seenSetAts.length > 0;
  if (started && themePairsEqual(input.local, input.baseline)) return null;
  if (synced !== null && themePairsEqual(input.local, synced)) return null;
  return {
    type: "push",
    theme: { light: input.local.light, dark: input.local.dark, setAt: input.now },
  };
}
