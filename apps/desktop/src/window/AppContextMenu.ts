import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as Electron from "electron";

import * as ElectronMenu from "../electron/ElectronMenu.ts";
import * as ElectronShell from "../electron/ElectronShell.ts";
import * as NativeWindowInteraction from "../electron/NativeWindowInteraction.ts";
import { copyContextMenuImage } from "./ContextMenuImage.ts";

export interface AppContextMenuRuntime {
  readonly popup: (input: ElectronMenu.ElectronMenuTemplateInput) => Effect.Effect<void>;
  readonly copyText: (text: string) => Effect.Effect<void>;
  readonly reportCopyImageFailure: Effect.Effect<void>;
  readonly runPromise: (effect: Effect.Effect<void>) => Promise<unknown>;
}

const installedContents = new WeakSet<Electron.WebContents>();

/**
 * Right-click cut/copy/paste for an app window. The quick-message panel can
 * call this when its window is created; it does not install webviews, zoom,
 * or quit handling.
 *
 * The menu popup blurs its owner. `withNativeWindowInteraction` stays raised
 * until the popup effect finishes, which is when the menu closes.
 */
export function installAppContextMenu(
  ownerWindow: Electron.BrowserWindow,
  contents: Electron.WebContents,
  runtime: AppContextMenuRuntime,
): void {
  if (installedContents.has(contents)) return;
  installedContents.add(contents);
  contents.on("context-menu", (event, params) => {
    event.preventDefault();
    if (contents.isDestroyed() || ownerWindow.isDestroyed()) return;
    // Native editing roles act on the focused contents, which may still be
    // the host renderer when the user right-clicks inside a browser guest.
    contents.focus();

    const menuTemplate: Electron.MenuItemConstructorOptions[] = [];

    if (params.misspelledWord) {
      for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
        menuTemplate.push({
          label: suggestion,
          click: () => {
            if (!contents.isDestroyed()) contents.replaceMisspelling(suggestion);
          },
        });
      }
      if (params.dictionarySuggestions.length === 0) {
        menuTemplate.push({ label: "No suggestions", enabled: false });
      }
      menuTemplate.push({ type: "separator" });
    }

    if (Option.isSome(ElectronShell.parseSafeExternalUrl(params.linkURL))) {
      menuTemplate.push(
        {
          label: "Copy Link",
          click: () => {
            void runtime.runPromise(runtime.copyText(params.linkURL));
          },
        },
        { type: "separator" },
      );
    }

    if (params.mediaType === "image") {
      menuTemplate.push({
        label: "Copy Image",
        click: () => {
          void runtime.runPromise(
            Effect.tryPromise(() => copyContextMenuImage(contents, params)).pipe(
              Effect.catch(() => runtime.reportCopyImageFailure),
            ),
          );
        },
      });
      menuTemplate.push({ type: "separator" });
    }

    menuTemplate.push(
      { role: "cut", enabled: params.editFlags.canCut },
      { role: "copy", enabled: params.editFlags.canCopy },
      { role: "paste", enabled: params.editFlags.canPaste },
      { role: "selectAll", enabled: params.editFlags.canSelectAll },
    );

    void runtime.runPromise(
      NativeWindowInteraction.withNativeWindowInteraction(
        Option.some(ownerWindow),
        runtime.popup({
          window: ownerWindow,
          template: menuTemplate,
          ...(params.frame ? { frame: params.frame } : {}),
        }),
      ),
    );
  });
  contents.on("did-create-window", (popup) => {
    installAppContextMenu(popup, popup.webContents, runtime);
  });
}
