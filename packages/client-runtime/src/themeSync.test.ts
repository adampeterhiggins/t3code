import { describe, expect, it } from "vite-plus/test";
import { nextThemeSyncAction, type ThemePair } from "./themeSync.ts";

const NOW = "2026-10-31T12:00:00.000Z";
const nightfall: ThemePair = { light: "t3-code", dark: "nightfall" };
const ocean: ThemePair = { light: "ocean", dark: "ocean" };
const synced = { ...nightfall, setAt: "2026-10-31T11:00:00.000Z" };

const decide = (input: {
  local: ThemePair;
  baseline?: ThemePair;
  synced: typeof synced | null;
  seen: ReadonlyArray<string>;
}) =>
  nextThemeSyncAction({
    local: input.local,
    baseline: input.baseline ?? input.local,
    synced: input.synced,
    seenSetAts: input.seen,
    now: NOW,
  });

describe("nextThemeSyncAction", () => {
  it("adopts each synced change once, even over a local change", () => {
    expect(decide({ local: ocean, synced, seen: [] })).toEqual({
      type: "adopt",
      theme: synced,
    });
    expect(decide({ local: nightfall, synced, seen: [synced.setAt] })).toBeNull();
  });

  it("does not re-adopt the value its own push replaced before the echo arrives", () => {
    expect(
      decide({ local: ocean, synced, seen: ["2026-10-31T11:30:00.000Z", synced.setAt] }),
    ).toBeNull();
  });

  it("pushes a choice made on this device", () => {
    expect(decide({ local: ocean, baseline: nightfall, synced, seen: [synced.setAt] })).toEqual({
      type: "push",
      theme: { ...ocean, setAt: NOW },
    });
  });

  it("starts the sync from this device when nothing is synced yet", () => {
    expect(decide({ local: ocean, synced: null, seen: [] })).toEqual({
      type: "push",
      theme: { ...ocean, setAt: NOW },
    });
    expect(decide({ local: ocean, synced: null, seen: [NOW] })).toBeNull();
  });

  it("keeps a half it could not resolve without pushing it back", () => {
    const keptOwnLight = { light: "material-you", dark: "nightfall" };
    expect(decide({ local: keptOwnLight, synced, seen: [synced.setAt] })).toBeNull();
  });
});
