import { describe, expect, it } from "vite-plus/test";

import { isQuickMessageWindowRole } from "./quickMessageWindow.ts";

describe("isQuickMessageWindowRole", () => {
  it("stays the quick-message window when navigation or reload changes the hash", () => {
    const getWindowRole = () => "quick-message" as const;
    for (const hash of ["", "#/", "#/drafts", "#/settings"]) {
      expect(isQuickMessageWindowRole(getWindowRole, hash)).toBe(true);
    }
  });

  it("stays the main window when its hash is the quick-message route", () => {
    expect(isQuickMessageWindowRole(() => "main", "#/quick-message")).toBe(false);
  });

  it("uses the hash only when the shell does not provide a role getter", () => {
    expect(isQuickMessageWindowRole(undefined, "#/quick-message")).toBe(true);
    expect(isQuickMessageWindowRole(undefined, "#/quick-message/rest")).toBe(true);
    expect(isQuickMessageWindowRole(undefined, "#/")).toBe(false);
    expect(isQuickMessageWindowRole(undefined, "")).toBe(false);
  });
});
