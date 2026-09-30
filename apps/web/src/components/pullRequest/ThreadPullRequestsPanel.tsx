import {
  listPullRequestWatches,
  setPullRequestWatch,
} from "@t3tools/client-runtime/pull-request-watches";
import type {
  PullRequestWatch,
  PullRequestWatchAction,
  PullRequestWatches,
  ScopedThreadRef,
  ThreadPullRequestLink,
} from "@t3tools/contracts";
import {
  PULL_REQUEST_WATCH_MAX_ATTEMPTS,
  evaluatePullRequestWatch,
  pullRequestWatchStatusLabel,
} from "@t3tools/shared/pullRequestWatch";
import {
  pullRequestListLines,
  threadPullRequestKeysEqual,
  visibleThreadPullRequests,
  type PullRequestListLine,
} from "@t3tools/shared/threadPullRequests";
import * as Option from "effect/Option";
import {
  ArrowUpRightIcon,
  EyeIcon,
  EyeOffIcon,
  LinkIcon,
  MoreHorizontalIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
} from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { useOpenPrLink } from "~/lib/openPullRequestLink";
import { runtime } from "~/lib/runtime";
import { cn } from "~/lib/utils";
import { useServerConfigs, useThreadShell } from "~/state/entities";
import { PullRequestsUnavailableState } from "./PullRequestsUnavailableState";
import { threadEnvironment } from "~/state/threads";
import { usePreparedConnection } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { MiddleTruncate } from "../ui/middle-truncate";
import { ScrollArea } from "../ui/scroll-area";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { openLinkPullRequestDialog } from "./LinkPullRequestDialog";
import {
  PULL_REQUEST_ROW_CLASS,
  PULL_REQUEST_ROW_NUMBER_CLASS,
  PullRequestRowAuthor,
  PullRequestRowBranches,
  PullRequestRowGlyph,
  PullRequestRowLines,
} from "./PullRequestListRow";
import {
  PullRequestDiffStat,
  PullRequestReviewDecisionGlyph,
  pullRequestChecksStatePresentation,
} from "./pullRequestPresentation";
import { PullRequestGlyph } from "./pullRequestIcons";

const SOURCE_LABELS: Record<ThreadPullRequestLink["source"], string> = {
  manual: "Linked by you",
  created: "Created from this thread",
  agent: "Linked by the agent",
  stack: "Found in the stack",
  "stack-dismissed": "Dismissed",
};

function ChecksGlyph({
  state,
}: {
  state: NonNullable<ThreadPullRequestLink["snapshot"]>["checksState"] & string;
}) {
  const presentation = pullRequestChecksStatePresentation(state);
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex shrink-0" />}>
        <presentation.Icon
          role="img"
          aria-label={presentation.label}
          className={cn("size-3.5", presentation.toneClassName)}
        />
      </TooltipTrigger>
      <TooltipPopup>{presentation.label}</TooltipPopup>
    </Tooltip>
  );
}

/**
 * The thread's pull request watches, or null when the environment does not serve them (servers
 * without this fork). Re-read whenever `revision` changes: the syncs and turns that move a watch.
 */
