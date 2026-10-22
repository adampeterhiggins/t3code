import { describe, expect, it } from "vite-plus/test";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import { resolveQuickMessageAppearance } from "./quickMessageAppearance";
import {
  getDefaultThemeColors,
  getEnvironmentThemes,
  setEnvironmentThemes,
  GROVE_THEME,
} from "./themePalette";

const app = { theme: "light", appearance: "light" as const, halves: null };

describe("quick message appearance", () => {
  it("respects a single-mode theme when the other appearance is requested", () => {
    const previous = getEnvironmentThemes();
    try {
      setEnvironmentThemes([
        {
          id: "quick-single-dark",
          label: "Single dark",
          appearance: "dark",
          colors: getDefaultThemeColors("dark"),
        },
      ]);
      expect(
        resolveQuickMessageAppearance(
          {
            ...DEFAULT_CLIENT_SETTINGS,
            quickMessageThemeSource: "theme",
            quickMessageTheme: "quick-single-dark",
            quickMessageAppearance: "light",
          },
          app,
          false,
        ),
      ).toEqual({ theme: "quick-single-dark", appearance: "dark", contrast: 100 });
    } finally {
      setEnvironmentThemes(previous);
    }
  });
  it("follows the app by default and ignores inactive overrides", () => {
    expect(
      resolveQuickMessageAppearance(
        { ...DEFAULT_CLIENT_SETTINGS, quickMessageTheme: "grove", quickMessageAppearance: "dark" },
        app,
        true,
      ),
    ).toEqual({ theme: "light", appearance: "light", contrast: 100 });
  });

  it("adapts the app's palette and clamps extra contrast", () => {
    expect(
      resolveQuickMessageAppearance(
        {
          ...DEFAULT_CLIENT_SETTINGS,
          quickMessageThemeSource: "adapt",
          quickMessageAppearance: "dark",
          appearanceContrast: 180,
        },
        { ...app, theme: GROVE_THEME.id },
        false,
      ),
    ).toEqual({ theme: GROVE_THEME.id, appearance: "dark", contrast: 200 });
  });

  it("selects the app's dark half when adapting to system appearance", () => {
    expect(
      resolveQuickMessageAppearance(
        {
          ...DEFAULT_CLIENT_SETTINGS,
          quickMessageThemeSource: "adapt",
          quickMessageAppearance: "system",
        },
        { ...app, halves: { dark: GROVE_THEME.id } },
        true,
      ),
    ).toEqual({ theme: GROVE_THEME.id, appearance: "dark", contrast: 140 });
  });

  it("keeps independent themes separate from the app's mixed halves", () => {
    expect(
      resolveQuickMessageAppearance(
        {
          ...DEFAULT_CLIENT_SETTINGS,
          quickMessageThemeSource: "theme",
          quickMessageTheme: GROVE_THEME.id,
          quickMessageAppearance: "dark",
        },
        { ...app, halves: { dark: "t3-chat" } },
        false,
      ),
    ).toEqual({ theme: GROVE_THEME.id, appearance: "dark", contrast: 100 });
  });

  it("falls back to the app if an independent theme was removed", () => {
    expect(
      resolveQuickMessageAppearance(
        {
          ...DEFAULT_CLIENT_SETTINGS,
          quickMessageThemeSource: "theme",
          quickMessageTheme: "removed-theme",
        },
        app,
        true,
      ),
    ).toEqual({ theme: "light", appearance: "light", contrast: 100 });
  });

  it("lets a stock theme use the explicitly selected appearance", () => {
    expect(
      resolveQuickMessageAppearance(
        {
          ...DEFAULT_CLIENT_SETTINGS,
          quickMessageThemeSource: "theme",
          quickMessageTheme: "dark",
          quickMessageAppearance: "light",
        },
        app,
        false,
      ).appearance,
    ).toBe("light");
  });
});
