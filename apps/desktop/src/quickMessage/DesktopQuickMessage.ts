import {
  DEFAULT_CLIENT_SETTINGS,
  type ClientSettings,
  type DesktopQuickMessagePresentation,
  type DesktopQuickMessageShowEvent,
  type DesktopQuickMessageState,
  type DesktopQuickMessageSubmission,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Electron from "electron";

import { makeComponentLogger } from "../app/DesktopObservability.ts";
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
import { isWaylandSession, toElectronAccelerator } from "../snapShot/snapShot.ts";
import { installAppContextMenu, type AppContextMenuRuntime } from "../window/AppContextMenu.ts";
import * as DesktopWindow from "../window/DesktopWindow.ts";
import { QUICK_MESSAGE_WINDOW_ROLE_ARGUMENT } from "../windowRole.ts";

// 52rem composer at the default 16px interface font, the frame's 3rem of
// horizontal padding, and 36px of slack so the card is not flush with the window.
const PANEL_WIDTH = 916;
// Taller than the composer so its project and model menus can open below it.
const COMPACT_PANEL_HEIGHT = 520;
const EXPANDED_PANEL_HEIGHT = 760;

export const QUICK_MESSAGE_PARTITION = "persist:t3code-quick-message";

export const QUICK_MESSAGE_SHORTCUT_TAKEN_MESSAGE =
  "This shortcut is already used by the system or another app.";
const WAYLAND_UNSUPPORTED_MESSAGE =
  "Global shortcuts aren't available in this Wayland session. Bind a desktop shortcut to T3 Code instead.";

const { logWarning: logQuickMessageWarning } = makeComponentLogger("desktop-quick-message");

function placedPanelBounds(workArea: Electron.Rectangle, height: number): Electron.Rectangle {
  const width = Math.min(PANEL_WIDTH, workArea.width);
  const clampedHeight = Math.min(height, workArea.height);
  return {
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + Math.min(workArea.height * 0.2, workArea.height - clampedHeight)),
    width,
    height: clampedHeight,
  };
}

/** Centred on the display, a fifth of the way down, like Spotlight. */
export function quickMessagePanelBounds(workArea: Electron.Rectangle): Electron.Rectangle {
  return placedPanelBounds(workArea, COMPACT_PANEL_HEIGHT);
}

/** Same placement as compact, tall enough for the expanded shell, clamped to the display. */
export function quickMessageExpandedPanelBounds(workArea: Electron.Rectangle): Electron.Rectangle {
  return placedPanelBounds(workArea, EXPANDED_PANEL_HEIGHT);
}

function clampBounds(bounds: Electron.Rectangle, workArea: Electron.Rectangle): Electron.Rectangle {
  const width = Math.min(bounds.width, workArea.width);
  const height = Math.min(bounds.height, workArea.height);
  const maxX = workArea.x + workArea.width - width;
  const maxY = workArea.y + workArea.height - height;
  return {
    x: Math.min(Math.max(bounds.x, workArea.x), maxX),
    y: Math.min(Math.max(bounds.y, workArea.y), maxY),
    width,
    height,
  };
}

export interface QuickMessagePanelWindowConfig {
  readonly detached: boolean;
  readonly isMac: boolean;
  readonly displayName: string;
  readonly preloadPath: string;
}

/**
 * `detached: false` is the legacy panel: default session and `#/quick-message`.
 * `true` is the isolated partition and `#/` entry. Callers pass false until
 * the shell is activated; this is not a user setting.
 */
export function quickMessagePanelEntryUrl(isDevelopment: boolean, detached: boolean): string {
  const root = ElectronProtocol.getDesktopUrl(isDevelopment);
  return detached ? `${root}#/` : `${root}#/quick-message`;
}

export function createQuickMessagePanelWindow(
  config: QuickMessagePanelWindowConfig,
): Electron.BrowserWindow {
  // Only the detached shell may touch the partition. The legacy panel shares
  // the default session so relay preferences stay where they are.
  const partitionSession = config.detached
    ? Electron.session.fromPartition(QUICK_MESSAGE_PARTITION)
    : undefined;
  return new Electron.BrowserWindow({
    width: PANEL_WIDTH,
    height: COMPACT_PANEL_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    // The composer draws its own shadow; the system one would outline the transparent margin.
    hasShadow: false,
    // Transparent Electron windows do not apply live native resize; presentation
    // changes size with setBounds instead.
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    title: config.displayName,
    // A panel takes keystrokes without activating the app, so dismissing it returns focus to
    // whatever the user was in, and it can float over full-screen apps.
    ...(config.isMac ? { type: "panel" as const } : {}),
    webPreferences: {
      preload: config.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [QUICK_MESSAGE_WINDOW_ROLE_ARGUMENT],
      ...(partitionSession === undefined ? {} : { session: partitionSession }),
    },
  });
}

/**
 * Same registration as the default session, minus `session`. `Omit` drops the
 * asset-directory / dev-origin union, so this names that union explicitly.
 */
