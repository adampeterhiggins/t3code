import { assert, it } from "@effect/vitest";
import {
  DEFAULT_CLIENT_SETTINGS,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  type ClientSettings,
  type DesktopQuickMessagePresentation,
  type DesktopQuickMessageSubmission,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";
import * as TestClock from "effect/testing/TestClock";
import type * as Electron from "electron";
import { beforeEach, vi } from "vite-plus/test";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as ElectronMenu from "../electron/ElectronMenu.ts";
import * as ElectronProtocol from "../electron/ElectronProtocol.ts";
import * as ElectronShell from "../electron/ElectronShell.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as NativeWindowInteraction from "../electron/NativeWindowInteraction.ts";
import {
  QUICK_MESSAGE_SHOW_EVENT_CHANNEL,
  QUICK_MESSAGE_SUBMIT_EVENT_CHANNEL,
} from "../ipc/channels.ts";
import * as DesktopClientSettings from "../settings/DesktopClientSettings.ts";
import * as DesktopWindow from "../window/DesktopWindow.ts";
import { QUICK_MESSAGE_WINDOW_ROLE_ARGUMENT } from "../windowRole.ts";
import * as DesktopQuickMessage from "./DesktopQuickMessage.ts";

interface FakeWebContents {
  readonly id: number;
  readonly sent: Array<readonly [string, unknown]>;
  windowOpenHandler: ((details: { readonly url: string }) => { action: "deny" }) | null;
  send(channel: string, payload: unknown): void;
  on(event: string, listener: (...args: unknown[]) => void): void;
  once(event: string, listener: (...args: unknown[]) => void): void;
  removeListener(event: string, listener: (...args: unknown[]) => void): void;
  emit(event: string, ...args: unknown[]): void;
  listenerCount(event: string): number;
  setWindowOpenHandler(handler: (details: { readonly url: string }) => { action: "deny" }): void;
  setBackgroundThrottling(): void;
  focus(): void;
  isDestroyed(): boolean;
  getURL(): string;
  reload(): void;
}

interface FakePanel {
  loadedUrl: string | null;
  visible: boolean;
  destroyed: boolean;
  focused: boolean;
  reloads: number;
  readonly loads: string[];
  rect: Electron.Rectangle;
  readonly bounds: Electron.Rectangle[];
  readonly additionalArguments: readonly string[];
  readonly session: unknown;
  readonly webContents: FakeWebContents;
  loadSnapshot: {
    auxiliary: boolean;
    contextMenu: boolean;
    willNavigate: boolean;
    windowOpen: boolean;
  } | null;
  emit(event: string, ...args: unknown[]): void;
  show(): void;
  hide(): void;
  focus(): void;
  isFocused(): boolean;
  isVisible(): boolean;
  isDestroyed(): boolean;
  destroy(): void;
  getBounds(): Electron.Rectangle;
}

const electron = vi.hoisted(() => {
  class Emitter {
    private readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>();

    on(event: string, listener: (...args: unknown[]) => void) {
      const set = this.listeners.get(event) ?? new Set();
      set.add(listener);
      this.listeners.set(event, set);
    }

    once(event: string, listener: (...args: unknown[]) => void) {
      const wrapped = (...args: unknown[]) => {
        this.off(event, wrapped);
        listener(...args);
      };
      this.on(event, wrapped);
    }

    off(event: string, listener: (...args: unknown[]) => void) {
      this.listeners.get(event)?.delete(listener);
    }

    emit(event: string, ...args: unknown[]) {
      // Copy first: a listener can remove itself while this event is firing.
      const listeners = this.listeners.get(event);
      if (listeners === undefined) return;
      for (const listener of Array.from(listeners)) listener(...args);
    }

    listenerCount(event: string) {
      return this.listeners.get(event)?.size ?? 0;
    }
  }

  return {
    Emitter,
    shortcuts: new Map<string, () => void>(),
    takenAccelerators: new Set<string>(),
    panels: [] as FakePanel[],
    workArea: { x: 0, y: 0, width: 1440, height: 900 },
    cursor: { x: 0, y: 0 },
    displays: null as Array<{
      id: number;
      bounds: Electron.Rectangle;
      workArea: Electron.Rectangle;
    }> | null,
    fromPartition: vi.fn((partition: string) => ({ partition })),
    appListeners: new Map<string, Array<() => void>>(),
  };
});

const fakeWebContents = (id: number): FakeWebContents => {
  const emitter = new electron.Emitter();
  return Object.assign(emitter, {
    id,
    sent: [] as Array<readonly [string, unknown]>,
    windowOpenHandler: null as FakeWebContents["windowOpenHandler"],
    send(channel: string, payload: unknown) {
      this.sent.push([channel, payload]);
    },
    setWindowOpenHandler(handler: (details: { readonly url: string }) => { action: "deny" }) {
      this.windowOpenHandler = handler;
    },
    setBackgroundThrottling() {},
    focus() {},
    isDestroyed: () => false,
    getURL: () => "",
    reload() {},
    removeListener(event: string, listener: (...args: unknown[]) => void) {
      emitter.off(event, listener);
    },
  });
};

vi.mock("electron", () => {
  class BrowserWindow extends electron.Emitter {
    loadedUrl: string | null = null;
    visible = false;
    destroyed = false;
    focused = false;
    reloads = 0;
    readonly loads: string[] = [];
    rect: Electron.Rectangle = { x: 0, y: 0, width: 0, height: 0 };
    readonly bounds: Electron.Rectangle[] = [];
    readonly additionalArguments: readonly string[];
    readonly session: unknown;
    readonly webContents: FakeWebContents;
    loadSnapshot: FakePanel["loadSnapshot"] = null;

    constructor(options?: {
      webPreferences?: { additionalArguments?: readonly string[]; session?: unknown };
    }) {
      super();
      this.additionalArguments = options?.webPreferences?.additionalArguments ?? [];
      this.session = options?.webPreferences?.session;
      this.webContents = fakeWebContents(100 + electron.panels.length);
      this.webContents.getURL = () => this.loadedUrl ?? "";
      this.webContents.reload = () => {
        this.reloads += 1;
      };
      electron.panels.push(this);
    }

    override emit(event: string, ...args: unknown[]) {
      if (event === "blur") this.focused = false;
      if (event === "focus") this.focused = true;
      super.emit(event, ...args);
    }

    setAlwaysOnTop() {}
    setVisibleOnAllWorkspaces() {}
    loadURL(url: string) {
      this.loads.push(url);
      this.loadedUrl = url;
      this.loadSnapshot = {
        auxiliary: ElectronWindow.isAuxiliaryWindow(this as unknown as Electron.BrowserWindow),
        contextMenu: this.webContents.listenerCount("context-menu") > 0,
        willNavigate: this.webContents.listenerCount("will-navigate") > 0,
        windowOpen: this.webContents.windowOpenHandler !== null,
      };
      return Promise.resolve();
    }
    getBounds() {
      return { ...this.rect };
    }
    setBounds(bounds: Electron.Rectangle) {
      this.rect = { ...bounds };
      this.bounds.push({ ...bounds });
    }
    show() {
      this.visible = true;
    }
    hide() {
      this.visible = false;
      this.focused = false;
      this.emit("hide");
    }
    focus() {
      this.focused = true;
    }
    isVisible() {
      return this.visible;
    }
    isFocused() {
      return this.focused;
    }
    isDestroyed() {
      return this.destroyed;
    }
    destroy() {
      this.destroyed = true;
      this.emit("closed");
    }
  }

  return {
    BrowserWindow,
    app: {
      on: (event: string, listener: () => void) => {
        const listeners = electron.appListeners.get(event) ?? [];
        listeners.push(listener);
        electron.appListeners.set(event, listeners);
      },
      removeListener: (event: string, listener: () => void) => {
        const listeners = electron.appListeners.get(event) ?? [];
        electron.appListeners.set(
          event,
          listeners.filter((candidate) => candidate !== listener),
        );
      },
    },
    session: { fromPartition: electron.fromPartition },
    globalShortcut: {
      register: (accelerator: string, callback: () => void) => {
        if (electron.takenAccelerators.has(accelerator)) return false;
        electron.shortcuts.set(accelerator, callback);
        return true;
      },
      unregister: (accelerator: string) => {
        electron.shortcuts.delete(accelerator);
      },
    },
    screen: {
      getCursorScreenPoint: () => electron.cursor,
      getDisplayNearestPoint: (point: { x: number; y: number }) => {
        const displays = electron.displays ?? [
          {
            id: 1,
            bounds: electron.workArea,
            workArea: electron.workArea,
          },
        ];
        const containing = displays.find(
          (display) =>
            point.x >= display.bounds.x &&
            point.x < display.bounds.x + display.bounds.width &&
            point.y >= display.bounds.y &&
            point.y < display.bounds.y + display.bounds.height,
        );
        if (containing !== undefined) return containing;
        let nearest = displays[0]!;
        let nearestDistance = Number.POSITIVE_INFINITY;
        for (const display of displays) {
          const dx = display.bounds.x + display.bounds.width / 2 - point.x;
          const dy = display.bounds.y + display.bounds.height / 2 - point.y;
          const distance = dx * dx + dy * dy;
          if (distance < nearestDistance) {
            nearest = display;
            nearestDistance = distance;
          }
        }
        return nearest;
      },
    },
  };
});

const externalOpens: string[] = [];
const menuOwners: FakePanel[] = [];
let nativeDuringMenu = false;

beforeEach(() => {
  electron.shortcuts.clear();
  electron.takenAccelerators.clear();
  electron.panels.length = 0;
  electron.workArea = { x: 0, y: 0, width: 1440, height: 900 };
  electron.cursor = { x: 0, y: 0 };
  electron.displays = null;
  electron.fromPartition.mockReset();
  electron.fromPartition.mockImplementation((partition: string) => ({ partition }));
  electron.appListeners.clear();
  externalOpens.length = 0;
  menuOwners.length = 0;
  nativeDuringMenu = false;
});

const ACCELERATOR = "Alt+/";
const enabled: ClientSettings = { ...DEFAULT_CLIENT_SETTINGS, quickMessageEnabled: true };
const settle = Effect.promise(() => Promise.resolve());

const screenDisplay = (id: number, x: number, y: number, width: number, height: number) => {
  const area = { x, y, width, height };
  return { id, bounds: area, workArea: area };
};

const PRIMARY_DISPLAY = screenDisplay(1, 0, 0, 1440, 900);
const SECONDARY_DISPLAY = screenDisplay(2, 2000, 0, 1440, 900);

type RendererExitReason = "clean-exit" | "abnormal-exit" | "killed" | "crashed" | "oom";

const emitRendererGone = (panel: FakePanel, reason: RendererExitReason) => {
  panel.webContents.emit("render-process-gone", {}, { reason, exitCode: 1 });
};

const showCount = (panel: FakePanel) => panel.webContents.sent.length;

const reportedState = (
  shortcutRegistered: boolean,
  message: string | null,
  presentation: DesktopQuickMessagePresentation = "compact",
) => ({ shortcutRegistered, message, presentation });

const submission: DesktopQuickMessageSubmission = {
  type: "draft",
  environmentId: EnvironmentId.make("environment-1"),
  projectId: ProjectId.make("project-1"),
  text: "Fix the flaky test",
  files: [],
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.5" },
  runtimeMode: "full-access",
  interactionMode: "default",
  attachments: [],
};

const showEvent = (
  presentation: DesktopQuickMessagePresentation = "compact",
): readonly [string, unknown] => [
  QUICK_MESSAGE_SHOW_EVENT_CHANNEL,
  { clientSettings: enabled, presentation },
];

const layerTest = (main: { webContents: FakeWebContents } | null, revealed: Array<unknown>) =>
  Layer.mergeAll(
    Layer.succeed(
      DesktopEnvironment.DesktopEnvironment,
      DesktopEnvironment.DesktopEnvironment.of({
        platform: "darwin",
        displayName: "T3 Code (Dev)",
        preloadPath: "/app/preload.js",
        isDevelopment: false,
      } as DesktopEnvironment.DesktopEnvironment["Service"]),
    ),
    Layer.succeed(
      DesktopClientSettings.DesktopClientSettings,
      DesktopClientSettings.DesktopClientSettings.of({
        get: Effect.succeed(Option.some(enabled)),
        set: () => Effect.void,
      }),
    ),
    Layer.mock(ElectronWindow.ElectronWindow)({
      main: Effect.succeed(Option.fromNullishOr(main as unknown as Electron.BrowserWindow | null)),
      reveal: (window) => Effect.sync(() => void revealed.push(window)),
    }),
    Layer.mock(DesktopWindow.DesktopWindow)({
      revealOrCreateMain: Effect.sync(() => {
        revealed.push("created");
        return {} as Electron.BrowserWindow;
      }),
    }),
    Layer.mock(ElectronMenu.ElectronMenu)({
      popupTemplate: (input) =>
        Effect.sync(() => {
          nativeDuringMenu = NativeWindowInteraction.nativeWindowInteractionInProgress(
            input.window,
          );
          menuOwners.push(input.window as unknown as FakePanel);
        }),
      setApplicationMenu: () => Effect.void,
      sendActionToFirstResponder: () => Effect.void,
      showContextMenu: () => Effect.succeed(Option.none()),
    }),
    Layer.mock(ElectronShell.ElectronShell)({
      openExternal: (url) =>
        Effect.sync(() => {
          externalOpens.push(String(url));
          return true;
        }),
      openSystemSettings: () => Effect.succeed(false),
      copyText: () => Effect.void,
      showItemInFolder: () => Effect.void,
    }),
  );

const openReadyPanel = (service: DesktopQuickMessage.DesktopQuickMessage["Service"]) =>
  Effect.gen(function* () {
    electron.shortcuts.get(ACCELERATOR)!();
    const panel = electron.panels[0]!;
    yield* service.setPanelReady;
    return panel;
  });

it.effect("registers the shortcut only while quick message is on", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const service = yield* DesktopQuickMessage.make;
      yield* service.initialize;
      assert.isTrue(electron.shortcuts.has(ACCELERATOR));
      assert.deepEqual(yield* service.state, reportedState(true, null));

      yield* service.configure({ ...enabled, quickMessageEnabled: false });
      assert.equal(electron.shortcuts.size, 0);
      assert.deepEqual(yield* service.state, reportedState(false, null));
    }),
  ).pipe(Effect.provide(layerTest(null, []))),
);

