import type { SidebarTabSortOrder } from "@t3tools/contracts";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";

import { cn } from "~/lib/utils";
import { shouldShowInstanceBadge, type ProviderInstanceEntry } from "../../providerInstances";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import type { SidebarThreadSummary } from "../../types";
import { useUiStateStore } from "../../uiStateStore";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import {
  hasUnseenCompletion,
  resolveSidebarThreadStatus,
  resolveThreadLastVisitedAt,
  shouldRecedeSidebarThread,
  sidebarTabSortTimestamp,
} from "../Sidebar.logic";
import { resolveSidebarTopStatus, SidebarTopStatusIcon } from "./SidebarTopStatus";

export function compactSidebarTimeLabel(label: string): string {
  if (label === "just now") return "now";
  return label.endsWith(" ago") ? label.slice(0, -4) : label;
}

export function threadTimeLabel(thread: SidebarThreadSummary): string {
  const timestamp = thread.latestUserMessageAt ?? thread.updatedAt;
  return compactSidebarTimeLabel(formatRelativeTimeLabel(timestamp));
}

/** A tab's label under a timed sort reads the time it sorted by; manual keeps the default. */
export function tabSortTimeLabel(
  thread: SidebarThreadSummary,
  order: SidebarTabSortOrder,
  openedAt: number | undefined,
): string | undefined {
  if (order === "manual") return undefined;
  const ms = sidebarTabSortTimestamp(thread, order, openedAt);
  return ms === null
    ? ""
    : compactSidebarTimeLabel(formatRelativeTimeLabel(new Date(ms).toISOString()));
}

/**
 * A tab's title, status, time, and provider as its sidebar row shows them, laid out inline for a
 * flex parent. `compact` fits a pill: status shows only its icon and colors stay the parent's.
 */
export function SidebarTabSummary(props: {
  thread: SidebarThreadSummary;
  providerEntries: ReadonlyMap<string, ProviderInstanceEntry> | undefined;
  tabSortOrder: SidebarTabSortOrder;
  openedAt: number | undefined;
  compact?: boolean;
}) {
  const { thread, providerEntries, compact = false } = props;
  const localLastVisitedAt = useUiStateStore(
    (state) =>
      state.threadLastVisitedAtById[
        scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))
      ],
  );
  const instanceId = thread.runtime?.providerInstanceId ?? thread.modelSelection.instanceId;
  const providerEntry = providerEntries?.get(instanceId) ?? null;
  const showInstanceBadge =
    providerEntry !== null &&
    providerEntries !== undefined &&
    shouldShowInstanceBadge(providerEntry, providerEntries.values());
  const isUnread = hasUnseenCompletion({
    ...thread,
    lastVisitedAt: resolveThreadLastVisitedAt(thread.lastVisitedAt, localLastVisitedAt),
  });
  const status = resolveSidebarThreadStatus(thread);
  const topStatus = resolveSidebarTopStatus(status, false, isUnread);
  const shouldRecede = shouldRecedeSidebarThread({
    status,
    isUnread,
    isWoke: false,
    isActive: false,
    isSelected: false,
  });
  const timeLabel =
    tabSortTimeLabel(thread, props.tabSortOrder, props.openedAt) ?? threadTimeLabel(thread);
  return (
    <>
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-left",
          !compact &&
            cn(
              "text-sm",
              shouldRecede
                ? "text-secondary-label"
                : isUnread || status === "input"
                  ? "text-foreground"
                  : "text-foreground/85",
            ),
        )}
      >
        {thread.title}
      </span>
      {topStatus && !(compact && topStatus.icon === null) ? (
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1 text-xs font-medium",
            topStatus.className,
          )}
        >
          <SidebarTopStatusIcon
            icon={topStatus.icon}
            className={cn("shrink-0", compact ? "size-3" : "size-3.5")}
          />
          {compact ? (
            <span className="sr-only">{topStatus.label}</span>
          ) : (
            <span>{topStatus.label}</span>
          )}
        </span>
      ) : null}
      <span className="shrink-0 text-xs tabular-nums text-secondary-label">{timeLabel}</span>
      {providerEntry ? (
        <span aria-hidden className="inline-flex shrink-0 items-center">
          <ProviderInstanceIcon
            driverKind={providerEntry.driverKind}
            displayName={providerEntry.displayName}
            accentColor={providerEntry.accentColor}
            showBadge={showInstanceBadge}
            iconClassName={compact ? "size-3 opacity-60" : "size-3.5 opacity-60"}
            badgeClassName="right-[-0.1875rem] bottom-[-0.1875rem] h-3 min-w-3 px-0.5 text-5xs"
          />
        </span>
      ) : null}
    </>
  );
}
