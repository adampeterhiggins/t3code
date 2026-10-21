import { assert, describe, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import type * as Electron from "electron";
import { beforeEach, vi } from "vite-plus/test";

const { flushStorageData, fromId, getAllWindows } = vi.hoisted(() => ({
  flushStorageData: vi.fn(),
  fromId: vi.fn(),
  getAllWindows: vi.fn((): Array<Electron.BrowserWindow> => []),
}));

vi.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows,
    getFocusedWindow: () => null,
  },
  webContents: { fromId },
}));

import * as DesktopLegacyLocalStorage from "../../app/DesktopLegacyLocalStorage.ts";
import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import {
  completeLegacyLocalStorage,
  LegacyLocalStorageUnauthorizedSenderError,
  takeLegacyLocalStorage,
} from "./legacyLocalStorage.ts";

const payload = { theme: "dark" };

function makeWindow(input: {
  readonly id: number;
  readonly webContentsId: number;
  readonly destroyed?: boolean;
}) {
  return {
    id: input.id,
    isDestroyed: () => input.destroyed ?? false,
    webContents: { id: input.webContentsId },
  } as unknown as Electron.BrowserWindow;
}

function syncEvent(webContentsId: number, role?: string): DesktopIpc.DesktopIpcSyncEvent {
  return {
    returnValue: undefined,
    sender: { id: webContentsId },
    ...(role === undefined ? {} : { role }),
  } as DesktopIpc.DesktopIpcSyncEvent;
}

const expectRejected = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(effect);
    assert.isTrue(Exit.isFailure(exit));
    if (Exit.isFailure(exit)) {
      const error = Cause.squash(exit.cause);
      assert.instanceOf(error, LegacyLocalStorageUnauthorizedSenderError);
      return error;
    }
    return yield* Effect.die("expected the migration to reject the sender");
  });

