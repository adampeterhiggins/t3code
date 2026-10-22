import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { threadLinkWatchFor } from "@t3tools/client-runtime/state/threadLinkWatches";
import type { EnvironmentId, ThreadId, ThreadLinkKind } from "@t3tools/contracts";
import { Alert } from "react-native";

import { SymbolView } from "../../components/ui/AppSymbol";
import { useEnvironmentQuery } from "../../state/query";
import { threadLinkWatchEnvironment } from "../../state/threadLinkWatches";
import { useAtomCommand } from "../../state/use-atom-command";

const WATCH_ACTION = "link:watch";

/**
 * Whether the thread's agent is woken when its link of `kind` changes, with the chip menu item
 * that starts or stops it. Servers without link watches offer no item.
 */
export function useThreadLinkWatch(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly kind: ThreadLinkKind;
  readonly url: string;
}) {
  const { environmentId, threadId, kind } = input;
  const watches = useEnvironmentQuery(
    threadLinkWatchEnvironment.watches({ environmentId, input: {} }),
  ).data;
  const canWatch = useAtomValue(
    threadLinkWatchEnvironment.setWatching.permissionAtom(environmentId),
  );
  const setWatching = useAtomCommand(threadLinkWatchEnvironment.setWatching, {
    label: "thread link watch",
    reportFailure: false,
  });
  const watch = threadLinkWatchFor(watches, threadId, kind);
  // A watch of a link the chip no longer shows ends on the server's next read.
  const watching = watch !== null && watch.url === input.url;

  const toggle = async () => {
    const result = await setWatching({
      environmentId,
      input: { threadId, kind, watching: !watching },
    });
    if (result._tag !== "Failure") return;
    const error = squashAtomCommandFailure(result);
    Alert.alert(
      watching ? "Could not stop watching" : "Could not watch for changes",
      error instanceof Error && error.message.trim() ? error.message : "Try again.",
    );
  };

  return {
    watching,
    menuActions:
      watches != null && canWatch
        ? [
            {
              id: WATCH_ACTION,
              title: watching ? "Stop watching" : "Watch for changes",
              image: watching ? "eye.slash" : "eye",
            },
          ]
        : [],
    /** Handles the watch item; false for any other menu item. */
    handleMenuAction: (id: string) => {
      if (id !== WATCH_ACTION) return false;
      void toggle();
      return true;
    },
  };
}

/** Marks a chip whose link the agent is woken by. */
export function ThreadLinkWatchingMark() {
  return (
    <SymbolView
      name="eye"
      size={13}
      tintColorClassName="accent-icon-subtle"
      type="monochrome"
      accessibilityElementsHidden
    />
  );
}
