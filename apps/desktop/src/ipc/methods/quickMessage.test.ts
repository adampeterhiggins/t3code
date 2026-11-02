import { assert, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { vi } from "vite-plus/test";

vi.mock("electron", () => ({
  app: { on: vi.fn(), removeListener: vi.fn() },
  BrowserWindow: function BrowserWindow() {},
  session: { fromPartition: vi.fn(() => ({})) },
  globalShortcut: { register: vi.fn(() => true), unregister: vi.fn() },
  screen: {
    getCursorScreenPoint: () => ({ x: 0, y: 0 }),
    getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1, height: 1 } }),
  },
}));

import * as DesktopQuickMessage from "../../quickMessage/DesktopQuickMessage.ts";
import { SET_QUICK_MESSAGE_PRESENTATION_CHANNEL } from "../channels.ts";
import { setQuickMessagePresentation } from "./quickMessage.ts";

it.effect("sets presentation only for the quick-message panel", () => {
  const presentations: Array<string> = [];
  let senderId: number | undefined;
  const layer = (isPanel: boolean) =>
    Layer.mock(DesktopQuickMessage.DesktopQuickMessage)({
      isPanel: (id) =>
        Effect.sync(() => {
          senderId = id;
          return isPanel && id === 4;
        }),
      setPresentation: (presentation) =>
        Effect.sync(() => {
          presentations.push(presentation);
        }),
    });

  return Effect.gen(function* () {
    assert.equal(setQuickMessagePresentation.channel, SET_QUICK_MESSAGE_PRESENTATION_CHANNEL);

    const rejected = yield* Effect.exit(
      setQuickMessagePresentation.handler("expanded", { sender: { id: 4 } }),
    );
    assert.equal(rejected._tag, "Failure");
    if (rejected._tag === "Failure") {
      const error = Cause.squash(rejected.cause);
      assert.ok(error instanceof Error);
      assert.equal(error.message, "Quick message request was rejected.");
    }
    assert.equal(senderId, 4);
    assert.deepEqual(presentations, []);

    const missingSender = yield* Effect.exit(setQuickMessagePresentation.handler("compact"));
    assert.equal(missingSender._tag, "Failure");

    const invalid = yield* Effect.exit(
      setQuickMessagePresentation.handler("fullscreen", { sender: { id: 4 } }),
    );
    assert.equal(invalid._tag, "Failure");
    assert.deepEqual(presentations, []);
  }).pipe(Effect.provide(layer(false)));
});

it.effect("forwards a panel presentation change", () => {
  const presentations: Array<string> = [];
  return Effect.gen(function* () {
    yield* setQuickMessagePresentation.handler("expanded", { sender: { id: 4 } });
    yield* setQuickMessagePresentation.handler("compact", { sender: { id: 4 } });
    assert.deepEqual(presentations, ["expanded", "compact"]);
  }).pipe(
    Effect.provide(
      Layer.mock(DesktopQuickMessage.DesktopQuickMessage)({
        isPanel: (id) => Effect.succeed(id === 4),
        setPresentation: (presentation) =>
          Effect.sync(() => {
            presentations.push(presentation);
          }),
      }),
    ),
  );
});
