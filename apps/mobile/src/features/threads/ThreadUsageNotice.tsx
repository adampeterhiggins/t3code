import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import {
  deriveThreadUsageSummary,
  latestProviderContextUsage,
  formatReportedThreadCost,
  isContextWindowNearlyFull,
  shouldRearmContextWindowNudge,
} from "@t3tools/client-runtime/thread-usage";
import { AppText as Text } from "../../components/AppText";
import { useThreadProjection } from "../../state/use-thread-detail";

/** Provider reports only: processed tokens are separate from context occupancy. */
export function ThreadUsageNotice(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly canCompact: boolean;
  readonly canOperate: boolean;
  readonly compacting: boolean;
  readonly onInsertCompact: () => void;
}) {
  const detail = useThreadProjection(props);
  const threads = detail?.projection.providerThreads;
  const turns = detail?.projection.providerTurns;
  const subagents = detail?.projection.subagents;
  const usage = useMemo(
    () =>
      threads && turns && subagents
        ? deriveThreadUsageSummary({ providerThreads: threads, providerTurns: turns, subagents })
        : null,
    [threads, turns, subagents],
  );
  const activeId = detail?.projection.thread.activeProviderThreadId;
  const active = threads?.find((thread) => thread.id === activeId);
  const live = useMemo(() => latestProviderContextUsage(turns ?? [], activeId), [turns, activeId]);
  const reading = live ?? active?.contextUsage;
  const usedTokens = reading?.usedTokens ?? 0;
  const maxTokens = reading?.maxTokens ?? null;
  const percent = maxTokens !== null && maxTokens > 0 ? (100 * usedTokens) / maxTokens : null;
  const [dismissedThread, setDismissedThread] = useState<string | null>(null);
  const dismissed = dismissedThread === props.threadId;
  if (
    dismissed &&
    shouldRearmContextWindowNudge({ usedTokens, maxTokens, usedPercentage: percent })
  ) {
    setDismissedThread(null);
  }
  const nearFull =
    props.canOperate &&
    !props.compacting &&
    !dismissed &&
    isContextWindowNearlyFull({ maxTokens, usedPercentage: percent });
  if (
    !usage ||
    (usage.mainTokens === null &&
      usage.subagentTokens === null &&
      usage.costs.length === 0 &&
      !nearFull)
  )
    return null;
  return (
    <View className="gap-2 px-4 pb-2">
      <Text className="text-xs text-foreground-muted" accessibilityLabel="Reported thread usage">
        {usage.mainTokens !== null
          ? `Thread tokens ${usage.mainTokens.toLocaleString()}${usage.mainPartial ? "+" : ""}`
          : ""}
        {usage.subagentTokens !== null
          ? ` · Subagents ${usage.subagentTokens.toLocaleString()}`
          : ""}
        {usage.costs.length > 0 ? ` · Reported cost ${formatReportedThreadCost(usage.costs)}` : ""}
      </Text>
      {nearFull ? (
        <View className="flex-row items-center gap-3 rounded-2xl bg-card p-3">
          <Text className="min-w-0 flex-1 text-xs text-foreground" accessibilityLiveRegion="polite">
            Context {Math.round(percent ?? 0)}% full
          </Text>
          {props.canCompact ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Insert compact command"
              onPress={props.onInsertCompact}
              hitSlop={8}
            >
              <Text className="text-xs text-accent">Use /compact</Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss context notice"
            onPress={() => setDismissedThread(props.threadId)}
            hitSlop={8}
          >
            <Text className="text-xs text-foreground-muted">Dismiss</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
