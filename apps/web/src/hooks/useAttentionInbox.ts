import {
  buildAttentionInbox,
  type AttentionInboxEntry,
} from "@t3tools/client-runtime/state/attention-inbox";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { useMemo } from "react";

import { useThreadShells } from "../state/entities";
import { useUiStateStore } from "../uiStateStore";
import { useNowMinute } from "./useNowMinute";

export type WebAttentionInboxEntry = AttentionInboxEntry<EnvironmentThreadShell>;

/**
 * Threads across every environment, project and tab group that need the user,
 * derived from the thread shells and this client's read markers. The minute
 * tick lets snoozes that expire bring their threads back.
 */
export function useAttentionInbox(): ReadonlyArray<WebAttentionInboxEntry> {
  const threads = useThreadShells();
  const lastVisitedAtByKey = useUiStateStore((state) => state.threadLastVisitedAtById);
  const now = useNowMinute();
  return useMemo(
    () => buildAttentionInbox(threads, { lastVisitedAtByKey, now }),
    [lastVisitedAtByKey, now, threads],
  );
}
