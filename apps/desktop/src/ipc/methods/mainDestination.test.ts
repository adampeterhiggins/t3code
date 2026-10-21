import { assert, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { vi } from "vite-plus/test";

vi.mock("electron", () => ({
  app: { on: vi.fn(), removeListener: vi.fn() },
  BrowserWindow: function BrowserWindow() {},
}));

import type * as Electron from "electron";

import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import * as DesktopMainDestination from "../../window/DesktopMainDestination.ts";
import * as DesktopQuickMessage from "../../quickMessage/DesktopQuickMessage.ts";
import {
  COMPLETE_MAIN_DESTINATION_CHANNEL,
  OPEN_MAIN_DESTINATION_CHANNEL,
  SET_MAIN_DESTINATION_RECEIVER_READY_CHANNEL,
} from "../channels.ts";
import {
  completeMainDestination,
  openMainDestination,
  setMainDestinationReceiverReady,
} from "./mainDestination.ts";

const threadRequest = {
  requestId: "req-thread",
  thread: { environmentId: "env-local", threadId: "thread-1" },
};

function rejectionMessage(exit: Exit.Exit<unknown, unknown>) {
  if (exit._tag !== "Failure") return null;
  const error = Cause.squash(exit.cause);
  return error instanceof Error ? error.message : null;
}

it.effect("opens only from the quick-message panel and reports a surfaced seed", () => {
  const opened: Array<unknown> = [];
  let panel = false;
  return Effect.gen(function* () {
    assert.equal(openMainDestination.channel, OPEN_MAIN_DESTINATION_CHANNEL);

    const denied = yield* Effect.exit(
      openMainDestination.handler(threadRequest, { sender: { id: 4 } }),
    );
    assert.equal(denied._tag, "Failure");
    assert.equal(rejectionMessage(denied), "Main destination request was rejected.");
    assert.deepEqual(opened, []);

    const missingSender = yield* Effect.exit(openMainDestination.handler(threadRequest));
    assert.equal(missingSender._tag, "Failure");

    panel = true;
    const seeded = yield* openMainDestination.handler(
      { requestId: "req-seed", href: "/settings/scheduled-tasks", seed: { prompt: "nightly" } },
      { sender: { id: 4 } },
    );
    assert.deepEqual(seeded, { requestId: "req-seed", status: "failed" });
    assert.deepEqual(opened, []);

    const result = yield* openMainDestination.handler(threadRequest, { sender: { id: 4 } });
    assert.deepEqual(result, {
      requestId: "req-thread",
      status: "opened",
      settledHref: "/env-local/thread-1",
    });
    assert.deepEqual(opened, [threadRequest]);
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.mock(DesktopQuickMessage.DesktopQuickMessage)({
          isPanel: (id) => Effect.sync(() => panel && id === 4),
        }),
        Layer.mock(DesktopMainDestination.DesktopMainDestination)({
          open: (request) =>
            Effect.sync(() => {
              opened.push(request);
              return {
                requestId: request.requestId,
                status: "opened" as const,
                settledHref: "/env-local/thread-1",
              };
            }),
        }),
      ),
    ),
  );
});

it.effect("accepts ready and complete only from the main window", () => {
  const ready: Array<readonly [number, boolean]> = [];
  const completed: Array<unknown> = [];
  let mainId: number | null = 7;
  const layer = Layer.mergeAll(
    Layer.mock(ElectronWindow.ElectronWindow)({
      main: Effect.sync(() =>
        mainId === null
          ? Option.none()
          : Option.some({
              isDestroyed: () => false,
              webContents: { id: mainId, isDestroyed: () => false },
            } as unknown as Electron.BrowserWindow),
      ),
    }),
    Layer.mock(DesktopMainDestination.DesktopMainDestination)({
      setReceiverReady: (webContents, isReady) =>
        Effect.sync(() => {
          ready.push([webContents.id, isReady]);
        }),
      complete: (_webContents, result) =>
        Effect.sync(() => {
          completed.push(result);
        }),
    }),
  );

  return Effect.gen(function* () {
    assert.equal(
      setMainDestinationReceiverReady.channel,
      SET_MAIN_DESTINATION_RECEIVER_READY_CHANNEL,
    );
    assert.equal(completeMainDestination.channel, COMPLETE_MAIN_DESTINATION_CHANNEL);

    const guest = yield* Effect.exit(
      setMainDestinationReceiverReady.handler(true, { sender: { id: 4 } }),
    );
    assert.equal(rejectionMessage(guest), "Main destination request was rejected.");

    const previewComplete = yield* Effect.exit(
      completeMainDestination.handler(
        { requestId: "req", status: "opened" },
        { sender: { id: 9 } },
      ),
    );
    assert.equal(rejectionMessage(previewComplete), "Main destination request was rejected.");
    assert.deepEqual(ready, []);
    assert.deepEqual(completed, []);

    yield* setMainDestinationReceiverReady.handler(true, { sender: { id: 7 } });
    yield* completeMainDestination.handler(
      { requestId: "req", status: "redirected", settledHref: "/pair" },
      { sender: { id: 7 } },
    );
    assert.deepEqual(ready, [[7, true]]);
    assert.deepEqual(completed, [{ requestId: "req", status: "redirected", settledHref: "/pair" }]);

    mainId = null;
    const closed = yield* Effect.exit(
      setMainDestinationReceiverReady.handler(false, { sender: { id: 7 } }),
    );
    assert.equal(rejectionMessage(closed), "Main destination request was rejected.");
  }).pipe(Effect.provide(layer));
});
