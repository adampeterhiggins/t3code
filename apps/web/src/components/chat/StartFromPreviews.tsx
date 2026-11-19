import { automationRunBlocker } from "@t3tools/client-runtime/scheduled-task-picker";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type {
  OrchestrationV2ThreadLaunchWorkspaceStrategy,
  ScheduledTask,
  ScopedThreadRef,
  VcsRef,
} from "@t3tools/contracts";
import { msg, T, useGT, useMessages, Var } from "gt-react";
import { GitBranchIcon } from "lucide-react";
import type { ReactElement } from "react";

import { useLinkClickHandler } from "~/browser/useOpenLink";
import { m, type MessageResolver } from "~/i18n/messages";
import { pullRequestEnvironment } from "~/state/pullRequests";
import { useEnvironmentQuery } from "~/state/query";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import type { EnvironmentPullRequestEntry } from "../pullRequest/pullRequestList.logic";
import { PullRequestMarkdown } from "../pullRequest/PullRequestMarkdown";
import { ScheduledRelativeLabel } from "../settings/ScheduledTasksSettings";
import { scheduleLabel } from "../settings/scheduledTasksSettings.logic";
import {
  PullRequestActorAvatar,
  PullRequestDiffStat,
  resolvePullRequestState,
} from "../pullRequest/pullRequestPresentation";
import { CursorPreviewCard } from "./CursorPreviewCard";
import { localBranchName } from "./StartFromPicker.logic";

const LISTED_THREADS = 3;

/**
 * Threads already working on the hovered row, which the picker would offer to open instead. With
 * `onOpenThread`, each title opens its thread.
 */
export function ThreadsInUse(props: {
  threads: ReadonlyArray<EnvironmentThreadShell>;
  onOpenThread?: (thread: EnvironmentThreadShell) => void;
}) {
  const { onOpenThread } = props;
  if (props.threads.length === 0) return null;
  const extra = props.threads.length - LISTED_THREADS;
  return (
    <div className="flex flex-col gap-0.5 border-t pt-2 text-muted-foreground">
      <span>
        <T>Already in use by</T>
      </span>
      {props.threads.slice(0, LISTED_THREADS).map((thread) =>
        onOpenThread ? (
          <button
            key={thread.id}
            type="button"
            className="truncate text-start text-foreground underline-offset-2 hover:underline"
            onClick={() => onOpenThread(thread)}
          >
            {thread.title}
          </button>
        ) : (
          <span key={thread.id} className="truncate text-foreground">
            {thread.title}
          </span>
        ),
      )}
      {extra > 0 ? (
        <span>
          <T>
            and <Var>{extra}</Var> more
          </T>
        </span>
      ) : null}
    </div>
  );
}

/** Hover card for a pull request row: its description and who opened it, read on open. */
export function PullRequestHoverPreview(props: {
  entry: EnvironmentPullRequestEntry;
  threadRef: ScopedThreadRef | null;
  threads: ReadonlyArray<EnvironmentThreadShell>;
  trigger: ReactElement;
}) {
  return (
    <CursorPreviewCard trigger={props.trigger} className="w-[28rem] max-w-[calc(100vw-2rem)]">
      <PullRequestPreviewBody {...props} />
    </CursorPreviewCard>
  );
}

function PullRequestPreviewBody(props: {
  entry: EnvironmentPullRequestEntry;
  threadRef: ScopedThreadRef | null;
  threads: ReadonlyArray<EnvironmentThreadShell>;
}) {
  const { entry } = props;
  const gt = useGT();
  const detailQuery = useEnvironmentQuery(
    pullRequestEnvironment.detail({
      environmentId: entry.environmentId,
      input: {
        projectId: entry.projectId,
        host: entry.host,
        repository: entry.repository,
        number: entry.number,
      },
    }),
  );
  const onLinkClick = useLinkClickHandler(props.threadRef);
  const detail = detailQuery.data;
  // The list row already carries everything but the description, so only that waits on the read.
  const state = resolvePullRequestState({ state: entry.state, isDraft: entry.isDraft });
  const author = detail?.author ?? entry.author;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3 text-muted-foreground">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 truncate">
            {entry.repository} #{entry.number}
          </span>
          <span aria-hidden>·</span>
          <span className="inline-flex shrink-0 items-center gap-1">
            <state.Icon aria-hidden className={`size-3 ${state.toneClassName}`} />
            {state.label}
          </span>
        </span>
        <a
          href={entry.url}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 underline-offset-2 hover:text-foreground hover:underline"
          onClick={(event) => onLinkClick(event, entry.url)}
        >
          {entry.provider === "github"
            ? gt("Open on GitHub")
            : gt("Open", { $context: "verb, opens the pull request in the browser" })}
        </a>
      </div>
      <p className="font-medium text-foreground text-sm leading-snug text-pretty">{entry.title}</p>
      <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
        <PullRequestActorAvatar actor={author} className="size-4" />
        <span className="min-w-0 truncate">{author?.login ?? "ghost"}</span>
        <span aria-hidden>·</span>
        <span className="shrink-0">
          <T>
            opened <Var>{formatRelativeTimeLabel(entry.createdAt)}</Var>
          </T>
        </span>
      </div>
      <div className="flex min-w-0 items-center gap-1.5 font-mono text-muted-foreground">
        <span className="min-w-0 truncate">{entry.headBranch}</span>
        <span aria-hidden>→</span>
        <span className="shrink-0">{entry.baseBranch}</span>
        {detail === null ? null : (
          <PullRequestDiffStat
            additions={detail.additions}
            deletions={detail.deletions}
            className="ms-auto shrink-0"
          />
        )}
      </div>
      <div className="max-h-80 overflow-y-auto rounded-lg border border-border/70 bg-background/70 px-3 py-2.5 text-xs text-foreground">
        {detail === null ? (
          <p className="text-muted-foreground">{detailQuery.error ?? gt("Loading description…")}</p>
        ) : (
          <PullRequestMarkdown
            text={detail.body.trim().length > 0 ? detail.body : gt("_No description provided._")}
            cwd={detail.workspaceRoot}
            environmentId={entry.environmentId}
            threadRef={props.threadRef}
          />
        )}
      </div>
      <ThreadsInUse threads={props.threads} />
    </div>
  );
}

