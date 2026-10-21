import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as NodeEvents from "node:events";
import type * as Electron from "electron";
import { describe, expect, it, vi } from "vite-plus/test";

const { ownerWindow, webContentsFromId } = vi.hoisted(() => ({
  ownerWindow: vi.fn(),
  webContentsFromId: vi.fn(),
}));

vi.mock("electron", () => ({
  webContents: { fromId: webContentsFromId },
  BrowserWindow: { fromWebContents: ownerWindow },
}));

import * as NativeWindowInteraction from "../../electron/NativeWindowInteraction.ts";
import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import {
  BEGIN_NATIVE_WINDOW_INTERACTION_CHANNEL,
  END_NATIVE_WINDOW_INTERACTION_CHANNEL,
} from "../nativeWindowInteractionChannels.ts";
import {
  assignNativeWindowInteractionSyncReturn,
  createNativeWindowInteractionLease,
  installNativeWindowInteractionIpc,
  type NativeWindowInteractionSyncIpc,
} from "./nativeWindowInteraction.ts";

interface AppContents {
  id: number;
  isDestroyed: () => boolean;
  getType: () => "window" | "webview";
}

function appWindow(id: number) {
  const state = { destroyed: false };
  const contents = new NodeEvents.EventEmitter() as NodeEvents.EventEmitter & AppContents;
  contents.id = id;
  contents.isDestroyed = () => state.destroyed;
  contents.getType = () => "window";
  const window = new NodeEvents.EventEmitter() as NodeEvents.EventEmitter & {
    id: number;
    webContents: AppContents;
    isDestroyed: () => boolean;
  };
  window.id = id;
  window.webContents = contents;
  window.isDestroyed = () => state.destroyed;
  return {
    window: window as unknown as Electron.BrowserWindow,
    contents,
    destroy() {
      state.destroyed = true;
    },
  };
}

function present(
  ...entries: ReadonlyArray<{
    readonly contents: AppContents;
    readonly window: Electron.BrowserWindow | null;
  }>
) {
  const byId = new Map(entries.map((entry) => [entry.contents.id, entry]));
  webContentsFromId.mockImplementation((id: number) => byId.get(id)?.contents);
  ownerWindow.mockImplementation((contents: AppContents) => byId.get(contents?.id)?.window ?? null);
}

function fakeIpc() {
  const listeners = new Map<string, (event: Electron.IpcMainEvent) => void>();
  return {
    on(channel: string, listener: (event: Electron.IpcMainEvent) => void) {
      listeners.set(channel, listener);
    },
    removeListener(channel: string, listener: (event: Electron.IpcMainEvent) => void) {
      if (listeners.get(channel) === listener) listeners.delete(channel);
    },
    removeAllListeners(channel: string) {
      listeners.delete(channel);
    },
    emit(channel: string, event: { returnValue: unknown; sender?: { id: number } }) {
      const listener = listeners.get(channel);
      if (listener === undefined) throw new Error(`missing ${channel}`);
      listener(event as Electron.IpcMainEvent);
    },
    listenerCount(channel: string) {
      return listeners.has(channel) ? 1 : 0;
    },
  };
}

const selector = (main: Option.Option<Electron.BrowserWindow>) =>
  Layer.mock(ElectronWindow.ElectronWindow)({
    main: Effect.succeed(main),
    focusedMainOrFirst: Effect.die("focused main selector was read"),
  });

function runSyncInstall(
  ipc: ReturnType<typeof fakeIpc>,
  layer: Layer.Layer<ElectronWindow.ElectronWindow>,
  use: (emit: ReturnType<typeof fakeIpc>["emit"]) => void,
) {
  // The handler answers ipcRenderer.sendSync with Effect.runSync. This test
  // uses that same synchronous path, including a thrown resolver.
  // oxlint-disable-next-line t3code/no-manual-effect-runtime-in-tests -- Replays the sync IPC listener's runSync boundary, which it.effect would hide.
  Effect.runSync(
    Effect.scoped(
      Effect.gen(function* () {
        yield* installNativeWindowInteractionIpc(ipc as unknown as NativeWindowInteractionSyncIpc);
        use(ipc.emit.bind(ipc));
      }),
    ).pipe(Effect.provide(layer)),
  );
}

