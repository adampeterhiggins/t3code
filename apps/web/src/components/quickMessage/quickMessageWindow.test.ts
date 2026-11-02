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
  const main = () => "main" as const;
  const isolated = () => true;
  const shared = () => false;
  const hashes = [
    "",
    "#/",
    "#/quick-message",
    "#/quick-message/rest",
    "#/draft/draft-1",
    "#/env-1/thread-1",
  ];

  it("keeps the legacy quick-message window shared across hash navigation and reload", () => {
    for (const hash of hashes) {
      expect(isQuickMessageWindowRole(quickMessage, hash)).toBe(true);
      expect(isDetachedChatWindowRole(quickMessage, shared)).toBe(false);
      expect(isDetachedChatWindowRole(quickMessage, undefined)).toBe(false);
    }
  });

  it("keeps an isolated quick-message window detached across hash navigation and reload", () => {
    for (const hash of hashes) {
      expect(isQuickMessageWindowRole(quickMessage, hash)).toBe(true);
      expect(isDetachedChatWindowRole(quickMessage, isolated)).toBe(true);
    }
  });

  it("stays the main window for a legacy route and a thread route", () => {
    for (const hash of ["#/quick-message", "#/env-1/thread-1"]) {
      expect(isQuickMessageWindowRole(main, hash)).toBe(false);
      expect(isDetachedChatWindowRole(main, isolated)).toBe(false);
      expect(isDetachedChatWindowRole(main, shared)).toBe(false);
      expect(isDetachedChatWindowRole(main, undefined)).toBe(false);
    }
  });

  it("is not detached when the isolation getter is missing, even on a thread hash", () => {
    expect(isQuickMessageWindowRole(quickMessage, "#/env-1/thread-1")).toBe(true);
    expect(isQuickMessageWindowRole(undefined, "#/draft/draft-1")).toBe(false);
    expect(isQuickMessageWindowRole(undefined, "#/quick-message")).toBe(true);
    expect(isDetachedChatWindowRole(quickMessage, undefined)).toBe(false);
    expect(isDetachedChatWindowRole(undefined, undefined)).toBe(false);
    expect(isDetachedChatWindowRole(undefined, isolated)).toBe(false);
  });
});
