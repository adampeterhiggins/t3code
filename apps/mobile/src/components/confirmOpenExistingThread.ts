import { Alert } from "react-native";

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
  const others = threads.length > 1 ? ` and ${threads.length - 1} more are` : " is";
  return new Promise((resolve) => {
    Alert.alert(
      `${subject} already has a thread`,
      `“${newest.title}”${others} already working on it. Open it, or start a second thread?`,
      [
        { text: "Cancel", style: "cancel", onPress: () => resolve("cancel") },
        { text: "Start new thread", onPress: () => resolve("start") },
        { text: "Open thread", style: "default", onPress: () => resolve(newest) },
      ],
      { cancelable: true, onDismiss: () => resolve("cancel") },
    );
  });
}
