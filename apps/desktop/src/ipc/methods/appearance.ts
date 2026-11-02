import { DesktopAppearanceSnapshot } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as DesktopAppearance from "../../appearance/DesktopAppearance.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import { ensureAppearanceReader, ensureMainSender } from "../mainAuthority.ts";

export const getAppearanceSnapshot = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.GET_APPEARANCE_SNAPSHOT_CHANNEL,
  payload: Schema.Void,
  result: Schema.NullOr(DesktopAppearanceSnapshot),
  handler: Effect.fn("desktop.ipc.appearance.get")(function* (_input, event) {
    yield* ensureAppearanceReader(event);
    return yield* (yield* DesktopAppearance.DesktopAppearance).get;
  }),
});

export const publishAppearanceSnapshot = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.PUBLISH_APPEARANCE_SNAPSHOT_CHANNEL,
  payload: DesktopAppearanceSnapshot,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.appearance.publish")(function* (snapshot, event) {
    yield* ensureMainSender(event, "publish-appearance");
    yield* (yield* DesktopAppearance.DesktopAppearance).publish(snapshot);
  }),
});
