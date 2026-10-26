import {
  DEFAULT_CLIENT_SETTINGS,
  type ClientSettings,
  type DesktopQuickMessageShowEvent,
  type DesktopQuickMessageState,
  type DesktopQuickMessageSubmission,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Electron from "electron";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import { getDesktopUrl } from "../electron/ElectronProtocol.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import {
  QUICK_MESSAGE_SHOW_EVENT_CHANNEL,
  QUICK_MESSAGE_SUBMIT_EVENT_CHANNEL,
} from "../ipc/channels.ts";
import * as DesktopClientSettings from "../settings/DesktopClientSettings.ts";
import { isWaylandSession, toElectronAccelerator } from "../snapShot/snapShot.ts";
import * as DesktopWindow from "../window/DesktopWindow.ts";

// 52rem composer at the default 16px interface font, the frame's 3rem of
// horizontal padding, and 36px of slack so the card is not flush with the window.
const PANEL_WIDTH = 916;
// Taller than the composer so its project and model menus can open below it.
const PANEL_HEIGHT = 520;

export const QUICK_MESSAGE_SHORTCUT_TAKEN_MESSAGE =
  "This shortcut is already used by the system or another app.";
const WAYLAND_UNSUPPORTED_MESSAGE =
  "Global shortcuts aren't available in this Wayland session. Bind a desktop shortcut to T3 Code instead.";

/** Centred on the display, a fifth of the way down, like Spotlight. */
export function quickMessagePanelBounds(workArea: Electron.Rectangle): Electron.Rectangle {
  const width = Math.min(PANEL_WIDTH, workArea.width);
  const height = Math.min(PANEL_HEIGHT, workArea.height);
  return {
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + Math.min(workArea.height * 0.2, workArea.height - height)),
    width,
    height,
  };
}

export class DesktopQuickMessage extends Context.Service<
  DesktopQuickMessage,
  {
    readonly initialize: Effect.Effect<void>;
    readonly configure: (settings: ClientSettings) => Effect.Effect<void>;
    readonly state: Effect.Effect<DesktopQuickMessageState>;
    readonly setShortcutSuppressed: (suppressed: boolean) => Effect.Effect<void>;
    readonly isPanel: (webContentsId: number) => Effect.Effect<boolean>;
    readonly setPanelReady: Effect.Effect<void>;
    readonly dismiss: Effect.Effect<void>;
    readonly submit: (submission: DesktopQuickMessageSubmission) => Effect.Effect<void>;
    readonly setReceiverReady: (
      webContents: Electron.WebContents,
      ready: boolean,
    ) => Effect.Effect<void>;
  }
>()("@t3tools/desktop/quickMessage/DesktopQuickMessage") {}

