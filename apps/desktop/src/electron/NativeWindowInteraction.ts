import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as Electron from "electron";

import * as ElectronWindow from "./ElectronWindow.ts";

export interface NativeInteractionSenderEvent {
  readonly sender: { readonly id: number };
}

// A native file dialog or menu blurs its owner. The quick-message panel hides
// on blur, so this count stays positive for the whole native call and that
// panel can ignore the blur without a renderer handshake.
const nativeInteractions = new WeakMap<Electron.BrowserWindow, number>();

export function beginNativeWindowInteraction(window: Electron.BrowserWindow): () => void {
  nativeInteractions.set(window, (nativeInteractions.get(window) ?? 0) + 1);
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    const next = (nativeInteractions.get(window) ?? 1) - 1;
    if (next <= 0) nativeInteractions.delete(window);
    else nativeInteractions.set(window, next);
  };
}

export function nativeWindowInteractionInProgress(window: Electron.BrowserWindow): boolean {
  return (nativeInteractions.get(window) ?? 0) > 0;
}

export const withNativeWindowInteraction = <A, E, R>(
  owner: Option.Option<Electron.BrowserWindow>,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Option.match(owner, {
    onNone: () => effect,
    onSome: (window) =>
      Effect.acquireUseRelease(
        Effect.sync(() => beginNativeWindowInteraction(window)),
        () => effect,
        (end) => Effect.sync(end),
      ),
  });

// `BrowserWindow.fromWebContents` returns the host of a preview guest. A guest
// is not a registered app window, and neither is a BrowserWindow that is not
// the main window or a panel marked with `markAuxiliaryWindow`.
const senderWindow = (
  event: NativeInteractionSenderEvent | undefined,
): Option.Option<Electron.BrowserWindow> => {
  if (event === undefined) return Option.none();
  const contents = Electron.webContents.fromId(event.sender.id);
  if (contents === undefined || contents.isDestroyed() || contents.getType() !== "window") {
    return Option.none();
  }
  const window = Electron.BrowserWindow.fromWebContents(contents);
  if (window === null || window === undefined || window.isDestroyed()) return Option.none();
  const ownerContents = window.webContents;
  if (ownerContents.isDestroyed() || ownerContents.id !== contents.id) return Option.none();
  return Option.some(window);
};

export const resolveNativeInteractionOwner = Effect.fn(
  "desktop.electron.resolveNativeInteractionOwner",
)(function* (event: NativeInteractionSenderEvent | undefined) {
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const candidate = senderWindow(event);
  if (Option.isSome(candidate) && !candidate.value.isDestroyed()) {
    const main = yield* electronWindow.main;
    const trustedMain = Option.isSome(main) && main.value === candidate.value;
    if (trustedMain || ElectronWindow.isAuxiliaryWindow(candidate.value)) {
      return candidate;
    }
  }
  return yield* electronWindow.focusedMainOrFirst;
});

// The paste acknowledgement has to name its own window. A missing, destroyed,
// guest, or unregistered sender fails closed: falling back to the focused main
// window would paste into a different composer.
export const resolveTrustedAppSender = Effect.fn("desktop.electron.resolveTrustedAppSender")(
  function* (event: NativeInteractionSenderEvent | undefined) {
    const electronWindow = yield* ElectronWindow.ElectronWindow;
    const candidate = senderWindow(event);
    if (Option.isNone(candidate) || candidate.value.isDestroyed()) return Option.none();
    const main = yield* electronWindow.main;
    if (Option.isSome(main) && !main.value.isDestroyed() && main.value === candidate.value) {
      return candidate;
    }
    if (ElectronWindow.isAuxiliaryWindow(candidate.value)) return candidate;
    return Option.none();
  },
);
