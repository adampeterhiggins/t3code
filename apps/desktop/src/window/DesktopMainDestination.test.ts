import { assert, it } from "@effect/vitest";
import type {
  DesktopMainDestinationRequest,
  DesktopMainDestinationResult,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";
import type * as Electron from "electron";
import { vi } from "vite-plus/test";

vi.mock("electron", () => ({
  app: { on: vi.fn(), removeListener: vi.fn() },
  BrowserWindow: function BrowserWindow() {},
}));

import { MAIN_DESTINATION_EVENT_CHANNEL } from "../ipc/channels.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as DesktopMainDestination from "./DesktopMainDestination.ts";
import * as DesktopWindow from "./DesktopWindow.ts";

type Listener = (...args: Array<unknown>) => void;

class Emitter {
  private readonly listeners = new Map<string, Set<Listener>>();

  on(event: string, listener: Listener) {
    const set = this.listeners.get(event) ?? new Set();
    set.add(listener);
    this.listeners.set(event, set);
    return this;
  }

  once(event: string, listener: Listener) {
    const wrapped: Listener = (...args) => {
      this.off(event, wrapped);
      listener(...args);
    };
    this.on(event, wrapped);
  }

  off(event: string, listener: Listener) {
    this.listeners.get(event)?.delete(listener);
  }

  removeListener(event: string, listener: Listener) {
    this.off(event, listener);
  }

  emit(event: string, ...args: Array<unknown>) {
    for (const listener of Array.from(this.listeners.get(event) ?? [])) listener(...args);
  }

  listenerCount(event: string) {
    return this.listeners.get(event)?.size ?? 0;
  }
}

class FakeContents extends Emitter {
  readonly id: number;
  destroyed = false;
  readonly sent: Array<readonly [string, DesktopMainDestinationRequest]> = [];
  private readonly notifySend: ((contents: FakeContents) => void) | undefined;

  constructor(id: number, notifySend: ((contents: FakeContents) => void) | undefined) {
    super();
    this.id = id;
    this.notifySend = notifySend;
  }

  send(channel: string, payload: DesktopMainDestinationRequest) {
    this.sent.push([channel, payload]);
    this.notifySend?.(this);
  }

  isDestroyed() {
    return this.destroyed;
  }
}

class FakeWindow extends Emitter {
  readonly id: number;
  readonly webContents: FakeContents;
  destroyed = false;

  constructor(id: number, webContents: FakeContents) {
    super();
    this.id = id;
    this.webContents = webContents;
  }

  isDestroyed() {
    return this.destroyed;
  }
}

const navigation = (isMainFrame: boolean, isSameDocument: boolean) => ({
  isMainFrame,
  isSameDocument,
});

function createHarness(hooks?: {
  readonly created?: Deferred.Deferred<number>;
  readonly shown?: Deferred.Deferred<number>;
  readonly onSend?: (contents: FakeContents) => void;
}) {
  let nextId = 1;
  let main: FakeWindow | null = null;
  let createdCount = 0;
  let shownCount = 0;

  const createContents = () => new FakeContents(nextId++, hooks?.onSend);

  const createWindow = () => {
    const id = nextId++;
    return new FakeWindow(id, createContents());
  };

  const layer = DesktopMainDestination.layer.pipe(
    Layer.provide(
      Layer.mock(ElectronWindow.ElectronWindow)({
        main: Effect.sync(() =>
          main === null || main.destroyed
            ? Option.none()
            : Option.some(main as unknown as Electron.BrowserWindow),
        ),
        reveal: () =>
          Effect.gen(function* () {
            shownCount += 1;
            if (hooks?.shown) yield* Deferred.succeed(hooks.shown, shownCount);
          }),
      }),
    ),
    Layer.provide(
      Layer.mock(DesktopWindow.DesktopWindow)({
        revealOrCreateMain: Effect.gen(function* () {
          createdCount += 1;
          main ??= createWindow();
          if (hooks?.created) yield* Deferred.succeed(hooks.created, createdCount);
          return main as unknown as Electron.BrowserWindow;
        }),
      }),
    ),
  );

  return {
    layer,
    createWindow,
    get main() {
      return main;
    },
    set main(window: FakeWindow | null) {
      main = window;
    },
    get created() {
      return createdCount;
    },
    get shown() {
      return shownCount;
    },
  };
}

const location = (requestId: string, href: string): DesktopMainDestinationRequest => ({
  requestId,
  href,
});

const forkOpen = (
  destination: {
    readonly open: (
      request: DesktopMainDestinationRequest,
    ) => Effect.Effect<DesktopMainDestinationResult>;
  },
  request: DesktopMainDestinationRequest,
) => destination.open(request).pipe(Effect.forkScoped({ startImmediately: true }));

// The worker completes these milestones from inside its own turn. Yield before
// waiting so that completion is recorded while the worker reaches its next
// real wait, instead of resuming this fiber inside that turn.
const reachWorker = Effect.yieldNow;

it.effect("reveals a missing main window and sends one request when it is ready", () =>
  Effect.gen(function* () {
    const created = yield* Deferred.make<number>();
    const harness = createHarness({ created });

    yield* Effect.gen(function* () {
      const destination = yield* DesktopMainDestination.DesktopMainDestination;
      const first = location("req-1", "/settings/general");
      const fiber = yield* forkOpen(destination, first);
      const duplicate = yield* forkOpen(destination, first);
      yield* reachWorker;
      assert.equal(yield* Deferred.await(created), 1);
      assert.equal(harness.created, 1);
      assert.equal(harness.shown, 0);
      const contents = harness.main?.webContents;
      assert.ok(contents);
      assert.equal(contents.listenerCount("did-start-navigation"), 0);

      const guest = harness.createWindow().webContents;
      const denied = yield* Effect.exit(
        destination.setReceiverReady(guest as unknown as Electron.WebContents, true),
      );
      assert.equal(denied._tag, "Failure");

      yield* destination.setReceiverReady(contents as unknown as Electron.WebContents, true);
      yield* destination.setReceiverReady(contents as unknown as Electron.WebContents, true);
      assert.equal(contents.sent.length, 1);
      assert.equal(contents.listenerCount("did-start-navigation"), 1);
      assert.deepEqual(contents.sent, [[MAIN_DESTINATION_EVENT_CHANNEL, first]]);
      assert.equal(harness.shown, 0);

      const result = {
        requestId: "req-1",
        status: "opened" as const,
        settledHref: "/settings/general",
      };
      yield* destination.complete(contents as unknown as Electron.WebContents, result);
      assert.equal(harness.created, 1);
      assert.equal(harness.shown, 0);
      assert.deepEqual(yield* Fiber.join(fiber), result);
      assert.deepEqual(yield* Fiber.join(duplicate), result);
    }).pipe(Effect.provide(Layer.mergeAll(harness.layer, TestClock.layer())));
  }),
);

it.effect("reveals an existing main window once and does not reveal it from readiness", () =>
  Effect.gen(function* () {
    const shown = yield* Deferred.make<number>();
    const harness = createHarness({ shown });

    yield* Effect.gen(function* () {
      const destination = yield* DesktopMainDestination.DesktopMainDestination;
      const existing = harness.createWindow();
      harness.main = existing;
      const contents = existing.webContents;

      yield* destination.setReceiverReady(contents as unknown as Electron.WebContents, false);
      assert.equal(harness.shown, 0);
      assert.equal(harness.created, 0);

      const request = location("req-existing", "/settings/general");
      const fiber = yield* forkOpen(destination, request);
      const duplicate = yield* forkOpen(destination, request);
      yield* reachWorker;
      assert.equal(yield* Deferred.await(shown), 1);
      assert.equal(harness.shown, 1);
      assert.equal(harness.created, 0);
      assert.equal(contents.sent.length, 0);
      assert.equal(existing.listenerCount("closed"), 1);

      yield* destination.setReceiverReady(contents as unknown as Electron.WebContents, false);
      assert.equal(harness.shown, 1);
      assert.equal(contents.sent.length, 0);

      yield* destination.setReceiverReady(contents as unknown as Electron.WebContents, true);
      yield* destination.setReceiverReady(contents as unknown as Electron.WebContents, true);
      assert.equal(harness.shown, 1);
      assert.equal(harness.created, 0);
      assert.equal(contents.listenerCount("did-start-navigation"), 1);
      assert.deepEqual(contents.sent, [[MAIN_DESTINATION_EVENT_CHANNEL, request]]);

      const result = {
        requestId: "req-existing",
        status: "opened" as const,
        settledHref: "/settings/general",
      };
      yield* destination.complete(contents as unknown as Electron.WebContents, result);
      assert.equal(harness.shown, 1);
      assert.deepEqual(yield* Fiber.join(fiber), result);
      assert.deepEqual(yield* Fiber.join(duplicate), result);
    }).pipe(Effect.provide(Layer.mergeAll(harness.layer, TestClock.layer())));
  }),
);

it.effect.each(["destroyed", "render-process-gone"] as const)(
  "does not replay a request after the receiver is %s",
  (event) =>
    Effect.gen(function* () {
      const created = yield* Deferred.make<number>();
      const harness = createHarness({ created });

      yield* Effect.gen(function* () {
        const destination = yield* DesktopMainDestination.DesktopMainDestination;
        const fiber = yield* forkOpen(destination, location("req-gone", "/usage"));
        yield* reachWorker;
        assert.equal(yield* Deferred.await(created), 1);
        const contents = harness.main?.webContents;
        assert.ok(contents);
        yield* destination.setReceiverReady(contents as unknown as Electron.WebContents, true);
        assert.equal(contents.sent.length, 1);
        assert.equal(contents.listenerCount("did-start-navigation"), 1);
        if (event === "destroyed") contents.destroyed = true;
        contents.emit(event);
        assert.equal(contents.listenerCount("did-start-navigation"), 0);
        assert.equal(contents.listenerCount(event), 0);
        assert.deepEqual(yield* Fiber.join(fiber), { requestId: "req-gone", status: "failed" });

        const replacement = harness.createWindow();
        harness.main = replacement;
        yield* destination.setReceiverReady(
          replacement.webContents as unknown as Electron.WebContents,
          true,
        );
        assert.equal(contents.sent.length, 1);
        assert.equal(replacement.webContents.sent.length, 0);
        const late = yield* Effect.exit(
          destination.complete(replacement.webContents as unknown as Electron.WebContents, {
            requestId: "req-gone",
            status: "opened",
            settledHref: "/usage",
          }),
        );
        assert.equal(late._tag, "Success");
        assert.equal(replacement.webContents.sent.length, 0);
      }).pipe(Effect.provide(Layer.mergeAll(harness.layer, TestClock.layer())));
    }),
);

it.effect("fails a request at 15 seconds and ignores a late acknowledgement", () =>
  Effect.gen(function* () {
    const created = yield* Deferred.make<number>();
    const harness = createHarness({ created });

    yield* Effect.gen(function* () {
      const destination = yield* DesktopMainDestination.DesktopMainDestination;
      const fiber = yield* forkOpen(destination, location("req-timeout", "/pull-requests"));
      yield* reachWorker;
      assert.equal(yield* Deferred.await(created), 1);
      yield* TestClock.adjust(Duration.seconds(15));
      assert.deepEqual(yield* Fiber.join(fiber), { requestId: "req-timeout", status: "failed" });

      const contents = harness.main?.webContents;
      assert.ok(contents);
      yield* destination.setReceiverReady(contents as unknown as Electron.WebContents, true);
      assert.equal(contents.sent.length, 0);
      assert.equal(harness.shown, 0);
      const late = yield* Effect.exit(
        destination.complete(contents as unknown as Electron.WebContents, {
          requestId: "req-timeout",
          status: "opened",
          settledHref: "/pull-requests",
        }),
      );
      assert.equal(late._tag, "Success");
      assert.equal(contents.sent.length, 0);
    }).pipe(Effect.provide(Layer.mergeAll(harness.layer, TestClock.layer())));
  }),
);

it.effect("queues distinct requests and rejects admission past the bound", () =>
  Effect.gen(function* () {
    const created = yield* Deferred.make<number>();
    const harness = createHarness({ created });

    yield* Effect.gen(function* () {
      const destination = yield* DesktopMainDestination.DesktopMainDestination;
      const fibers: Array<Fiber.Fiber<DesktopMainDestinationResult>> = [];
      for (let index = 0; index < DesktopMainDestination.MAIN_DESTINATION_QUEUE_LIMIT; index += 1) {
        fibers.push(yield* forkOpen(destination, location(`req-${index}`, "/settings/projects")));
      }
      const overflow = yield* destination.open(location("req-overflow", "/settings/projects"));
      assert.deepEqual(overflow, { requestId: "req-overflow", status: "failed" });
      yield* reachWorker;
      assert.equal(yield* Deferred.await(created), 1);
      assert.equal(harness.created, 1);

      const contents = harness.main?.webContents;
      assert.ok(contents);
      yield* destination.setReceiverReady(contents as unknown as Electron.WebContents, true);
      assert.equal(contents.sent.length, 1);

      for (let index = 0; index < fibers.length; index += 1) {
        yield* destination.complete(contents as unknown as Electron.WebContents, {
          requestId: `req-${index}`,
          status: "redirected",
          settledHref: "/settings/projects",
        });
        assert.deepEqual(yield* Fiber.join(fibers[index]!), {
          requestId: `req-${index}`,
          status: "redirected",
          settledHref: "/settings/projects",
        });
        yield* reachWorker;
        assert.equal(
          contents.sent.length,
          Math.min(index + 2, DesktopMainDestination.MAIN_DESTINATION_QUEUE_LIMIT),
        );
      }
      assert.deepEqual(
        contents.sent.map((entry) => entry[1].requestId),
        fibers.map((_, index) => `req-${index}`),
      );
    }).pipe(Effect.provide(Layer.mergeAll(harness.layer, TestClock.layer())));
  }),
);

it.effect("drops a reloaded document and delivers an unsent request on the next ready", () =>
  Effect.gen(function* () {
    const created = yield* Deferred.make<number>();
    const harness = createHarness({ created });

    yield* Effect.gen(function* () {
      const destination = yield* DesktopMainDestination.DesktopMainDestination;
      const first = location("req-reload", "/settings/general");
      const second = location("req-next", "/usage");
      const firstFiber = yield* forkOpen(destination, first);
      yield* reachWorker;
      assert.equal(yield* Deferred.await(created), 1);
      const contents = harness.main?.webContents;
      assert.ok(contents);
      yield* destination.setReceiverReady(contents as unknown as Electron.WebContents, true);
      yield* destination.setReceiverReady(contents as unknown as Electron.WebContents, true);
      assert.equal(contents.listenerCount("did-start-navigation"), 1);
      assert.deepEqual(contents.sent, [[MAIN_DESTINATION_EVENT_CHANNEL, first]]);

      const secondFiber = yield* forkOpen(destination, second);
      contents.emit("did-start-navigation", navigation(false, false));
      contents.emit("did-start-navigation", navigation(true, true));
      assert.equal(contents.sent.length, 1);
      assert.equal(contents.listenerCount("did-start-navigation"), 1);

      contents.emit("did-start-navigation", navigation(true, false));
      yield* reachWorker;
      assert.deepEqual(yield* Fiber.join(firstFiber), {
        requestId: "req-reload",
        status: "failed",
      });
      assert.equal(contents.sent.length, 1);
      const late = yield* Effect.exit(
        destination.complete(contents as unknown as Electron.WebContents, {
          requestId: "req-reload",
          status: "opened",
          settledHref: "/settings/general",
        }),
      );
      assert.equal(late._tag, "Success");
      assert.equal(contents.sent.length, 1);

      yield* destination.setReceiverReady(contents as unknown as Electron.WebContents, true);
      yield* reachWorker;
      assert.equal(contents.listenerCount("did-start-navigation"), 1);
      assert.deepEqual(contents.sent, [
        [MAIN_DESTINATION_EVENT_CHANNEL, first],
        [MAIN_DESTINATION_EVENT_CHANNEL, second],
      ]);
      contents.emit("did-start-navigation", navigation(true, true));
      const redirected = {
        requestId: "req-next",
        status: "redirected" as const,
        settledHref: "/usage",
      };
      yield* destination.complete(contents as unknown as Electron.WebContents, redirected);
      assert.deepEqual(yield* Fiber.join(secondFiber), redirected);
      assert.equal(contents.sent.length, 2);
    }).pipe(Effect.provide(Layer.mergeAll(harness.layer, TestClock.layer())));
  }),
);

it.effect("fails a request whose document loads during delivery and does not replay it", () =>
  Effect.gen(function* () {
    const created = yield* Deferred.make<number>();
    const armedAtSend: Array<number> = [];
    const harness = createHarness({
      created,
      onSend: (contents) => {
        armedAtSend.push(contents.listenerCount("did-start-navigation"));
        contents.emit("did-start-navigation", navigation(true, false));
      },
    });

    yield* Effect.gen(function* () {
      const destination = yield* DesktopMainDestination.DesktopMainDestination;
      const request = location("req-mid-send", "/pull-requests");
      const fiber = yield* forkOpen(destination, request);
      yield* reachWorker;
      assert.equal(yield* Deferred.await(created), 1);
      const contents = harness.main?.webContents;
      assert.ok(contents);
      assert.equal(contents.listenerCount("did-start-navigation"), 0);

      yield* destination.setReceiverReady(contents as unknown as Electron.WebContents, true);
      assert.deepEqual(armedAtSend, [1]);
      assert.deepEqual(yield* Fiber.join(fiber), { requestId: "req-mid-send", status: "failed" });
      assert.deepEqual(contents.sent, [[MAIN_DESTINATION_EVENT_CHANNEL, request]]);

      yield* destination.setReceiverReady(contents as unknown as Electron.WebContents, true);
      assert.equal(contents.listenerCount("did-start-navigation"), 1);
      assert.equal(contents.sent.length, 1);
      const late = yield* Effect.exit(
        destination.complete(contents as unknown as Electron.WebContents, {
          requestId: "req-mid-send",
          status: "opened",
          settledHref: "/pull-requests",
        }),
      );
      assert.equal(late._tag, "Success");
      assert.equal(contents.sent.length, 1);
    }).pipe(Effect.provide(Layer.mergeAll(harness.layer, TestClock.layer())));
  }),
);
