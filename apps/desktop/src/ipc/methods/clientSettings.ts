import { ClientSettingsSchema } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as DesktopClientSettings from "../../settings/DesktopClientSettings.ts";
import * as DesktopQuickMessage from "../../quickMessage/DesktopQuickMessage.ts";
import { sendToQuickMessagePanel } from "../../quickMessage/sendToQuickMessagePanel.ts";
import * as DesktopSnapShot from "../../snapShot/DesktopSnapShot.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import { ensureMainSender } from "../mainAuthority.ts";

export const getClientSettings = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.GET_CLIENT_SETTINGS_CHANNEL,
  payload: Schema.Void,
  result: Schema.NullOr(ClientSettingsSchema),
  handler: Effect.fn("desktop.ipc.clientSettings.get")(function* () {
    const clientSettings = yield* DesktopClientSettings.DesktopClientSettings;
    return Option.getOrNull(yield* clientSettings.get);
  }),
});

export const setClientSettings = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.SET_CLIENT_SETTINGS_CHANNEL,
  payload: ClientSettingsSchema,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.clientSettings.set")(function* (settings, event) {
    // The panel shares this file. Its in-memory copy is older than a main-window edit.
    yield* ensureMainSender(event, "set-client-settings");
    const clientSettings = yield* DesktopClientSettings.DesktopClientSettings;
    const snapShot = yield* DesktopSnapShot.DesktopSnapShot;
    yield* clientSettings.set(settings);
    yield* sendToQuickMessagePanel(IpcChannels.CLIENT_SETTINGS_EVENT_CHANNEL, settings);
    yield* snapShot.configure(settings);
    yield* (yield* DesktopQuickMessage.DesktopQuickMessage).configure(settings);
  }),
});