/** @public */
export const make = Effect.gen(function* () {
  const context = yield* Effect.context<never>();
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const clientSettings = yield* DesktopClientSettings.DesktopClientSettings;
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  const isMac = environment.platform === "darwin";

  let settings = DEFAULT_CLIENT_SETTINGS;
  let state: DesktopQuickMessageState = { shortcutRegistered: false, message: null };
  let registeredAccelerator: string | null = null;
  let suppressed = false;
  let panel: Electron.BrowserWindow | null = null;
  let panelReady = false;
  let showWhenReady = false;
  const pending: Array<DesktopQuickMessageSubmission> = [];
  let receiver: Electron.WebContents | null = null;
  let detachReceiver: (() => void) | null = null;

  const livePanel = () => (panel !== null && !panel.isDestroyed() ? panel : null);

  const destroyPanel = () => {
    const window = livePanel();
    panel = null;
    panelReady = false;
    showWhenReady = false;
    window?.destroy();
  };

  const showPanel = (window: Electron.BrowserWindow) => {
    const cursor = Electron.screen.getCursorScreenPoint();
    window.setBounds(
      quickMessagePanelBounds(Electron.screen.getDisplayNearestPoint(cursor).workArea),
    );
    // Chromium can count a transparent floating window as occluded, which pauses its frames
    // and leaves menus stuck mid-animation. Hidden, it goes back to being throttled.
    window.webContents.setBackgroundThrottling(false);
    window.show();
    window.focus();
    const event: DesktopQuickMessageShowEvent = { clientSettings: settings };
    window.webContents.send(QUICK_MESSAGE_SHOW_EVENT_CHANNEL, event);
  };

  const createPanel = () => {
    const window = new Electron.BrowserWindow({
      width: PANEL_WIDTH,
      height: PANEL_HEIGHT,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      // The composer draws its own shadow; the system one would outline the transparent margin.
      hasShadow: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      title: environment.displayName,
      // A panel takes keystrokes without activating the app, so dismissing it returns focus to
      // whatever the user was in, and it can float over full-screen apps.
      ...(isMac ? { type: "panel" as const } : {}),
      webPreferences: {
        preload: environment.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    ElectronWindow.markAuxiliaryWindow(window);
    window.setAlwaysOnTop(true, isMac ? "floating" : "normal");
    if (isMac) {
      window.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true,
        // Electron otherwise briefly turns the whole app into a UIElement process, after which
        // macOS stops treating it as a foreground app: no Dock dot, another app's menu bar, and
        // the first click into the main window only activates it.
        skipTransformProcessType: true,
      });
    }
    window.on("blur", () => {
      if (!window.isDestroyed()) window.hide();
    });
    window.on("hide", () => {
      if (!window.isDestroyed()) window.webContents.setBackgroundThrottling(true);
    });
    window.once("closed", () => {
      if (panel === window) {
        panel = null;
        panelReady = false;
        showWhenReady = false;
      }
    });
    if (!isMac) {
      // Elsewhere the app quits once its last window closes, and a hidden panel would keep it
      // running after the main window is gone.
      const main = Effect.runSyncWith(context)(electronWindow.main);
      if (Option.isSome(main)) main.value.once("closed", destroyPanel);
    }
    void window
      .loadURL(`${getDesktopUrl(environment.isDevelopment)}#/quick-message`)
      .catch(() => undefined);
    return window;
  };

  const togglePanel = () => {
    const existing = livePanel();
    if (existing?.isVisible()) {
      existing.hide();
      return;
    }
    const window = existing ?? createPanel();
    panel = window;
    if (panelReady) showPanel(window);
    else showWhenReady = true;
  };

  const releaseShortcut = () => {
    if (registeredAccelerator === null) return;
    Electron.globalShortcut.unregister(registeredAccelerator);
    registeredAccelerator = null;
  };

  const applyShortcut = () => {
    releaseShortcut();
    if (!settings.quickMessageEnabled) {
      state = { shortcutRegistered: false, message: null };
      return;
    }
    if (suppressed) return;
    if (isWaylandSession(environment.platform, process.env)) {
      state = { shortcutRegistered: false, message: WAYLAND_UNSUPPORTED_MESSAGE };
      return;
    }
    const accelerator = toElectronAccelerator(settings.quickMessageShortcut);
    let registered = false;
    try {
      registered = Electron.globalShortcut.register(accelerator, togglePanel);
    } catch {
      registered = false;
    }
    if (registered) registeredAccelerator = accelerator;
    state = registered
      ? { shortcutRegistered: true, message: null }
      : { shortcutRegistered: false, message: QUICK_MESSAGE_SHORTCUT_TAKEN_MESSAGE };
  };

  const configure = (next: ClientSettings) =>
    Effect.sync(() => {
      const shortcutChanged =
        next.quickMessageEnabled !== settings.quickMessageEnabled ||
        toElectronAccelerator(next.quickMessageShortcut) !==
          toElectronAccelerator(settings.quickMessageShortcut);
      settings = next;
      if (!next.quickMessageEnabled) destroyPanel();
      if (shortcutChanged || (next.quickMessageEnabled && registeredAccelerator === null)) {
        applyShortcut();
      }
    });

  const stopReceiving = () => {
    detachReceiver?.();
    detachReceiver = null;
    receiver = null;
  };

  const startReceiving = (webContents: Electron.WebContents) => {
    if (receiver === webContents) return;
    stopReceiving();
    receiver = webContents;
    const onNavigation = (
      event: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>,
    ) => {
      if (event.isMainFrame && !event.isSameDocument) stopReceiving();
    };
    webContents.on("did-start-navigation", onNavigation);
    webContents.on("render-process-gone", stopReceiving);
    webContents.once("destroyed", stopReceiving);
    detachReceiver = () => {
      webContents.removeListener("did-start-navigation", onNavigation);
      webContents.removeListener("render-process-gone", stopReceiving);
      webContents.removeListener("destroyed", stopReceiving);
    };
  };

  // Submissions wait for the main window's renderer, which may need creating first: on macOS the
  // app keeps running, and the shortcut keeps working, after its last window closes.
  const flush = Effect.gen(function* () {
    if (pending.length === 0) return;
    const main = yield* electronWindow.main;
    if (Option.isNone(main)) {
      yield* desktopWindow.revealOrCreateMain;
      return;
    }
    if (receiver === null || receiver !== main.value.webContents || receiver.isDestroyed()) {
      yield* electronWindow.reveal(main.value);
      return;
    }
    for (const submission of pending.splice(0)) {
      receiver.send(QUICK_MESSAGE_SUBMIT_EVENT_CHANNEL, submission);
    }
    yield* electronWindow.reveal(main.value);
  }).pipe(
    Effect.catch((error) =>
      Effect.logWarning("Could not hand the quick message to the main window.", error),
    ),
  );

  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      releaseShortcut();
      stopReceiving();
      destroyPanel();
    }),
  );

  return DesktopQuickMessage.of({
    initialize: clientSettings.get.pipe(
      Effect.flatMap((stored) =>
        configure(Option.getOrElse(stored, () => DEFAULT_CLIENT_SETTINGS)),
      ),
      Effect.ignore,
      Effect.withSpan("DesktopQuickMessage.initialize"),
    ),
    configure: Effect.fn("DesktopQuickMessage.configure")(function* (next) {
      yield* configure(next);
    }),
    state: Effect.sync(() => state),
    setShortcutSuppressed: Effect.fn("DesktopQuickMessage.setShortcutSuppressed")(function* (next) {
      yield* Effect.sync(() => {
        if (suppressed === next) return;
        suppressed = next;
        if (next) releaseShortcut();
        else applyShortcut();
      });
    }),
    isPanel: Effect.fn("DesktopQuickMessage.isPanel")((webContentsId) =>
      Effect.sync(() => livePanel()?.webContents.id === webContentsId),
    ),
    setPanelReady: Effect.sync(() => {
      const window = livePanel();
      if (window === null) return;
      panelReady = true;
      if (showWhenReady) {
        showWhenReady = false;
        showPanel(window);
      }
    }).pipe(Effect.withSpan("DesktopQuickMessage.setPanelReady")),
    dismiss: Effect.sync(() => livePanel()?.hide()),
    submit: Effect.fn("DesktopQuickMessage.submit")(function* (submission) {
      livePanel()?.hide();
      pending.push(submission);
      yield* flush;
    }),
    setReceiverReady: Effect.fn("DesktopQuickMessage.setReceiverReady")(
      function* (webContents, ready) {
        if (ready) startReceiving(webContents);
        else if (receiver === webContents) stopReceiving();
        yield* flush;
      },
    ),
  });
});

export const layer = Layer.effect(DesktopQuickMessage, make);
