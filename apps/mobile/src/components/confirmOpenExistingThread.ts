import { msg } from "gt-react-native";
import { Alert } from "react-native";

import { m } from "../i18n/messages";

/**
 * Asks whether to open a thread already working on `subject` (newest first) or start another
 * one. Resolves to "start" right away when there are none.
 */
export function confirmOpenExistingThread<T extends { readonly title: string }>(
  subject: string,
  threads: ReadonlyArray<T>,
): Promise<T | "start" | "cancel"> {
  const newest = threads[0];
  if (newest === undefined) return Promise.resolve("start");
  return new Promise((resolve) => {
    Alert.alert(
      m(msg("{subject} already has a thread", { subject })),
      m(
        msg(
          "{others, plural, =0 {“{title}” is already working on it.} other {“{title}” and {others} more are already working on it.}} Open it, or start a second thread?",
          { title: newest.title, others: threads.length - 1 },
        ),
      ),
      [
        { text: m(msg("Cancel")), style: "cancel", onPress: () => resolve("cancel") },
        { text: m(msg("Start new thread")), onPress: () => resolve("start") },
        { text: m(msg("Open thread")), style: "default", onPress: () => resolve(newest) },
      ],
      { cancelable: true, onDismiss: () => resolve("cancel") },
    );
  });
}