it.effect("says so when another app holds the shortcut", () =>
  Effect.scoped(
    Effect.gen(function* () {
      electron.takenAccelerators.add(ACCELERATOR);
      const service = yield* DesktopQuickMessage.make;
      yield* service.initialize;
      assert.deepEqual(
        yield* service.state,
        reportedState(false, DesktopQuickMessage.QUICK_MESSAGE_SHORTCUT_TAKEN_MESSAGE),
      );
    }),
  ).pipe(Effect.provide(layerTest(null, []))),
);

it.effect("lets go of the shortcut while a new one is being recorded", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const service = yield* DesktopQuickMessage.make;
      yield* service.initialize;
      yield* service.setShortcutSuppressed(true);
      assert.equal(electron.shortcuts.size, 0);
      yield* service.setShortcutSuppressed(false);
      assert.isTrue(electron.shortcuts.has(ACCELERATOR));
    }),
  ).pipe(Effect.provide(layerTest(null, []))),
);

it.effect("keeps the legacy panel on the default session and quick-message route", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const service = yield* DesktopQuickMessage.make;
      yield* service.initialize;
      electron.shortcuts.get(ACCELERATOR)!();
      const panel = electron.panels[0]!;
      assert.deepEqual(panel.additionalArguments, [QUICK_MESSAGE_WINDOW_ROLE_ARGUMENT]);
      assert.equal(panel.session, undefined);
      assert.equal(electron.fromPartition.mock.calls.length, 0);
      assert.equal(panel.loadedUrl, DesktopQuickMessage.quickMessagePanelEntryUrl(false, false));
      assert.deepEqual(panel.loadSnapshot, {
        auxiliary: true,
        contextMenu: true,
        willNavigate: true,
        windowOpen: true,
      });
    }),
  ).pipe(Effect.provide(layerTest(null, []))),
);