function usePullRequestWatches(threadRef: ScopedThreadRef, revision: string) {
  const prepared = usePreparedConnection(threadRef.environmentId);
  const [watches, setWatches] = useState<PullRequestWatches | null>(null);

  useEffect(() => {
    if (Option.isNone(prepared)) return;
    let active = true;
    void runtime.runPromise(listPullRequestWatches(prepared.value, threadRef.threadId)).then(
      (next) => {
        if (active) setWatches(next);
      },
      () => {
        if (active) setWatches(null);
      },
    );
    return () => {
      active = false;
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- `revision` is the refetch trigger.
  }, [prepared, threadRef.threadId, revision]);

  const setWatch = useCallback(
    (link: ThreadPullRequestLink, action: PullRequestWatchAction) => {
      if (Option.isNone(prepared)) return;
      const input = { host: link.host, repository: link.repository, number: link.number, action };
      void runtime
        .runPromise(setPullRequestWatch(prepared.value, threadRef.threadId, input))
        .then(setWatches, (cause: unknown) => {
          toastManager.add({
            type: "error",
            title: "Could not update the pull request watch",
            description: cause instanceof Error ? cause.message : undefined,
          });
        });
    },
    [prepared, threadRef.threadId],
  );

  return { watches, setWatch };
}

function WatchStatusLine({
  watch,
  link,
  busy,
  depth,
}: {
  watch: PullRequestWatch;
  link: ThreadPullRequestLink;
  busy: boolean;
  depth: number;
}) {
  const evaluation = evaluatePullRequestWatch(watch, link.snapshot);
  return (
    <div
      className="flex items-center gap-1.5 pr-1 pb-1 text-2xs text-muted-foreground"
      style={{ paddingLeft: `${2 + Math.min(depth, 8) * 0.75}rem` }}
    >
      <EyeIcon aria-label="Watching" className="size-3 shrink-0" />
      <span className="min-w-0 truncate">{pullRequestWatchStatusLabel(evaluation, busy)}</span>
      <span className="ml-auto shrink-0 tabular-nums">
        {watch.attemptsUsed}/{PULL_REQUEST_WATCH_MAX_ATTEMPTS} follow-ups
      </span>
    </div>
  );
}

function LinkRow({
  line,
  threadRef,
  onUnlink,
  watch,
  canWatch,
  onWatch,
}: {
  line: PullRequestListLine;
  threadRef: ScopedThreadRef;
  onUnlink: (link: ThreadPullRequestLink) => void;
  watch: PullRequestWatch | undefined;
  canWatch: boolean;
  onWatch: (link: ThreadPullRequestLink, action: PullRequestWatchAction) => void;
}) {
  const openPrLink = useOpenPrLink(threadRef);
  const { link, depth, stack } = line;
  const snapshot = link.snapshot;
  const watchStopped =
    watch !== undefined &&
    ["paused", "exhausted"].includes(evaluatePullRequestWatch(watch, snapshot).kind);
  return (
    <div
      className={cn(PULL_REQUEST_ROW_CLASS, "relative hover:bg-accent/60")}
      // Each pull request steps in under the one it targets. The step is capped: past this the
      // connector already says "still in the tree", and a deeper stair would push titles off.
      style={{ paddingLeft: `${0.5 + Math.min(depth, 8) * 0.75}rem` }}
    >
      {depth > 0 ? <span aria-hidden className="-ml-2 h-6 w-px shrink-0 bg-border/70" /> : null}
      {snapshot === null ? (
        <PullRequestGlyph.pullRequest
          aria-label="Waiting for host state"
          className="size-4 shrink-0 text-muted-foreground"
        />
      ) : (
        <PullRequestRowGlyph
          state={snapshot.state}
          isDraft={snapshot.isDraft}
          mergeability={snapshot.mergeability}
          baseBranch={snapshot.baseBranch}
        />
      )}
      <a
        href={link.url}
        onClick={(event) => openPrLink(event, link.url, threadRef)}
        className="flex min-w-0 flex-1"
      >
        <PullRequestRowLines
          number={
            <Tooltip>
              <TooltipTrigger render={<span className={PULL_REQUEST_ROW_NUMBER_CLASS} />}>
                #{link.number}
              </TooltipTrigger>
              <TooltipPopup>
                {SOURCE_LABELS[link.source]} · {formatRelativeTimeLabel(link.linkedAt)}
              </TooltipPopup>
            </Tooltip>
          }
          title={snapshot?.title ?? link.repository}
          signals={
            snapshot?.state === "open" ? (
              <>
                {snapshot.checksState ? <ChecksGlyph state={snapshot.checksState} /> : null}
                {snapshot.reviewDecision ? (
                  <PullRequestReviewDecisionGlyph decision={snapshot.reviewDecision} />
                ) : null}
              </>
            ) : null
          }
          // Match the full PR list: diff counts up top, checks under the lifecycle glyph, the
          // verdict by the author. Each is absent rather than neutral when the host said
          // nothing, so a row without them reads as unknown, not as fine.
          status={
            <PullRequestDiffStat
              additions={snapshot?.additions ?? 0}
              deletions={snapshot?.deletions ?? 0}
              className="font-mono"
            />
          }
          meta={
            <>
              {stack ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <span className="inline-flex shrink-0 items-center gap-0.5 text-foreground/70" />
                    }
                  >
                    <PullRequestGlyph.stack aria-hidden className="size-3" />
                    {stack.size}
                  </TooltipTrigger>
                  <TooltipPopup>
                    {stack.kind === "native"
                      ? `GitHub stack of ${stack.size}: merging a layer lands the ones below it.`
                      : `${stack.size} pull requests chained by base branch.`}
                  </TooltipPopup>
                </Tooltip>
              ) : null}
              {snapshot?.author ? (
                <PullRequestRowAuthor
                  actor={snapshot.author}
                  className="shrink-0"
                  labelClassName="max-w-28"
                />
              ) : null}
              {snapshot !== null ? (
                <>
                  {/* Cut in the middle: rows from one owner differ in the repository name at the
                      end, which a tail cut would hide. */}
                  <Tooltip>
                    <TooltipTrigger render={<span className="flex min-w-0 max-w-32 font-mono" />}>
                      <MiddleTruncate value={link.repository} showTitle={false} />
                    </TooltipTrigger>
                    <TooltipPopup>{link.repository}</TooltipPopup>
                  </Tooltip>
                  <PullRequestRowBranches head={snapshot.headBranch} base={snapshot.baseBranch} />
                </>
              ) : (
                <span className="truncate font-mono">
                  {link.host}/{link.repository}
                </span>
              )}
            </>
          }
          updatedAt={snapshot?.updatedAt}
        />
      </a>
      {/* Out of the row's flow, so no row reserves a column for a button only the hovered one
          shows. It sits over the right end of the second line on the row's own hover color,
          fading in from the left, so it covers the time and leaves the diff counts alone. */}
      <span
        className={cn(
          "absolute right-0 bottom-0.5 flex items-center rounded-r-md bg-background pr-1 pl-5",
          "[mask-image:linear-gradient(to_right,transparent,black_1rem)]",
          // Hidden means untouchable too: on a touch screen there is no hover, and an invisible
          // layer over the right of the row would otherwise swallow the tap meant for the link.
          "pointer-events-none opacity-0 group-hover/pr-row:pointer-events-auto group-hover/pr-row:opacity-100",
          "has-[[data-popup-open]]:pointer-events-auto has-[[data-popup-open]]:opacity-100",
          "has-[:focus-visible]:pointer-events-auto has-[:focus-visible]:opacity-100",
        )}
      >
        <span aria-hidden className="absolute inset-0 bg-accent/60" />
        <Menu>
          <MenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-micro"
                aria-label={`Actions for #${link.number}`}
                className="relative"
              >
                <MoreHorizontalIcon className="size-3.5" />
              </Button>
            }
          />
          <MenuPopup align="end" side="bottom">
            <MenuItem onClick={() => void writeTextToClipboard(link.url, "link")}>
              <LinkIcon className="size-3.5" />
              Copy link
            </MenuItem>
            <MenuItem onClick={(event) => openPrLink(event, link.url, threadRef)}>
              <ArrowUpRightIcon className="size-3.5" />
              Open
            </MenuItem>
            {canWatch && watch === undefined && snapshot?.state === "open" ? (
              <MenuItem onClick={() => onWatch(link, "watch")}>
                <EyeIcon className="size-3.5" />
                Watch and follow up
              </MenuItem>
            ) : null}
            {watch !== undefined ? (
              <>
                <MenuItem onClick={() => onWatch(link, watchStopped ? "resume" : "pause")}>
                  {watchStopped ? (
                    <PlayIcon className="size-3.5" />
                  ) : (
                    <PauseIcon className="size-3.5" />
                  )}
                  {watchStopped ? "Resume watching" : "Pause watching"}
                </MenuItem>
                <MenuItem onClick={() => onWatch(link, "stop")}>
                  <EyeOffIcon className="size-3.5" />
                  Stop watching
                </MenuItem>
              </>
            ) : null}
            <MenuItem onClick={() => onUnlink(link)}>
              <PullRequestGlyph.unlink className="size-3.5" />
              {link.source === "stack" ? "Dismiss from thread" : "Unlink from thread"}
            </MenuItem>
          </MenuPopup>
        </Menu>
      </span>
    </div>
  );
}

