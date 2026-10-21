import {
  type DesktopMainDestinationRequest,
  type DesktopMainDestinationResult,
  desktopMainDestinationHrefCarriesSeed,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";

import type * as Electron from "electron";

import * as ElectronWindow from "../electron/ElectronWindow.ts";
import { MAIN_DESTINATION_EVENT_CHANNEL } from "../ipc/channels.ts";
import * as DesktopWindow from "./DesktopWindow.ts";

export const MAIN_DESTINATION_TIMEOUT = Duration.seconds(15);
export const MAIN_DESTINATION_QUEUE_LIMIT = 8;

export class DesktopMainDestinationUnauthorizedError extends Schema.TaggedError<DesktopMainDestinationUnauthorizedError>()(
  "DesktopMainDestinationUnauthorizedError",
  {},
) {
  override get message(): string {
    return "Main destination request was rejected.";
  }
}

export class DesktopMainDestination extends Context.Service<
  DesktopMainDestination,
  {
    readonly open: (
      request: DesktopMainDestinationRequest,
    ) => Effect.Effect<DesktopMainDestinationResult>;
    readonly setReceiverReady: (
      webContents: Electron.WebContents,
      ready: boolean,
    ) => Effect.Effect<void, DesktopMainDestinationUnauthorizedError>;
    readonly complete: (
      webContents: Electron.WebContents,
      result: DesktopMainDestinationResult,
    ) => Effect.Effect<void, DesktopMainDestinationUnauthorizedError>;
  }
>()("@t3tools/desktop/window/DesktopMainDestination") {}

interface Job {
  readonly request: DesktopMainDestinationRequest;
  readonly result: Deferred.Deferred<DesktopMainDestinationResult>;
  settled: boolean;
  sent: boolean;
  sentTo: number | null;
}

function failedResult(requestId: string): DesktopMainDestinationResult {
  return { requestId, status: "failed" };
}

/**
 * Reveals the main window and delivers one destination per request.
 * DesktopQuickMessage already depends on DesktopWindow; this service does not
 * depend on DesktopQuickMessage, so the panel check stays in IPC and the
 * quick-message lifecycle module stays untouched.
 */
export const make = Effect.gen(function* () {
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  const context = yield* Effect.context<
    ElectronWindow.ElectronWindow | DesktopWindow.DesktopWindow
  >();
  const runFork = Effect.runForkWith(context);
  const jobs = yield* Queue.unbounded<Job>();
  const inflight = new Map<string, Job>();
  let receiver: Electron.WebContents | null = null;
  let wakePending = false;
  let wakeResume: (() => void) | null = null;
  const armedContents = new Set<number>();
  const armedWindows = new Set<number>();

  const signalWake = () => {
    wakePending = true;
    const resume = wakeResume;
    wakeResume = null;
    resume?.();
  };

  const waitForWake = Effect.callback<void>((resume) => {
    if (wakePending) {
      wakePending = false;
      return resume(Effect.void);
    }
    wakeResume = () => {
      wakePending = false;
      resume(Effect.void);
    };
  });

  const settle = Effect.fn("DesktopMainDestination.settle")(function* (
    job: Job,
    result: DesktopMainDestinationResult,
  ) {
    const won = yield* Effect.sync(() => {
      if (job.settled) return false;
      job.settled = true;
      inflight.delete(job.request.requestId);
      return true;
    });
    if (won) yield* Deferred.succeed(job.result, result).pipe(Effect.ignore);
  });

  const failSentJobs = (webContentsId: number) => {
    const doomed = [...inflight.values()].filter(
      (job) => job.sent && !job.settled && job.sentTo === webContentsId,
    );
    if (doomed.length === 0) return;
    runFork(
      Effect.gen(function* () {
        for (const job of doomed) yield* settle(job, failedResult(job.request.requestId));
      }),
    );
  };

  const armContents = (webContents: Electron.WebContents) => {
    if (armedContents.has(webContents.id)) return;
    armedContents.add(webContents.id);
    const clear = () => {
      armedContents.delete(webContents.id);
      if (receiver?.id === webContents.id) receiver = null;
      failSentJobs(webContents.id);
      signalWake();
    };
    webContents.once("destroyed", clear);
    webContents.once("render-process-gone", clear);
  };

  const armWindow = (window: Electron.BrowserWindow) => {
    if (armedWindows.has(window.id)) return;
    armedWindows.add(window.id);
    const contentsId = window.webContents.id;
    window.once("closed", () => {
      armedWindows.delete(window.id);
      if (receiver?.id === contentsId) receiver = null;
      failSentJobs(contentsId);
      signalWake();
    });
  };

  const ensureMain = Effect.fn("DesktopMainDestination.ensureMain")(function* (
    webContents: Electron.WebContents,
  ) {
    const main = yield* electronWindow.main;
    if (
      Option.isNone(main) ||
      main.value.isDestroyed() ||
      webContents.isDestroyed() ||
      main.value.webContents.id !== webContents.id
    ) {
      return yield* new DesktopMainDestinationUnauthorizedError();
    }
    return main.value;
  });

  const waitForReceiver = Effect.fn("DesktopMainDestination.waitForReceiver")(function* (job: Job) {
    let revealedForGap = false;
    while (!job.settled) {
      const main = yield* electronWindow.main;
      if (Option.isNone(main) || main.value.isDestroyed()) {
        if (revealedForGap) {
          yield* waitForWake;
          continue;
        }
        revealedForGap = true;
        const created = yield* desktopWindow.revealOrCreateMain.pipe(Effect.option);
        if (Option.isNone(created)) {
          yield* settle(job, failedResult(job.request.requestId));
          return null;
        }
        armWindow(created.value);
        continue;
      }
      revealedForGap = false;
      armWindow(main.value);
      const contents = main.value.webContents;
      if (!contents.isDestroyed() && receiver?.id === contents.id) return contents;
      yield* waitForWake;
    }
    return null;
  });

  const dispatch = Effect.fn("DesktopMainDestination.dispatch")(function* (job: Job) {
    if ("href" in job.request && desktopMainDestinationHrefCarriesSeed(job.request.href)) {
      yield* settle(job, failedResult(job.request.requestId));
      return;
    }
    const contents = yield* waitForReceiver(job);
    if (contents === null || job.settled) return;
    if (!job.sent) {
      const sent = yield* Effect.try({
        try: () => contents.send(MAIN_DESTINATION_EVENT_CHANNEL, job.request),
        catch: () => new DesktopMainDestinationUnauthorizedError(),
      }).pipe(Effect.option);
      if (Option.isNone(sent)) {
        yield* settle(job, failedResult(job.request.requestId));
        return;
      }
      job.sent = true;
      job.sentTo = contents.id;
    }
    yield* Deferred.await(job.result);
  });

  const runJobEffect = Effect.fn("DesktopMainDestination.runJob")(function* (job: Job) {
    const arrived = yield* dispatch(job).pipe(Effect.timeoutOption(MAIN_DESTINATION_TIMEOUT));
    if (Option.isNone(arrived)) yield* settle(job, failedResult(job.request.requestId));
  });
  const runJob = (job: Job) =>
    runJobEffect(job).pipe(Effect.catch(() => settle(job, failedResult(job.request.requestId))));

  const worker = Effect.forever(
    Queue.take(jobs).pipe(
      Effect.flatMap(runJob),
      Effect.catch(() => Effect.void),
    ),
  );
  yield* Effect.forkScoped(worker);

  return DesktopMainDestination.of({
    open: Effect.fn("DesktopMainDestination.open")(function* (request) {
      const result = yield* Deferred.make<DesktopMainDestinationResult>();
      const admission = yield* Effect.sync(() => {
        const existing = inflight.get(request.requestId);
        if (existing) return { _tag: "existing" as const, job: existing };
        if (inflight.size >= MAIN_DESTINATION_QUEUE_LIMIT) return { _tag: "full" as const };
        const job: Job = { request, result, settled: false, sent: false, sentTo: null };
        inflight.set(request.requestId, job);
        return { _tag: "admitted" as const, job };
      });
      if (admission._tag === "full") return failedResult(request.requestId);
      if (admission._tag === "existing") return yield* Deferred.await(admission.job.result);
      yield* Queue.offer(jobs, admission.job).pipe(Effect.asVoid);
      return yield* Deferred.await(admission.job.result);
    }),
    setReceiverReady: Effect.fn("DesktopMainDestination.setReceiverReady")(
      function* (webContents, ready) {
        yield* ensureMain(webContents);
        if (ready) {
          receiver = webContents;
          armContents(webContents);
        } else if (receiver?.id === webContents.id) {
          receiver = null;
        }
        signalWake();
      },
    ),
    complete: Effect.fn("DesktopMainDestination.complete")(function* (webContents, result) {
      yield* ensureMain(webContents);
      const job = inflight.get(result.requestId);
      if (job === undefined || job.settled || !job.sent) return;
      yield* settle(job, result);
    }),
  });
});

export const layer = Layer.effect(DesktopMainDestination, make);
