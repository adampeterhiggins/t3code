import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { DesktopAppearanceSnapshot } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { vi } from "vite-plus/test";

import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import { APPEARANCE_SNAPSHOT_CHANNEL } from "../ipc/channels.ts";
import * as DesktopQuickMessage from "../quickMessage/DesktopQuickMessage.ts";
import {
  DESKTOP_APPEARANCE_SNAPSHOT_FILE_NAME,
  DesktopAppearance,
  DesktopAppearanceWriteError,
  desktopAppearanceSnapshotPath,
  layer as appearanceLayer,
  make,
} from "./DesktopAppearance.ts";

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
  },
}));

const snapshot = {
  theme: "environment-palette-pending",
  appearanceMode: "system" as const,
  halves: { dark: "custom-not-yet-loaded" },
  customThemes: [{ id: "cedar", extra: true }],
};
const decodeSnapshot = Schema.decodeUnknownEffect(DesktopAppearanceSnapshot);

function openWindow(id: number, destroyed = false) {
  const window = {
    isDestroyed: () => destroyed,
    webContents: {
      isDestroyed: () => destroyed,
      id,
      send: (channel: string, payload: unknown) => {
        native.sent.push({ id, channel, payload });
      },
    },
  };
  native.windows.push(window);
  return window;
}

const quickMessageLayer = (panelIds: ReadonlySet<number>) =>
  Layer.succeed(
    DesktopQuickMessage.DesktopQuickMessage,
    DesktopQuickMessage.DesktopQuickMessage.of({
      initialize: Effect.void,
      configure: () => Effect.void,
      state: Effect.succeed({ shortcutRegistered: false, message: null }),
      setShortcutSuppressed: () => Effect.void,
      isPanel: (webContentsId) => Effect.sync(() => panelIds.has(webContentsId)),
      setPanelReady: Effect.void,
      dismiss: Effect.void,
      submit: () => Effect.void,
      setReceiverReady: () => Effect.void,
    }),
  );

function runtime(baseDir: string) {
  const environment = DesktopEnvironment.layer({
    dirname: "/repo/apps/desktop/src",
    homeDirectory: baseDir,
    platform: "darwin",
    processArch: "x64",
    appVersion: "1.2.3",
    appPath: "/repo",
    isPackaged: true,
    resourcesPath: "/missing/resources",
    runningUnderArm64Translation: false,
  }).pipe(
    Layer.provide(
      Layer.mergeAll(NodeServices.layer, DesktopConfig.layerTest({ T3CODE_HOME: baseDir })),
    ),
  );
  return appearanceLayer.pipe(
    Layer.provideMerge(environment),
    Layer.provideMerge(quickMessageLayer(new Set([4]))),
    Layer.provideMerge(NodeServices.layer),
  );
}

const withAppearance = <A, E, R>(
  effect: Effect.Effect<A, E, R | DesktopAppearance | DesktopEnvironment.DesktopEnvironment>,
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const baseDir = yield* fileSystem.makeTempDirectoryScoped({
      prefix: "t3-desktop-appearance-test-",
    });
    native.windows.length = 0;
    native.sent.length = 0;
    openWindow(2);
    openWindow(4);
    openWindow(9, true);
    return yield* effect.pipe(Effect.provide(runtime(baseDir)));
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped);

