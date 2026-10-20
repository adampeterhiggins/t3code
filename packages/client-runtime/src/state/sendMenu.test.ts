import { describe, expect, it } from "vite-plus/test";

import {
  draftMenuLabel,
  findComposerSendMenuAction,
  resolveComposerSendMenu,
  type ComposerSendMenuInput,
} from "./sendMenu.ts";

const base: ComposerSendMenuInput = {
  hasContent: true,
  running: false,
  canSteer: true,
  activeTurnDefault: "queue",
  canSendInNewThread: true,
  canSaveDraft: true,
  isEditingQueuedMessage: false,
  drafts: [],
};

const ids = (input: Partial<ComposerSendMenuInput>) =>
  resolveComposerSendMenu({ ...base, ...input }).map((entry) => entry.id);

describe("resolveComposerSendMenu", () => {
  it("offers send, a new thread, and saving a draft when idle", () => {
    expect(ids({})).toEqual(["send", "send-in-new-thread", "save-draft"]);
  });

  it("lists the thread's drafts in a submenu when there are any", () => {
    const menu = resolveComposerSendMenu({ ...base, drafts: [{ id: "d1", text: "Fix it" }] });
    const openDraft = menu.find((entry) => entry.id === "open-draft");
    expect(openDraft?.label).toBe("Open draft (1)");
    expect(findComposerSendMenuAction(menu, "open-draft:d1")).toEqual({
      type: "open-draft",
      draftId: "d1",
    });
  });

  it("checks the follow-up default while a turn runs", () => {
    const menu = resolveComposerSendMenu({ ...base, running: true, activeTurnDefault: "steer" });
    expect(menu.slice(0, 2).map((entry) => [entry.id, entry.checked])).toEqual([
      ["queue", false],
      ["steer", true],
    ]);
  });

  it("only queues while the active turn cannot take steering", () => {
    expect(ids({ running: true, canSteer: false })).toEqual([
      "queue",
      "send-in-new-thread",
      "save-draft",
    ]);
  });

  it("offers only the drafts when the composer is empty", () => {
    expect(ids({ hasContent: false })).toEqual([]);
    expect(ids({ hasContent: false, drafts: [{ id: "d1", text: "x" }] })).toEqual([
      "drafts-header",
      "open-draft:d1",
    ]);
  });

  it("lets a queued message move back to drafts while editing it", () => {
    expect(ids({ isEditingQueuedMessage: true })).toEqual([
      "update-queued",
      "move-to-drafts",
      "cancel-edit",
    ]);
  });

  it("keeps saving a draft available while sending is not", () => {
    const menu = resolveComposerSendMenu({ ...base, running: true, sendDisabled: true });
    expect(menu.map((entry) => [entry.id, entry.disabled === true])).toEqual([
      ["queue", true],
      ["steer", true],
      ["send-in-new-thread", true],
      ["save-draft", false],
    ]);
  });

  it("omits drafts where the composer is an unsaved new thread", () => {
    expect(ids({ canSaveDraft: false, drafts: [{ id: "d1", text: "x" }] })).toEqual([
      "send",
      "send-in-new-thread",
    ]);
  });
});

describe("draftMenuLabel", () => {
  it("uses the first line and truncates long text", () => {
    expect(draftMenuLabel("  First line\nsecond")).toBe("First line");
    expect(draftMenuLabel("x".repeat(80))).toHaveLength(48);
    expect(draftMenuLabel("   ")).toBe("Untitled draft");
  });
});
