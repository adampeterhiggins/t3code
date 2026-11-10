import { assert, describe, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import type { ManagedPolicyLimits } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { ManagedPolicyFileError } from "@t3tools/shared/managedPolicyFile";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { beforeEach, vi } from "vite-plus/test";

import type * as Electron from "electron";

const { focusedWebContents, ownerWindow, webContentsFromId } = vi.hoisted(() => ({
  focusedWebContents: vi.fn(),
  ownerWindow: vi.fn(),
  webContentsFromId: vi.fn(),
}));
vi.mock("electron", () => ({
  webContents: { getFocusedWebContents: focusedWebContents, fromId: webContentsFromId },
  BrowserWindow: { fromWebContents: ownerWindow },
}));

import * as DesktopBackendConfiguration from "../../backend/DesktopBackendConfiguration.ts";
import * as DesktopBackendManager from "../../backend/DesktopBackendManager.ts";
import * as DesktopBackendPool from "../../backend/DesktopBackendPool.ts";
import * as DesktopManagedPolicy from "../../app/DesktopManagedPolicy.ts";
import * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";
import * as ElectronDialog from "../../electron/ElectronDialog.ts";
import * as ElectronMenu from "../../electron/ElectronMenu.ts";
import * as NativeWindowInteraction from "../../electron/NativeWindowInteraction.ts";
import * as ElectronShell from "../../electron/ElectronShell.ts";
import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import * as DesktopAppSettings from "../../settings/DesktopAppSettings.ts";
import * as DesktopWslEnvironment from "../../wsl/DesktopWslEnvironment.ts";
import {
  getLocalEnvironmentBootstraps,
  installRelayTelemetryEnabled,
  readMedia,
  getWindowFullscreenState,
  pasteAsText,
  pickFolder,
  pickProjectFavicon,
  pickThemeFiles,
  probeRemoteEditors,
  saveTextFile,
  showContextMenu,
  showSavedFileInFolder,
  revealWindow,
  syncHtmlFullscreen,
} from "./window.ts";

const readyWslConfig: DesktopBackendManager.DesktopBackendStartConfig = {
  executablePath: "wsl.exe",
  args: ["-d", "Ubuntu", "--", "node", "/app/bin.mjs"],
  entryPath: "/app/bin.mjs",
  cwd: "/app",
  env: {},
  extendEnv: false,
  bootstrap: {
    mode: "desktop",
    noBrowser: true,
    port: 3774,
    host: "0.0.0.0",
    desktopBootstrapToken: "bootstrap-token",
    tailscaleServeEnabled: false,
    tailscaleServePort: 443,
  },
  bootstrapDelivery: "stdin",
  httpBaseUrl: new URL("http://127.0.0.1:3774"),
  captureOutput: true,
  preflightFailure: Option.none(),
  runningDistro: "Ubuntu",
};

const defaultWslInstance: DesktopBackendManager.DesktopBackendInstance = {
  id: DesktopBackendManager.BackendInstanceId("wsl:default"),
  label: Effect.succeed("WSL (default distro)"),
  start: Effect.void,
  stop: () => Effect.void,
  currentConfig: Effect.succeedSome(readyWslConfig),
  snapshot: Effect.succeed({
    desiredRunning: true,
    ready: true,
    activePid: Option.some(123),
    restartAttempt: 0,
    restartScheduled: false,
  }),
  waitForReady: () => Effect.succeed(true),
};

const backendConfigurationLayer = Layer.succeed(
  DesktopBackendConfiguration.DesktopBackendConfiguration,
  {
    resolvePrimary: Effect.die("unexpected resolvePrimary"),
    resolvePrimaryLabel: Effect.succeed("Windows"),
    resolveWsl: () => Effect.die("unexpected resolveWsl"),
    currentBootstrapToken: Effect.succeed("current-window-token"),
  } satisfies DesktopBackendConfiguration.DesktopBackendConfiguration["Service"],
);

const bootstrapsLayer = (instances: ReadonlyArray<DesktopBackendManager.DesktopBackendInstance>) =>
  Layer.merge(DesktopBackendPool.layerTest([...instances]), backendConfigurationLayer);

describe("getLocalEnvironmentBootstraps", () => {
  it.effect("hands out the current window's token to a backend launched with the secret", () =>
    Effect.gen(function* () {
      const result = yield* getLocalEnvironmentBootstraps.handler();

      assert.deepEqual(result, [
        {
          id: "wsl:default",
          label: "WSL (Ubuntu)",
          runningDistro: "Ubuntu",
          httpBaseUrl: "http://127.0.0.1:3774/",
          wsBaseUrl: "ws://127.0.0.1:3774/",
          bootstrapToken: "current-window-token",
        },
      ]);
    }).pipe(
      Effect.provide(
        bootstrapsLayer([
          {
            ...defaultWslInstance,
            currentConfig: Effect.succeedSome({
              ...readyWslConfig,
              bootstrap: {
                ...readyWslConfig.bootstrap,
                desktopBootstrapSecret: "desktop-secret",
              },
            }),
          },
        ]),
      ),
    ),
  );

  it.effect("publishes a pending bootstrap only while a transient retry is scheduled", () => {
    const retryingConfig: DesktopBackendManager.DesktopBackendStartConfig = {
      ...readyWslConfig,
      preflightFailure: Option.some({
        reason: "WSL probe timed out",
        fatal: false,
        retryLimit: 12,
      }),
    };
    const retryingInstance: DesktopBackendManager.DesktopBackendInstance = {
      ...defaultWslInstance,
      currentConfig: Effect.succeedSome(retryingConfig),
      snapshot: Effect.succeed({
        desiredRunning: true,
        ready: false,
        activePid: Option.none(),
        restartAttempt: 2,
        restartScheduled: true,
      }),
    };

    return Effect.gen(function* () {
      const result = yield* getLocalEnvironmentBootstraps.handler();
      assert.deepEqual(result, [
        {
          id: "wsl:default",
          label: "WSL (default distro)",
          runningDistro: null,
          httpBaseUrl: null,
          wsBaseUrl: null,
        },
      ]);
    }).pipe(Effect.provide(bootstrapsLayer([retryingInstance])));
  });

  it.effect("omits a bounded transient bootstrap after retries stop", () => {
    const stoppedInstance: DesktopBackendManager.DesktopBackendInstance = {
      ...defaultWslInstance,
      currentConfig: Effect.succeedSome({
        ...readyWslConfig,
        preflightFailure: Option.some({
          reason: "WSL probe timed out",
          fatal: false,
          retryLimit: 12,
        }),
      }),
      snapshot: Effect.succeed({
        desiredRunning: false,
        ready: false,
        activePid: Option.none(),
        restartAttempt: 12,
        restartScheduled: false,
      }),
    };

    return Effect.gen(function* () {
      const result = yield* getLocalEnvironmentBootstraps.handler();
      assert.deepEqual(result, []);
    }).pipe(Effect.provide(bootstrapsLayer([stoppedInstance])));
  });
});

describe("installRelayTelemetryEnabled", () => {
  // The renderer reads this over sync IPC, so the answer must not wait on the filesystem.
  const relayTelemetryEnabled = (
    env: NodeJS.ProcessEnv,
    policy?: Parameters<typeof DesktopManagedPolicy.layerTest>[0],
  ) =>
    Effect.gen(function* () {
      const listeners = new Map<string, DesktopIpc.DesktopIpcSyncListener>();
      const ipcMain: DesktopIpc.DesktopIpcMain = {
        removeHandler: () => undefined,
        handle: () => undefined,
        removeAllListeners: (channel) => void listeners.delete(channel),
        on: (channel, listener) => void listeners.set(channel, listener),
      };
      yield* installRelayTelemetryEnabled().pipe(
        Effect.provideService(HostProcess.Environment, env),
        Effect.provide(
          Layer.mergeAll(DesktopIpc.layer(ipcMain), DesktopManagedPolicy.layerTest(policy)),
        ),
      );
      const event = { returnValue: undefined as unknown };
      listeners.get(IpcChannels.GET_RELAY_TELEMETRY_ENABLED_CHANNEL)?.(event as never);
      return event.returnValue;
    }).pipe(Effect.scoped);

  it.effect("reads the desktop host opt-out before returning the renderer policy", () =>
    Effect.gen(function* () {
      assert.isFalse(yield* relayTelemetryEnabled({ T3CODE_TELEMETRY_ENABLED: "false" }));
      assert.isTrue(yield* relayTelemetryEnabled({}));
    }),
  );

  it.effect("turns relay tracing off when the managed policy turns telemetry off", () =>
    Effect.gen(function* () {
      const policy = (limits: ManagedPolicyLimits) => ({
        schemaVersion: 1 as const,
        organization: "Example Corp",
        limits,
      });
      assert.isFalse(yield* relayTelemetryEnabled({}, policy({ telemetry: false })));
      assert.isTrue(yield* relayTelemetryEnabled({}, policy({ webhookTasks: false })));
      // A policy that cannot be read fails closed.
      assert.isFalse(
        yield* relayTelemetryEnabled(
          {},
          new ManagedPolicyFileError({ path: "/test", reason: "bad JSON" }),
        ),
      );
    }),
  );
});

describe("getWindowFullscreenState", () => {
  it.effect("reads the current native window state", () => {
    const window = { isFullScreen: () => true } as Electron.BrowserWindow;

    return Effect.gen(function* () {
      assert.isTrue(yield* getWindowFullscreenState.handler());
    }).pipe(
      Effect.provide(
        Layer.mock(ElectronWindow.ElectronWindow)({
          currentMainOrFirst: Effect.succeedSome(window),
        }),
      ),
    );
  });
});

describe("pasteAsText", () => {
  interface AppContents {
    readonly id: number;
    isDestroyed: () => boolean;
    getType: () => "window" | "webview";
    paste: ReturnType<typeof vi.fn>;
  }

  function appWindow(id: number, destroyed = false) {
    const contents: AppContents = {
      id,
      isDestroyed: () => destroyed,
      getType: () => "window",
      paste: vi.fn(),
    };
    const window = {
      id,
      isDestroyed: () => destroyed,
      webContents: contents,
    } as unknown as Electron.BrowserWindow;
    return { window, contents };
  }

  function present(
    ...entries: ReadonlyArray<{
      readonly contents: AppContents;
      readonly window: Electron.BrowserWindow | null;
    }>
  ) {
    const byId = new Map(entries.map((entry) => [entry.contents.id, entry]));
    webContentsFromId.mockImplementation((id: number) => byId.get(id)?.contents);
    ownerWindow.mockImplementation(
      (contents: AppContents) => byId.get(contents?.id)?.window ?? null,
    );
  }

  const windowLayer = (main: Option.Option<Electron.BrowserWindow>) =>
    Layer.mock(ElectronWindow.ElectronWindow)({
      main: Effect.succeed(main),
      focusedMainOrFirst: Effect.die("paste must not fall back to another window"),
    });

  beforeEach(() => {
    webContentsFromId.mockReset();
    ownerWindow.mockReset();
    focusedWebContents.mockReset();
  });

  it.effect(
    "pastes into the focused guest only after the main renderer acknowledges the menu action",
    () => {
      const main = appWindow(42);
      const focused: AppContents = {
        id: 77,
        isDestroyed: () => false,
        getType: () => "webview",
        paste: vi.fn(),
      };
      present(main, { contents: focused, window: main.window });
      focusedWebContents.mockReturnValue(focused);

      return Effect.gen(function* () {
        yield* pasteAsText.handler(undefined, { sender: { id: 42 } });
        assert.equal(focused.paste.mock.calls.length, 1);
        assert.equal(main.contents.paste.mock.calls.length, 0);

        yield* pasteAsText.handler(undefined, { sender: { id: 99 } });
        assert.equal(focused.paste.mock.calls.length, 1);

        present(main, { contents: focused, window: appWindow(8).window });
        yield* pasteAsText.handler(undefined, { sender: { id: 42 } });
        assert.equal(focused.paste.mock.calls.length, 1);

        present(main, { contents: focused, window: null });
        yield* pasteAsText.handler(undefined, { sender: { id: 42 } });
        assert.equal(focused.paste.mock.calls.length, 1);

        present(main, {
          contents: { ...focused, isDestroyed: () => true },
          window: main.window,
        });
        focusedWebContents.mockReturnValue({ ...focused, isDestroyed: () => true });
        yield* pasteAsText.handler(undefined, { sender: { id: 42 } });
        assert.equal(focused.paste.mock.calls.length, 1);

        focusedWebContents.mockReturnValue(null);
        yield* pasteAsText.handler(undefined, { sender: { id: 42 } });
        assert.equal(focused.paste.mock.calls.length, 1);

        yield* pasteAsText.handler(undefined);
        assert.equal(focused.paste.mock.calls.length, 1);
      }).pipe(Effect.provide(windowLayer(Option.some(main.window))));
    },
  );

  it.effect("pastes for a quick-message window only into that same window", () => {
    const main = appWindow(1);
    const quick = appWindow(2);
    const stranger = appWindow(8);
    ElectronWindow.markAuxiliaryWindow(quick.window);
    const guest: AppContents = {
      id: 99,
      isDestroyed: () => false,
      getType: () => "webview",
      paste: vi.fn(),
    };
    const destroyed = appWindow(3, true);
    ElectronWindow.markAuxiliaryWindow(destroyed.window);
    present(main, quick, stranger, destroyed, { contents: guest, window: main.window });
    focusedWebContents.mockReturnValue(quick.contents);

    return Effect.gen(function* () {
      yield* pasteAsText.handler(undefined, { sender: { id: quick.contents.id } });
      assert.equal(quick.contents.paste.mock.calls.length, 1);
      assert.equal(main.contents.paste.mock.calls.length, 0);

      focusedWebContents.mockReturnValue(guest);
      yield* pasteAsText.handler(undefined, { sender: { id: quick.contents.id } });
      assert.equal(quick.contents.paste.mock.calls.length, 1);
      assert.equal(guest.paste.mock.calls.length, 0);

      yield* pasteAsText.handler(undefined, { sender: { id: guest.id } });
      yield* pasteAsText.handler(undefined, { sender: { id: stranger.contents.id } });
      yield* pasteAsText.handler(undefined, { sender: { id: destroyed.contents.id } });
      focusedWebContents.mockReturnValue(stranger.contents);
      yield* pasteAsText.handler(undefined, { sender: { id: stranger.contents.id } });
      assert.equal(quick.contents.paste.mock.calls.length, 1);
      assert.equal(stranger.contents.paste.mock.calls.length, 0);
      assert.equal(main.contents.paste.mock.calls.length, 0);
    }).pipe(Effect.provide(windowLayer(Option.some(main.window))));
  });
});

describe("revealWindow", () => {
  it.effect("reveals the main window only when it asks", () => {
    const window = { webContents: { id: 42 } } as unknown as Electron.BrowserWindow;
    const reveal = vi.fn(() => Effect.void);
    return Effect.gen(function* () {
      yield* revealWindow.handler(undefined, { sender: { id: 99 } });
      assert.equal(reveal.mock.calls.length, 0);
      yield* revealWindow.handler(undefined, { sender: { id: 42 } });
      assert.deepEqual(reveal.mock.calls, [[window]]);
    }).pipe(
      Effect.provide(
        Layer.mock(ElectronWindow.ElectronWindow)({
          main: Effect.succeedSome(window),
          reveal,
        }),
      ),
    );
  });
});

describe("readMedia", () => {
  it.effect("reads http(s) media only for the main window", () =>
    Effect.gen(function* () {
      const mib = new Uint8Array(1024 * 1024);
      const fetch = vi.fn(async (url: string) => {
        if (url.endsWith("/missing.png")) return new Response("Not Found", { status: 404 });
        if (url.endsWith("/small.png")) return new Response(new Uint8Array([1, 2]));
        let sent = 0;
        // 257 MiB from one reused chunk: over the cap without allocating it.
        const huge = new ReadableStream<Uint8Array>({
          pull: (controller) => (sent++ < 257 ? controller.enqueue(mib) : controller.close()),
        });
        return new Response(huge);
      });
      const main = {
        webContents: { id: 1, session: { fetch } },
      } as unknown as Electron.BrowserWindow;
      const read = (url: string, senderId: number) =>
        readMedia
          .handler(url, { sender: { id: senderId } })
          .pipe(
            Effect.provide(
              Layer.mock(ElectronWindow.ElectronWindow)({ main: Effect.succeedSome(main) }),
            ),
          );

      assert.strictEqual(yield* read("https://example.com/a.png", 2), null);
      assert.strictEqual(yield* read("file:///etc/passwd", 1), null);
      assert.strictEqual(fetch.mock.calls.length, 0);
      assert.deepEqual(yield* read("https://example.com/small.png", 1), {
        status: 200,
        mimeType: "",
        data: Buffer.from([1, 2]),
      });
      assert.deepEqual(yield* read("https://example.com/missing.png", 1), {
        status: 404,
        mimeType: "text/plain;charset=UTF-8",
        data: new Uint8Array(),
      });
      assert.deepEqual(yield* read("https://example.com/huge.mp4", 1), {
        status: 413,
        mimeType: "",
        data: new Uint8Array(),
      });
    }),
  );
});

describe("pickProjectFavicon", () => {
  const pickerLayer = (
    pickFiles: () => Effect.Effect<Array<string>>,
    settings?: DesktopAppSettings.DesktopSettings,
  ) =>
    Layer.mergeAll(
      Layer.mock(ElectronDialog.ElectronDialog)({ pickFiles }),
      Layer.mock(ElectronWindow.ElectronWindow)({
        focusedMainOrFirst: Effect.succeedNone,
      }),
      DesktopAppSettings.layerTest(settings),
    );

  it.effect("opens a single-image picker from the project directory", () =>
    Effect.gen(function* () {
      const pickFiles = vi.fn(() => Effect.succeed(["/pictures/icon.png"]));
      const result = yield* pickProjectFavicon
        .handler("/project")
        .pipe(Effect.provide(pickerLayer(pickFiles)));

      assert.strictEqual(result, "/pictures/icon.png");
      assert.deepEqual(pickFiles.mock.calls, [
        [
          {
            owner: Option.none(),
            defaultPath: Option.some("/project"),
            multiple: false,
            filters: [
              {
                name: "Images",
                extensions: [
                  "avif",
                  "bmp",
                  "gif",
                  "ico",
                  "heic",
                  "heif",
                  "jpeg",
                  "jpg",
                  "png",
                  "svg",
                  "tif",
                  "tiff",
                  "webp",
                  "icns",
                ],
              },
            ],
          },
        ],
      ]);
    }),
  );

  it.effect("does not open a picker while the local environment is off", () =>
    Effect.gen(function* () {
      const pickFiles = vi.fn(() => Effect.succeed(["/pictures/icon.png"]));
      const result = yield* pickProjectFavicon.handler("/project").pipe(
        Effect.provide(
          pickerLayer(pickFiles, {
            ...DesktopAppSettings.DEFAULT_DESKTOP_SETTINGS,
            localEnvironmentEnabled: false,
          }),
        ),
      );

      assert.strictEqual(result, null);
      assert.strictEqual(pickFiles.mock.calls.length, 0);
    }),
  );
});

describe("saveTextFile", () => {
  const saveLayer = (
    saveFile: () => Effect.Effect<Option.Option<string>>,
    showItemInFolder: (path: string) => Effect.Effect<void>,
  ) =>
    Layer.mergeAll(
      Layer.mock(ElectronDialog.ElectronDialog)({ saveFile }),
      Layer.mock(ElectronShell.ElectronShell)({ showItemInFolder }),
      Layer.mock(ElectronWindow.ElectronWindow)({ focusedMainOrFirst: Effect.succeedNone }),
      NodeServices.layer,
    );

  it.effect("writes the file the user picked and can reveal only that file", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-save-text-" });
      const target = path.join(directory, "chosen.md");
      const revealed: string[] = [];
      const layer = saveLayer(
        () => Effect.succeedSome(target),
        (filePath) => Effect.sync(() => void revealed.push(filePath)),
      );

      const saved = yield* saveTextFile
        .handler({ defaultFileName: "thread.md", contents: "# Thread\n" })
        .pipe(Effect.provide(layer));
      yield* showSavedFileInFolder
        .handler(path.join(directory, "other.md"))
        .pipe(Effect.provide(layer));
      yield* showSavedFileInFolder.handler(target).pipe(Effect.provide(layer));

      assert.strictEqual(saved, target);
      assert.strictEqual(yield* fs.readFileString(target), "# Thread\n");
      assert.deepEqual(revealed, [target]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("writes nothing when the dialog is cancelled", () =>
    Effect.gen(function* () {
      const saved = yield* saveTextFile
        .handler({ defaultFileName: "thread.md", contents: "# Thread\n" })
        .pipe(
          Effect.provide(
            saveLayer(
              () => Effect.succeedNone,
              () => Effect.void,
            ),
          ),
        );

      assert.strictEqual(saved, null);
    }),
  );
});

describe("native interaction ownership", () => {
  beforeEach(() => {
    webContentsFromId.mockReset();
    ownerWindow.mockReset();
  });

  interface AppContents {
    readonly id: number;
    isDestroyed: () => boolean;
    getType: () => "window" | "webview";
  }

  function appWindow(id: number, destroyed = false) {
    const contents: AppContents = {
      id,
      isDestroyed: () => destroyed,
      getType: () => "window",
    };
    const window = {
      id,
      isDestroyed: () => destroyed,
      webContents: contents,
    } as unknown as Electron.BrowserWindow;
    return { window, contents };
  }

  function present(
    ...entries: ReadonlyArray<{
      readonly contents: AppContents;
      readonly window: Electron.BrowserWindow | null;
    }>
  ) {
    const byId = new Map(entries.map((entry) => [entry.contents.id, entry]));
    webContentsFromId.mockImplementation((id: number) => byId.get(id)?.contents);
    ownerWindow.mockImplementation(
      (contents: AppContents) => byId.get(contents?.id)?.window ?? null,
    );
  }

  const selector = (
    main: Option.Option<Electron.BrowserWindow>,
    focused: "unread" | Option.Option<Electron.BrowserWindow>,
  ) =>
    Layer.mock(ElectronWindow.ElectronWindow)({
      main: Effect.succeed(main),
      focusedMainOrFirst:
        focused === "unread"
          ? Effect.die("focused main selector was read")
          : Effect.succeed(focused),
    });

  const menuItem = { id: "copy", label: "Copy" };

  it.effect("targets the quick-message window that sent the menu", () => {
    const quick = appWindow(2);
    ElectronWindow.markAuxiliaryWindow(quick.window);
    present(quick);
    const showContextMenuMock = vi.fn((input: { readonly window: Electron.BrowserWindow }) =>
      Effect.sync(() => {
        assert.strictEqual(input.window, quick.window);
        assert.isTrue(NativeWindowInteraction.nativeWindowInteractionInProgress(quick.window));
        return Option.some("copy");
      }),
    );

    return Effect.gen(function* () {
      const selected = yield* showContextMenu.handler(
        { items: [menuItem] },
        { sender: { id: quick.contents.id } },
      );

      assert.strictEqual(selected, "copy");
      assert.strictEqual(showContextMenuMock.mock.calls[0]?.[0].window, quick.window);
      assert.isFalse(NativeWindowInteraction.nativeWindowInteractionInProgress(quick.window));
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          selector(Option.none(), "unread"),
          Layer.mock(ElectronMenu.ElectronMenu)({ showContextMenu: showContextMenuMock }),
        ),
      ),
    );
  });

  it.effect("targets the registered main window that sent the menu", () => {
    const main = appWindow(1);
    const quick = appWindow(2);
    ElectronWindow.markAuxiliaryWindow(quick.window);
    present(main, quick);
    const showContextMenuMock = vi.fn((input: { readonly window: Electron.BrowserWindow }) =>
      Effect.sync(() => {
        assert.strictEqual(input.window, main.window);
        assert.isTrue(NativeWindowInteraction.nativeWindowInteractionInProgress(main.window));
        assert.isFalse(NativeWindowInteraction.nativeWindowInteractionInProgress(quick.window));
        return Option.some("copy");
      }),
    );

    return Effect.gen(function* () {
      yield* showContextMenu.handler({ items: [menuItem] }, { sender: { id: main.contents.id } });
      assert.strictEqual(showContextMenuMock.mock.calls[0]?.[0].window, main.window);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          selector(Option.some(main.window), "unread"),
          Layer.mock(ElectronMenu.ElectronMenu)({ showContextMenu: showContextMenuMock }),
        ),
      ),
    );
  });

  it.effect("keeps the main-window selector when no sender is attached", () => {
    const fallback = appWindow(3);
    const showContextMenuMock = vi.fn((_input: { readonly window: Electron.BrowserWindow }) =>
      Effect.succeedSome("copy"),
    );

    return Effect.gen(function* () {
      yield* showContextMenu.handler({ items: [menuItem] });
      assert.strictEqual(webContentsFromId.mock.calls.length, 0);
      assert.strictEqual(showContextMenuMock.mock.calls[0]?.[0].window, fallback.window);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          selector(Option.none(), Option.some(fallback.window)),
          Layer.mock(ElectronMenu.ElectronMenu)({ showContextMenu: showContextMenuMock }),
        ),
      ),
    );
  });

  it.effect("does not trust a preview webview or an unregistered window", () => {
    const quick = appWindow(2);
    const stranger = appWindow(8);
    const fallback = appWindow(4);
    ElectronWindow.markAuxiliaryWindow(quick.window);
    const guest: AppContents = {
      id: 99,
      isDestroyed: () => false,
      getType: () => "webview",
    };
    present(quick, stranger, { contents: guest, window: quick.window });
    const showContextMenuMock = vi.fn((input: { readonly window: Electron.BrowserWindow }) =>
      Effect.sync(() => {
        assert.strictEqual(input.window, fallback.window);
        assert.isTrue(NativeWindowInteraction.nativeWindowInteractionInProgress(fallback.window));
        assert.isFalse(NativeWindowInteraction.nativeWindowInteractionInProgress(quick.window));
        assert.isFalse(NativeWindowInteraction.nativeWindowInteractionInProgress(stranger.window));
        return Option.some("copy");
      }),
    );
    const layer = Layer.mergeAll(
      selector(Option.some(appWindow(1).window), Option.some(fallback.window)),
      Layer.mock(ElectronMenu.ElectronMenu)({ showContextMenu: showContextMenuMock }),
    );

    return Effect.gen(function* () {
      yield* showContextMenu
        .handler({ items: [menuItem] }, { sender: { id: guest.id } })
        .pipe(Effect.provide(layer));
      yield* showContextMenu
        .handler({ items: [menuItem] }, { sender: { id: stranger.contents.id } })
        .pipe(Effect.provide(layer));
      assert.strictEqual(showContextMenuMock.mock.calls.length, 2);
    });
  });

  it.effect("falls back when the sender window is already destroyed", () => {
    const quick = appWindow(2, true);
    const main = appWindow(1, true);
    const fallback = appWindow(4);
    ElectronWindow.markAuxiliaryWindow(quick.window);
    present(quick, main);
    const showContextMenuMock = vi.fn((input: { readonly window: Electron.BrowserWindow }) =>
      Effect.sync(() => {
        assert.strictEqual(input.window, fallback.window);
        assert.isTrue(NativeWindowInteraction.nativeWindowInteractionInProgress(fallback.window));
        assert.isFalse(NativeWindowInteraction.nativeWindowInteractionInProgress(quick.window));
        assert.isFalse(NativeWindowInteraction.nativeWindowInteractionInProgress(main.window));
        return Option.some("copy");
      }),
    );
    const layer = Layer.mergeAll(
      selector(Option.some(main.window), Option.some(fallback.window)),
      Layer.mock(ElectronMenu.ElectronMenu)({ showContextMenu: showContextMenuMock }),
    );

    return Effect.gen(function* () {
      yield* showContextMenu
        .handler({ items: [menuItem] }, { sender: { id: quick.contents.id } })
        .pipe(Effect.provide(layer));
      yield* showContextMenu
        .handler({ items: [menuItem] }, { sender: { id: main.contents.id } })
        .pipe(Effect.provide(layer));
    });
  });

  it.effect("owns folder, file, and save dialogs to the quick-message sender", () => {
    const quick = appWindow(2);
    ElectronWindow.markAuxiliaryWindow(quick.window);
    present(quick);
    const assertOwned = (owner: Option.Option<Electron.BrowserWindow>) => {
      assert.isTrue(Option.isSome(owner));
      if (Option.isSome(owner)) assert.strictEqual(owner.value, quick.window);
      assert.isTrue(NativeWindowInteraction.nativeWindowInteractionInProgress(quick.window));
    };
    const pickFolderMock = vi.fn(
      (input: { readonly owner: Option.Option<Electron.BrowserWindow> }) =>
        Effect.sync(() => {
          assertOwned(input.owner);
          return Option.some("/work");
        }),
    );
    const pickFilesMock = vi.fn(
      (input: { readonly owner: Option.Option<Electron.BrowserWindow> }) =>
        Effect.sync(() => {
          assertOwned(input.owner);
          return ["/icon.png"];
        }),
    );
    const saveFileMock = vi.fn((input: { readonly owner: Option.Option<Electron.BrowserWindow> }) =>
      Effect.sync(() => {
        assertOwned(input.owner);
        return Option.none<string>();
      }),
    );
    const electron = selector(Option.none(), "unread");

    return Effect.gen(function* () {
      assert.strictEqual(
        yield* pickFolder.handler(undefined, { sender: { id: quick.contents.id } }).pipe(
          Effect.provide(
            Layer.mergeAll(
              electron,
              Layer.mock(ElectronDialog.ElectronDialog)({ pickFolder: pickFolderMock }),
              Layer.mock(DesktopEnvironment.DesktopEnvironment)({
                resolvePickFolderDefaultPath: () => Option.none(),
              } as unknown as DesktopEnvironment.DesktopEnvironment["Service"]),
              Layer.mock(DesktopWslEnvironment.DesktopWslEnvironment)({}),
              DesktopAppSettings.layerTest(),
            ),
          ),
        ),
        "/work",
      );
      assert.strictEqual(
        yield* pickProjectFavicon
          .handler(undefined, { sender: { id: quick.contents.id } })
          .pipe(
            Effect.provide(
              Layer.mergeAll(
                electron,
                Layer.mock(ElectronDialog.ElectronDialog)({ pickFiles: pickFilesMock }),
                DesktopAppSettings.layerTest(),
              ),
            ),
          ),
        "/icon.png",
      );
      assert.isNull(
        yield* pickThemeFiles.handler(undefined, { sender: { id: quick.contents.id } }).pipe(
          Effect.provide(
            Layer.mergeAll(
              electron,
              Layer.mock(ElectronDialog.ElectronDialog)({
                pickFiles: (input: { readonly owner: Option.Option<Electron.BrowserWindow> }) =>
                  Effect.sync(() => {
                    assertOwned(input.owner);
                    return [];
                  }),
              }),
              NodeServices.layer,
            ),
          ),
        ),
      );
      assert.isNull(
        yield* saveTextFile
          .handler(
            { defaultFileName: "thread.md", contents: "# Thread\n" },
            { sender: { id: quick.contents.id } },
          )
          .pipe(
            Effect.provide(
              Layer.mergeAll(
                electron,
                Layer.mock(ElectronDialog.ElectronDialog)({ saveFile: saveFileMock }),
                NodeServices.layer,
              ),
            ),
          ),
      );
      assert.isFalse(NativeWindowInteraction.nativeWindowInteractionInProgress(quick.window));
    });
  });
});