it("builds the detached shell on the persistent partition and app root", () => {
  const partitionSession = { partition: DesktopQuickMessage.QUICK_MESSAGE_PARTITION };
  electron.fromPartition.mockReturnValue(partitionSession);
  const window = DesktopQuickMessage.createQuickMessagePanelWindow({
    detached: true,
    isMac: true,
    displayName: "T3 Code",
    preloadPath: "/app/preload.js",
  }) as unknown as FakePanel;
  assert.deepEqual(electron.fromPartition.mock.calls, [
    [DesktopQuickMessage.QUICK_MESSAGE_PARTITION],
  ]);
  assert.strictEqual(window.session, partitionSession);
  assert.deepEqual(window.additionalArguments, [QUICK_MESSAGE_WINDOW_ROLE_ARGUMENT]);
  assert.equal(DesktopQuickMessage.quickMessagePanelEntryUrl(false, true), "t3code://app/#/");
  assert.equal(
    DesktopQuickMessage.quickMessagePanelEntryUrl(false, false),
    "t3code://app/#/quick-message",
  );
});

it.effect("shows the panel once its page is ready, and the shortcut toggles a focused panel", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const service = yield* DesktopQuickMessage.make;
      yield* service.initialize;
      const toggle = electron.shortcuts.get(ACCELERATOR)!;

      toggle();
      const panel = electron.panels[0]!;
      assert.isTrue(panel.loadedUrl?.endsWith("#/quick-message"));
      assert.isFalse(panel.visible);

      yield* service.setPanelReady;
      assert.isTrue(panel.visible);
      assert.isTrue(panel.isFocused());
      assert.deepEqual(panel.webContents.sent, [showEvent()]);
      assert.deepEqual(
        panel.bounds.at(-1),
        DesktopQuickMessage.quickMessagePanelBounds(electron.workArea),
      );

      toggle();
      assert.isFalse(panel.visible);
      toggle();
      assert.isTrue(panel.visible);
      assert.equal(electron.panels.length, 1);
      assert.equal(panel.loadedUrl, DesktopQuickMessage.quickMessagePanelEntryUrl(false, false));
    }),
  ).pipe(Effect.provide(layerTest(null, []))),
);

