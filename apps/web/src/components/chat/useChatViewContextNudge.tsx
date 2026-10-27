import type { ContextWindowSnapshot } from "../../lib/contextWindow";
import {
  isContextWindowNearlyFull,
  shouldRearmContextWindowNudge,
} from "@t3tools/client-runtime/thread-usage";
import { Button } from "../ui/button";
import { GaugeIcon } from "lucide-react";
import * as Schema from "effect/Schema";
import { useEffect, useRef } from "react";
import type { ComposerBannerStackItem } from "./ComposerBannerStack";
import { useLocalStorage } from "~/hooks/useLocalStorage";

export function useChatViewContextNudge(input: {
  routeThreadKey: string;
  activeContextWindow: ContextWindowSnapshot | null;
  canOperateThread: boolean;
  isServerThread: boolean;
  isCompacting: boolean;
  manualCompactionProviderAvailable: boolean;
  compactDisabled: boolean;
  hasThreadTabs: boolean;
}) {
  const {
    routeThreadKey,
    activeContextWindow,
    canOperateThread,
    isServerThread,
    isCompacting,
    manualCompactionProviderAvailable,
    compactDisabled,
    hasThreadTabs,
  } = input;
  // Near a full window, suggest compacting or carrying a summary into a new tab. Dismissal is
  // per thread and lasts until the provider reports the window back under the threshold.
  const [contextNudgeDismissed, setContextNudgeDismissed] = useLocalStorage(
    `t3code:context-nudge-dismissed:${routeThreadKey}`,
    false,
    Schema.Boolean,
  );
  useEffect(() => {
    if (contextNudgeDismissed && shouldRearmContextWindowNudge(activeContextWindow)) {
      setContextNudgeDismissed(false);
    }
  }, [activeContextWindow, contextNudgeDismissed, setContextNudgeDismissed]);
  const contextNudgeActionsRef = useRef({ compact: () => {}, continueInNewTab: () => {} });
  const contextNudgePercent =
    canOperateThread &&
    isServerThread &&
    !contextNudgeDismissed &&
    !isCompacting &&
    isContextWindowNearlyFull(activeContextWindow)
      ? Math.round(activeContextWindow?.usedPercentage ?? 0)
      : null;
  const contextNudgeCanCompact = manualCompactionProviderAvailable;
  const contextNudgeCompactDisabled = compactDisabled;
  const contextNudgeCanContinue = hasThreadTabs;
  const contextNudgeBannerItem = (() => {
    if (contextNudgePercent === null) return null;
    return {
      id: "context-window-nudge",
      variant: "info",
      compact: true,
      icon: <GaugeIcon />,
      title: `Context ${contextNudgePercent}% full`,
      actions:
        contextNudgeCanCompact || contextNudgeCanContinue ? (
          <>
            {contextNudgeCanCompact ? (
              <Button
                size="xs"
                variant="ghost"
                disabled={contextNudgeCompactDisabled}
                onClick={() => contextNudgeActionsRef.current.compact()}
              >
                Compact
              </Button>
            ) : null}
            {contextNudgeCanContinue ? (
              <Button
                size="xs"
                variant="ghost"
                onClick={() => contextNudgeActionsRef.current.continueInNewTab()}
              >
                Continue in new tab
              </Button>
            ) : null}
          </>
        ) : null,
      dismissLabel: "Dismiss context notice",
      onDismiss: () => setContextNudgeDismissed(true),
    };
  })() as ComposerBannerStackItem | null;
  return { contextNudgeBannerItem, contextNudgeActionsRef };
}
