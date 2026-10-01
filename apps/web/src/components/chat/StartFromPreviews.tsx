import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { ScopedThreadRef, VcsRef } from "@t3tools/contracts";
import { GitBranchIcon } from "lucide-react";
import type { ReactElement } from "react";

import { useLinkClickHandler } from "~/browser/useOpenLink";
import { pullRequestEnvironment } from "~/state/pullRequests";
import { useEnvironmentQuery } from "~/state/query";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import type { EnvironmentPullRequestEntry } from "../pullRequest/pullRequestList.logic";
import { PullRequestMarkdown } from "../pullRequest/PullRequestMarkdown";
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
      <span>Already in use by</span>
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
      {extra > 0 ? <span>and {extra} more</span> : null}
    </div>
  );
}

/** Hover card for a pull request row: its description and who opened it, read on open. */
export function PullRequestHoverPreview(props: {
  entry: EnvironmentPullRequestEntry;
  threadRef: ScopedThreadRef;
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
  threadRef: ScopedThreadRef;
  threads: ReadonlyArray<EnvironmentThreadShell>;
}) {
  const { entry } = props;
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
          {entry.provider === "github" ? "Open on GitHub" : "Open"}
        </a>
      </div>
      <p className="font-medium text-foreground text-sm leading-snug text-pretty">{entry.title}</p>
      <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
        <PullRequestActorAvatar actor={author} className="size-4" />
        <span className="min-w-0 truncate">{author?.login ?? "ghost"}</span>
        <span aria-hidden>·</span>
        <span className="shrink-0">opened {formatRelativeTimeLabel(entry.createdAt)}</span>
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
          <p className="text-muted-foreground">{detailQuery.error ?? "Loading description…"}</p>
        ) : (
          <PullRequestMarkdown
            text={detail.body.trim().length > 0 ? detail.body : "_No description provided._"}
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
function branchCheckoutLabel(branch: VcsRef, workspaceRoot: string): string {
  if (branch.worktreePath === workspaceRoot) return "Checked out in the project folder";
  if (branch.worktreePath !== null) return `Checked out in ${branch.worktreePath}`;
  return "Starts in a new worktree";
}

/** Hover card for a branch row: its full name, where it would run, and threads already on it. */
export function BranchHoverPreview(props: {
  branch: VcsRef;
  workspaceRoot: string;
  threads: ReadonlyArray<EnvironmentThreadShell>;
  trigger: ReactElement;
}) {
  const { branch } = props;
  const kind = branch.current
    ? "Current branch"
    : branch.isDefault
      ? "Default branch"
      : branch.isRemote
        ? `Remote branch, worked on as ${localBranchName(branch)}`
        : "Local branch";
  return (
    <CursorPreviewCard trigger={props.trigger}>
      <div className="flex flex-col gap-2">
        <div className="flex min-w-0 items-start gap-1.5">
          <GitBranchIcon aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 break-all font-mono text-foreground">{branch.name}</span>
        </div>
        <div className="flex flex-col gap-0.5 text-muted-foreground">
          <span>{kind}</span>
          <span className="break-all">{branchCheckoutLabel(branch, props.workspaceRoot)}</span>
        </div>
        <ThreadsInUse threads={props.threads} />
      </div>
    </CursorPreviewCard>
  );
}