it.effect("focuses a visible unfocused panel and reopens the same presentation", () =>
  Effect.scoped(
    Effect.gen(function* () {
      electron.displays = [PRIMARY_DISPLAY, SECONDARY_DISPLAY];
      electron.cursor = { x: 10, y: 10 };
      const service = yield* DesktopQuickMessage.make;
      yield* service.initialize;
      const panel = yield* openReadyPanel(service);
      const toggle = electron.shortcuts.get(ACCELERATOR)!;
      yield* service.setPresentation("expanded");
      const showsBefore = panel.webContents.sent.length;

      panel.focused = false;
      toggle();
      assert.isTrue(panel.visible);
      assert.isTrue(panel.isFocused());
      assert.equal(panel.webContents.sent.length, showsBefore);
      assert.equal(electron.panels.length, 1);

      toggle();
      assert.isFalse(panel.visible);
      electron.cursor = { x: 2100, y: 10 };
      toggle();
      assert.isTrue(panel.visible);
      assert.equal(electron.panels.length, 1);
      assert.equal(panel.loadedUrl, DesktopQuickMessage.quickMessagePanelEntryUrl(false, false));
      assert.equal(panel.bounds.at(-1)?.height, 760);
      assert.equal(panel.bounds.at(-1)?.width, 916);
      // Expanded stays on the display where it was placed, not the cursor's.
      assert.equal(panel.bounds.at(-1)?.x, 262);
      assert.deepEqual(panel.webContents.sent.at(-1), showEvent("expanded"));
      assert.deepEqual(yield* service.state, reportedState(true, null, "expanded"));

      yield* service.setPresentation("compact");
      assert.equal(panel.bounds.at(-1)?.height, 520);
      assert.equal(panel.bounds.at(-1)?.x, 2262);
      yield* service.setPresentation("expanded");
      assert.equal(panel.bounds.at(-1)?.height, 760);
      assert.equal(panel.bounds.at(-1)?.width, 916);
      assert.equal(panel.bounds.at(-1)?.x, 262);
    }),
  ).pipe(Effect.provide(layerTest(null, []))),
);

