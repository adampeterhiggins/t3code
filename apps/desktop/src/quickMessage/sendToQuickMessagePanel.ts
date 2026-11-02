import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Electron from "electron";

import * as DesktopQuickMessage from "./DesktopQuickMessage.ts";

class QuickMessagePanelDeliveryError extends Schema.TaggedError<QuickMessagePanelDeliveryError>()(
  "QuickMessagePanelDeliveryError",
  {
    operation: Schema.Literals(["list-windows", "send"]),
    channel: Schema.String,
    cause: Schema.Defect(),
  },
) {}

/**
 * Delivers to the live quick-message panel only. `DesktopQuickMessage` owns
 * that window and does not depend on appearance or client-settings writes.
 */
export const sendToQuickMessagePanel = Effect.fn("desktop.quickMessage.sendToPanel")(function* (
  channel: string,
  payload: unknown,
) {
  const quickMessage = yield* DesktopQuickMessage.DesktopQuickMessage;
  const windows = yield* Effect.try({
    try: () => Electron.BrowserWindow.getAllWindows(),
    catch: (cause) =>
      new QuickMessagePanelDeliveryError({ operation: "list-windows", channel, cause }),
  }).pipe(
    Effect.tapError((error) =>
      Effect.logWarning(
        "Could not list windows for a quick message panel event.",
        error.cause,
      ).pipe(Effect.annotateLogs({ channel })),
    ),
    Effect.orElseSucceed(() => [] as ReadonlyArray<Electron.BrowserWindow>),
  );

  for (const window of windows) {
    if (window.isDestroyed() || window.webContents.isDestroyed()) continue;
    if (!(yield* quickMessage.isPanel(window.webContents.id))) continue;
    yield* Effect.try({
      try: () => {
        window.webContents.send(channel, payload);
      },
      catch: (cause) => new QuickMessagePanelDeliveryError({ operation: "send", channel, cause }),
    }).pipe(
      Effect.catch((error) =>
        Effect.logWarning(
          "Could not deliver a desktop event to the quick message panel.",
          error.cause,
        ).pipe(Effect.annotateLogs({ channel })),
      ),
    );
  }
});
