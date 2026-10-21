import { describe, expect, it } from "vite-plus/test";

import { isDetachedChatWindowRole, isQuickMessageWindowRole } from "./quickMessageWindow.ts";

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

describe("isDetachedChatWindowRole", () => {
  const quickMessage = () => "quick-message" as const;

  it("keeps the legacy panel on the shared shell", () => {
    expect(isQuickMessageWindowRole(quickMessage, "#/quick-message")).toBe(true);
    expect(isDetachedChatWindowRole(quickMessage, "#/quick-message")).toBe(false);
    expect(isDetachedChatWindowRole(quickMessage, "#/quick-message/rest")).toBe(false);
  });

  it("treats a quick-message window that started on a real thread as detached after reload", () => {
    for (const hash of ["", "#/", "#/draft/draft-1", "#/env-1/thread-1"]) {
      expect(isQuickMessageWindowRole(quickMessage, hash)).toBe(true);
      expect(isDetachedChatWindowRole(quickMessage, hash)).toBe(true);
    }
  });

  it("stays the main window for both the legacy route and a thread route", () => {
    expect(isDetachedChatWindowRole(() => "main", "#/quick-message")).toBe(false);
    expect(isDetachedChatWindowRole(() => "main", "#/env-1/thread-1")).toBe(false);
    expect(isQuickMessageWindowRole(() => "main", "#/quick-message")).toBe(false);
  });

  it("cannot be detached from the hash alone when the shell has no role getter", () => {
    expect(isDetachedChatWindowRole(undefined, "#/quick-message")).toBe(false);
    expect(isDetachedChatWindowRole(undefined, "#/draft/draft-1")).toBe(false);
    expect(isDetachedChatWindowRole(undefined, "")).toBe(false);
  });
});