it.effect("hides compact on blur, keeps expanded, and ignores menu-close focus ordering", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const service = yield* DesktopQuickMessage.make;
      yield* service.initialize;
      const panel = yield* openReadyPanel(service);

      const end = NativeWindowInteraction.beginNativeWindowInteraction(
        panel as unknown as Electron.BrowserWindow,
      );
      panel.emit("blur");
      yield* settle;
      assert.isTrue(panel.visible);
      assert.isTrue(
        NativeWindowInteraction.nativeWindowInteractionInProgress(
          panel as unknown as Electron.BrowserWindow,
        ),
      );
      end();
      assert.isFalse(
        NativeWindowInteraction.nativeWindowInteractionInProgress(
          panel as unknown as Electron.BrowserWindow,
        ),
      );
      yield* settle;
      assert.isTrue(panel.visible);

      panel.emit("blur");
      panel.emit("focus");
      yield* settle;
      assert.isTrue(panel.visible);

      panel.emit("blur");
      yield* settle;
      assert.isFalse(panel.visible);
      assert.isFalse(panel.destroyed);

      electron.shortcuts.get(ACCELERATOR)!();
      yield* service.setPresentation("expanded");
      panel.emit("blur");
      yield* settle;
      assert.isTrue(panel.visible);
      assert.equal(electron.panels.length, 1);
    }),
  ).pipe(Effect.provide(layerTest(null, []))),
);

it.effect("reloads a crashed panel before it is ready and does not replay show or submit", () => {
  const main = { webContents: fakeWebContents(1) };
  const revealed: Array<unknown> = [];
  return Effect.scoped(
    Effect.gen(function* () {
      const service = yield* DesktopQuickMessage.make;
      yield* service.initialize;
      const waiting = electron.shortcuts.get(ACCELERATOR)!;
      waiting();
      const panel = electron.panels[0]!;
      const entry = DesktopQuickMessage.quickMessagePanelEntryUrl(false, false);
      assert.equal(panel.loads.length, 1);
      assert.equal(panel.loadedUrl, entry);

      emitRendererGone(panel, "crashed");
      yield* service.setPanelReady;
      assert.isFalse(panel.visible);
      assert.equal(showCount(panel), 0);
      yield* TestClock.adjust(499);
      assert.equal(panel.reloads, 0);
      yield* TestClock.adjust(1);
      assert.equal(panel.reloads, 1);
      assert.equal(panel.loads.length, 1);
      assert.equal(panel.loadedUrl, entry);
      assert.equal(electron.panels.length, 1);
      panel.webContents.emit("did-start-navigation", {
        isMainFrame: true,
        isSameDocument: false,
      });
      assert.equal(showCount(panel), 0);
      yield* service.setPanelReady;
      assert.isTrue(panel.visible);
      assert.deepEqual(panel.webContents.sent, [showEvent()]);

      panel.webContents.emit("did-start-navigation", {
        isMainFrame: true,
        isSameDocument: false,
      });
      yield* service.setPanelReady;
      assert.deepEqual(panel.webContents.sent, [showEvent()]);

      panel.webContents.emit("did-start-navigation", {
        isMainFrame: false,
        isSameDocument: false,
      });
      panel.webContents.emit("did-start-navigation", {
        isMainFrame: true,
        isSameDocument: true,
      });
      electron.shortcuts.get(ACCELERATOR)!();
      assert.isFalse(panel.visible);
      electron.shortcuts.get(ACCELERATOR)!();
      assert.isTrue(panel.visible);
      assert.equal(showCount(panel), 2);

      electron.shortcuts.get(ACCELERATOR)!();
      assert.isFalse(panel.visible);
      const hiddenReloads = panel.reloads;
      emitRendererGone(panel, "crashed");
      yield* TestClock.adjust(500);
      assert.equal(panel.reloads, hiddenReloads + 1);
      yield* service.setPanelReady;
      assert.isFalse(panel.visible);
      assert.equal(showCount(panel), 2);

      yield* service.submit(submission);
      const submitReloads = panel.reloads;
      emitRendererGone(panel, "crashed");
      yield* TestClock.adjust(500);
      assert.equal(panel.reloads, submitReloads + 1);
      yield* service.setReceiverReady(main.webContents as unknown as Electron.WebContents, true);
      assert.deepEqual(main.webContents.sent, [[QUICK_MESSAGE_SUBMIT_EVENT_CHANNEL, submission]]);
      yield* service.setReceiverReady(main.webContents as unknown as Electron.WebContents, true);
      assert.equal(main.webContents.sent.length, 1);
      assert.equal(
        panel.webContents.sent.filter(([channel]) => channel === QUICK_MESSAGE_SUBMIT_EVENT_CHANNEL)
          .length,
        0,
      );
    }),
  ).pipe(Effect.provide(layerTest(main, revealed)));
});

