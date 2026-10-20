import { resolveComposerSendMenu } from "@t3tools/client-runtime/state/send-menu";
import { describe, expect, it } from "vite-plus/test";

import { composerSendMenuActions } from "./composerSendMenu";

const base = {
  hasContent: true,
  running: false,
  canSteer: false,
  activeTurnDefault: "queue",
  canSendInNewThread: false,
  canSaveDraft: true,
  isEditingQueuedMessage: false,
  drafts: [],
} as const;

describe("composerSendMenuActions", () => {
  it("keeps the follow-up choice and its subtitles while a turn runs", () => {
    const menu = composerSendMenuActions(
      resolveComposerSendMenu({ ...base, running: true, canSteer: true, canSaveDraft: false }),
      "ios",
    );

    expect(menu.actions).toEqual([
      { id: "queue", title: "Queue", subtitle: "Run after the current turn", state: "on" },
      {
        id: "steer",
        title: "Steer now",
        subtitle: "Interrupt what the agent is doing",
        state: "off",
      },
    ]);
  });

  it("separates drafts into an inline section on iOS and flattens it on Android", () => {
    const items = resolveComposerSendMenu({
      ...base,
      drafts: [{ id: "draft-1", text: "Follow up on tests" }],
    });

    const ios = composerSendMenuActions(items, "ios");
    expect(ios.actions.map((action) => action.displayInline)).toEqual([true, true]);
    expect(ios.actions[1]?.subactions?.map((action) => action.id)).toEqual([
      "save-draft",
      "open-draft",
    ]);
    expect(ios.actions[1]?.subactions?.[0]?.subtitle).toBe("Keep it in this thread");
    expect(ios.actions[1]?.subactions?.[1]?.subactions?.[0]).toMatchObject({
      id: "open-draft:draft-1",
      title: "Follow up on tests",
    });

    const android = composerSendMenuActions(items, "android");
    expect(android.actions.map((action) => action.id)).toEqual([
      "send",
      "save-draft",
      "open-draft",
    ]);
  });

  it("titles an empty composer's menu with its drafts header", () => {
    const menu = composerSendMenuActions(
      resolveComposerSendMenu({
        ...base,
        hasContent: false,
        drafts: [{ id: "draft-1", text: "" }],
      }),
      "android",
    );

    expect(menu.title).toBe("Drafts in this thread");
    expect(menu.actions.map((action) => action.title)).toEqual(["Untitled draft"]);
  });
});