export function ThreadPullRequestsPanel({ threadRef }: { threadRef: ScopedThreadRef }) {
  const configs = useServerConfigs();
  if (configs.get(threadRef.environmentId)?.environment.capabilities.threadPullRequests !== true) {
    return (
      <PullRequestsUnavailableState
        title="Linked pull requests unavailable"
        error="This environment does not support multiple linked pull requests."
      />
    );
  }
  return <EnabledThreadPullRequestsPanel threadRef={threadRef} />;
}

function EnabledThreadPullRequestsPanel({ threadRef }: { threadRef: ScopedThreadRef }) {
  const thread = useThreadShell(threadRef);
  const openLinkDialog = useCallback(() => openLinkPullRequestDialog(threadRef), [threadRef]);
  const unlink = useAtomCommand(threadEnvironment.unlinkPullRequest, { reportFailure: true });
  const links = useMemo(() => visibleThreadPullRequests(thread?.pullRequests ?? []), [thread]);
  const lines = useMemo(() => pullRequestListLines(links), [links]);
  const handleUnlink = useCallback(
    (link: ThreadPullRequestLink) => {
      void unlink({
        environmentId: threadRef.environmentId,
        input: {
          threadId: threadRef.threadId,
          host: link.host,
          repository: link.repository,
          number: link.number,
        },
      });
    },
    [threadRef, unlink],
  );
  const openCount = useMemo(
    () => links.filter((link) => link.snapshot === null || link.snapshot.state === "open").length,
    [links],
  );
  const lastSynced = useMemo(() => {
    let latest: string | null = null;
    for (const link of links) {
      const at = link.snapshot?.syncedAt;
      if (at !== undefined && (latest === null || at > latest)) latest = at;
    }
    return latest;
  }, [links]);
  const sessionStatus = thread?.session?.status ?? null;
  const busy = sessionStatus === "starting" || sessionStatus === "running";
  const { watches, setWatch } = usePullRequestWatches(
    threadRef,
    `${lastSynced}|${sessionStatus}|${thread?.latestTurn?.state ?? null}`,
  );

  if (links.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <PullRequestGlyph.link aria-hidden className="size-6 text-muted-foreground/60" />
        <p className="text-sm font-medium">No linked pull requests</p>
        <p className="max-w-60 text-xs text-muted-foreground">
          Pull requests the agent opens from this thread land here. Link your own from the list or a
          URL.
        </p>
        <Button size="sm" variant="outline" onClick={openLinkDialog}>
          <PlusIcon className="size-3.5" />
          Link pull request
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col p-1.5">
          {lines.map((line) => {
            const key = `${line.link.host}/${line.link.repository}#${line.link.number}`;
            const watch = watches?.find((entry) => threadPullRequestKeysEqual(entry, line.link));
            return (
              <Fragment key={key}>
                <LinkRow
                  line={line}
                  threadRef={threadRef}
                  onUnlink={handleUnlink}
                  watch={watch}
                  canWatch={watches !== null}
                  onWatch={setWatch}
                />
                {watch !== undefined ? (
                  <WatchStatusLine watch={watch} link={line.link} busy={busy} depth={line.depth} />
                ) : null}
              </Fragment>
            );
          })}
        </div>
      </ScrollArea>
      <footer className="flex items-center justify-between border-t border-border/60 px-2 py-1.5 text-2xs text-muted-foreground">
        <span>
          {openCount} open · {links.length} linked
          {lastSynced ? ` · synced ${formatRelativeTimeLabel(lastSynced)}` : ""}
        </span>
        <Button size="xs" variant="ghost" onClick={openLinkDialog}>
          <PlusIcon className="size-3.5" />
          Link
        </Button>
      </footer>
    </div>
  );
}