it.effect("shows a visible panel once after reload and stays hidden if dismissed first", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const service = yield* DesktopQuickMessage.make;
      yield* service.initialize;
      const panel = yield* openReadyPanel(service);
      const toggle = electron.shortcuts.get(ACCELERATOR)!;
      const entry = DesktopQuickMessage.quickMessagePanelEntryUrl(false, false);
      const shows = showCount(panel);

      emitRendererGone(panel, "crashed");
      yield* service.setPanelReady;
      assert.equal(showCount(panel), shows);
      yield* TestClock.adjust(499);
      assert.equal(panel.reloads, 0);
      yield* TestClock.adjust(1);
      assert.equal(panel.reloads, 1);
      assert.equal(panel.loads.length, 1);
      assert.equal(panel.loadedUrl, entry);
      assert.equal(electron.panels.length, 1);
      panel.webContents.emit("did-start-navigation", {
        isMainFrame: true,
        isSameDocument: false,
      });
      assert.equal(showCount(panel), shows);
      yield* service.setPanelReady;
      assert.isTrue(panel.visible);
      assert.equal(showCount(panel), shows + 1);
      yield* service.setPanelReady;
      assert.equal(showCount(panel), shows + 1);

      emitRendererGone(panel, "abnormal-exit");
      toggle();
      assert.isFalse(panel.visible);
      yield* TestClock.adjust(500);
      assert.equal(panel.reloads, 2);
      yield* service.setPanelReady;
      assert.isFalse(panel.visible);
      assert.equal(showCount(panel), shows + 1);
    }),
  ).pipe(Effect.provide(layerTest(null, []))),
);

it.effect("caps automatic crash recovery and still reloads once for a later shortcut", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const service = yield* DesktopQuickMessage.make;
      yield* service.initialize;
      const panel = yield* openReadyPanel(service);
      const toggle = electron.shortcuts.get(ACCELERATOR)!;
      assert.equal(panel.loads.length, 1);
      assert.equal(showCount(panel), 1);

      emitRendererGone(panel, "clean-exit");
      yield* TestClock.adjust(500);
      assert.equal(panel.reloads, 0);
      yield* service.setPanelReady;
      assert.equal(showCount(panel), 1);

      for (const reason of ["killed", "oom", "crashed"] as const) {
        const reloads = panel.reloads;
        emitRendererGone(panel, reason);
        yield* TestClock.adjust(500);
        assert.equal(panel.reloads, reloads + 1);
        assert.equal(showCount(panel), 1);
        assert.equal(panel.loads.length, 1);
      }

      const capped = panel.reloads;
      emitRendererGone(panel, "killed");
      yield* service.setPanelReady;
      yield* TestClock.adjust(500);
      assert.equal(panel.reloads, capped);
      assert.equal(showCount(panel), 1);
      assert.equal(electron.panels.length, 1);

      toggle();
      assert.isFalse(panel.visible);
      toggle();
      yield* TestClock.adjust(499);
      assert.equal(panel.reloads, capped);
      yield* TestClock.adjust(1);
      assert.equal(panel.reloads, capped + 1);
      assert.equal(panel.loads.length, 1);
      assert.equal(panel.loadedUrl, DesktopQuickMessage.quickMessagePanelEntryUrl(false, false));
      assert.equal(showCount(panel), 1);
      yield* service.setPanelReady;
      assert.isTrue(panel.visible);
      assert.equal(showCount(panel), 2);
      yield* service.setPanelReady;
      assert.equal(showCount(panel), 2);

      emitRendererGone(panel, "crashed");
      yield* TestClock.adjust(500);
      assert.equal(panel.reloads, capped + 1);

      yield* TestClock.adjust(60_000);
      emitRendererGone(panel, "killed");
      yield* TestClock.adjust(500);
      assert.equal(panel.reloads, capped + 2);
      assert.equal(showCount(panel), 2);
      yield* service.setPanelReady;
      assert.equal(showCount(panel), 3);
      yield* service.setPanelReady;
      assert.equal(showCount(panel), 3);
    }),
  ).pipe(Effect.provide(layerTest(null, []))),
);

it.effect("restores a dragged expanded panel from getBounds across hide and show", () =>
  Effect.scoped(
    Effect.gen(function* () {
      electron.displays = [PRIMARY_DISPLAY, SECONDARY_DISPLAY];
      electron.cursor = { x: 10, y: 10 };
      const service = yield* DesktopQuickMessage.make;
      yield* service.initialize;
      const panel = yield* openReadyPanel(service);
      const toggle = electron.shortcuts.get(ACCELERATOR)!;
      yield* service.setPresentation("expanded");
      assert.deepEqual(panel.getBounds(), { x: 262, y: 140, width: 916, height: 760 });

      panel.rect = { x: 80, y: 40, width: 916, height: 760 };
      panel.emit("move");
      electron.cursor = { x: 2100, y: 20 };
      yield* service.setPresentation("expanded");
      assert.deepEqual(panel.getBounds(), { x: 80, y: 40, width: 916, height: 760 });

      toggle();
      assert.isFalse(panel.visible);
      toggle();
      assert.deepEqual(panel.getBounds(), { x: 80, y: 40, width: 916, height: 760 });
      assert.equal(electron.panels.length, 1);
    }),
  ).pipe(Effect.provide(layerTest(null, []))),
);

