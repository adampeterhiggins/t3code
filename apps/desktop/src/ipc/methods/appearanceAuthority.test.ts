import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  DEFAULT_CLIENT_SETTINGS,
  DesktopAppearanceSnapshot,
  type ClientSettings,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { vi } from "vite-plus/test";

import type * as Electron from "electron";

import * as DesktopAppearance from "../../appearance/DesktopAppearance.ts";
import * as DesktopConfig from "../../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";
import * as ElectronTheme from "../../electron/ElectronTheme.ts";
import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import * as DesktopQuickMessage from "../../quickMessage/DesktopQuickMessage.ts";
import * as DesktopClientSettings from "../../settings/DesktopClientSettings.ts";
import * as DesktopSnapShot from "../../snapShot/DesktopSnapShot.ts";
import { APPEARANCE_SNAPSHOT_CHANNEL, CLIENT_SETTINGS_EVENT_CHANNEL } from "../channels.ts";
import { DesktopMainAuthorityError } from "../mainAuthority.ts";
import { getAppearanceSnapshot, publishAppearanceSnapshot } from "./appearance.ts";
import { setClientSettings } from "./clientSettings.ts";
import { setTheme } from "./window.ts";

const MAIN_ID = 7;
const PANEL_ID = 4;
const OTHER_ID = 9;

const native = vi.hoisted(() => ({
  windows: [] as Array<{
    isDestroyed: () => boolean;
    webContents: {
      isDestroyed: () => boolean;
      id: number;
      send: (channel: string, payload: unknown) => void;
    };
  }>,
  sent: [] as Array<{ id: number; channel: string; payload: unknown }>,
}));

vi.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows: () => native.windows,
    fromWebContents: () => null,
    getFocusedWindow: () => null,
  },
  webContents: { getFocusedWebContents: () => null },
  nativeTheme: {
    themeSource: "system",
    shouldUseDarkColors: false,
    on: () => undefined,
    removeListener: () => undefined,
  },
}));

const snapshot = {
  theme: "environment-palette-pending",
  appearanceMode: "system" as const,
  halves: { light: "builtin-light" },
  customThemes: [{ id: "cedar" }],
};
const settings: ClientSettings = { ...DEFAULT_CLIENT_SETTINGS, timestampFormat: "12-hour" };
const decodeSnapshot = Schema.decodeUnknownEffect(DesktopAppearanceSnapshot);

function openWindow(id: number) {
  const window = {
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      id,
      send: (channel: string, payload: unknown) => {
        native.sent.push({ id, channel, payload });
      },
    },
  };
  native.windows.push(window);
  return window;
}

const sender = (id: number) => ({ sender: { id } });

// IPC handlers succeed with `unknown`, so `Effect.flip` would put `unknown` on
// the error channel. Keep the rejection as the success value instead.
const rejected = <E, R>(effect: Effect.Effect<unknown, E, R>) =>
  effect.pipe(
    Effect.matchEffect({
      onFailure: Effect.succeed,
      onSuccess: () => Effect.die("expected the desktop call to be rejected"),
    }),
  );