describe("native window interaction chooser", () => {
  it("holds one window at a time and leaves another window's dialog count alone", () => {
    const lease = createNativeWindowInteractionLease();
    const first = appWindow(1);
    const second = appWindow(2);
    const dialogEnd = NativeWindowInteraction.beginNativeWindowInteraction(second.window);

    expect(lease.begin(first.window)).toBe(true);
    expect(lease.begin(first.window)).toBe(true);
    expect(NativeWindowInteraction.nativeWindowInteractionInProgress(first.window)).toBe(true);
    lease.end(first.window);
    expect(NativeWindowInteraction.nativeWindowInteractionInProgress(first.window)).toBe(false);
    lease.end(first.window);
    expect(NativeWindowInteraction.nativeWindowInteractionInProgress(second.window)).toBe(true);
    dialogEnd();
    expect(NativeWindowInteraction.nativeWindowInteractionInProgress(second.window)).toBe(false);

    expect(lease.begin(first.window)).toBe(true);
    first.contents.emit("render-process-gone");
    expect(NativeWindowInteraction.nativeWindowInteractionInProgress(first.window)).toBe(false);

    expect(lease.begin(first.window)).toBe(true);
    first.contents.emit("destroyed");
    expect(NativeWindowInteraction.nativeWindowInteractionInProgress(first.window)).toBe(false);

    expect(lease.begin(first.window)).toBe(true);
    (first.window as unknown as NodeEvents.EventEmitter).emit("closed");
    expect(NativeWindowInteraction.nativeWindowInteractionInProgress(first.window)).toBe(false);
    first.destroy();
    expect(lease.begin(first.window)).toBe(false);
  });

  it("sets a harmless sync result before a handler throws", () => {
    const event = { returnValue: "unset" as unknown };
    assignNativeWindowInteractionSyncReturn(event, false, () => {
      throw new Error("sync handler failed");
    });
    expect(event.returnValue).toBe(false);

    assignNativeWindowInteractionSyncReturn(event, null, () => null);
    expect(event.returnValue).toBeNull();
  });

  it("acknowledges a trusted window and ignores untrusted end or destruction", () => {
    const quick = appWindow(2);
    const main = appWindow(1);
    const stranger = appWindow(8);
    const guestContents = new NodeEvents.EventEmitter() as NodeEvents.EventEmitter & AppContents;
    guestContents.id = 99;
    guestContents.isDestroyed = () => false;
    guestContents.getType = () => "webview";
    ElectronWindow.markAuxiliaryWindow(quick.window);
    present(quick, main, stranger, { contents: guestContents, window: quick.window });
    const ipc = fakeIpc();

    runSyncInstall(ipc, selector(Option.some(main.window)), (emit) => {
      const quickBegin = { returnValue: "unset" as unknown, sender: { id: quick.contents.id } };
      emit(BEGIN_NATIVE_WINDOW_INTERACTION_CHANNEL, quickBegin);
      expect(quickBegin.returnValue).toBe(true);
      emit(BEGIN_NATIVE_WINDOW_INTERACTION_CHANNEL, {
        returnValue: undefined,
        sender: { id: quick.contents.id },
      });
      expect(NativeWindowInteraction.nativeWindowInteractionInProgress(quick.window)).toBe(true);

      const mainBegin = { returnValue: undefined, sender: { id: main.contents.id } };
      emit(BEGIN_NATIVE_WINDOW_INTERACTION_CHANNEL, mainBegin);
      expect(mainBegin.returnValue).toBe(true);
      expect(NativeWindowInteraction.nativeWindowInteractionInProgress(main.window)).toBe(true);

      const untrustedBegin = {
        returnValue: "unset" as unknown,
        sender: { id: stranger.contents.id },
        role: "main",
        webContentsId: quick.contents.id,
      };
      emit(BEGIN_NATIVE_WINDOW_INTERACTION_CHANNEL, untrustedBegin);
      expect(untrustedBegin.returnValue).toBe(false);
      expect(NativeWindowInteraction.nativeWindowInteractionInProgress(stranger.window)).toBe(
        false,
      );

      const guestBegin = { returnValue: undefined, sender: { id: guestContents.id } };
      emit(BEGIN_NATIVE_WINDOW_INTERACTION_CHANNEL, guestBegin);
      expect(guestBegin.returnValue).toBe(false);

      const missingSender = { returnValue: "unset" as unknown };
      emit(BEGIN_NATIVE_WINDOW_INTERACTION_CHANNEL, missingSender);
      expect(missingSender.returnValue).toBe(false);

      emit(END_NATIVE_WINDOW_INTERACTION_CHANNEL, {
        returnValue: "unset",
        sender: { id: stranger.contents.id },
      });
      expect(NativeWindowInteraction.nativeWindowInteractionInProgress(quick.window)).toBe(true);
      expect(NativeWindowInteraction.nativeWindowInteractionInProgress(main.window)).toBe(true);

      const quickEnd = { returnValue: "unset" as unknown, sender: { id: quick.contents.id } };
      emit(END_NATIVE_WINDOW_INTERACTION_CHANNEL, quickEnd);
      expect(quickEnd.returnValue).toBeNull();
      expect(NativeWindowInteraction.nativeWindowInteractionInProgress(quick.window)).toBe(false);
      expect(NativeWindowInteraction.nativeWindowInteractionInProgress(main.window)).toBe(true);

      (main.window as unknown as NodeEvents.EventEmitter).emit("closed");
      expect(NativeWindowInteraction.nativeWindowInteractionInProgress(main.window)).toBe(false);
    });

    expect(ipc.listenerCount(BEGIN_NATIVE_WINDOW_INTERACTION_CHANNEL)).toBe(0);
    expect(ipc.listenerCount(END_NATIVE_WINDOW_INTERACTION_CHANNEL)).toBe(0);
  });

  it("returns false without throwing when the sender cannot be resolved", () => {
    const ipc = fakeIpc();
    const event = { returnValue: "unset" as unknown, sender: { id: 4 } };
    expect(() =>
      runSyncInstall(
        ipc,
        Layer.mock(ElectronWindow.ElectronWindow)({
          main: Effect.die("window service unavailable"),
          focusedMainOrFirst: Effect.die("focused main selector was read"),
        }),
        (emit) => {
          emit(BEGIN_NATIVE_WINDOW_INTERACTION_CHANNEL, event);
        },
      ),
    ).not.toThrow();
    expect(event.returnValue).toBe(false);
  });
});
