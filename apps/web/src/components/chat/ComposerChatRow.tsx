import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { MessagesSquareIcon } from "lucide-react";
import { useMemo } from "react";

import { deriveProviderInstanceEntries, shouldShowInstanceBadge } from "~/providerInstances";
import { useProject, useServerConfigs, useThreadShell } from "~/state/entities";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { useUiStateStore } from "~/uiStateStore";
import { ProjectFavicon } from "../ProjectFavicon";
import { hasUnseenCompletion, resolveSidebarThreadStatus } from "../Sidebar.logic";
import { resolveSidebarTopStatus, SidebarTopStatusIcon } from "../sidebar/SidebarTopStatus";
import { Badge } from "../ui/badge";
import { getTriggerDisplayModelLabel } from "./providerIconUtils";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";

/**
 * A row in the `@` menu's Chats tab: the title over its project and branch, then fixed-width
 * model, status, and last-activity columns so they line up down the list.
 */
export function ComposerChatRow(props: {
  threadRef: ScopedThreadRef;
  label: string;
  /** Set for this chat's own tabs, which get a chip beside the title. */
  isTab: boolean;
}) {
  const thread = useThreadShell(props.threadRef);
  const project = useProject(
    thread ? { environmentId: thread.environmentId, projectId: thread.projectId } : null,
  );
  const serverConfig = useServerConfigs().get(props.threadRef.environmentId);
  const providerEntries = useMemo(
    () => deriveProviderInstanceEntries(serverConfig?.providers ?? []),
    [serverConfig],
  );
  const instanceId = thread
    ? (thread.runtime?.providerInstanceId ?? thread.modelSelection.instanceId)
    : null;
  const providerEntry = providerEntries.find((entry) => entry.instanceId === instanceId);
  const model = thread
    ? providerEntry?.models.find((candidate) => candidate.slug === thread.modelSelection.model)
    : undefined;
  const modelLabel = model ? getTriggerDisplayModelLabel(model) : thread?.modelSelection.model;
  const lastVisitedAt = useUiStateStore(
    (state) => state.threadLastVisitedAtById[scopedThreadKey(props.threadRef)],
  );
  const status = thread
    ? resolveSidebarTopStatus(
        resolveSidebarThreadStatus(thread),
        false,
        hasUnseenCompletion({ ...thread, lastVisitedAt }),
      )
    : null;
  const location = [project?.title, thread?.branch].filter(Boolean).join(" · ");

  return (
    <span className="flex min-w-0 flex-1 items-center gap-2 text-xs">
      {project ? (
        <ProjectFavicon project={project} className="size-4 shrink-0" />
      ) : (
        <MessagesSquareIcon aria-hidden="true" className="size-4 shrink-0 text-secondary-label" />
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 truncate font-medium font-sans">{props.label}</span>
          {props.isTab ? (
            <Badge size="sm" variant="secondary">
              Tab
            </Badge>
          ) : null}
        </span>
        {location ? (
          <span className="min-w-0 truncate text-2xs text-secondary-label">{location}</span>
        ) : null}
      </span>
      <span className="flex w-32 shrink-0 items-center gap-1.5 text-secondary-label">
        {providerEntry ? (
          <ProviderInstanceIcon
            driverKind={providerEntry.driverKind}
            displayName={providerEntry.displayName}
            accentColor={providerEntry.accentColor}
            showBadge={shouldShowInstanceBadge(providerEntry, providerEntries)}
            iconClassName="size-3.5 opacity-60"
            badgeClassName="right-[-0.1875rem] bottom-[-0.1875rem] h-3 min-w-3 px-0.5 text-5xs"
          />
        ) : null}
        <span className="min-w-0 truncate">{modelLabel}</span>
      </span>
      <span className="w-24 shrink-0 truncate">
        {status ? (
          <span className={`inline-flex items-center gap-1 font-medium ${status.className}`}>
            <SidebarTopStatusIcon icon={status.icon} className="size-3.5 shrink-0" />
            {status.label}
          </span>
        ) : null}
      </span>
      <span className="w-16 shrink-0 text-end text-secondary-label tabular-nums">
        {thread ? formatRelativeTimeLabel(thread.latestUserMessageAt ?? thread.updatedAt) : null}
      </span>
    </span>
  );
}
