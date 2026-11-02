import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type * as Electron from "electron";

import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as DesktopQuickMessage from "../quickMessage/DesktopQuickMessage.ts";
import type * as DesktopIpc from "./DesktopIpc.ts";

const DesktopMainAuthorityOperation = Schema.Literals([
  "set-theme",
  "set-client-settings",
  "publish-appearance",
  "get-appearance",
]);
type DesktopMainAuthorityOperation = typeof DesktopMainAuthorityOperation.Type;

export class DesktopMainAuthorityError extends Schema.TaggedError<DesktopMainAuthorityError>()(
  "DesktopMainAuthorityError",
  {
    operation: DesktopMainAuthorityOperation,
  },
) {
  override get message(): string {
    return `Desktop ${this.operation} was rejected.`;
  }
}

function isRegisteredMain(main: Option.Option<Electron.BrowserWindow>, senderId: number): boolean {
  return (
    Option.isSome(main) &&
    !main.value.isDestroyed() &&
    !main.value.webContents.isDestroyed() &&
    main.value.webContents.id === senderId
  );
}

/**
 * The registered main webContents, not `currentMainOrFirst`. That fallback
 * also matches the splash and any window that is not registered yet.
 */
export const ensureMainSender = Effect.fn("desktop.ipc.ensureMainSender")(function* (
  event: DesktopIpc.DesktopIpcInvokeEvent | undefined,
  operation: Exclude<DesktopMainAuthorityOperation, "get-appearance">,
) {
  const main = yield* (yield* ElectronWindow.ElectronWindow).main;
  if (event === undefined || !isRegisteredMain(main, event.sender.id)) {
    return yield* new DesktopMainAuthorityError({ operation });
  }
});

/**
 * Main webContents or the live quick-message panel. The sender id is the
 * identity; a renderer-supplied role is not accepted.
 */
export const ensureAppearanceReader = Effect.fn("desktop.ipc.ensureAppearanceReader")(function* (
  event: DesktopIpc.DesktopIpcInvokeEvent | undefined,
) {
  if (event !== undefined) {
    const main = yield* (yield* ElectronWindow.ElectronWindow).main;
    if (isRegisteredMain(main, event.sender.id)) return;
    if (yield* (yield* DesktopQuickMessage.DesktopQuickMessage).isPanel(event.sender.id)) {
      return;
    }
  }
  return yield* new DesktopMainAuthorityError({ operation: "get-appearance" });
});
