import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { DesktopAppearanceSnapshot } from "./desktopAppearance.ts";

describe("DesktopAppearanceSnapshot", () => {
  const decode = Schema.decodeUnknownSync(DesktopAppearanceSnapshot);

  it("carries raw theme ids and unchecked custom theme entries", () => {
    const customTheme = {
      id: "harbor",
      label: "Harbor",
      appearance: "dark",
      colors: { canvas: "#10243d" },
    };
    const invalidTheme = { id: "NOT VALID", leftover: true };

    expect(
      decode({
        theme: "env-unpublished",
        appearanceMode: "system",
        halves: { light: "env-day", dark: "harbor" },
        customThemes: [customTheme, invalidTheme, null],
      }),
    ).toEqual({
      theme: "env-unpublished",
      appearanceMode: "system",
      halves: { light: "env-day", dark: "harbor" },
      customThemes: [customTheme, invalidTheme, null],
    });
  });

  it("accepts a missing mix and a single half", () => {
    expect(
      decode({
        theme: "t3-chat",
        appearanceMode: "dark",
        halves: null,
        customThemes: [],
      }).halves,
    ).toBeNull();
    expect(
      decode({
        theme: "t3-chat",
        appearanceMode: "light",
        halves: { dark: "harbor" },
        customThemes: [],
      }).halves,
    ).toEqual({ dark: "harbor" });
  });

  it("rejects an appearance mode outside light, dark, and system", () => {
    expect(() =>
      decode({
        theme: "t3-chat",
        appearanceMode: "auto",
        halves: null,
        customThemes: [],
      }),
    ).toThrow();
  });
});
