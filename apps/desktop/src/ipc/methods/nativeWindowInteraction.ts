import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as Electron from "electron";

import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import * as NativeWindowInteraction from "../../electron/NativeWindowInteraction.ts";
import {
  BEGIN_NATIVE_WINDOW_INTERACTION_CHANNEL,
  END_NATIVE_WINDOW_INTERACTION_CHANNEL,
} from "../nativeWindowInteractionChannels.ts";

export interface NativeWindowInteractionSyncIpc {
  on(channel: string, listener: (event: Electron.IpcMainEvent) => void): void;
  removeListener(channel: string, listener: (event: Electron.IpcMainEvent) => void): void;
  removeAllListeners?(channel: string): void;
}

interface ChooserLease {
  readonly endCounter: () => void;
  readonly stopWatching: () => void;
}

/**
 * One chooser hold per window, on the same counter menus and Electron dialogs
 * already use. A second begin does not stack, and end only releases this
 * hold, so a guest cannot drain another window's count.
 */
export function createNativeWindowInteractionLease() {
  const leases = new WeakMap<Electron.BrowserWindow, ChooserLease>();

  const end = (window: Electron.BrowserWindow): void => {
    const lease = leases.get(window);
    if (lease === undefined) return;
    leases.delete(window);
    lease.stopWatching();
    lease.endCounter();
  };

  const begin = (window: Electron.BrowserWindow): boolean => {
    if (window.isDestroyed()) return false;
    if (leases.has(window)) return true;
    let endCounter: () => void;
    try {
      endCounter = NativeWindowInteraction.beginNativeWindowInteraction(window);
    } catch {
      return false;
    }
    let contents: Electron.WebContents;
    try {
      contents = window.webContents;
    } catch {
      endCounter();
      return false;
    }
    const onGone = () => end(window);
    const stopWatching = () => {
      if (!contents.isDestroyed()) {
        contents.removeListener("render-process-gone", onGone);
        contents.removeListener("destroyed", onGone);
      }
      if (!window.isDestroyed()) window.removeListener("closed", onGone);
    };
    try {
      contents.on("render-process-gone", onGone);
      contents.on("destroyed", onGone);
      window.on("closed", onGone);
    } catch {
      stopWatching();
      endCounter();
      return false;
    }
    leases.set(window, { endCounter, stopWatching });
    return true;
  };

  return { begin, end };
}

/**
 * `ipcRenderer.sendSync` hangs forever when the listener throws before
 * `returnValue` is set. The fallback is written first, and again if the
 * handler throws.
 */
export function assignNativeWindowInteractionSyncReturn(
  event: { returnValue: unknown },
  fallback: boolean | null,
  compute: () => boolean | null,
): void {
  event.returnValue = fallback;
  try {
    event.returnValue = compute();
  } catch {
    event.returnValue = fallback;
  }
}

// The sender is the IPC event's own webContents. A role string or id in a
// payload is never consulted: preview guests and unregistered windows fail
// closed, and they cannot clear another window's hold.
export const installNativeWindowInteractionIpc = Effect.fn(
  "desktop.ipc.nativeWindowInteraction.install",
)(function* (ipcMain?: NativeWindowInteractionSyncIpc) {
  const bound = ipcMain ?? Electron.ipcMain;
  const context = yield* Effect.context<ElectronWindow.ElectronWindow>();
  const runSync = Effect.runSyncWith(context);
  const lease = createNativeWindowInteractionLease();

  const acknowledged = (
    event: Electron.IpcMainEvent,
    fallback: boolean | null,
    effect: Effect.Effect<boolean | null, never, ElectronWindow.ElectronWindow>,
  ) => {
    assignNativeWindowInteractionSyncReturn(event, fallback, () =>
      runSync(effect.pipe(Effect.catchCause(() => Effect.succeed(fallback)))),
    );
  };

  const onBegin = (event: Electron.IpcMainEvent) => {
    acknowledged(
      event,
      false,
      Effect.gen(function* () {
        const owner = yield* NativeWindowInteraction.resolveTrustedAppSender(event);
        if (Option.isNone(owner)) return false;
        return lease.begin(owner.value);
      }),
    );
  };

  const onEnd = (event: Electron.IpcMainEvent) => {
    acknowledged(
      event,
      null,
      Effect.gen(function* () {
        const owner = yield* NativeWindowInteraction.resolveTrustedAppSender(event);
        if (Option.isNone(owner)) return null;
        lease.end(owner.value);
        return null;
      }),
    );
  };

  yield* Effect.acquireRelease(
    Effect.sync(() => {
      bound.removeAllListeners?.(BEGIN_NATIVE_WINDOW_INTERACTION_CHANNEL);
      bound.removeAllListeners?.(END_NATIVE_WINDOW_INTERACTION_CHANNEL);
      bound.on(BEGIN_NATIVE_WINDOW_INTERACTION_CHANNEL, onBegin);
      bound.on(END_NATIVE_WINDOW_INTERACTION_CHANNEL, onEnd);
    }),
    () =>
      Effect.sync(() => {
        bound.removeListener(BEGIN_NATIVE_WINDOW_INTERACTION_CHANNEL, onBegin);
        bound.removeListener(END_NATIVE_WINDOW_INTERACTION_CHANNEL, onEnd);
      }),
  );
});
