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

class Emitter {
  private readonly listeners = new Map<string, Set<() => void>>();

  once(event: string, listener: () => void) {
    const wrapped = () => {
      this.off(event, wrapped);
      listener();
    };
    const set = this.listeners.get(event) ?? new Set();
    set.add(wrapped);
    this.listeners.set(event, set);
  }

  off(event: string, listener: () => void) {
    this.listeners.get(event)?.delete(listener);
  }

  emit(event: string) {
    for (const listener of Array.from(this.listeners.get(event) ?? [])) listener();
  }
}

interface FakeContents extends Emitter {
  readonly id: number;
  destroyed: boolean;
  readonly sent: Array<readonly [string, DesktopMainDestinationRequest]>;
  send(channel: string, payload: DesktopMainDestinationRequest): void;
  isDestroyed(): boolean;
}

interface FakeWindow extends Emitter {
  readonly id: number;
  readonly webContents: FakeContents;
  destroyed: boolean;
  isDestroyed(): boolean;
}

function createHarness(hooks: {
  readonly onReveal: () => void;
  readonly onSend: (count: number) => void;
}) {
  let nextId = 1;
  let main: FakeWindow | null = null;
  let revealed = 0;

  const createContents = (): FakeContents => {
    const id = nextId++;
    const contents = Object.assign(new Emitter(), {
      id,
      destroyed: false,
      sent: [] as Array<readonly [string, DesktopMainDestinationRequest]>,
      send(channel: string, payload: DesktopMainDestinationRequest) {
        this.sent.push([channel, payload]);
        hooks.onSend(this.sent.length);
      },
      isDestroyed() {
        return this.destroyed;
      },
    });
    return contents;
  };

  const createWindow = (): FakeWindow =>
    Object.assign(new Emitter(), {
      id: nextId++,
      webContents: createContents(),
      destroyed: false,
      isDestroyed() {
        return this.destroyed;
      },
    });

  const layer = DesktopMainDestination.layer.pipe(
    Layer.provide(
      Layer.mock(ElectronWindow.ElectronWindow)({
        main: Effect.sync(() =>
          main === null || main.destroyed
            ? Option.none()
            : Option.some(main as unknown as Electron.BrowserWindow),
        ),
      }),
    ),
    Layer.provide(
      Layer.mock(DesktopWindow.DesktopWindow)({
        revealOrCreateMain: Effect.sync(() => {
          revealed += 1;
          main ??= createWindow();
          hooks.onReveal();
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
    get revealed() {
      return revealed;
    },
  };
}

const location = (requestId: string, href: string): DesktopMainDestinationRequest => ({
  requestId,
  href,
});

const succeed = <A>(deferred: Deferred.Deferred<A>, value: A) => {
  Deferred.doneUnsafe(deferred, Effect.succeed(value));
};

it.effect("reveals a missing main window and sends one request when it is ready", () =>
  Effect.gen(function* () {
    const revealed = yield* Deferred.make<number>();
    const sent = yield* Deferred.make<number>();
    const harness = createHarness({
      onReveal: () => succeed(revealed, 1),
      onSend: (count) => succeed(sent, count),
    });

    yield* Effect.gen(function* () {
      const destination = yield* DesktopMainDestination.DesktopMainDestination;
      const first = location("req-1", "/settings/general");
      const fiber = yield* destination.open(first).pipe(Effect.forkScoped);
      const duplicate = yield* destination.open(first).pipe(Effect.forkScoped);
      yield* Deferred.await(revealed);
      assert.equal(harness.revealed, 1);
      const contents = harness.main?.webContents;
      assert.ok(contents);

      const guest = harness.createWindow().webContents;
      const denied = yield* Effect.exit(
        destination.setReceiverReady(guest as unknown as Electron.WebContents, true),
      );
      assert.equal(denied._tag, "Failure");

      yield* destination.setReceiverReady(contents as unknown as Electron.WebContents, true);
      yield* destination.setReceiverReady(contents as unknown as Electron.WebContents, true);
      assert.equal(yield* Deferred.await(sent), 1);
      assert.deepEqual(contents.sent, [[MAIN_DESTINATION_EVENT_CHANNEL, first]]);

      const result = {
        requestId: "req-1",
        status: "opened" as const,
        settledHref: "/settings/general",
      };
      yield* destination.complete(contents as unknown as Electron.WebContents, result);
      assert.deepEqual(yield* Fiber.join(fiber), result);
      assert.deepEqual(yield* Fiber.join(duplicate), result);
    }).pipe(Effect.provide(Layer.mergeAll(harness.layer, TestClock.layer())));
  }),
);

it.effect("does not replay a request on a second ready or after the receiver is gone", () =>
  Effect.gen(function* () {
    const revealed = yield* Deferred.make<number>();
    const sent = yield* Deferred.make<number>();
    const harness = createHarness({
      onReveal: () => succeed(revealed, 1),
      onSend: (count) => succeed(sent, count),
    });

    yield* Effect.gen(function* () {
      const destination = yield* DesktopMainDestination.DesktopMainDestination;
      const fiber = yield* destination.open(location("req-gone", "/usage")).pipe(Effect.forkScoped);
      yield* Deferred.await(revealed);
      const contents = harness.main?.webContents;
      assert.ok(contents);
      yield* destination.setReceiverReady(contents as unknown as Electron.WebContents, true);
      yield* Deferred.await(sent);
      contents.destroyed = true;
      contents.emit("destroyed");
      assert.deepEqual(yield* Fiber.join(fiber), { requestId: "req-gone", status: "failed" });

      const replacement = harness.createWindow();
      harness.main = replacement;
      yield* destination.setReceiverReady(
        replacement.webContents as unknown as Electron.WebContents,
        true,
      );
      assert.equal(contents.sent.length, 1);
      assert.equal(replacement.webContents.sent.length, 0);
    }).pipe(Effect.provide(Layer.mergeAll(harness.layer, TestClock.layer())));
  }),
);

it.effect("fails a request at 15 seconds and ignores a late acknowledgement", () =>
  Effect.gen(function* () {
    const revealed = yield* Deferred.make<number>();
    const harness = createHarness({
      onReveal: () => succeed(revealed, 1),
      onSend: () => undefined,
    });

    yield* Effect.gen(function* () {
      const destination = yield* DesktopMainDestination.DesktopMainDestination;
      const fiber = yield* destination
        .open(location("req-timeout", "/pull-requests"))
        .pipe(Effect.forkScoped);
      yield* Deferred.await(revealed);
      yield* TestClock.adjust(Duration.seconds(15));
      assert.deepEqual(yield* Fiber.join(fiber), { requestId: "req-timeout", status: "failed" });

      const contents = harness.main?.webContents;
      assert.ok(contents);
      yield* destination.setReceiverReady(contents as unknown as Electron.WebContents, true);
      assert.equal(contents.sent.length, 0);
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
    const revealed = yield* Deferred.make<number>();
    let onSend: (count: number) => void = () => undefined;
    const harness = createHarness({
      onReveal: () => succeed(revealed, 1),
      onSend: (count) => onSend(count),
    });
    const firstSent = yield* Deferred.make<number>();
    onSend = (count) => succeed(firstSent, count);

    yield* Effect.gen(function* () {
      const destination = yield* DesktopMainDestination.DesktopMainDestination;
      const fibers: Array<Fiber.Fiber<DesktopMainDestinationResult>> = [];
      for (let index = 0; index < DesktopMainDestination.MAIN_DESTINATION_QUEUE_LIMIT; index += 1) {
        fibers.push(
          yield* destination
            .open(location(`req-${index}`, "/settings/projects"))
            .pipe(Effect.forkScoped),
        );
      }
      yield* Deferred.await(revealed);
      const overflow = yield* destination.open(location("req-overflow", "/settings/projects"));
      assert.deepEqual(overflow, { requestId: "req-overflow", status: "failed" });

      const contents = harness.main?.webContents;
      assert.ok(contents);
      yield* destination.setReceiverReady(contents as unknown as Electron.WebContents, true);
      assert.equal(yield* Deferred.await(firstSent), 1);

      for (let index = 0; index < fibers.length; index += 1) {
        const nextSent = index < fibers.length - 1 ? yield* Deferred.make<number>() : null;
        if (nextSent) onSend = (count) => succeed(nextSent, count);
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
        if (nextSent) yield* Deferred.await(nextSent);
      }
      assert.equal(contents.sent.length, DesktopMainDestination.MAIN_DESTINATION_QUEUE_LIMIT);
    }).pipe(Effect.provide(Layer.mergeAll(harness.layer, TestClock.layer())));
  }),
);
