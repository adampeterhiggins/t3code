import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId, type ClientSettings } from "@t3tools/contracts";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const detached = vi.hoisted(() => ({ value: false }));

vi.mock("./quickMessageWindow", () => ({
  get isDetachedChatWindow() {
    return detached.value;
  },
}));

import { commandForProjectScript } from "../../projectScripts";
import { buildThreadRouteParams } from "../../threadRoutes";
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
  openDetachedExistingThread,
  presentationForDetachedMilestone,
  readDetachedChatPresentation,
  settleDetachedSendPresentation,
  requestDetachedComposerCompact,
  requestDetachedComposerExpanded,
  resetDetachedChatPresentationForTests,
  type DetachedPresentationMilestone,
} from "./detachedChatPresentation";

const settings = { theme: "dark" } as unknown as ClientSettings;
const destinationThread = scopeThreadRef(EnvironmentId.make("env-1"), ThreadId.make("thread-1"));

function createFloatingThreadRouter(
  initialEntry: string,
  threadBeforeLoad?: () => Promise<void> | void,
) {
  const root = createRootRoute();
  const thread = createRoute({
    getParentRoute: () => root,
    path: "/$environmentId/$threadId",
    ...(threadBeforeLoad ? { beforeLoad: threadBeforeLoad } : {}),
  });
  const draft = createRoute({
    getParentRoute: () => root,
    path: "/draft/$draftId",
  });
  return createRouter({
    routeTree: root.addChildren([draft, thread]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
}

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

  it("applies a delayed send result only while that route is still current", async () => {
    let current: string | null = "draft-a";
    let release: (milestone: DetachedPresentationMilestone | null) => void = () => undefined;
    const pending = new Promise<DetachedPresentationMilestone | null>((resolve) => {
      release = resolve;
    });
    const finishing = settleDetachedSendPresentation({
      routeThreadKey: "draft-a",
      readCurrentRouteThreadKey: () => current,
      result: pending,
    });
    current = "draft-b";
    release("foreground-draft-turn-started");
    await finishing;
    expect(readDetachedChatPresentation()).toBe("compact");
    expect(setPresentation).not.toHaveBeenCalled();

    current = "draft-a";
    await settleDetachedSendPresentation({
      routeThreadKey: "draft-a",
      readCurrentRouteThreadKey: () => current,
      result: Promise.resolve("foreground-draft-turn-started"),
    });
    expect(readDetachedChatPresentation()).toBe("expanded");
    expect(setPresentation).toHaveBeenCalledWith("expanded");

    setPresentation.mockClear();
    current = "draft-c";
    for (const milestone of [
      "draft-send-failed",
      "background-draft",
      "fanout",
      "thread-created-without-message",
    ] as const) {
      await settleDetachedSendPresentation({
        routeThreadKey: "draft-a",
        readCurrentRouteThreadKey: () => current,
        result: Promise.resolve(milestone),
      });
    }
    expect(readDetachedChatPresentation()).toBe("expanded");
    expect(setPresentation).not.toHaveBeenCalled();

    current = "draft-a";
    await settleDetachedSendPresentation({
      routeThreadKey: "draft-a",
      readCurrentRouteThreadKey: () => current,
      result: Promise.resolve("draft-send-failed"),
    });
    expect(readDetachedChatPresentation()).toBe("compact");
    expect(setPresentation).toHaveBeenCalledWith("compact");
  });

  it("expands after the open settles on the destination, even when the source view ref is null", async () => {
    let releaseDestination: () => void = () => undefined;
    const destinationReady = new Promise<void>((resolve) => {
      releaseDestination = resolve;
    });
    const router = createFloatingThreadRouter("/draft/draft-source", () => destinationReady);
    await router.load();
    // Open runs after the sending view has unmounted and cleared its route ref.
    const sourceRouteThreadKeyRef = { current: "draft-source" as string | null };
    sourceRouteThreadKeyRef.current = null;

    const opening = openDetachedExistingThread({
      navigate: () =>
        router.navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(destinationThread),
        }),
      router,
      destination: destinationThread,
    });
    await Promise.resolve();
    expect(readDetachedChatPresentation()).toBe("compact");
    expect(setPresentation).not.toHaveBeenCalled();
    expect(sourceRouteThreadKeyRef.current).toBeNull();

    releaseDestination();
    await expect(opening).resolves.toBe(true);
    expect(readDetachedChatPresentation()).toBe("expanded");
    expect(setPresentation).toHaveBeenCalledWith("expanded");
    expect(router.state.location.pathname).toBe("/env-1/thread-1");
    expect(sourceRouteThreadKeyRef.current).toBeNull();
  });

  it("does not expand when the open fails or a later route wins", async () => {
    const router = createFloatingThreadRouter("/draft/draft-source");
    await router.load();
    await expect(
      openDetachedExistingThread({
        navigate: () => Promise.reject(new Error("navigation blocked")),
        router,
        destination: destinationThread,
      }),
    ).resolves.toBe(false);
    expect(readDetachedChatPresentation()).toBe("compact");
    expect(router.state.location.pathname).toBe("/draft/draft-source");

    const blocked = createFloatingThreadRouter("/draft/draft-source", () => {
      throw new Error("navigation blocked");
    });
    await blocked.load();
    await expect(
      openDetachedExistingThread({
        navigate: () =>
          blocked.navigate({
            to: "/$environmentId/$threadId",
            params: buildThreadRouteParams(destinationThread),
          }),
        router: blocked,
        destination: destinationThread,
      }),
    ).resolves.toBe(false);
    expect(blocked.state.location.pathname).toBe("/env-1/thread-1");
    expect(blocked.state.matches.at(-1)?.status).toBe("error");
    expect(readDetachedChatPresentation()).toBe("compact");

    let releaseDestination: () => void = () => undefined;
    const destinationReady = new Promise<void>((resolve) => {
      releaseDestination = resolve;
    });
    const superseded = createFloatingThreadRouter("/draft/draft-source", () => destinationReady);
    await superseded.load();
    const opening = openDetachedExistingThread({
      navigate: () =>
        superseded.navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(destinationThread),
        }),
      router: superseded,
      destination: destinationThread,
    });
    const later = superseded.navigate({
      to: "/draft/$draftId",
      params: { draftId: "draft-later" },
    });
    releaseDestination();
    await expect(opening).resolves.toBe(false);
    await later;
    expect(superseded.state.location.pathname).toBe("/draft/draft-later");
    expect(readDetachedChatPresentation()).toBe("compact");
    expect(setPresentation).not.toHaveBeenCalled();
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