it.effect("reads expanded getBounds on hide and before leaving expanded", () =>
  Effect.scoped(
    Effect.gen(function* () {
      electron.displays = [PRIMARY_DISPLAY, SECONDARY_DISPLAY];
      electron.cursor = { x: 10, y: 10 };
      const service = yield* DesktopQuickMessage.make;
      yield* service.initialize;
      const panel = yield* openReadyPanel(service);
      const toggle = electron.shortcuts.get(ACCELERATOR)!;
      yield* service.setPresentation("expanded");

      panel.rect = { x: 64, y: 88, width: 916, height: 760 };
      electron.cursor = { x: 2100, y: 20 };
      toggle();
      toggle();
      assert.deepEqual(panel.getBounds(), { x: 64, y: 88, width: 916, height: 760 });

      panel.rect = { x: 18, y: 44, width: 916, height: 760 };
      yield* service.setPresentation("compact");
      assert.equal(panel.getBounds().x, 2262);
      assert.equal(panel.getBounds().height, 520);
      panel.emit("move");
      yield* service.setPresentation("expanded");
      assert.deepEqual(panel.getBounds(), { x: 18, y: 44, width: 916, height: 760 });
    }),
  ).pipe(Effect.provide(layerTest(null, []))),
);

it.effect("grows back to the canonical expanded size when the display gets larger", () =>
  Effect.scoped(
    Effect.gen(function* () {
      electron.workArea = { x: 0, y: 0, width: 1000, height: 600 };
      const service = yield* DesktopQuickMessage.make;
      yield* service.initialize;
      const panel = yield* openReadyPanel(service);
      const toggle = electron.shortcuts.get(ACCELERATOR)!;
      yield* service.setPresentation("expanded");
      assert.deepEqual(panel.getBounds(), { x: 42, y: 0, width: 916, height: 600 });

      electron.workArea = { x: 0, y: 0, width: 1600, height: 1200 };
      toggle();
      toggle();
      assert.deepEqual(panel.getBounds(), { x: 42, y: 0, width: 916, height: 760 });
    }),
  ).pipe(Effect.provide(layerTest(null, []))),
);

it.effect("clamps expanded bounds onto a remaining display when the saved one is gone", () =>
  Effect.scoped(
    Effect.gen(function* () {
      electron.displays = [PRIMARY_DISPLAY, SECONDARY_DISPLAY];
      electron.cursor = { x: 2100, y: 100 };
      const service = yield* DesktopQuickMessage.make;
      yield* service.initialize;
      const panel = yield* openReadyPanel(service);
      const toggle = electron.shortcuts.get(ACCELERATOR)!;
      yield* service.setPresentation("expanded");
      assert.equal(panel.getBounds().x, 2262);
      assert.equal(panel.getBounds().height, 760);

      electron.displays = [PRIMARY_DISPLAY];
      toggle();
      toggle();
      assert.deepEqual(panel.getBounds(), { x: 524, y: 140, width: 916, height: 760 });
    }),
  ).pipe(Effect.provide(layerTest(null, []))),
);

it.effect("hides on close, lets quit close, and destroys from the service finalizer", () => {
  let panel: FakePanel | undefined;
  return Effect.gen(function* () {
    yield* Effect.scoped(
      Effect.gen(function* () {
        const service = yield* DesktopQuickMessage.make;
        yield* service.initialize;
        panel = yield* openReadyPanel(service);
        const hideEvent = { preventDefault: vi.fn() };
        panel.emit("close", hideEvent);
        assert.equal(hideEvent.preventDefault.mock.calls.length, 1);
        assert.isFalse(panel.visible);
        assert.isFalse(panel.destroyed);
        assert.equal(panel.loadedUrl, DesktopQuickMessage.quickMessagePanelEntryUrl(false, false));

        electron.shortcuts.get(ACCELERATOR)!();
        assert.isTrue(panel.visible);
        for (const listener of electron.appListeners.get("before-quit") ?? []) listener();
        const quitEvent = { preventDefault: vi.fn() };
        panel.emit("close", quitEvent);
        assert.equal(quitEvent.preventDefault.mock.calls.length, 0);
        assert.isFalse(panel.destroyed);
      }),
    );
    assert.isTrue(panel?.destroyed);
  }).pipe(Effect.provide(layerTest(null, [])));
});

it.effect("opens safe external urls and blocks the rest", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const service = yield* DesktopQuickMessage.make;
      yield* service.initialize;
      electron.shortcuts.get(ACCELERATOR)!();
      const panel = electron.panels[0]!;
      const opened = panel.webContents.windowOpenHandler?.({ url: "https://example.com/docs" });
      assert.deepEqual(opened, { action: "deny" });
      const denied = panel.webContents.windowOpenHandler?.({ url: "file:///etc/passwd" });
      assert.deepEqual(denied, { action: "deny" });

      const unsafeEvent = { preventDefault: vi.fn() };
      panel.webContents.emit("will-navigate", unsafeEvent, "ftp://example.com/secret");
      const httpsEvent = { preventDefault: vi.fn() };
      panel.webContents.emit("will-navigate", httpsEvent, "https://example.com/path");
      const appEvent = { preventDefault: vi.fn() };
      panel.webContents.emit("will-navigate", appEvent, "t3code://app/#/quick-message");
      yield* settle;

      assert.equal(unsafeEvent.preventDefault.mock.calls.length, 1);
      assert.equal(httpsEvent.preventDefault.mock.calls.length, 1);
      assert.equal(appEvent.preventDefault.mock.calls.length, 0);
      assert.deepEqual(externalOpens, ["https://example.com/docs", "https://example.com/path"]);
    }),
  ).pipe(Effect.provide(layerTest(null, []))),
);

