import { DesktopQuickMessageState, DesktopQuickMessageSubmission } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import * as DesktopQuickMessage from "../../quickMessage/DesktopQuickMessage.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

class QuickMessageIpcUnauthorizedSenderError extends Schema.TaggedError<QuickMessageIpcUnauthorizedSenderError>()(
  "QuickMessageIpcUnauthorizedSenderError",
  {},
) {
  override get message(): string {
    return "Quick message request was rejected.";
  }
}

const ensurePanelSender = Effect.fn("desktop.ipc.quickMessage.ensurePanelSender")(function* (
  event: DesktopIpc.DesktopIpcInvokeEvent | undefined,
) {
  const quickMessage = yield* DesktopQuickMessage.DesktopQuickMessage;
  if (event === undefined || !(yield* quickMessage.isPanel(event.sender.id))) {
    return yield* new QuickMessageIpcUnauthorizedSenderError();
  }
  return quickMessage;
});

export const getQuickMessageState = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.GET_QUICK_MESSAGE_STATE_CHANNEL,
  payload: Schema.Void,
  result: DesktopQuickMessageState,
  handler: Effect.fn("desktop.ipc.quickMessage.getState")(function* () {
    return yield* (yield* DesktopQuickMessage.DesktopQuickMessage).state;
  }),
});

export const setQuickMessageShortcutSuppressed = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.SET_QUICK_MESSAGE_SHORTCUT_SUPPRESSED_CHANNEL,
  payload: Schema.Boolean,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.quickMessage.setShortcutSuppressed")(function* (suppressed) {
    yield* (yield* DesktopQuickMessage.DesktopQuickMessage).setShortcutSuppressed(suppressed);
  }),
});

export const setQuickMessageReceiverReady = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.SET_QUICK_MESSAGE_RECEIVER_READY_CHANNEL,
  payload: Schema.Boolean,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.quickMessage.setReceiverReady")(function* (ready, event) {
    const main = yield* (yield* ElectronWindow.ElectronWindow).main;
    if (
      event === undefined ||
      Option.isNone(main) ||
      main.value.webContents.id !== event.sender.id
    ) {
      return yield* new QuickMessageIpcUnauthorizedSenderError();
    }
    yield* (yield* DesktopQuickMessage.DesktopQuickMessage).setReceiverReady(
      main.value.webContents,
      ready,
    );
  }),
});

export const setQuickMessagePanelReady = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.SET_QUICK_MESSAGE_PANEL_READY_CHANNEL,
  payload: Schema.Void,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.quickMessage.setPanelReady")(function* (_, event) {
    yield* (yield* ensurePanelSender(event)).setPanelReady;
  }),
});

export const submitQuickMessage = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.SUBMIT_QUICK_MESSAGE_CHANNEL,
  payload: DesktopQuickMessageSubmission,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.quickMessage.submit")(function* (submission, event) {
    yield* (yield* ensurePanelSender(event)).submit(submission);
  }),
});

export const dismissQuickMessage = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.DISMISS_QUICK_MESSAGE_CHANNEL,
  payload: Schema.Void,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.quickMessage.dismiss")(function* (_, event) {
    yield* (yield* ensurePanelSender(event)).dismiss;
  }),
});
