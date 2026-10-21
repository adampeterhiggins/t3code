import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as NodeEvents from "node:events";
import type * as Electron from "electron";
import { vi } from "vite-plus/test";

import * as ElectronMenu from "../electron/ElectronMenu.ts";
import * as NativeWindowInteraction from "../electron/NativeWindowInteraction.ts";
import { installAppContextMenu, type AppContextMenuRuntime } from "./AppContextMenu.ts";

function makeContents() {
  const emitter = new NodeEvents.EventEmitter();
  return Object.assign(emitter, {
    isDestroyed: vi.fn(() => false),
    focus: vi.fn(),
    replaceMisspelling: vi.fn(),
    copyImageAt: vi.fn(),
  });
}

function makeWindow(contents: ReturnType<typeof makeContents>) {
  return {
    isDestroyed: vi.fn(() => false),
    webContents: contents,
  } as unknown as Electron.BrowserWindow & { isDestroyed: ReturnType<typeof vi.fn> };
}

const editParams = {
  linkURL: "",
  mediaType: "none",
  misspelledWord: "",
  dictionarySuggestions: [],
  editFlags: { canCut: true, canCopy: true, canPaste: true, canSelectAll: true },
} as unknown as Electron.ContextMenuParams;

describe("installAppContextMenu", () => {
  it.effect("pops the menu under a native interaction and installs once", () =>
    Effect.gen(function* () {
      const contents = makeContents();
      const window = makeWindow(contents);
      let pending = Promise.resolve();
      let protectedDuringPopup = false;
      const popup = vi.fn((_input: ElectronMenu.ElectronMenuTemplateInput) =>
        Effect.sync(() => {
          protectedDuringPopup = NativeWindowInteraction.nativeWindowInteractionInProgress(window);
        }),
      );
      const runtime = {
        popup,
        copyText: () => Effect.void,
        reportCopyImageFailure: Effect.void,
        runPromise: (effect: Effect.Effect<void>) => {
          // oxlint-disable-next-line t3code/no-manual-effect-runtime-in-tests -- Context-menu clicks start through DesktopWindow's promise runtime. This stub is that boundary, so the test sees the popup begin and end instead of hiding a handler that never runs.
          pending = Effect.runPromise(effect);
          return pending;
        },
      } satisfies AppContextMenuRuntime;

      installAppContextMenu(window, contents as unknown as Electron.WebContents, runtime);
      installAppContextMenu(window, contents as unknown as Electron.WebContents, runtime);
      contents.emit("context-menu", { preventDefault: vi.fn() }, editParams);
      yield* Effect.promise(() => pending);

      assert.equal(popup.mock.calls.length, 1);
      const shown = popup.mock.calls[0]?.[0];
      assert.isDefined(shown);
      assert.strictEqual(shown.window, window);
      assert.isTrue(protectedDuringPopup);
      assert.isFalse(NativeWindowInteraction.nativeWindowInteractionInProgress(window));

      window.isDestroyed.mockReturnValue(true);
      contents.emit("context-menu", { preventDefault: vi.fn() }, editParams);
      yield* Effect.promise(() => pending);
      assert.equal(popup.mock.calls.length, 1);
    }),
  );

  it.effect("installs the same menu on a window the contents creates", () =>
    Effect.gen(function* () {
      const contents = makeContents();
      const window = makeWindow(contents);
      const popupContents = makeContents();
      const popupWindow = makeWindow(popupContents);
      let pending = Promise.resolve();
      const popup = vi.fn((_input: ElectronMenu.ElectronMenuTemplateInput) => Effect.void);
      const runtime = {
        popup,
        copyText: () => Effect.void,
        reportCopyImageFailure: Effect.void,
        runPromise: (effect: Effect.Effect<void>) => {
          // oxlint-disable-next-line t3code/no-manual-effect-runtime-in-tests -- Context-menu clicks start through DesktopWindow's promise runtime. This stub is that boundary, so the test sees the popup begin and end instead of hiding a handler that never runs.
          pending = Effect.runPromise(effect);
          return pending;
        },
      } satisfies AppContextMenuRuntime;

      installAppContextMenu(window, contents as unknown as Electron.WebContents, runtime);
      contents.emit("did-create-window", popupWindow);
      popupContents.emit("context-menu", { preventDefault: vi.fn() }, editParams);
      yield* Effect.promise(() => pending);

      const shown = popup.mock.calls[0]?.[0];
      assert.isDefined(shown);
      assert.strictEqual(shown.window, popupWindow);
      assert.isFalse(NativeWindowInteraction.nativeWindowInteractionInProgress(popupWindow));
    }),
  );
});