function runtime(input: {
  readonly baseDir: string;
  readonly main: Option.Option<Electron.BrowserWindow>;
  readonly themes: Array<string>;
  readonly configured: Array<ClientSettings>;
}) {
  const environment = DesktopEnvironment.layer({
    dirname: "/repo/apps/desktop/src",
    homeDirectory: input.baseDir,
    platform: "darwin",
    processArch: "x64",
    appVersion: "1.2.3",
    appPath: "/repo",
    isPackaged: true,
    resourcesPath: "/missing/resources",
    runningUnderArm64Translation: false,
  }).pipe(
    Layer.provide(
      Layer.mergeAll(NodeServices.layer, DesktopConfig.layerTest({ T3CODE_HOME: input.baseDir })),
    ),
  );
  return Layer.mergeAll(
    DesktopAppearance.layer,
    DesktopClientSettings.layer,
    Layer.succeed(
      ElectronWindow.ElectronWindow,
      ElectronWindow.ElectronWindow.of({
        create: () => Effect.die("unused"),
        main: Effect.succeed(input.main),
        // This fallback also matches the splash and any window not registered yet.
        currentMainOrFirst: Effect.sync(() =>
          Option.fromNullishOr(
            (native.windows.find((window) => window.webContents.id === OTHER_ID) ??
              null) as Electron.BrowserWindow | null,
          ),
        ),
        focusedMainOrFirst: Effect.succeed(Option.none()),
        setMain: () => Effect.void,
        clearMain: () => Effect.void,
        prepareReveal: () => Effect.succeed(false),
        reveal: () => Effect.void,
        sendAll: () => Effect.void,
        destroyAll: Effect.void,
        syncAllAppearance: () => Effect.void,
      }),
    ),
    Layer.succeed(
      DesktopQuickMessage.DesktopQuickMessage,
      DesktopQuickMessage.DesktopQuickMessage.of({
        initialize: Effect.void,
        configure: (next) =>
          Effect.sync(() => {
            input.configured.push(next);
          }),
        state: Effect.succeed({ shortcutRegistered: false, message: null }),
        setShortcutSuppressed: () => Effect.void,
        isPanel: (webContentsId) => Effect.sync(() => webContentsId === PANEL_ID),
        setPanelReady: Effect.void,
        setPresentation: () => Effect.void,
        dismiss: Effect.void,
        submit: () => Effect.void,
        setReceiverReady: () => Effect.void,
      }),
    ),
    Layer.succeed(DesktopSnapShot.DesktopSnapShot, {
      configure: (next) =>
        Effect.sync(() => {
          input.configured.push(next);
        }),
    } as DesktopSnapShot.DesktopSnapShot["Service"]),
    Layer.succeed(
      ElectronTheme.ElectronTheme,
      ElectronTheme.ElectronTheme.of({
        shouldUseDarkColors: Effect.succeed(false),
        setSource: (theme) =>
          Effect.sync(() => {
            input.themes.push(theme);
          }),
        onUpdated: () => Effect.void,
      }),
    ),
  ).pipe(Layer.provideMerge(environment), Layer.provideMerge(NodeServices.layer));
}

const withRuntime = <A, E, R>(
  registerMain: boolean,
  effect: (input: {
    readonly themes: Array<string>;
    readonly configured: Array<ClientSettings>;
  }) => Effect.Effect<
    A,
    E,
    | R
    | DesktopAppearance.DesktopAppearance
    | DesktopClientSettings.DesktopClientSettings
    | DesktopEnvironment.DesktopEnvironment
  >,
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const baseDir = yield* fileSystem.makeTempDirectoryScoped({
      prefix: "t3-desktop-appearance-ipc-",
    });
    native.windows.length = 0;
    native.sent.length = 0;
    const themes: Array<string> = [];
    const configured: Array<ClientSettings> = [];
    const main = openWindow(MAIN_ID);
    openWindow(PANEL_ID);
    openWindow(OTHER_ID);
    return yield* effect({ themes, configured }).pipe(
      Effect.provide(
        runtime({
          baseDir,
          main: registerMain ? Option.some(main as Electron.BrowserWindow) : Option.none(),
          themes,
          configured,
        }),
      ),
    );
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped);