type QuickMessagePartitionProtocolInput = {
  readonly scheme: string;
  readonly clerkFrontendApiHostname: string | undefined;
} & ({ readonly targetOrigin: URL } | { readonly assetDirectory: string });

/**
 * Registers the desktop scheme on the quick-message partition. The caller's
 * scope owns the handler. Activation calls this from `DesktopApp` bootstrap,
 * immediately after the default `registerDesktopProtocol`, in that same scope.
 * A nested `Effect.scoped` unhandles the scheme as soon as that scope ends.
 * Left uncalled until the detached shell is activated; the legacy panel uses
 * the default session's registration.
 */
export const registerQuickMessagePartitionProtocol = Effect.fn(
  "DesktopQuickMessage.registerPartitionProtocol",
)(function* (input: QuickMessagePartitionProtocolInput) {
  const protocol = yield* ElectronProtocol.ElectronProtocol;
  const session = Electron.session.fromPartition(QUICK_MESSAGE_PARTITION);
  yield* protocol.registerDesktopProtocol(
    "assetDirectory" in input
      ? {
          scheme: input.scheme,
          clerkFrontendApiHostname: input.clerkFrontendApiHostname,
          assetDirectory: input.assetDirectory,
          session,
        }
      : {
          scheme: input.scheme,
          clerkFrontendApiHostname: input.clerkFrontendApiHostname,
          targetOrigin: input.targetOrigin,
          session,
        },
  );
});

export class DesktopQuickMessage extends Context.Service<
  DesktopQuickMessage,
  {
    readonly initialize: Effect.Effect<void>;
    readonly configure: (settings: ClientSettings) => Effect.Effect<void>;
    readonly state: Effect.Effect<DesktopQuickMessageState>;
    readonly setShortcutSuppressed: (suppressed: boolean) => Effect.Effect<void>;
    readonly isPanel: (webContentsId: number) => Effect.Effect<boolean>;
    readonly setPanelReady: Effect.Effect<void>;
    readonly setPresentation: (
      presentation: DesktopQuickMessagePresentation,
    ) => Effect.Effect<void>;
    readonly dismiss: Effect.Effect<void>;
    readonly submit: (submission: DesktopQuickMessageSubmission) => Effect.Effect<void>;
    readonly setReceiverReady: (
      webContents: Electron.WebContents,
      ready: boolean,
    ) => Effect.Effect<void>;
  }
