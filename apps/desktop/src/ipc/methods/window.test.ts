import { assert, describe, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as HostProcess from "@t3tools/shared/HostProcess";
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
import * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";
import * as ElectronDialog from "../../electron/ElectronDialog.ts";
import * as ElectronMenu from "../../electron/ElectronMenu.ts";
import * as NativeWindowInteraction from "../../electron/NativeWindowInteraction.ts";
import * as ElectronShell from "../../electron/ElectronShell.ts";
import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import * as DesktopAppSettings from "../../settings/DesktopAppSettings.ts";
import * as DesktopWslEnvironment from "../../wsl/DesktopWslEnvironment.ts";
import {
  getLocalEnvironmentBootstraps,
  getRelayTelemetryEnabled,
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
  it.effect("publishes the concrete running distro without replacing the stable instance id", () =>
    Effect.gen(function* () {
      const result = yield* getLocalEnvironmentBootstraps.handler();

      assert.deepEqual(result, [
        {
          id: "wsl:default",
          label: "WSL (Ubuntu)",
          runningDistro: "Ubuntu",
          httpBaseUrl: "http://127.0.0.1:3774/",
          wsBaseUrl: "ws://127.0.0.1:3774/",
          bootstrapToken: "bootstrap-token",
        },
      ]);
    }).pipe(Effect.provide(bootstrapsLayer([defaultWslInstance]))),
  );

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

describe("getRelayTelemetryEnabled", () => {
  it.effect("reads the desktop host opt-out before returning the renderer policy", () =>
    Effect.gen(function* () {
      assert.isFalse(
        yield* getRelayTelemetryEnabled.handler().pipe(
          Effect.provideService(HostProcess.Environment, {
            T3CODE_TELEMETRY_ENABLED: "false",
          }),
        ),
      );
      assert.isTrue(
        yield* getRelayTelemetryEnabled
          .handler()
          .pipe(Effect.provideService(HostProcess.Environment, {})),
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
                extensions: ["avif", "gif", "ico", "jpeg", "jpg", "png", "svg", "webp", "icns"],
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