describe("appearance authority", () => {
  it.effect("lets the registered main window publish and the panel read the stored snapshot", () =>
    withRuntime(true, () =>
      Effect.gen(function* () {
        const environment = yield* DesktopEnvironment.DesktopEnvironment;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const snapshotPath = DesktopAppearance.desktopAppearanceSnapshotPath(
          environment.clientSettingsPath,
          path,
        );

        assert.equal(yield* getAppearanceSnapshot.handler(undefined, sender(MAIN_ID)), null);
        assert.equal(yield* getAppearanceSnapshot.handler(undefined, sender(PANEL_ID)), null);

        yield* publishAppearanceSnapshot.handler(snapshot, sender(MAIN_ID));
        assert.deepEqual(
          yield* getAppearanceSnapshot.handler(undefined, sender(PANEL_ID)),
          snapshot,
        );
        assert.deepEqual(
          yield* decodeSnapshot(JSON.parse(yield* fileSystem.readFileString(snapshotPath))),
          snapshot,
        );
        assert.deepEqual(native.sent, [
          { id: PANEL_ID, channel: APPEARANCE_SNAPSHOT_CHANNEL, payload: snapshot },
        ]);

        const panelPublish = yield* rejected(
          publishAppearanceSnapshot.handler({ ...snapshot, theme: "from-panel" }, sender(PANEL_ID)),
        );
        assert.instanceOf(panelPublish, DesktopMainAuthorityError);
        assert.equal(panelPublish.operation, "publish-appearance");

        const previewRead = yield* rejected(
          getAppearanceSnapshot.handler(undefined, sender(OTHER_ID)),
        );
        assert.instanceOf(previewRead, DesktopMainAuthorityError);
        assert.equal(previewRead.operation, "get-appearance");

        const spoofed = yield* Effect.result(
          publishAppearanceSnapshot.handler({ ...snapshot, role: "main" }, sender(OTHER_ID)),
        );
        assert.equal(spoofed._tag, "Failure");
        assert.deepEqual(
          yield* getAppearanceSnapshot.handler(undefined, sender(MAIN_ID)),
          snapshot,
        );
        assert.equal(native.sent.length, 1);

        const invalid = yield* rejected(
          publishAppearanceSnapshot.handler({ ...snapshot, theme: 1 }, sender(MAIN_ID)),
        );
        assert.instanceOf(invalid, Schema.SchemaError);
        assert.deepEqual(
          yield* decodeSnapshot(JSON.parse(yield* fileSystem.readFileString(snapshotPath))),
          snapshot,
        );
      }),
    ),
  );

  it.effect("broadcasts the settings the main window wrote and refuses an auxiliary write", () =>
    withRuntime(true, (input) =>
      Effect.gen(function* () {
        const environment = yield* DesktopEnvironment.DesktopEnvironment;
        const fileSystem = yield* FileSystem.FileSystem;

        yield* setClientSettings.handler(settings, sender(MAIN_ID));
        const written = JSON.parse(
          yield* fileSystem.readFileString(environment.clientSettingsPath),
        );
        assert.deepEqual(written, settings);
        assert.deepEqual(native.sent, [
          { id: PANEL_ID, channel: CLIENT_SETTINGS_EVENT_CHANNEL, payload: settings },
        ]);
        assert.deepEqual(input.configured, [settings, settings]);

        const saved = yield* fileSystem.readFileString(environment.clientSettingsPath);
        native.sent.length = 0;
        input.configured.length = 0;
        const denied = yield* rejected(
          setClientSettings.handler(
            { ...settings, wordWrap: !settings.wordWrap },
            sender(PANEL_ID),
          ),
        );
        assert.instanceOf(denied, DesktopMainAuthorityError);
        assert.equal(denied.operation, "set-client-settings");
        assert.equal(yield* fileSystem.readFileString(environment.clientSettingsPath), saved);
        assert.equal(native.sent.length, 0);
        assert.equal(input.configured.length, 0);
      }),
    ),
  );

  it.effect("keeps native theme changes on the registered main window", () =>
    withRuntime(true, (input) =>
      Effect.gen(function* () {
        yield* setTheme.handler("dark", sender(MAIN_ID));
        assert.deepEqual(input.themes, ["dark"]);

        const panel = yield* rejected(setTheme.handler("light", sender(PANEL_ID)));
        assert.instanceOf(panel, DesktopMainAuthorityError);
        assert.equal(panel.operation, "set-theme");
        assert.deepEqual(input.themes, ["dark"]);
      }),
    ),
  );

  it.effect("does not trust the unregistered main-window fallback", () =>
    withRuntime(false, (input) =>
      Effect.gen(function* () {
        // MAIN_ID is open, and currentMainOrFirst resolves to OTHER_ID. Neither
        // is ElectronWindow.main, so neither can act as the main renderer.
        for (const id of [MAIN_ID, OTHER_ID]) {
          const theme = yield* rejected(setTheme.handler("dark", sender(id)));
          assert.instanceOf(theme, DesktopMainAuthorityError);
          assert.equal(theme.operation, "set-theme");

          const settingsWrite = yield* rejected(setClientSettings.handler(settings, sender(id)));
          assert.instanceOf(settingsWrite, DesktopMainAuthorityError);
          assert.equal(settingsWrite.operation, "set-client-settings");

          const publish = yield* rejected(publishAppearanceSnapshot.handler(snapshot, sender(id)));
          assert.instanceOf(publish, DesktopMainAuthorityError);
          assert.equal(publish.operation, "publish-appearance");

          const read = yield* rejected(getAppearanceSnapshot.handler(undefined, sender(id)));
          assert.instanceOf(read, DesktopMainAuthorityError);
          assert.equal(read.operation, "get-appearance");
        }

        assert.equal(yield* getAppearanceSnapshot.handler(undefined, sender(PANEL_ID)), null);
        assert.equal(input.themes.length, 0);
        assert.equal(input.configured.length, 0);
        assert.equal(native.sent.length, 0);
      }),
    ),
  );
});