describe("legacy local storage migration", () => {
  beforeEach(() => {
    flushStorageData.mockReset();
    fromId.mockReset();
    getAllWindows.mockReset();
    getAllWindows.mockReturnValue([]);
    fromId.mockImplementation((id: number) => ({
      id,
      session: { flushStorageData },
    }));
  });

  const withLegacy = <A, E, R>(
    run: (input: {
      readonly items: Ref.Ref<Option.Option<Readonly<Record<string, string>>>>;
      readonly completions: { count: number };
    }) => Effect.Effect<A, E, R>,
  ) =>
    Effect.gen(function* () {
      const items = yield* Ref.make(Option.some<Readonly<Record<string, string>>>(payload));
      const completions = { count: 0 };
      const legacy = DesktopLegacyLocalStorage.DesktopLegacyLocalStorage.of({
        load: () => Effect.void,
        take: Ref.getAndSet(items, Option.none()),
        complete: Effect.sync(() => {
          completions.count += 1;
        }),
      });
      yield* run({ items, completions }).pipe(
        Effect.provide(
          Layer.mergeAll(
            ElectronWindow.layer.pipe(Layer.provide(Layer.succeed(HostProcess.Platform, "darwin"))),
            Layer.succeed(DesktopLegacyLocalStorage.DesktopLegacyLocalStorage, legacy),
          ),
        ),
      );
    });

  it.effect("leaves the payload for the main renderer when another caller takes it", () =>
    withLegacy(({ items }) =>
      Effect.gen(function* () {
        const auxiliary = makeWindow({ id: 2, webContentsId: 22 });
        const main = makeWindow({ id: 3, webContentsId: 33 });
        ElectronWindow.markAuxiliaryWindow(auxiliary);
        getAllWindows.mockReturnValue([auxiliary, main]);
        const electronWindow = yield* ElectronWindow.ElectronWindow;
        assert.isTrue(Option.isNone(yield* electronWindow.main));

        assert.isNull(yield* takeLegacyLocalStorage.handler(syncEvent(22, "main")));
        assert.isNull(yield* takeLegacyLocalStorage.handler());
        assert.isNull(yield* takeLegacyLocalStorage.handler({ returnValue: undefined }));
        assert.deepEqual(yield* Ref.get(items), Option.some(payload));

        assert.deepEqual(yield* takeLegacyLocalStorage.handler(syncEvent(33)), payload);
        assert.deepEqual(yield* Ref.get(items), Option.none());
        assert.isNull(yield* takeLegacyLocalStorage.handler(syncEvent(33)));
      }),
    ),
  );

  it.effect("allows the loading main renderer before the main ref is assigned", () =>
    withLegacy(({ items }) =>
      Effect.gen(function* () {
        const auxiliary = makeWindow({ id: 2, webContentsId: 22 });
        const destroyed = makeWindow({ id: 4, webContentsId: 44, destroyed: true });
        const main = makeWindow({ id: 3, webContentsId: 33 });
        ElectronWindow.markAuxiliaryWindow(auxiliary);
        const electronWindow = yield* ElectronWindow.ElectronWindow;
        assert.isTrue(Option.isNone(yield* electronWindow.main));

        getAllWindows.mockReturnValue([auxiliary]);
        assert.isNull(yield* takeLegacyLocalStorage.handler(syncEvent(22)));

        getAllWindows.mockReturnValue([destroyed]);
        assert.isNull(yield* takeLegacyLocalStorage.handler(syncEvent(44)));
        assert.deepEqual(yield* Ref.get(items), Option.some(payload));

        getAllWindows.mockReturnValue([auxiliary, main]);
        const current = yield* electronWindow.currentMainOrFirst;
        assert.isTrue(Option.isSome(current));
        if (Option.isSome(current)) assert.strictEqual(current.value, main);
        assert.deepEqual(yield* takeLegacyLocalStorage.handler(syncEvent(33)), payload);
      }),
    ),
  );

  it.effect("returns null for a different renderer once the main window is assigned", () =>
    withLegacy(({ items }) =>
      Effect.gen(function* () {
        const splash = makeWindow({ id: 1, webContentsId: 11 });
        const main = makeWindow({ id: 3, webContentsId: 33 });
        getAllWindows.mockReturnValue([splash, main]);
        const electronWindow = yield* ElectronWindow.ElectronWindow;
        yield* electronWindow.setMain(main);

        assert.isNull(yield* takeLegacyLocalStorage.handler(syncEvent(11)));
        assert.deepEqual(yield* Ref.get(items), Option.some(payload));
        assert.deepEqual(yield* takeLegacyLocalStorage.handler(syncEvent(33)), payload);
      }),
    ),
  );

  it.effect("does not flush or complete legacy storage for an auxiliary renderer", () =>
    withLegacy(({ completions }) =>
      Effect.gen(function* () {
        const auxiliary = makeWindow({ id: 2, webContentsId: 22 });
        const main = makeWindow({ id: 3, webContentsId: 33 });
        ElectronWindow.markAuxiliaryWindow(auxiliary);
        getAllWindows.mockReturnValue([auxiliary, main]);

        const auxiliarySender = {
          sender: { id: 22 },
          role: "main",
        } as DesktopIpc.DesktopIpcInvokeEvent;
        const auxiliaryError = yield* expectRejected(
          completeLegacyLocalStorage.handler(undefined, auxiliarySender),
        );
        assert.equal(auxiliaryError.message, "Legacy local storage migration was rejected.");
        yield* expectRejected(completeLegacyLocalStorage.handler(undefined));
        assert.equal(completions.count, 0);
        assert.equal(fromId.mock.calls.length, 0);
        assert.equal(flushStorageData.mock.calls.length, 0);

        yield* completeLegacyLocalStorage.handler(undefined, { sender: { id: 33 } });
        assert.equal(completions.count, 1);
        assert.deepEqual(fromId.mock.calls, [[33]]);
        assert.equal(flushStorageData.mock.calls.length, 1);
      }),
    ),
  );

  it.effect("replies null from the registered sync listener for an unauthorized sender", () =>
    withLegacy(({ items, completions }) =>
      Effect.gen(function* () {
        const main = makeWindow({ id: 3, webContentsId: 33 });
        const auxiliary = makeWindow({ id: 2, webContentsId: 22 });
        ElectronWindow.markAuxiliaryWindow(auxiliary);
        getAllWindows.mockReturnValue([auxiliary, main]);
        const electronWindow = yield* ElectronWindow.ElectronWindow;
        yield* electronWindow.setMain(main);
        const listeners = new Map<string, DesktopIpc.DesktopIpcSyncListener>();
        const ipc = DesktopIpc.make({
          removeHandler: () => undefined,
          handle: () => undefined,
          removeAllListeners: () => undefined,
          on: (channel, listener) => {
            listeners.set(channel, listener);
          },
        });

        yield* Effect.scoped(
          Effect.gen(function* () {
            yield* ipc.handleSync(takeLegacyLocalStorage);
            const listener = listeners.get(takeLegacyLocalStorage.channel);
            assert.isDefined(listener);

            const auxiliaryEvent: DesktopIpc.DesktopIpcSyncEvent = {
              returnValue: "unset",
              sender: { id: 22 },
            };
            listener!(auxiliaryEvent);
            assert.isNull(auxiliaryEvent.returnValue);

            const missingSender: DesktopIpc.DesktopIpcSyncEvent = { returnValue: "unset" };
            listener!(missingSender);
            assert.isNull(missingSender.returnValue);
            assert.deepEqual(yield* Ref.get(items), Option.some(payload));

            yield* expectRejected(
              completeLegacyLocalStorage.handler(undefined, { sender: { id: 22 } }),
            );
            yield* expectRejected(completeLegacyLocalStorage.handler(undefined));
            assert.equal(completions.count, 0);
            assert.equal(fromId.mock.calls.length, 0);
            assert.equal(flushStorageData.mock.calls.length, 0);

            const mainEvent: DesktopIpc.DesktopIpcSyncEvent = {
              returnValue: undefined,
              sender: { id: 33 },
            };
            listener!(mainEvent);
            assert.deepEqual(mainEvent.returnValue, payload);
            assert.isFalse(mainEvent.returnValue instanceof Promise);
            assert.deepEqual(yield* Ref.get(items), Option.none());
          }),
        );
      }),
    ),
  );
});
