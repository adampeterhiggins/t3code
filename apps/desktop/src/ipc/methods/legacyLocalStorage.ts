import * as Electron from "electron";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as DesktopLegacyLocalStorage from "../../app/DesktopLegacyLocalStorage.ts";
import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

export class LegacyLocalStorageUnauthorizedSenderError extends Schema.TaggedError<LegacyLocalStorageUnauthorizedSenderError>()(
  "LegacyLocalStorageUnauthorizedSenderError",
  {},
) {
  override get message(): string {
    return "Legacy local storage migration was rejected.";
  }
}

// loadURL runs the preload before createMain assigns the main ref. currentMainOrFirst
// still resolves that first live window, and it excludes marked auxiliary renderers.
const ensureMainRendererSender = Effect.fn("desktop.ipc.legacyLocalStorage.ensureMainRenderer")(
  function* (sender: { readonly id: number } | undefined) {
    if (sender === undefined) {
      return yield* new LegacyLocalStorageUnauthorizedSenderError();
    }
    const current = yield* (yield* ElectronWindow.ElectronWindow).currentMainOrFirst;
    if (Option.isNone(current) || current.value.webContents.id !== sender.id) {
      return yield* new LegacyLocalStorageUnauthorizedSenderError();
    }
    return sender;
  },
);

export const takeLegacyLocalStorage = DesktopIpc.makeSyncIpcMethod({
  channel: IpcChannels.TAKE_LEGACY_LOCAL_STORAGE_CHANNEL,
  result: Schema.NullOr(Schema.Record(Schema.String, Schema.String)),
  handler: Effect.fn("desktop.ipc.legacyLocalStorage.take")(function* (
    event?: DesktopIpc.DesktopIpcSyncEvent,
  ) {
    yield* ensureMainRendererSender(event?.sender);
    const legacy = yield* DesktopLegacyLocalStorage.DesktopLegacyLocalStorage;
    return Option.getOrNull(yield* legacy.take);
  }),
});

export const completeLegacyLocalStorage = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.COMPLETE_LEGACY_LOCAL_STORAGE_CHANNEL,
  payload: Schema.Void,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.legacyLocalStorage.complete")(function* (_, event) {
    const sender = yield* ensureMainRendererSender(event?.sender);
    // Chromium writes localStorage to disk lazily; persist the merge before
    // the marker stops later launches from retrying it.
    Electron.webContents.fromId(sender.id)?.session.flushStorageData();
    yield* (yield* DesktopLegacyLocalStorage.DesktopLegacyLocalStorage).complete;
  }),
});