/** Where a branch would be worked on, as `resolveBranchStart` decides it. */
function branchCheckoutLabel(
  branch: VcsRef,
  workspaceRoot: string,
  resolve: MessageResolver = m,
): string {
  if (branch.worktreePath === workspaceRoot) {
    return resolve(msg("Checked out in the project folder"));
  }
  if (branch.worktreePath !== null) {
    return resolve(msg("Checked out in {path}"), { path: branch.worktreePath });
  }
  return resolve(msg("Starts in a new worktree"));
}

/** Hover card for a branch row: its full name, where it would run, and threads already on it. */
export function BranchHoverPreview(props: {
  branch: VcsRef;
  workspaceRoot: string;
  threads: ReadonlyArray<EnvironmentThreadShell>;
  trigger: ReactElement;
}) {
  const { branch } = props;
  const gt = useGT();
  const resolve = useMessages();
  const kind = branch.current
    ? gt("Current branch")
    : branch.isDefault
      ? gt("Default branch")
      : branch.isRemote
        ? gt("Remote branch, worked on as {name}", { name: localBranchName(branch) })
        : gt("Local branch");
  return (
    <CursorPreviewCard trigger={props.trigger}>
      <div className="flex flex-col gap-2">
        <div className="flex min-w-0 items-start gap-1.5">
          <GitBranchIcon aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 break-all font-mono text-foreground">{branch.name}</span>
        </div>
        <div className="flex flex-col gap-0.5 text-muted-foreground">
          <span>{kind}</span>
          <span className="break-all">
            {branchCheckoutLabel(branch, props.workspaceRoot, resolve)}
          </span>
        </div>
        <ThreadsInUse threads={props.threads} />
      </div>
    </CursorPreviewCard>
  );
}

function workspaceLabel(
  strategy: OrchestrationV2ThreadLaunchWorkspaceStrategy,
  resolve: MessageResolver = m,
): string {
  if (strategy.type === "root") return resolve(msg("Runs in the project checkout"));
  if (strategy.type === "existing_worktree") {
    return resolve(msg("Runs in {path}"), { path: strategy.worktreePath });
  }
  return resolve(msg("Runs in a new worktree from {ref}"), {
    ref: `${strategy.startFromOrigin ? "origin/" : ""}${strategy.baseRef}`,
  });
}

/** `{time}` is the last run's relative time, empty when there is none. */
const RUN_STATUS_LABELS: Record<ScheduledTask["lastRunStatus"], string> = {
  never: msg("Never run"),
  running: msg("Running now"),
  succeeded: msg("Last run succeeded {time}"),
  failed: msg("Last run failed {time}"),
};

/** Hover card for an automation row: what running it would do, and how it last went. */
export function AutomationHoverPreview(props: {
  task: ScheduledTask;
  timeZone: string | undefined;
  trigger: ReactElement;
}) {
  const { task } = props;
  const gt = useGT();
  const resolve = useMessages();
  const blocker = automationRunBlocker(task, resolve);
  return (
    <CursorPreviewCard trigger={props.trigger} className="w-[28rem] max-w-[calc(100vw-2rem)]">
      <div className="flex flex-col gap-2">
        <p className="font-medium text-foreground text-sm leading-snug text-pretty">{task.title}</p>
        <div className="flex flex-col gap-0.5 text-muted-foreground">
          <span>
            {scheduleLabel(task.schedule, props.timeZone)}
            {!task.enabled ? (
              gt(" · paused")
            ) : task.nextRunAt !== null ? (
              <T>
                {" · next "}
                <Var>
                  <ScheduledRelativeLabel value={task.nextRunAt} />
                </Var>
              </T>
            ) : null}
          </span>
          <span className="truncate font-mono">
            {task.modelSelection.instanceId} · {task.modelSelection.model}
          </span>
          <span className="break-all">{workspaceLabel(task.workspaceStrategy, resolve)}</span>
          <span>
            {task.threadId === null
              ? gt("Starts a new thread each run")
              : gt("Sends each run to the same thread")}
          </span>
          <span>
            {resolve(RUN_STATUS_LABELS[task.lastRunStatus], {
              time: task.lastRunAt === null ? "" : formatRelativeTimeLabel(task.lastRunAt),
            }).trim()}
          </span>
          {task.lastRunError ? <span className="text-destructive">{task.lastRunError}</span> : null}
          {blocker ? <span>{blocker}</span> : null}
        </div>
        <div className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border/70 bg-background/70 px-3 py-2.5 text-xs text-foreground">
          {task.prompt}
        </div>
      </div>
    </CursorPreviewCard>
  );
}
