import type { ClientSettings } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const detached = vi.hoisted(() => ({ value: false }));

vi.mock("./quickMessageWindow", () => ({
  get isDetachedChatWindow() {
    return detached.value;
  },
}));

import { commandForProjectScript } from "../../projectScripts";
import {
  adoptDetachedChatPresentation,
  applyDetachedPresentationMilestone,
  compactBackdropShouldDismiss,
  DETACHED_COMPOSER_INPUT_SELECTOR,
  detachedChatShortcutRuns,
  detachedOpenExpandsThread,
  dismissDetachedChat,
  floatingSplitPartnerInput,
  focusDetachedComposerInput,
  handleDetachedChatShow,
  noteDetachedNewDraftOpened,
  presentationForDetachedMilestone,
  readDetachedChatPresentation,
  requestDetachedComposerCompact,
  requestDetachedComposerExpanded,
  resetDetachedChatPresentationForTests,
  type DetachedPresentationMilestone,
} from "./detachedChatPresentation";

const settings = { theme: "dark" } as unknown as ClientSettings;

describe("detached chat presentation", () => {
  const setPresentation = vi.fn(async () => undefined);
  const dismiss = vi.fn(async () => undefined);

  beforeEach(() => {
    detached.value = true;
    setPresentation.mockClear();
    dismiss.mockClear();
    resetDetachedChatPresentationForTests();
    vi.stubGlobal("window", {
      desktopBridge: { quickMessage: { setPresentation, dismiss } },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("expands when a foreground draft turn or an existing thread is opened", () => {
    const expanded: ReadonlyArray<DetachedPresentationMilestone> = [
      "foreground-draft-turn-started",
      "thread-created-without-message",
      "existing-thread-opened",
    ];
    for (const milestone of expanded) {
      expect(presentationForDetachedMilestone(milestone)).toBe("expanded");
    }
  });

  it("stays compact for a failed, background, or fanout send and a new draft", () => {
    const compact: ReadonlyArray<DetachedPresentationMilestone> = [
      "draft-send-failed",
      "background-draft",
      "fanout",
      "new-draft-navigated",
    ];
    for (const milestone of compact) {
      expect(presentationForDetachedMilestone(milestone)).toBe("compact");
    }
  });

  it("leaves a server follow-up and a failed new draft on the current presentation", () => {
    expect(presentationForDetachedMilestone("server-follow-up")).toBeNull();
    expect(presentationForDetachedMilestone("new-draft-failed")).toBeNull();
    applyDetachedPresentationMilestone("foreground-draft-turn-started");
    setPresentation.mockClear();
    applyDetachedPresentationMilestone("server-follow-up");
    applyDetachedPresentationMilestone("new-draft-failed");
    expect(setPresentation).not.toHaveBeenCalled();
    expect(readDetachedChatPresentation()).toBe("expanded");
  });

  it("asks the shell to resize only from the floating window", () => {
    applyDetachedPresentationMilestone("foreground-draft-turn-started");
    expect(setPresentation).toHaveBeenCalledWith("expanded");
    applyDetachedPresentationMilestone("draft-send-failed");
    expect(setPresentation).toHaveBeenCalledWith("compact");

    detached.value = false;
    setPresentation.mockClear();
    applyDetachedPresentationMilestone("foreground-draft-turn-started");
    expect(setPresentation).not.toHaveBeenCalled();
  });

  it("adopts a shown presentation without asking the shell to resize again", () => {
    const adoptSettings = vi.fn();
    const focusInput = vi.fn();
    handleDetachedChatShow(
      { clientSettings: settings, presentation: "expanded" },
      {
        adoptSettings,
        adoptPresentation: adoptDetachedChatPresentation,
        focusInput,
      },
    );
    expect(adoptSettings).toHaveBeenCalledWith(settings);
    expect(focusInput).toHaveBeenCalledOnce();
    expect(readDetachedChatPresentation()).toBe("expanded");
    expect(setPresentation).not.toHaveBeenCalled();
  });

  it("treats a show without a presentation as compact", () => {
    handleDetachedChatShow(
      { clientSettings: settings },
      {
        adoptSettings: vi.fn(),
        adoptPresentation: adoptDetachedChatPresentation,
        focusInput: vi.fn(),
      },
    );
    expect(readDetachedChatPresentation()).toBe("compact");
    expect(setPresentation).not.toHaveBeenCalled();
  });

  it("compacts after a new draft opens and ignores a failed open", () => {
    noteDetachedNewDraftOpened(null);
    noteDetachedNewDraftOpened(undefined);
    expect(setPresentation).not.toHaveBeenCalled();
    noteDetachedNewDraftOpened({ draftId: "draft-1" });
    expect(setPresentation).toHaveBeenCalledWith("compact");
  });

  it("focuses the composer already on screen", () => {
    const editor = { focus: vi.fn() };
    const root = {
      querySelector: (selector: string) =>
        selector === DETACHED_COMPOSER_INPUT_SELECTOR ? editor : null,
    };
    expect(focusDetachedComposerInput(root as unknown as ParentNode)).toBe(true);
    expect(editor.focus).toHaveBeenCalledOnce();
    expect(focusDetachedComposerInput({ querySelector: () => null } as unknown as ParentNode)).toBe(
      false,
    );
  });

  it("hides through the existing bridge and skips a missing one", () => {
    dismissDetachedChat();
    expect(dismiss).toHaveBeenCalledOnce();
    vi.stubGlobal("window", { desktopBridge: { quickMessage: {} } });
    expect(() => {
      dismissDetachedChat();
      requestDetachedComposerExpanded();
      requestDetachedComposerCompact();
    }).not.toThrow();
  });

  it("does not mount a split partner in the floating window", () => {
    const threadRef = { environmentId: "env", threadId: "thread" };
    expect(
      floatingSplitPartnerInput({
        detached: true,
        splitHidden: false,
        serverThreadRef: threadRef,
      }),
    ).toBeNull();
    expect(
      floatingSplitPartnerInput({
        detached: false,
        splitHidden: true,
        serverThreadRef: threadRef,
      }),
    ).toBeNull();
    expect(
      floatingSplitPartnerInput({
        detached: false,
        splitHidden: false,
        serverThreadRef: null,
      }),
    ).toBeNull();
    expect(
      floatingSplitPartnerInput({
        detached: false,
        splitHidden: false,
        serverThreadRef: threadRef,
      }),
    ).toBe(threadRef);
  });

  it("drops split, terminal, preview, and project-script shortcuts only while floating", () => {
    const script = commandForProjectScript("lint");
    expect(script).not.toBeNull();
    detached.value = false;
    expect(detachedChatShortcutRuns("splitView.toggle")).toBe(true);
    expect(detachedChatShortcutRuns(script!)).toBe(true);

    detached.value = true;
    for (const command of [
      "splitView.toggle",
      "splitView.focusOther",
      "terminal.toggle",
      "terminal.new",
      "rightPanel.toggle",
      "preview.toggle",
      "preview.refresh",
      script!,
    ]) {
      expect(detachedChatShortcutRuns(command)).toBe(false);
    }
    expect(detachedChatShortcutRuns("chat.new")).toBe(true);
    expect(detachedChatShortcutRuns("thread.undo")).toBe(true);
  });

  it("dismisses a compact backdrop click that is not on the composer or a dialog", () => {
    const frame = {};
    expect(compactBackdropShouldDismiss({ target: frame, currentTarget: frame })).toBe(true);
    expect(compactBackdropShouldDismiss({ target: {}, currentTarget: frame })).toBe(false);
    expect(compactBackdropShouldDismiss({ target: null, currentTarget: frame })).toBe(false);
  });

  it("expands an existing thread open and leaves settings, projects, and drafts", () => {
    expect(detachedOpenExpandsThread("#/env-1/thread-1")).toBe(true);
    expect(detachedOpenExpandsThread("/env-1/thread-1")).toBe(true);
    expect(detachedOpenExpandsThread("#/env-1/thread-1?tab=1")).toBe(true);
    expect(detachedOpenExpandsThread("#/settings/scheduled-tasks?environmentId=env-1")).toBe(false);
    expect(detachedOpenExpandsThread("#/draft/draft-1")).toBe(false);
    expect(detachedOpenExpandsThread("#/projects/project-1")).toBe(false);
    expect(detachedOpenExpandsThread("#/quick-message")).toBe(false);
    expect(detachedOpenExpandsThread("#/pair")).toBe(false);
    expect(detachedOpenExpandsThread("#/welcome")).toBe(false);
    expect(detachedOpenExpandsThread("#/env-1/thread-1/extra")).toBe(false);
  });
});