describe("syncHtmlFullscreen", () => {
  const fullscreenWindow = (fullscreen: boolean, { animatedExit = false } = {}) => {
    let current = fullscreen;
    let exiting = false;
    const queued: boolean[] = [];
    const leaveListeners: Array<() => void> = [];
    const leave = () => {
      current = false;
      for (const listener of leaveListeners) listener();
    };
    // Like macOS, an animated exit keeps reporting fullscreen and queues requests until it ends.
    const setFullScreen = vi.fn((next: boolean) => {
      if (exiting) queued.push(next);
      else if (next) current = true;
      else if (!current) return;
      else if (animatedExit) exiting = true;
      else leave();
    });
    const finishExit = () => {
      exiting = false;
      leave();
      for (const next of queued.splice(0)) setFullScreen(next);
    };
    const window = {
      webContents: { id: 1 },
      isDestroyed: () => false,
      isFullScreen: () => current,
      setFullScreen,
      on: (event: string, listener: () => void) => {
        if (event === "leave-full-screen") leaveListeners.push(listener);
      },
    } as unknown as Electron.BrowserWindow;
    const layer = Layer.mock(ElectronWindow.ElectronWindow)({ main: Effect.succeedSome(window) });
    return { window, setFullScreen, finishExit, layer };
  };
  const fromMainRenderer = { sender: { id: 1 } };

  it.effect("takes the screen for the app's own fullscreen element and gives it back", () => {
    const { window, layer } = fullscreenWindow(false);
    return Effect.gen(function* () {
      yield* syncHtmlFullscreen.handler(true, fromMainRenderer);
      assert.isTrue(window.isFullScreen());

      yield* syncHtmlFullscreen.handler(false, fromMainRenderer);
      assert.isFalse(window.isFullScreen());
    }).pipe(Effect.provide(layer));
  });

  it.effect("keeps a window the user had already made fullscreen", () => {
    const { window, setFullScreen, layer } = fullscreenWindow(true);
    return Effect.gen(function* () {
      yield* syncHtmlFullscreen.handler(true, fromMainRenderer);
      yield* syncHtmlFullscreen.handler(false, fromMainRenderer);

      assert.isTrue(window.isFullScreen());
      assert.strictEqual(setFullScreen.mock.calls.length, 0);
    }).pipe(Effect.provide(layer));
  });

  it.effect("hands the window back once the user leaves OS fullscreen during playback", () => {
    const { window, layer } = fullscreenWindow(false);
    return Effect.gen(function* () {
      yield* syncHtmlFullscreen.handler(true, fromMainRenderer);
      window.setFullScreen(false);
      window.setFullScreen(true);
      yield* syncHtmlFullscreen.handler(false, fromMainRenderer);

      assert.isTrue(window.isFullScreen());
    }).pipe(Effect.provide(layer));
  });

  it.effect("takes the screen again when the video returns during an animated exit", () => {
    const { window, finishExit, layer } = fullscreenWindow(false, { animatedExit: true });
    return Effect.gen(function* () {
      yield* syncHtmlFullscreen.handler(true, fromMainRenderer);
      yield* syncHtmlFullscreen.handler(false, fromMainRenderer);
      yield* syncHtmlFullscreen.handler(true, fromMainRenderer);
      finishExit();
      assert.isTrue(window.isFullScreen());

      yield* syncHtmlFullscreen.handler(false, fromMainRenderer);
      finishExit();
      assert.isFalse(window.isFullScreen());
    }).pipe(Effect.provide(layer));
  });
});

it.effect.skipIf(HostProcess.Platform.defaultValue() === "win32")(
  "finds remote editors installed without PATH launchers",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs.makeTempDirectoryScoped({ prefix: "t3-remote-editors-" });
      for (const app of ["Cursor", "Visual Studio Code", "WebStorm"]) {
        const executable = path.join(
          home,
          "Applications",
          `${app}.app`,
          app === "WebStorm" ? "Contents/MacOS/webstorm" : "Contents/Resources/app/bin/code",
        );
        yield* fs.makeDirectory(path.dirname(executable), { recursive: true });
        yield* fs.writeFileString(executable, "#!/bin/sh\n");
        yield* fs.chmod(executable, 0o755);
      }
      const editors = yield* probeRemoteEditors.handler(undefined).pipe(
        Effect.provideService(HostProcess.Environment, {
          HOME: home,
          PATH: path.join(home, "empty"),
        }),
        Effect.provideService(HostProcess.Platform, "darwin"),
      );
      assert.include(editors, "cursor");
      assert.include(editors, "vscode");
      assert.include(editors, "webstorm");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
