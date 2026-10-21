import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type * as Electron from "electron";
import { vi } from "vite-plus/test";

vi.mock("electron", () => ({
  webContents: { fromId: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn() },
}));

import * as NativeWindowInteraction from "./NativeWindowInteraction.ts";

const fakeWindow = (id: number) => ({ id }) as Electron.BrowserWindow;

describe("NativeWindowInteraction", () => {
  it.effect("keeps a nested native interaction open until every owner finishes", () =>
    Effect.sync(() => {
      const window = fakeWindow(1);
      const other = fakeWindow(2);
      const end = NativeWindowInteraction.beginNativeWindowInteraction(window);
      const nested = NativeWindowInteraction.beginNativeWindowInteraction(window);

      assert.isTrue(NativeWindowInteraction.nativeWindowInteractionInProgress(window));
      assert.isFalse(NativeWindowInteraction.nativeWindowInteractionInProgress(other));
      end();
      assert.isTrue(NativeWindowInteraction.nativeWindowInteractionInProgress(window));
      end();
      assert.isTrue(NativeWindowInteraction.nativeWindowInteractionInProgress(window));
      nested();
      assert.isFalse(NativeWindowInteraction.nativeWindowInteractionInProgress(window));
    }),
  );

  it.effect("clears the interaction when the owned effect finishes or fails", () =>
    Effect.gen(function* () {
      const window = fakeWindow(3);
      let running = false;

      yield* NativeWindowInteraction.withNativeWindowInteraction(
        Option.some(window),
        Effect.sync(() => {
          running = NativeWindowInteraction.nativeWindowInteractionInProgress(window);
        }),
      );
      assert.isTrue(running);
      assert.isFalse(NativeWindowInteraction.nativeWindowInteractionInProgress(window));

      const exit = yield* Effect.exit(
        NativeWindowInteraction.withNativeWindowInteraction(
          Option.some(window),
          Effect.die("menu failed"),
        ),
      );
      assert.equal(exit._tag, "Failure");
      assert.isFalse(NativeWindowInteraction.nativeWindowInteractionInProgress(window));

      let ran = false;
      yield* NativeWindowInteraction.withNativeWindowInteraction(
        Option.none(),
        Effect.sync(() => {
          ran = true;
        }),
      );
      assert.isTrue(ran);
    }),
  );
});