>()("@t3tools/desktop/quickMessage/DesktopQuickMessage") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const clientSettings = yield* DesktopClientSettings.DesktopClientSettings;
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  const electronMenu = yield* ElectronMenu.ElectronMenu;
  const electronShell = yield* ElectronShell.ElectronShell;
  const context = yield* Effect.context<ElectronMenu.ElectronMenu | ElectronShell.ElectronShell>();
  const runPromise = Effect.runPromiseWith(context);
  const isMac = environment.platform === "darwin";
  const applicationUrl = ElectronProtocol.getDesktopUrl(environment.isDevelopment);

  let settings = DEFAULT_CLIENT_SETTINGS;
  let state: DesktopQuickMessageState = { shortcutRegistered: false, message: null };
  let presentation: DesktopQuickMessagePresentation = "compact";
  // Kept across hide and show. Compact placement is recomputed; this is not.
  let expandedBounds: Electron.Rectangle | null = null;
  let registeredAccelerator: string | null = null;
  let suppressed = false;
  let panel: Electron.BrowserWindow | null = null;
  let panelReady = false;
  let showWhenReady = false;
  let appQuitting = false;
  const pending: Array<DesktopQuickMessageSubmission> = [];
  let receiver: Electron.WebContents | null = null;
  let detachReceiver: (() => void) | null = null;

  const readState = (): DesktopQuickMessageState => ({
    shortcutRegistered: state.shortcutRegistered,
    message: state.message,
    presentation,
  });

  const livePanel = () => (panel !== null && !panel.isDestroyed() ? panel : null);

  const destroyPanel = () => {
    const window = livePanel();
    panel = null;
    panelReady = false;
    showWhenReady = false;
    window?.destroy();
  };

  const currentWorkArea = () =>
    Electron.screen.getDisplayNearestPoint(Electron.screen.getCursorScreenPoint()).workArea;

  const applyPresentationBounds = (window: Electron.BrowserWindow) => {
    const area = currentWorkArea();
    if (presentation === "expanded") {
      expandedBounds ??= quickMessageExpandedPanelBounds(area);
      window.setBounds(clampBounds(expandedBounds, area));
      return;
    }
    window.setBounds(quickMessagePanelBounds(area));
  };

  const showPanel = (window: Electron.BrowserWindow) => {
    applyPresentationBounds(window);
    // Chromium can count a transparent floating window as occluded, which pauses its frames
    // and leaves menus stuck mid-animation. Hidden, it goes back to being throttled.
    window.webContents.setBackgroundThrottling(false);
    window.show();
    window.focus();
    const event: DesktopQuickMessageShowEvent = { clientSettings: settings, presentation };
    window.webContents.send(QUICK_MESSAGE_SHOW_EVENT_CHANNEL, event);
  };

  const resetPanelReady = () => {
    panelReady = false;
  };

  const installExternalNavigation = (window: Electron.BrowserWindow) => {
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (Option.isSome(ElectronShell.parseSafeExternalUrl(url))) {
        void runPromise(electronShell.openExternal(url));
      }
      return { action: "deny" };
    });
    window.webContents.on("will-navigate", (event, url) => {
      if (
        DesktopWindow.isSameOriginRendererNavigation({
          applicationUrl,
          navigationUrl: url,
        })
      ) {
        return;
      }
      event.preventDefault();
      if (Option.isSome(ElectronShell.parseSafeExternalUrl(url))) {
        void runPromise(electronShell.openExternal(url));
      }
    });
  };

  const createPanel = () => {
    // Legacy shortcut until the detached shell is activated. Both arguments
    // flip together; there is no user-facing switch.
    const detached = false;
    const window = createQuickMessagePanelWindow({
      detached,
      isMac,
      displayName: environment.displayName,
      preloadPath: environment.preloadPath,
    });
    ElectronWindow.markAuxiliaryWindow(window);
    window.setAlwaysOnTop(true, isMac ? "floating" : "normal");
    if (isMac) window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    const contextMenu = {
      popup: (input) => electronMenu.popupTemplate(input),
      copyText: (text) => electronShell.copyText(text),
      reportCopyImageFailure: logQuickMessageWarning("failed to copy context-menu image"),
      runPromise: (effect) => runPromise(effect),
    } satisfies AppContextMenuRuntime;
    installAppContextMenu(window, window.webContents, contextMenu);
    installExternalNavigation(window);

    // A native menu blurs the panel while its interaction count is up, then
    // can deliver blur and focus in one turn after the count drops. Wait for
    // that turn and hide only if focus did not return. A sticky ignore would
    // also swallow the next real blur.
    let compactBlurEpoch = 0;
    const scheduleCompactBlurHide = () => {
      const epoch = compactBlurEpoch;
      queueMicrotask(() => {
        if (epoch !== compactBlurEpoch) return;
        if (window.isDestroyed() || presentation !== "compact") return;
        if (NativeWindowInteraction.nativeWindowInteractionInProgress(window)) return;
        if (window.isFocused()) return;
        window.hide();
      });
    };
    window.on("blur", () => {
      if (presentation !== "compact") return;
      if (NativeWindowInteraction.nativeWindowInteractionInProgress(window)) return;
      scheduleCompactBlurHide();
    });
    window.on("focus", () => {
      compactBlurEpoch += 1;
    });
    window.on("hide", () => {
      if (!window.isDestroyed()) window.webContents.setBackgroundThrottling(true);
    });
    // Hide keeps the renderer and its route. Preventing close while the app
    // is actually quitting cancels quit and leaves the process running.
    window.on("close", (event) => {
      if (appQuitting || window.isDestroyed()) return;
      event.preventDefault();
      window.hide();
    });
    window.webContents.on("did-start-navigation", (event) => {
      if (event.isMainFrame && !event.isSameDocument) resetPanelReady();
    });
    window.webContents.on("render-process-gone", () => {
      resetPanelReady();
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
      const main = Effect.runSync(electronWindow.main);
      if (Option.isSome(main)) main.value.once("closed", destroyPanel);
    }
    void window
      .loadURL(quickMessagePanelEntryUrl(environment.isDevelopment, detached))
      .catch(() => undefined);
    return window;
  };

  const togglePanel = () => {
    const existing = livePanel();
    if (existing?.isVisible()) {
      if (existing.isFocused()) existing.hide();
      else existing.focus();
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

  const onBeforeQuit = () => {
    appQuitting = true;
  };
  Electron.app.on("before-quit", onBeforeQuit);

  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      Electron.app.removeListener("before-quit", onBeforeQuit);
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
    state: Effect.sync(readState),
    setShortcutSuppressed: Effect.fn("DesktopQuickMessage.setShortcutSuppressed")(function* (next) {
      yield* Effect.sync(() => {
        if (suppressed === next) return;
        suppressed = next;
        if (next) releaseShortcut();
        else applyShortcut();
      });
    }),
    isPanel: (webContentsId) => Effect.sync(() => livePanel()?.webContents.id === webContentsId),
    setPanelReady: Effect.sync(() => {
      const window = livePanel();
      if (window === null) return;
      panelReady = true;
      if (showWhenReady) {
        showWhenReady = false;
        showPanel(window);
      }
    }).pipe(Effect.withSpan("DesktopQuickMessage.setPanelReady")),
    setPresentation: Effect.fn("DesktopQuickMessage.setPresentation")(function* (next) {
      yield* Effect.sync(() => {
        presentation = next;
        const window = livePanel();
        if (window !== null) applyPresentationBounds(window);
      });
    }),
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