describe("DesktopAppearance", () => {
  it.effect("keeps a missing snapshot absent and reloads a published one after restart", () =>
    withAppearance(
      Effect.gen(function* () {
        const environment = yield* DesktopEnvironment.DesktopEnvironment;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const appearance = yield* DesktopAppearance;
        const snapshotPath = desktopAppearanceSnapshotPath(environment.clientSettingsPath, path);

        assert.equal(yield* appearance.get, null);
        const missing = yield* Effect.result(fileSystem.readFileString(snapshotPath));
        assert.equal(missing._tag, "Failure");
        if (missing._tag === "Failure") {
          assert.equal(missing.failure.reason._tag, "NotFound");
        }

        assert.deepEqual(yield* appearance.publish(snapshot), snapshot);
        assert.deepEqual(yield* appearance.get, snapshot);
        assert.equal(path.basename(snapshotPath), DESKTOP_APPEARANCE_SNAPSHOT_FILE_NAME);
        assert.equal(path.dirname(snapshotPath), path.dirname(environment.clientSettingsPath));
        assert.deepEqual(
          yield* decodeSnapshot(JSON.parse(yield* fileSystem.readFileString(snapshotPath))),
          snapshot,
        );
        assert.deepEqual(native.sent, [
          { id: 4, channel: APPEARANCE_SNAPSHOT_CHANNEL, payload: snapshot },
        ]);

        const restarted = yield* make;
        assert.deepEqual(yield* restarted.get, snapshot);
      }),
    ),
  );

  it.effect("writes through a symlink without replacing the link", () =>
    withAppearance(
      Effect.gen(function* () {
        const environment = yield* DesktopEnvironment.DesktopEnvironment;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const appearance = yield* DesktopAppearance;
        const snapshotPath = desktopAppearanceSnapshotPath(environment.clientSettingsPath, path);
        const dotfiles = yield* fileSystem.makeTempDirectoryScoped({
          prefix: "t3-desktop-appearance-dotfiles-",
        });
        const linkedPath = `${dotfiles}/${DESKTOP_APPEARANCE_SNAPSHOT_FILE_NAME}`;
        yield* fileSystem.writeFileString(linkedPath, "{}\n");
        yield* fileSystem.makeDirectory(path.dirname(snapshotPath), { recursive: true });
        yield* fileSystem.symlink(linkedPath, snapshotPath);

        yield* appearance.publish(snapshot);

        assert.equal(yield* fileSystem.readLink(snapshotPath), linkedPath);
        assert.deepEqual(
          yield* decodeSnapshot(JSON.parse(yield* fileSystem.readFileString(linkedPath))),
          snapshot,
        );
      }),
    ),
  );

  it.effect("leaves a corrupt snapshot in place until a valid publish", () =>
    withAppearance(
      Effect.gen(function* () {
        const environment = yield* DesktopEnvironment.DesktopEnvironment;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const snapshotPath = desktopAppearanceSnapshotPath(environment.clientSettingsPath, path);
        yield* fileSystem.makeDirectory(path.dirname(snapshotPath), { recursive: true });
        const corrupt = "{not-json";
        yield* fileSystem.writeFileString(snapshotPath, corrupt);

        const loaded = yield* make;
        assert.equal(yield* loaded.get, null);
        assert.equal(yield* fileSystem.readFileString(snapshotPath), corrupt);

        const invalid = yield* loaded
          .publish({ theme: 1, appearanceMode: "auto" })
          .pipe(Effect.flip);
        assert.instanceOf(invalid, DesktopAppearanceWriteError);
        assert.equal(invalid.operation, "decode-snapshot");
        assert.equal(yield* fileSystem.readFileString(snapshotPath), corrupt);
        assert.equal(native.sent.length, 0);

        assert.deepEqual(yield* loaded.publish(snapshot), snapshot);
        assert.deepEqual(
          yield* decodeSnapshot(JSON.parse(yield* fileSystem.readFileString(snapshotPath))),
          snapshot,
        );
      }),
    ),
  );

  it.effect("does not replace a saved snapshot when a later publish is invalid", () =>
    withAppearance(
      Effect.gen(function* () {
        const environment = yield* DesktopEnvironment.DesktopEnvironment;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const appearance = yield* DesktopAppearance;
        const snapshotPath = desktopAppearanceSnapshotPath(environment.clientSettingsPath, path);
        yield* appearance.publish(snapshot);
        const saved = yield* fileSystem.readFileString(snapshotPath);
        native.sent.length = 0;

        const invalid = yield* appearance
          .publish({ ...snapshot, appearanceMode: "nope" })
          .pipe(Effect.flip);
        assert.instanceOf(invalid, DesktopAppearanceWriteError);
        assert.equal(yield* fileSystem.readFileString(snapshotPath), saved);
        assert.deepEqual(yield* appearance.get, snapshot);
        assert.equal(native.sent.length, 0);

        const next = { ...snapshot, theme: "harbor" };
        yield* appearance.publish(next);
        assert.deepEqual(
          native.sent.map((event) => event.payload),
          [next],
        );
        assert.deepEqual(yield* appearance.get, next);
      }),
    ),
  );
});
