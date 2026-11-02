import * as Option from "effect/Option";
import * as Electron from "electron";

import * as ElectronWindow from "../electron/ElectronWindow.ts";

export type DesktopMenuDispatchTarget = "main" | "focused-trusted";

export interface DesktopMenuDispatchOptions {
  readonly reveal?: boolean;
  readonly target?: DesktopMenuDispatchTarget;
}

/**
 * focusedMainOrFirst skips auxiliary windows. Paste has to reach a marked quick-message panel,
 * and it must ignore an unregistered popup or webview host. The composer is already focused, so
 * nothing is revealed.
 */
export function sendToFocusedTrustedWindow(
  main: Option.Option<Electron.BrowserWindow>,
  channel: string,
  payload: unknown,
): void {
  const focused = Electron.BrowserWindow.getFocusedWindow();
  if (focused === null || focused === undefined || focused.isDestroyed()) return;
  const isMain = Option.isSome(main) && !main.value.isDestroyed() && main.value === focused;
  if (!isMain && !ElectronWindow.isAuxiliaryWindow(focused)) return;
  if (focused.webContents.isDestroyed()) return;
  const send = () => {
    if (!focused.isDestroyed()) focused.webContents.send(channel, payload);
  };
  if (focused.webContents.isLoadingMainFrame()) {
    focused.webContents.once("did-finish-load", send);
    return;
  }
  send();
}
