import { assert, it } from "@effect/vitest";
import {
  DEFAULT_CLIENT_SETTINGS,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  type ClientSettings,
  type DesktopQuickMessageSubmission,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Electron from "electron";
import { beforeEach, vi } from "vite-plus/test";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import {
  QUICK_MESSAGE_SHOW_EVENT_CHANNEL,
  QUICK_MESSAGE_SUBMIT_EVENT_CHANNEL,
} from "../ipc/channels.ts";
import * as DesktopClientSettings from "../settings/DesktopClientSettings.ts";
import * as DesktopWindow from "../window/DesktopWindow.ts";
import * as DesktopQuickMessage from "./DesktopQuickMessage.ts";

interface FakeWebContents {
  readonly id: number;
  readonly sent: Array<readonly [string, unknown]>;
  send(channel: string, payload: unknown): void;
  on(): void;
  once(): void;
  removeListener(): void;
  setBackgroundThrottling(): void;
  isDestroyed(): boolean;
}

const fakeWebContents = (id: number): FakeWebContents => ({
  id,
  sent: [],
  send(channel, payload) {
    this.sent.push([channel, payload]);
  },
  on() {},
  once() {},
  removeListener() {},
  setBackgroundThrottling() {},
  isDestroyed: () => false,
});

const electron = vi.hoisted(() => ({
  shortcuts: new Map<string, () => void>(),
  takenAccelerators: new Set<string>(),
  panels: [] as Array<{
    loadedUrl: string | null;
    visible: boolean;
    destroyed: boolean;
    webContents: FakeWebContents;
  }>,
}));

vi.mock("electron", () => {
  class BrowserWindow {
    loadedUrl: string | null = null;
    visible = false;
    destroyed = false;
    readonly webContents = fakeWebContents(100 + electron.panels.length);
    constructor() {
      electron.panels.push(this);
    }
    setAlwaysOnTop() {}
    setVisibleOnAllWorkspaces() {}
    on() {}
    once() {}
    loadURL(url: string) {
      this.loadedUrl = url;
      return Promise.resolve();
    }
    setBounds() {}
    show() {
      this.visible = true;
    }
    hide() {
      this.visible = false;
    }
    focus() {}
    isVisible() {
      return this.visible;
    }
    isDestroyed() {
      return this.destroyed;
    }
    destroy() {
      this.destroyed = true;
    }
  }
  return {
    BrowserWindow,
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
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
      getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }),
    },
  };
});

beforeEach(() => {
  electron.shortcuts.clear();
  electron.takenAccelerators.clear();
  electron.panels.length = 0;
});

const ACCELERATOR = "Alt+/";
const enabled: ClientSettings = { ...DEFAULT_CLIENT_SETTINGS, quickMessageEnabled: true };

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
        get: Effect.succeedSome(enabled),
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
  );

it.effect("registers the shortcut only while quick message is on", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const service = yield* DesktopQuickMessage.make;
      yield* service.initialize;
      assert.isTrue(electron.shortcuts.has(ACCELERATOR));
      assert.deepEqual(yield* service.state, { shortcutRegistered: true, message: null });

      yield* service.configure({ ...enabled, quickMessageEnabled: false });
      assert.equal(electron.shortcuts.size, 0);
      assert.deepEqual(yield* service.state, { shortcutRegistered: false, message: null });
    }),
  ).pipe(Effect.provide(layerTest(null, []))),
);

it.effect("says so when another app holds the shortcut", () =>
  Effect.scoped(
    Effect.gen(function* () {
      electron.takenAccelerators.add(ACCELERATOR);
      const service = yield* DesktopQuickMessage.make;
      yield* service.initialize;
      assert.deepEqual(yield* service.state, {
        shortcutRegistered: false,
        message: DesktopQuickMessage.QUICK_MESSAGE_SHORTCUT_TAKEN_MESSAGE,
      });
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

it.effect("shows the panel once its page is ready, and the shortcut toggles it", () =>
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
      assert.deepEqual(panel.webContents.sent, [
        [QUICK_MESSAGE_SHOW_EVENT_CHANNEL, { clientSettings: enabled }],
      ]);

      toggle();
      assert.isFalse(panel.visible);
      toggle();
      assert.isTrue(panel.visible);
      assert.equal(electron.panels.length, 1);
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

it("places the panel a fifth of the way down the display", () => {
  assert.deepEqual(
    DesktopQuickMessage.quickMessagePanelBounds({ x: 100, y: 25, width: 1440, height: 875 }),
    { x: 362, y: 200, width: 916, height: 520 },
  );
  assert.deepEqual(
    DesktopQuickMessage.quickMessagePanelBounds({ x: 0, y: 0, width: 600, height: 500 }),
    { x: 0, y: 0, width: 600, height: 500 },
  );
});