it.effect("installs the app menu under a native interaction", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const service = yield* DesktopQuickMessage.make;
      yield* service.initialize;
      electron.shortcuts.get(ACCELERATOR)!();
      const panel = electron.panels[0]!;
      panel.webContents.emit(
        "context-menu",
        { preventDefault: vi.fn() },
        {
          linkURL: "",
          mediaType: "none",
          misspelledWord: "",
          dictionarySuggestions: [],
          editFlags: { canCut: true, canCopy: true, canPaste: true, canSelectAll: true },
        },
      );
      yield* settle;
      assert.equal(menuOwners.length, 1);
      assert.strictEqual(menuOwners[0], panel);
      assert.isTrue(nativeDuringMenu);
      assert.isFalse(
        NativeWindowInteraction.nativeWindowInteractionInProgress(
          panel as unknown as Electron.BrowserWindow,
        ),
      );
    }),
  ).pipe(Effect.provide(layerTest(null, []))),
);

it.effect("holds a submission until the main window can start it", () => {
  const main = { webContents: fakeWebContents(1) };
  const revealed: Array<unknown> = [];
  return Effect.scoped(
    Effect.gen(function* () {
      const service = yield* DesktopQuickMessage.make;
      yield* service.initialize;
      electron.shortcuts.get(ACCELERATOR)!();
      yield* service.setPanelReady;

      yield* service.submit(submission);
      assert.isFalse(electron.panels[0]!.visible);
      assert.deepEqual(main.webContents.sent, []);

      yield* service.setReceiverReady(main.webContents as unknown as Electron.WebContents, true);
      assert.deepEqual(main.webContents.sent, [[QUICK_MESSAGE_SUBMIT_EVENT_CHANNEL, submission]]);
      assert.deepEqual(revealed, [main, main]);

      yield* service.setReceiverReady(main.webContents as unknown as Electron.WebContents, true);
      assert.equal(main.webContents.sent.length, 1);
    }),
  ).pipe(Effect.provide(layerTest(main, revealed)));
});

it.effect("opens the main window for a submission when none is open", () => {
  const revealed: Array<unknown> = [];
  return Effect.scoped(
    Effect.gen(function* () {
      const service = yield* DesktopQuickMessage.make;
      yield* service.submit(submission);
      assert.deepEqual(revealed, ["created"]);
    }),
  ).pipe(Effect.provide(layerTest(null, revealed)));
});

it.effect("holds the partition protocol until the calling scope closes", () =>
  Effect.gen(function* () {
    const partitionSession = { partition: DesktopQuickMessage.QUICK_MESSAGE_PARTITION };
    electron.fromPartition.mockReturnValue(partitionSession);
    const registered: Array<unknown> = [];
    let released = 0;
    const protocol = ElectronProtocol.ElectronProtocol.of({
      registerDesktopProtocol: (input) =>
        Effect.acquireRelease(
          Effect.sync(() => {
            registered.push(input.session);
          }),
          () =>
            Effect.sync(() => {
              released += 1;
            }),
        ),
    });
    const scope = yield* Scope.make();
    yield* DesktopQuickMessage.registerQuickMessagePartitionProtocol({
      scheme: "t3code",
      assetDirectory: "/assets",
      clerkFrontendApiHostname: undefined,
    }).pipe(
      Effect.provideService(Scope.Scope, scope),
      Effect.provideService(ElectronProtocol.ElectronProtocol, protocol),
    );
    assert.equal(released, 0);
    assert.strictEqual(registered[0], partitionSession);
    assert.deepEqual(electron.fromPartition.mock.calls, [
      [DesktopQuickMessage.QUICK_MESSAGE_PARTITION],
    ]);
    yield* Scope.close(scope, Exit.void);
    assert.equal(released, 1);
  }),
);

it("places the panel a fifth of the way down the display", () => {
  assert.deepEqual(
    DesktopQuickMessage.quickMessagePanelBounds({ x: 100, y: 25, width: 1440, height: 875 }),
    { x: 362, y: 200, width: 916, height: 520 },
  );
  assert.deepEqual(
    DesktopQuickMessage.quickMessagePanelBounds({ x: 0, y: 0, width: 600, height: 500 }),
    { x: 0, y: 0, width: 600, height: 500 },
  );
  assert.deepEqual(
    DesktopQuickMessage.quickMessageExpandedPanelBounds({
      x: 100,
      y: 25,
      width: 1440,
      height: 875,
    }),
    { x: 362, y: 140, width: 916, height: 760 },
  );
  assert.deepEqual(
    DesktopQuickMessage.quickMessageExpandedPanelBounds({ x: 0, y: 0, width: 600, height: 500 }),
    { x: 0, y: 0, width: 600, height: 500 },
  );
});
