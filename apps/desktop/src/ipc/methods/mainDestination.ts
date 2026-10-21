import {
  DesktopMainDestinationRequest,
  DesktopMainDestinationResult,
  desktopMainDestinationSeedFailure,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import * as DesktopMainDestination from "../../window/DesktopMainDestination.ts";
import * as DesktopQuickMessage from "../../quickMessage/DesktopQuickMessage.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

const decodeRequest = Schema.decodeUnknownEffect(DesktopMainDestinationRequest);
const encodeResult = Schema.encodeUnknownEffect(DesktopMainDestinationResult);

const ensureMainSender = Effect.fn("desktop.ipc.mainDestination.ensureMainSender")(function* (
  event: DesktopIpc.DesktopIpcInvokeEvent | undefined,
) {
  const main = yield* (yield* ElectronWindow.ElectronWindow).main;
  if (
    event === undefined ||
    Option.isNone(main) ||
    main.value.isDestroyed() ||
    main.value.webContents.id !== event.sender.id
  ) {
    return yield* new DesktopMainDestination.DesktopMainDestinationUnauthorizedError();
  }
  return main.value.webContents;
});

const openFromPanel = Effect.fn("desktop.ipc.mainDestination.open")(function* (
  raw: unknown,
  event: DesktopIpc.DesktopIpcInvokeEvent | undefined,
) {
  const quickMessage = yield* DesktopQuickMessage.DesktopQuickMessage;
  if (event === undefined || !(yield* quickMessage.isPanel(event.sender.id))) {
    return yield* new DesktopMainDestination.DesktopMainDestinationUnauthorizedError();
  }
  const seedFailure = desktopMainDestinationSeedFailure(raw);
  if (seedFailure !== null) return seedFailure;
  const request = yield* decodeRequest(raw);
  return yield* (yield* DesktopMainDestination.DesktopMainDestination).open(request);
});

export const openMainDestination: DesktopIpc.DesktopIpcMethod<
  DesktopMainDestination.DesktopMainDestinationUnauthorizedError | Schema.SchemaError,
  DesktopQuickMessage.DesktopQuickMessage | DesktopMainDestination.DesktopMainDestination
> = {
  channel: IpcChannels.OPEN_MAIN_DESTINATION_CHANNEL,
  handler: (raw, event) =>
    openFromPanel(raw, event).pipe(
      Effect.flatMap(encodeResult),
      Effect.withSpan("desktop.ipc.method", {
        attributes: { channel: IpcChannels.OPEN_MAIN_DESTINATION_CHANNEL },
      }),
    ),
};

export const setMainDestinationReceiverReady = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.SET_MAIN_DESTINATION_RECEIVER_READY_CHANNEL,
  payload: Schema.Boolean,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.mainDestination.setReceiverReady")(function* (ready, event) {
    const webContents = yield* ensureMainSender(event);
    yield* (yield* DesktopMainDestination.DesktopMainDestination).setReceiverReady(
      webContents,
      ready,
    );
  }),
});

export const completeMainDestination = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.COMPLETE_MAIN_DESTINATION_CHANNEL,
  payload: DesktopMainDestinationResult,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.mainDestination.complete")(function* (result, event) {
    const webContents = yield* ensureMainSender(event);
    yield* (yield* DesktopMainDestination.DesktopMainDestination).complete(webContents, result);
  }),
});
