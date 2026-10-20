import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  latestThreadPreviewItems,
  type ThreadPreviewItem,
} from "@t3tools/client-runtime/work-log/tool-preview";
import type { ThreadContextRecord, ThreadId } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import {
  ArrowRightLeftIcon,
  BotIcon,
  CircleAlertIcon,
  GitBranchIcon,
  TerminalIcon,
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { useComposerDraftActiveModelSelection } from "~/composerDraftStore";
import { useSupportsMultiplePullRequests } from "~/hooks/useSupportsMultiplePullRequests";
import { cn } from "~/lib/utils";
import { shouldShowInstanceBadge } from "~/providerInstances";
import { useProject, useThreadProjection, useThreadShell } from "~/state/entities";
import { useEnvironmentIdentities, useEnvironmentMachines } from "~/state/environments";
import {
  providerEntriesByEnvironmentAtom,
  type ProviderEntrySummary,
} from "~/state/providerEntries";
import { useEnvironmentQuery } from "~/state/query";
import { useThreadRunningTerminalIds } from "~/state/terminalSessions";
import { vcsEnvironment } from "~/state/vcs";
import { resolveCheckoutBranchMismatch } from "./BranchToolbar.logic";
import { EnvironmentMachineIcon } from "./EnvironmentMachineIcon";
import { PreviewCornerAction } from "./chat/PreviewCornerAction";
import { ProviderInstanceIcon } from "./chat/ProviderInstanceIcon";
import { getTriggerDisplayModelLabel } from "./chat/providerIconUtils";
import { StartedByHoverLine } from "./chat/StartedByChip";
import { ProjectFavicon } from "./ProjectFavicon";
import { ThreadPullRequestsMiniList, terminalStatusFromRunningIds } from "./ThreadStatusIndicators";
import { MiddleTruncate } from "./ui/middle-truncate";
import { TooltipPopup } from "./ui/tooltip";

/*
 * The one hover preview of a thread. It is the context presentation registry's `thread` body,
 * so chips, thread links, sidebar rows and an agent's read of a thread all show this.
 */

export function ThreadHoverCardPopup({ className, ...props }: ComponentProps<typeof TooltipPopup>) {
  return (
    <TooltipPopup
      {...props}
      variant="glass"
      className={cn("max-w-80 text-left whitespace-normal", className)}
    />
  );
}

/** What an agent's read of the thread returned, shown in place of its live latest messages. */
export interface ThreadReadSnapshot {
  title: string;
  status: string | null;
  model: string | null;
  branch: string | null;
  items: ReadonlyArray<ThreadPreviewItem>;
  /** Items the read returned beyond `items`. */
  moreItems: number;
}

export interface ThreadPreviewProps {
  record: Pick<ThreadContextRecord, "environmentId" | "threadId" | "title">;
  /** On another machine than the one the message is for, so its agent can't read it. */
  unreadable?: boolean | undefined;
  read?: ThreadReadSnapshot | undefined;
  /** For surfaces where the trigger doesn't already open the thread. */
  onOpenThread?: ((threadId: ThreadId) => void) | undefined;
}

/**
 * Mounted only while open: metadata draws from the shell the client already holds, and the
 * latest messages arrive once the thread's detail loads.
 */
export function ThreadPreview(props: ThreadPreviewProps) {
  const { environmentId, threadId } = props.record;
  const shell = useThreadShell(scopeThreadRef(environmentId, threadId));
  if (props.unreadable) {
    return (
      <p className="px-1 py-2 text-xs">
        On another machine, so this machine's agent can't read it. Remove it or switch back to send.
      </p>
    );
  }
  if (shell) return <LiveThreadPreview {...props} shell={shell} />;
  if (props.read) return <ReadThreadPreview {...props} read={props.read} />;
  return <p className="px-1 py-2 text-xs">Thread no longer available</p>;
}

function ThreadPreviewLayout(props: {
  title: string;
  status: string | null;
  onOpen: (() => void) | null;
  children: ReactNode;
  items: ReadonlyArray<ThreadPreviewItem>;
  moreItems: number;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 max-w-80 flex-col gap-2 px-1 py-2 text-xs">
      <div className="flex min-w-0 items-start gap-2">
        <span className="line-clamp-2 min-w-0 flex-1 leading-tight font-medium break-words text-foreground">
          {props.title}
        </span>
        {props.status ? (
          <span className="shrink-0 text-muted-foreground capitalize">
            {props.status.replaceAll("_", " ")}
          </span>
        ) : null}
        {props.onOpen ? (
          <PreviewCornerAction onClick={props.onOpen}>Open thread</PreviewCornerAction>
        ) : null}
      </div>
      <div className="grid gap-1.5 pl-0.5 text-muted-foreground">{props.children}</div>
      {props.items.length > 0 ? (
        <div className="space-y-1 border-t border-border/60 pt-2">
          {props.moreItems > 0 ? (
            <p className="text-muted-foreground">+{props.moreItems} earlier</p>
          ) : null}
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1">
            {props.items.map((item) => (
              <div key={item.key} className="contents">
                <dt className="text-muted-foreground">{item.label}</dt>
                <dd
                  className={
                    item.activity
                      ? "truncate text-foreground/70"
                      : "line-clamp-3 break-words whitespace-pre-wrap text-foreground/85"
                  }
                >
                  {item.text}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
      {props.footer}
    </div>
  );
}

function PreviewLine(props: { icon: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 items-center gap-2", props.className)}>
      {props.icon}
      <div className="min-w-0 truncate text-foreground/75">{props.children}</div>
    </div>
  );
}

const EMPTY_PROVIDER_ENTRIES: ReadonlyMap<string, ProviderEntrySummary> = new Map();

function LiveThreadPreview(props: ThreadPreviewProps & { shell: EnvironmentThreadShell }) {
  const { shell: thread, read, onOpenThread } = props;
  const threadRef = scopeThreadRef(thread.environmentId, thread.id);
  const project = useProject(scopeProjectRef(thread.environmentId, thread.projectId));
  const environmentLabel =
    useEnvironmentIdentities().find((env) => env.environmentId === thread.environmentId)?.label ??
    null;
  const environmentMachine = useEnvironmentMachines().get(thread.environmentId) ?? "server";
  const providerEntries =
    useAtomValue(providerEntriesByEnvironmentAtom).get(thread.environmentId) ??
    EMPTY_PROVIDER_ENTRIES;
  const supportsMultiplePullRequests = useSupportsMultiplePullRequests(thread.environmentId);
  const runningTerminalIds = useThreadRunningTerminalIds({
    environmentId: thread.environmentId,
    threadId: thread.id,
  });
  const terminalStatus = terminalStatusFromRunningIds(runningTerminalIds);
  // An unsent composer pick wins, so the preview follows the composer before the next turn.
  const draftModelSelection = useComposerDraftActiveModelSelection(threadRef);
  const gitCwd = thread.worktreePath ?? project?.workspaceRoot ?? null;
  const gitStatus = useEnvironmentQuery(
    thread.branch !== null && gitCwd !== null
      ? vcsEnvironment.status({
          environmentId: thread.environmentId,
          input: { cwd: gitCwd, includeRemote: false },
        })
      : null,
  );
  // A read already carries the messages it saw; only a live preview loads the thread.
  const detail = useThreadProjection(read ? null : threadRef);

  const modelSelection = draftModelSelection ?? thread.modelSelection;
  const modelInstanceId =
    draftModelSelection?.instanceId ??
    thread.runtime?.providerInstanceId ??
    thread.modelSelection.instanceId;
  const providerEntry = providerEntries.get(modelInstanceId) ?? null;
  const showInstanceBadge =
    providerEntry !== null && shouldShowInstanceBadge(providerEntry, providerEntries.values());
  const selectedModel = providerEntry?.models.find((model) => model.slug === modelSelection.model);
  const modelLabel = selectedModel
    ? getTriggerDisplayModelLabel(selectedModel)
    : modelSelection.model;
  const previousProviderNames = thread.providerInstanceHistory
    .filter((instanceId) => instanceId !== modelInstanceId)
    .map((instanceId) => providerEntries.get(instanceId)?.displayName ?? instanceId);
  const branchMismatch = resolveCheckoutBranchMismatch({
    effectiveEnvMode: thread.worktreePath === null ? "local" : "worktree",
    activeWorktreePath: thread.worktreePath,
    activeThreadBranch: thread.branch,
    currentGitBranch: gitStatus.data?.refName ?? null,
  });
  const items = read?.items ?? latestThreadPreviewItems(detail?.projection.messages ?? []);

  return (
    <ThreadPreviewLayout
      title={thread.title.trim() || props.record.title}
      status={thread.source.status}
      onOpen={onOpenThread ? () => onOpenThread(thread.id) : null}
      items={items}
      moreItems={read?.moreItems ?? 0}
      footer={
        supportsMultiplePullRequests && thread.pullRequests.length > 0 ? (
          <div className="border-t border-border/60 pt-2 pl-0.5 text-muted-foreground">
            <ThreadPullRequestsMiniList pullRequests={thread.pullRequests} />
          </div>
        ) : null
      }
    >
      {project ? (
        <PreviewLine icon={<ProjectFavicon project={project} className="size-3 shrink-0" />}>
          {project.title}
        </PreviewLine>
      ) : null}
      {environmentLabel ? (
        <PreviewLine
          icon={
            <EnvironmentMachineIcon
              kind={environmentMachine}
              className="size-3 shrink-0 stroke-muted-foreground"
            />
          }
        >
          {environmentLabel}
        </PreviewLine>
      ) : null}
      {thread.branch ? (
        <div className="flex min-w-0 items-center gap-2">
          <GitBranchIcon className="size-3 shrink-0 stroke-muted-foreground" />
          <MiddleTruncate value={thread.branch} className="flex" />
        </div>
      ) : null}
      {branchMismatch ? (
        <div className="flex min-w-0 items-start gap-2 text-warning">
          <CircleAlertIcon aria-hidden className="mt-0.5 size-3 shrink-0 stroke-current" />
          <div className="min-w-0 flex-1 wrap-break-word">
            You're currently checked out on another branch.
          </div>
        </div>
      ) : null}
      <PreviewLine
        icon={
          providerEntry ? (
            <ProviderInstanceIcon
              driverKind={providerEntry.driverKind}
              displayName={providerEntry.displayName}
              accentColor={providerEntry.accentColor}
              acpRegistryAgentId={providerEntry.acpRegistryAgentId}
              acpRegistryIconUrl={providerEntry.acpRegistryIconUrl}
              showBadge={showInstanceBadge && providerEntry.accentColor !== undefined}
              badgeContent="none"
              badgeClassName="h-2 min-w-2 px-0"
              iconClassName="size-3 shrink-0 grayscale opacity-60"
            />
          ) : (
            <BotIcon aria-hidden className="size-3 shrink-0 stroke-muted-foreground" />
          )
        }
      >
        {showInstanceBadge && providerEntry
          ? `${modelLabel} · ${providerEntry.displayName}`
          : modelLabel}
      </PreviewLine>
      {previousProviderNames.length > 0 ? (
        <PreviewLine
          icon={<ArrowRightLeftIcon className="size-3 shrink-0 stroke-muted-foreground" />}
        >
          Handed off from {previousProviderNames.join(", ")}
        </PreviewLine>
      ) : null}
      {thread.startedBy !== null ? <StartedByHoverLine thread={thread} /> : null}
      {terminalStatus ? (
        <PreviewLine
          icon={
            <TerminalIcon
              aria-hidden
              className={cn("size-3 shrink-0", terminalStatus.colorClass)}
            />
          }
        >
          {runningTerminalIds.length} terminal{" "}
          {runningTerminalIds.length === 1 ? "process" : "processes"} running
        </PreviewLine>
      ) : null}
      {thread.runtime?.lastError ? (
        <div
          className={cn(
            "flex min-w-0 items-center gap-2",
            thread.runtime.lastErrorClass === "usage_limit" ? "text-warning" : "text-error",
          )}
        >
          <CircleAlertIcon className="size-3 shrink-0 stroke-current" />
          <div className="min-w-0 truncate">
            {thread.runtime.lastErrorClass === "usage_limit"
              ? "Usage limit reached"
              : "Error occurred"}
          </div>
        </div>
      ) : null}
    </ThreadPreviewLayout>
  );
}

/** A thread this client doesn't hold, such as one on another machine: what the read saw. */
function ReadThreadPreview(props: ThreadPreviewProps & { read: ThreadReadSnapshot }) {
  const { read, onOpenThread } = props;
  return (
    <ThreadPreviewLayout
      title={read.title}
      status={read.status}
      onOpen={onOpenThread ? () => onOpenThread(props.record.threadId) : null}
      items={read.items}
      moreItems={read.moreItems}
    >
      {read.model ? (
        <PreviewLine icon={<BotIcon aria-hidden className="size-3 shrink-0" />}>
          {read.model}
        </PreviewLine>
      ) : null}
      {read.branch ? (
        <PreviewLine icon={<GitBranchIcon aria-hidden className="size-3 shrink-0" />}>
          {read.branch}
        </PreviewLine>
      ) : null}
    </ThreadPreviewLayout>
  );
}
