import { sourceControlClients } from "@t3tools/client-runtime/source-control-clients";
import { useAtomCommand } from "~/state/use-atom-command";
import type {
  EnvironmentId,
  PullRequestComment,
  PullRequestDetailView,
  PullRequestRef,
  ScopedThreadRef,
} from "@t3tools/contracts";
import {
  ArrowDownUpIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  HammerIcon,
  ListFilterIcon,
  MessageSquareIcon,
  TagIcon,
  UsersIcon,
} from "lucide-react";
import * as Schema from "effect/Schema";
import { useRef, useState, type ReactNode } from "react";

import { pullRequestEnvironment } from "~/state/pullRequests";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { cn } from "~/lib/utils";
import { useOpenLink } from "~/browser/useOpenLink";
import { RelativeTime } from "~/components/RelativeTime";

import { Button } from "../ui/button";
import { PullRequestEditButton } from "./PullRequestEditButton";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuPopup,
  MenuTrigger,
} from "../ui/menu";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  PullRequestActorLabel,
  PullRequestCheckStatusIcon,
  pullRequestCheckStatusLabel,
  PullRequestLabelChip,
  PullRequestReviewOutcomeBadge,
  pullRequestReviewOutcomeLabel,
  pullRequestReviewOutcomeRingClassName,
  pullRequestReviewOutcomeStaleLabel,
} from "./pullRequestPresentation";
import { PullRequestLabelPicker } from "./PullRequestLabelPicker";
import { PullRequestReviewerPicker } from "./PullRequestReviewerPicker";
import { PullRequestActivityUnavailableState } from "./PullRequestActivityUnavailableState";
import {
  groupPullRequestConversation,
  latestPullRequestReviewOutcomes,
  orderPullRequestComments,
  pullRequestFindingKey,
  pullRequestReviewOutcome,
  visibleBody,
  type PullRequestConversationEntry,
  type PullRequestFinding,
} from "./pullRequestDetail.logic";
import {
  canEditPullRequestChangeRequest,
  canEditPullRequestComment,
  canResolvePullRequestThread,
} from "./pullRequestEditing.logic";
import { PullRequestMarkdown } from "./PullRequestMarkdown";
import { PullRequestQuoteSource } from "./PullRequestQuoteToolbar";
import { PullRequestCommentBody } from "./PullRequestCommentBody";
import { PullRequestMarkdownEditor } from "./PullRequestMarkdownEditor";
import { PullRequestReactionBar } from "./PullRequestReactions";
import { PullRequestConversationGhost } from "./PullRequestGhosts";
import { usePullRequestLinkClick } from "./PullRequestMarkdownContext";
import { sectionCollapseAnchorScrollTop } from "./pullRequestSummaryScroll.logic";

function reviewerKey(login: string): string {
  return login.toLowerCase();
}

function CommentIdentity({
  comment,
  detail,
}: {
  comment: PullRequestComment;
  detail: PullRequestDetailView;
}) {
  const onLinkClick = usePullRequestLinkClick();
  const actor = comment.author;
  const commentUrl = comment.url;
  const profileUrl = actor
    ? sourceControlClients.get(detail.provider).authorProfileUrl(actor.login, detail.url)
    : null;
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-1 text-xs">
      <PullRequestActorLabel actor={actor} profileUrl={profileUrl} className="max-w-full" />
      <Tooltip>
        <TooltipTrigger
          render={
            commentUrl ? (
              <a
                href={commentUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => onLinkClick(event, commentUrl)}
                className="text-muted-foreground hover:text-foreground hover:underline"
              />
            ) : (
              <span className="text-muted-foreground" />
            )
          }
        >
          <time dateTime={comment.createdAt}>
            <RelativeTime timestamp={comment.createdAt} />
          </time>
        </TooltipTrigger>
        <TooltipPopup>
          {new Date(comment.createdAt).toLocaleString()}
          {comment.url ? " · Open comment on host" : ""}
        </TooltipPopup>
      </Tooltip>
    </div>
  );
}

/** Where on the change a remark points, and whether that line has since moved on. */
function CommentLocation({
  path,
  line = null,
  isOutdated = false,
  className,
}: {
  path: string | null;
  line?: number | null;
  isOutdated?: boolean;
  className?: string;
}) {
  if (!path) return null;
  const label = `${path}${line ? `:${line}` : ""}`;
  return (
    <div className={cn("flex min-w-0 items-center gap-2 text-xs text-muted-foreground", className)}>
      <Tooltip>
        <TooltipTrigger render={<span className="truncate font-mono" />}>{label}</TooltipTrigger>
        <TooltipPopup>{label}</TooltipPopup>
      </Tooltip>
      {isOutdated ? <span className="shrink-0">Outdated</span> : null}
    </div>
  );
}

/** A remark flattened to one line of plain words, for a card that is folded shut. */
function commentPreview(body: string): string {
  return body
    .replace(/<!--[\s\S]*?-->/gu, "")
    .replace(/^\s*>?\s*\[!\w+\]\s*$/gmu, "")
    .replace(/!?(\[([^\]]+)\])\([^)]*\)/gu, "$2")
    .replace(/^[\s>#*-]+/gmu, "")
    .replace(/[*`]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** "CHANGES_REQUESTED" reads as "Changes requested": one capital, the host's underscores gone. */
function reviewStateLabel(state: string): string {
  const words = state.toLowerCase().replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

interface CommentEditing {
  readonly cwd: string;
  readonly environmentId: EnvironmentId;
  readonly threadRef: ScopedThreadRef | null;
  readonly canEdit: (comment: PullRequestComment) => boolean;
  readonly editingId: string | null;
  readonly saving: boolean;
  readonly onEdit: (comment: PullRequestComment | null) => void;
  readonly onSave: (comment: PullRequestComment, body: string) => void;
}

function CommentBody({
  comment,
  editing,
  className,
}: {
  comment: PullRequestComment;
  editing: CommentEditing;
  className?: string | undefined;
}) {
  if (editing.editingId === comment.id) {
    return (
      <PullRequestMarkdownEditor
        className={className}
        value={comment.body}
        cwd={editing.cwd}
        environmentId={editing.environmentId}
        threadRef={editing.threadRef}
        label="Edit comment"
        saving={editing.saving}
        onSave={(body) => editing.onSave(comment, body)}
        onCancel={() => editing.onEdit(null)}
      />
    );
  }
  return (
    <div className={cn("flex items-start gap-1", className)}>
      <PullRequestQuoteSource
        className="min-w-0 flex-1"
        source="comment"
        author={comment.author}
        url={comment.url}
      >
        <PullRequestCommentBody
          key={comment.id}
          text={comment.body}
          cwd={editing.cwd}
          environmentId={editing.environmentId}
          threadRef={editing.threadRef}
        />
      </PullRequestQuoteSource>
      {editing.canEdit(comment) ? (
        <PullRequestEditButton aria-label="Edit comment" onClick={() => editing.onEdit(comment)} />
      ) : null}
    </div>
  );
}

function CollapsedComment({
  comment,
  editing,
  label,
  body,
  reactionBar,
  detail,
}: {
  comment: PullRequestComment;
  editing: CommentEditing;
  label: string;
  body: string | null;
  reactionBar: ReactNode;
  detail: PullRequestDetailView;
}) {
  const [open, setOpen] = useState(false);
  const statusTriggerRef = useRef<HTMLButtonElement>(null);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <article className="group rounded-lg border border-border/60 [contain-intrinsic-block-size:44px] [content-visibility:auto]">
        <div className="p-3">
          <div className="flex flex-wrap items-baseline gap-2">
            <CommentIdentity comment={comment} detail={detail} />
            <CollapsibleTrigger
              ref={statusTriggerRef}
              className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {label}
              <ChevronDownIcon
                aria-hidden
                className={cn("size-3.5 transition-transform", open && "rotate-180")}
              />
            </CollapsibleTrigger>
            {reactionBar}
          </div>
          <CommentLocation className="mt-2" path={comment.path} />
          {!open && body ? (
            <CollapsibleTrigger
              className="mt-2 block w-full truncate text-left text-xs text-muted-foreground hover:text-foreground"
              onClick={() => statusTriggerRef.current?.focus({ preventScroll: true })}
            >
              {commentPreview(body)}
            </CollapsibleTrigger>
          ) : null}
        </div>
        <CollapsiblePanel>
          {open ? (
            <div className="px-3 pb-3">
              {body === null && !editing.canEdit(comment) ? null : (
                <CommentBody className="mt-2" comment={comment} editing={editing} />
              )}
            </div>
          ) : null}
        </CollapsiblePanel>
      </article>
    </Collapsible>
  );
}

/** The last few lines a thread was written against, the way the host shows them above it. */
function ThreadHunk({ hunk }: { hunk: string }) {
  const lines = hunk
    .split("\n")
    .filter((line) => !line.startsWith("@@"))
    .slice(-4);
  if (lines.length === 0) return null;
  return (
    <pre className="overflow-x-auto border-b border-border/60 py-1 font-mono text-2xs leading-5">
      {lines.map((line, index) => (
        <div
          // Lines of a hunk repeat and never reorder, so their position is who they are.
          key={`${index}:${line}`}
          className={cn(
            "w-max min-w-full px-3",
            line.startsWith("+")
              ? "bg-success/10"
              : line.startsWith("-")
                ? "bg-destructive/10"
                : "text-muted-foreground",
          )}
        >
          {line.length > 0 ? line : " "}
        </div>
      ))}
    </pre>
  );
}

/**
 * A conversation on a line, drawn as one card the way the host draws it: where it points, the
 * code it was written against, every remark in order, then the way to answer or close it. A
 * resolved one is finished work and opens folded to its latest remark.
 */
function ReviewThreadEntry({
  entry,
  detail,
  editing,
  environmentId,
  reference,
  canReply,
  canResolve,
  pending,
  fixAction,
  onReply,
  onToggleResolved,
  onRefresh,
}: {
  entry: Extract<PullRequestConversationEntry, { kind: "thread" }>;
  detail: PullRequestDetailView;
  editing: CommentEditing;
  environmentId: EnvironmentId;
  reference: PullRequestRef;
  canReply: boolean;
  canResolve: boolean;
  pending: boolean;
  fixAction: ReactNode;
  /** Resolves to whether the host took it, so a reply that failed keeps its words. */
  onReply: (body: string) => Promise<boolean>;
  onToggleResolved: () => void;
  onRefresh: () => void;
}) {
  const { thread, comments } = entry;
  const [open, setOpen] = useState(!thread.isResolved);
  const [replying, setReplying] = useState(false);
  const latest = comments.at(-1);
  const latestBody = latest ? visibleBody(latest.body) : null;
  // The host's total, where it read the thread in pages: the conversation only carries the
  // remarks it had room for.
  const missing = Math.max(0, (thread.commentCount ?? comments.length) - comments.length);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <article className="rounded-lg border border-border/60 bg-background [contain-intrinsic-block-size:200px] [content-visibility:auto]">
        <div className="flex items-center gap-2 rounded-t-lg bg-muted/25 px-3 py-2">
          <CommentLocation
            className="flex-1"
            path={thread.path}
            line={thread.line}
            isOutdated={thread.isOutdated}
          />
          {fixAction}
          <CollapsibleTrigger
            aria-label={open ? "Collapse conversation" : "Expand conversation"}
            className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {thread.isResolved ? "Resolved" : `${comments.length + missing}`}
            {thread.isResolved ? null : <MessageSquareIcon aria-hidden className="size-3" />}
            <ChevronDownIcon
              aria-hidden
              className={cn("size-3.5 transition-transform", open && "rotate-180")}
            />
          </CollapsibleTrigger>
        </div>
        {!open && latest && latestBody ? (
          <CollapsibleTrigger className="block w-full truncate px-3 py-2 text-left text-xs text-muted-foreground hover:text-foreground">
            <span className="text-foreground">{latest.author?.login ?? "ghost"}</span>{" "}
            {commentPreview(latestBody)}
          </CollapsibleTrigger>
        ) : null}
        <CollapsiblePanel>
          {open ? (
            <>
              {thread.diffHunk ? <ThreadHunk hunk={thread.diffHunk} /> : null}
              <div className="divide-y divide-border/60">
                {comments.map((comment) => {
                  const body = visibleBody(comment.body);
                  return (
                    <div key={comment.id} className="group px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <CommentIdentity comment={comment} detail={detail} />
                        <PullRequestReactionBar
                          className="ml-auto justify-end"
                          reactions={comment.reactions ?? []}
                          canReact={detail.capabilities.reactions === true}
                          subjectId={comment.id}
                          environmentId={environmentId}
                          reference={reference}
                          onRefresh={onRefresh}
                        />
                      </div>
                      {body === null && !editing.canEdit(comment) ? null : (
                        <CommentBody className="mt-2" comment={comment} editing={editing} />
                      )}
                    </div>
                  );
                })}
                {missing > 0 ? (
                  <p className="px-3 py-2 text-xs text-muted-foreground">
                    {missing} more {missing === 1 ? "reply" : "replies"} on the host.
                  </p>
                ) : null}
              </div>
              {canReply || canResolve ? (
                <div className="border-t border-border/60 px-3 py-2">
                  {replying ? (
                    <PullRequestMarkdownEditor
                      value=""
                      cwd={editing.cwd}
                      environmentId={environmentId}
                      threadRef={editing.threadRef}
                      label="Reply to this conversation"
                      placeholder="Reply..."
                      submitLabel="Reply"
                      saving={pending}
                      onSave={(body) => {
                        void onReply(body).then((sent) => {
                          if (sent) setReplying(false);
                        });
                      }}
                      onCancel={() => setReplying(false)}
                    />
                  ) : (
                    <div className="flex items-center gap-2">
                      {canReply ? (
                        <button
                          type="button"
                          className="h-7 min-w-0 flex-1 rounded-md border border-border/60 px-2 text-left text-xs text-muted-foreground hover:border-border hover:text-foreground"
                          onClick={() => setReplying(true)}
                        >
                          Reply...
                        </button>
                      ) : null}
                      {canResolve ? (
                        <Button
                          size="compact"
                          variant="outline"
                          className="ml-auto shrink-0"
                          disabled={pending}
                          onClick={onToggleResolved}
                        >
                          {thread.isResolved ? "Unresolve conversation" : "Resolve conversation"}
                        </Button>
                      ) : null}
                    </div>
                  )}
                </div>
              ) : null}
            </>
          ) : null}
        </CollapsiblePanel>
      </article>
    </Collapsible>
  );
}

function MetaRow({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid min-h-7 min-w-0 grid-cols-[6rem_minmax(0,1fr)] items-center gap-2 text-xs sm:min-h-6">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className="min-w-0 text-foreground">{children}</span>
    </div>
  );
}

function Section({
  title,
  defaultOpen = true,
  keepMounted = false,
  actions,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  keepMounted?: boolean;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const headingRef = useRef<HTMLDivElement>(null);
  const setOpenWithScrollAnchor = (nextOpen: boolean) => {
    if (!nextOpen) {
      const heading = headingRef.current;
      const section = heading?.closest<HTMLElement>("[data-pull-request-summary-section]");
      const scroller = heading?.closest<HTMLElement>("[data-pull-request-summary-scroll]");
      if (heading && section && scroller) {
        const target = sectionCollapseAnchorScrollTop({
          scrollTop: scroller.scrollTop,
          viewportTop: scroller.getBoundingClientRect().top,
          sectionTop: section.getBoundingClientRect().top,
          headingTop: heading.getBoundingClientRect().top,
        });
        // Synchronous with the press: React commits the collapsed height before the browser
        // paints, so the reader sees the heading they pressed stay put rather than a jump first.
        if (target !== null) scroller.scrollTop = target;
      }
    }
    setOpen(nextOpen);
  };
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpenWithScrollAnchor}
      render={<section aria-label={title} />}
      data-pull-request-summary-section
    >
      <div
        ref={headingRef}
        className="sticky top-0 z-10 flex w-full items-center bg-background pr-4"
      >
        <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-1.5 px-4 py-3 text-left text-xs font-medium text-muted-foreground hover:text-foreground">
          <span>{title}</span>
          <ChevronRightIcon
            aria-hidden
            className={cn(
              "size-3.5 text-muted-foreground/60 transition-transform",
              open && "rotate-90",
            )}
          />
        </CollapsibleTrigger>
        {actions}
      </div>
      <CollapsiblePanel keepMounted={keepMounted}>
        <div className="px-4 pb-4">{children}</div>
      </CollapsiblePanel>
    </Collapsible>
  );
}

const COMMENT_PAGE = 10;

const COMMENT_FILTER_STORAGE_KEY = "t3code:pull-request-comment-filter:v1";
const CommentFilterSchema = Schema.Struct({ bots: Schema.Boolean, resolved: Schema.Boolean });
const DEFAULT_COMMENT_FILTER: typeof CommentFilterSchema.Type = { bots: false, resolved: false };

export function PullRequestSummaryTab({
  scrollerRef,
  environmentId,
  threadRef,
  reference,
  detail,
  activityPending,
  checksStale = false,
  activityError,
  pendingFinding,
  fixFindingLabel = "Fix in a thread",
  fixCheckLabel = "Fix",
  onFixFinding,
  onRefresh,
  onRefreshChecks = onRefresh,
}: {
  scrollerRef: (node: HTMLDivElement | null) => void;
  environmentId: EnvironmentId;
  threadRef: ScopedThreadRef | null;
  reference: PullRequestRef;
  detail: PullRequestDetailView;
  activityPending: boolean;
  checksStale?: boolean;
  activityError: string | null;
  pendingFinding?: string | null;
  fixFindingLabel?: string;
  fixCheckLabel?: string;
  onFixFinding?: (finding: PullRequestFinding) => void;
  onRefresh: () => void;
  onRefreshChecks?: () => void;
}) {
  const [shown, setShown] = useState({ url: detail.url, count: COMMENT_PAGE });
  const shownComments = shown.url === detail.url ? shown.count : COMMENT_PAGE;
  const [commentFilter, setCommentFilter] = useLocalStorage(
    COMMENT_FILTER_STORAGE_KEY,
    DEFAULT_COMMENT_FILTER,
    CommentFilterSchema,
  );
  // A comment that lives on a review thread is drawn as part of that thread: the thread carries
  // the line and side the bare comment has lost, and its replies belong beneath it.
  const entries = groupPullRequestConversation(detail.comments, detail.reviewThreads);
  const entryComments = (entry: PullRequestConversationEntry) =>
    entry.kind === "thread" ? entry.comments : [entry.comment];

  // A resolved thread is finished work nobody should be invited to fix again — the same call the
  // whole-review hand-off makes.
  const isFinished = (entry: PullRequestConversationEntry) =>
    entry.kind === "thread"
      ? entry.thread.isResolved
      : pullRequestReviewOutcome(entry.comment.reviewState) === "dismissed";
  const isBot = (comment: PullRequestComment) =>
    comment.author?.isBot === true || comment.author?.login.endsWith("[bot]") === true;
  // A thread a person has answered is a person's conversation, whoever opened it.
  const isBotEntry = (entry: PullRequestConversationEntry) => entryComments(entry).every(isBot);
  const filteredEntries = entries.filter(
    (entry) =>
      (commentFilter.bots || !isBotEntry(entry)) && (commentFilter.resolved || !isFinished(entry)),
  );
  // The one count the filter shows, in comments like the heading's. Per-kind counts would
  // overlap, since a resolved bot comment is both kinds and needs both shown.
  const filteredOutCount =
    detail.comments.length -
    filteredEntries.reduce((total, entry) => total + entryComments(entry).length, 0);
  const recentEntries = filteredEntries.slice(Math.max(0, filteredEntries.length - shownComments));
  const hiddenCommentCount = filteredEntries.length - recentEntries.length;
  const [commentOrder, setCommentOrder] = useState<"newest" | "oldest">("newest");
  const visibleEntries = orderPullRequestComments(recentEntries, commentOrder);
  const showOldestCommentsButton =
    hiddenCommentCount > 0 ? (
      <Button
        size="sm"
        variant="outline"
        className="w-full"
        onClick={() => setShown({ url: detail.url, count: shownComments + COMMENT_PAGE })}
      >
        Show {Math.min(hiddenCommentCount, COMMENT_PAGE)} older comment
        {hiddenCommentCount === 1 ? "" : "s"} ({hiddenCommentCount} hidden)
      </Button>
    ) : null;
  // Read from the whole conversation, not the window shown below it: a verdict older than the
  // visible comments still stands.
  const reviewOutcomes = latestPullRequestReviewOutcomes(detail.comments, detail.commits);
  // Hosts do not promise one casing for a login across two fields of the same response, and
  // none of them lets `Octocat` and `octocat` be two people — so matching on the literal string
  // would show one reviewer twice and drop the verdict off both.
  const outcomeByLogin = new Map(
    reviewOutcomes.flatMap((entry) =>
      entry.actor ? [[reviewerKey(entry.actor.login), entry] as const] : [],
    ),
  );
  // Everyone whose face belongs on this row: the people a review was asked of, then anyone who
  // ruled without being on that list. A host drops a reviewer from the requested set once they
  // have reviewed, and their verdict is the thing this row now exists to show.
  const reviewerEntries = [
    ...detail.reviewers.map((actor) => ({
      key: actor.login,
      actor,
      outcome: outcomeByLogin.get(reviewerKey(actor.login))?.outcome ?? null,
      stale: outcomeByLogin.get(reviewerKey(actor.login))?.stale ?? false,
    })),
    ...reviewOutcomes
      .filter(
        (entry) =>
          !detail.reviewers.some(
            (actor) =>
              entry.actor !== null && reviewerKey(actor.login) === reviewerKey(entry.actor.login),
          ),
      )
      .map((entry) => ({
        key: entry.key,
        actor: entry.actor,
        outcome: entry.outcome,
        stale: entry.stale,
      })),
  ];

  const openLink = useOpenLink(threadRef);
  const openCheck = (url: string) => {
    void openLink(url).catch((error: unknown) => {
      console.error(error);
      toastManager.add({ type: "error", title: "Unable to open check details" });
    });
  };

  const update = useAtomCommand(pullRequestEnvironment.update, { reportFailure: false });
  const replyToThread = useAtomCommand(pullRequestEnvironment.replyToThread, {
    reportFailure: false,
  });
  const setThreadResolution = useAtomCommand(pullRequestEnvironment.setThreadResolution, {
    reportFailure: false,
  });
  const [threadPending, setThreadPending] = useState(false);
  // What is offered is what this host can do at all and what this account may do here, together.
  const canReplyToThreads = detail.capabilities.review.reply && detail.viewerPermissions.comment;
  const canResolveThreads = detail.capabilities.review.resolve;
  const runThreadCommand = async (
    failure: string,
    run: () => Promise<{ readonly _tag: string }>,
  ): Promise<boolean> => {
    if (threadPending) return false;
    setThreadPending(true);
    const result = await run();
    setThreadPending(false);
    if (result._tag === "Failure") {
      toastManager.add({ type: "error", title: failure });
      return false;
    }
    onRefresh();
    return true;
  };
  const updateComment = useAtomCommand(pullRequestEnvironment.updateComment, {
    reportFailure: false,
  });
  const [bodyScope, setBodyScope] = useState<string | null>(null);
  const [bodySaving, setBodySaving] = useState(false);
  // The remark being rewritten, named with the pull request it belongs to: a comment id is the
  // host's own, and two hosts — or two pull requests on Azure DevOps, which numbers a remark
  // inside its thread — hand out the same one. Without the pull request beside it, opening a
  // different one would leave its like-numbered remark sitting open in an editor.
  const [commentScope, setCommentScope] = useState<{
    readonly pullRequest: string;
    readonly commentId: string;
  } | null>(null);
  const [commentSaving, setCommentSaving] = useState(false);
  const editingCommentId = commentScope?.pullRequest === detail.url ? commentScope.commentId : null;

  const saveBody = async (body: string) => {
    if (bodySaving) return;
    setBodySaving(true);
    const result = await update({ environmentId, input: { ...reference, body } });
    setBodySaving(false);
    if (result._tag === "Failure") {
      toastManager.add({ type: "error", title: "Could not save the description" });
      return;
    }
    setBodyScope(null);
    onRefresh();
  };

  const commentEditing: CommentEditing = {
    cwd: detail.workspaceRoot,
    environmentId,
    threadRef,
    canEdit: (comment) => canEditPullRequestComment(detail, comment),
    editingId: editingCommentId,
    saving: commentSaving,
    onEdit: (comment) =>
      setCommentScope(comment === null ? null : { pullRequest: detail.url, commentId: comment.id }),
    onSave: async (comment, body) => {
      if (commentSaving || comment.kind === "review") return;
      setCommentSaving(true);
      const result = await updateComment({
        environmentId,
        input: { ...reference, commentId: comment.id, kind: comment.kind, body },
      });
      setCommentSaving(false);
      if (result._tag === "Failure") {
        toastManager.add({ type: "error", title: "Could not save the comment" });
        return;
      }
      setCommentScope(null);
      onRefresh();
    },
  };

  const fixButton = (finding: PullRequestFinding, beside: "comment" | "thread") =>
    onFixFinding ? (
      <Button
        size="xs"
        variant="ghost"
        className={beside === "comment" ? "-mt-1 shrink-0" : "shrink-0"}
        disabled={pendingFinding !== null && pendingFinding !== undefined}
        onClick={() => onFixFinding(finding)}
      >
        <HammerIcon className="size-3" />
        {pendingFinding === pullRequestFindingKey(finding) ? "Preparing..." : fixFindingLabel}
      </Button>
    ) : null;

  const renderEntry = (entry: PullRequestConversationEntry) => {
    if (entry.kind === "comment") return renderComment(entry.comment);
    const { thread } = entry;
    return (
      <ReviewThreadEntry
        key={`${detail.url}:thread:${thread.id}`}
        entry={entry}
        detail={detail}
        editing={commentEditing}
        environmentId={environmentId}
        reference={reference}
        canReply={canReplyToThreads}
        canResolve={canResolveThreads && canResolvePullRequestThread(detail, thread)}
        pending={threadPending}
        fixAction={thread.isResolved ? null : fixButton({ kind: "thread", thread }, "thread")}
        onReply={(body) =>
          runThreadCommand("Reply could not be posted", () =>
            replyToThread({ environmentId, input: { ...reference, threadId: thread.id, body } }),
          )
        }
        onToggleResolved={() =>
          void runThreadCommand("The conversation could not be updated", () =>
            setThreadResolution({
              environmentId,
              input: { ...reference, threadId: thread.id, resolved: !thread.isResolved },
            }),
          )
        }
        onRefresh={onRefresh}
      />
    );
  };

  const renderComment = (comment: PullRequestComment) => {
    const body = visibleBody(comment.body);
    if (pullRequestReviewOutcome(comment.reviewState) === "dismissed") {
      return (
        <CollapsedComment
          key={`${detail.url}:${comment.id}`}
          comment={comment}
          editing={commentEditing}
          detail={detail}
          label="Review dismissed"
          body={body}
          reactionBar={
            <PullRequestReactionBar
              className="ml-auto justify-end"
              reactions={comment.reactions ?? []}
              canReact={detail.capabilities.reactions === true}
              subjectId={comment.id}
              environmentId={environmentId}
              reference={reference}
              onRefresh={onRefresh}
            />
          }
        />
      );
    }
    const outcome = pullRequestReviewOutcome(comment.reviewState);
    // Nor is a remark with nothing in it: offering to hand an empty review to a thread promises
    // work it does not describe.
    const finding: PullRequestFinding | null =
      (comment.kind !== "review" && comment.kind !== "review-comment") ||
      outcome === "approved" ||
      body === null
        ? null
        : { kind: "comment", comment };
    const reactionBar = (
      <PullRequestReactionBar
        reactions={comment.reactions ?? []}
        canReact={detail.capabilities.reactions === true}
        subjectId={comment.id}
        environmentId={environmentId}
        reference={reference}
        onRefresh={onRefresh}
        className="ml-auto justify-end"
      />
    );
    return (
      <article
        key={`${detail.url}:${comment.id}`}
        // Offscreen comments skip style, layout and paint. Bot comments carry pages of
        // highlighted code, and the conversation is below the description either way.
        className="group rounded-lg border border-border/60 bg-background [contain-intrinsic-block-size:160px] [content-visibility:auto]"
      >
        <div className="flex flex-wrap items-baseline gap-2 rounded-t-lg bg-muted/25 px-3 py-2.5">
          <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-2 text-xs text-muted-foreground">
            <CommentIdentity comment={comment} detail={detail} />
            {outcome ? (
              <PullRequestReviewOutcomeBadge outcome={outcome} />
            ) : comment.reviewState ? (
              <span>{reviewStateLabel(comment.reviewState)}</span>
            ) : null}
          </div>
          {/* Review remarks only. A plain conversation comment is talk, not a finding,
                      and offering to fix one would promise more than it says. */}
          {finding ? fixButton(finding, "comment") : null}
          {reactionBar}
        </div>
        <CommentLocation className="mt-2 px-3" path={comment.path} />
        {/* A verdict usually carries no words, and an empty markdown block reads as
                          a card somebody forgot to fill in — the badge above already said it.
                          Kept where this reader may rewrite the remark: the pencil lives in here,
                          and hiding the block would take away the only way back to it. */}
        {body === null && !commentEditing.canEdit(comment) ? null : (
          <CommentBody className="px-3 py-3" comment={comment} editing={commentEditing} />
        )}
      </article>
    );
  };

  return (
    <div ref={scrollerRef} className="h-full overflow-y-auto" data-pull-request-summary-scroll>
      <section className="px-4 pt-2.5 pb-1">
        <div className="space-y-2">
          <MetaRow icon={<UsersIcon className="size-3.5" />} label="Reviewers">
            <span className="flex min-w-0 flex-wrap items-center gap-1.5">
              {reviewerEntries.length === 0 ? (
                <span className="text-muted-foreground">None</span>
              ) : (
                <span className="flex items-center -space-x-1">
                  {reviewerEntries.map((entry) => {
                    const login = entry.actor?.login ?? "ghost";
                    const named =
                      entry.actor?.name && entry.actor.name !== login
                        ? `${entry.actor.name} (@${login})`
                        : login;
                    return (
                      <Tooltip key={entry.key}>
                        <TooltipTrigger
                          render={
                            <span
                              className={cn(
                                "relative rounded-full hover:z-10",
                                entry.outcome
                                  ? pullRequestReviewOutcomeRingClassName(
                                      entry.outcome,
                                      entry.stale,
                                    )
                                  : undefined,
                              )}
                            />
                          }
                        >
                          <PullRequestActorLabel
                            actor={entry.actor}
                            tooltip={false}
                            variant="avatar"
                          />
                          {entry.outcome ? (
                            <span className="sr-only">
                              {entry.stale
                                ? pullRequestReviewOutcomeStaleLabel(entry.outcome)
                                : pullRequestReviewOutcomeLabel(entry.outcome)}
                            </span>
                          ) : null}
                        </TooltipTrigger>
                        <TooltipPopup side="bottom">
                          {entry.outcome
                            ? `${named} — ${
                                entry.stale
                                  ? pullRequestReviewOutcomeStaleLabel(entry.outcome)
                                  : pullRequestReviewOutcomeLabel(entry.outcome)
                              }`
                            : named}
                        </TooltipPopup>
                      </Tooltip>
                    );
                  })}
                </span>
              )}
              {/*
               * Azure DevOps is the exception — it takes a reviewer but will not
                  say who could be one, so there is nothing to open.
               */}
              {detail.capabilities.reviewers.request &&
              detail.capabilities.reviewers.listCandidates ? (
                <PullRequestReviewerPicker
                  environmentId={environmentId}
                  reference={reference}
                  allowed={detail.viewerPermissions.requestReviewers}
                />
              ) : null}
            </span>
          </MetaRow>
          {detail.labels.length > 0 || detail.capabilities.labels === true ? (
            <MetaRow icon={<TagIcon className="size-3.5" />} label="Labels">
              <span className="flex min-w-0 flex-wrap items-center gap-1">
                {detail.labels.length === 0 ? (
                  <span className="text-muted-foreground">None</span>
                ) : (
                  detail.labels.map((label) => (
                    <PullRequestLabelChip
                      key={label.name}
                      label={label}
                      size="default"
                      className="max-w-48"
                    />
                  ))
                )}
                {detail.capabilities.labels === true ? (
                  <PullRequestLabelPicker
                    environmentId={environmentId}
                    reference={reference}
                    allowed={detail.viewerPermissions.labels !== false}
                  />
                ) : null}
              </span>
            </MetaRow>
          ) : null}
        </div>
      </section>

      <Section key={`description:${detail.url}`} title="Description" keepMounted>
        <div className="group">
          {bodyScope === detail.url ? (
            <PullRequestMarkdownEditor
              allowEmpty
              value={detail.body}
              cwd={detail.workspaceRoot}
              environmentId={environmentId}
              threadRef={threadRef}
              label="Pull request description"
              placeholder="Describe this pull request"
              saving={bodySaving}
              onSave={(body) => void saveBody(body)}
              onCancel={() => setBodyScope(null)}
            />
          ) : (
            <div className="flex items-start gap-1">
              {detail.body.trim().length > 0 ? (
                <PullRequestQuoteSource
                  className="min-w-0 flex-1"
                  source="description"
                  author={detail.author}
                  url={detail.url}
                >
                  <PullRequestMarkdown
                    text={detail.body}
                    cwd={detail.workspaceRoot}
                    environmentId={environmentId}
                    threadRef={threadRef}
                  />
                </PullRequestQuoteSource>
              ) : (
                <PullRequestMarkdown
                  className="min-w-0 flex-1"
                  text="_No description provided._"
                  cwd={detail.workspaceRoot}
                  environmentId={environmentId}
                  threadRef={threadRef}
                />
              )}
              {canEditPullRequestChangeRequest(detail) ? (
                <PullRequestEditButton
                  aria-label="Edit description"
                  onClick={() => setBodyScope(detail.url)}
                />
              ) : null}
            </div>
          )}
        </div>
      </Section>

      <Section key={`checks:${detail.url}`} title="Checks" defaultOpen={false}>
        {checksStale ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Check details are out of date.</span>
            <Button size="xs" variant="ghost" onClick={onRefreshChecks}>
              Refresh
            </Button>
          </div>
        ) : detail.checks.length === 0 ? (
          <p className="text-xs text-muted-foreground">No checks reported.</p>
        ) : (
          detail.checks.map((check, index) => {
            const finding = { kind: "check", check } as const;
            const failing = check.status === "failure" || check.status === "cancelled";
            return (
              <div
                key={`${index}:${check.name}:${check.url ?? ""}`}
                className="group flex items-center gap-2 rounded-md pr-1 hover:bg-accent/60"
              >
                <button
                  type="button"
                  disabled={!check.url}
                  onClick={() => check.url && openCheck(check.url)}
                  className={cn(
                    "flex min-w-0 flex-1 items-start gap-2 rounded-md px-2 py-2 text-left text-xs leading-5 [&>svg]:mt-0.5",
                    check.url ? "cursor-pointer" : "cursor-default",
                  )}
                >
                  <PullRequestCheckStatusIcon status={check.status} />
                  <span className="min-w-0 flex-1 wrap-anywhere">{check.name}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {pullRequestCheckStatusLabel(check)}
                  </span>
                </button>
                {onFixFinding && failing ? (
                  <Button
                    size="xs"
                    variant="ghost"
                    className="shrink-0"
                    disabled={pendingFinding !== null && pendingFinding !== undefined}
                    onClick={() => onFixFinding(finding)}
                  >
                    <HammerIcon className="size-3" />
                    {pendingFinding === pullRequestFindingKey(finding)
                      ? "Preparing..."
                      : fixCheckLabel}
                  </Button>
                ) : null}
              </div>
            );
          })
        )}
      </Section>

      <Section
        title={`Comments (${detail.commentCount})`}
        actions={
          <div className="flex shrink-0 items-center gap-1">
            <Menu>
              <MenuTrigger
                render={<Button size="xs" variant="ghost-muted" />}
                aria-label="Filter comments"
              >
                <ListFilterIcon aria-hidden className="size-3" />
                {filteredOutCount > 0 ? `${filteredOutCount} hidden` : "Filter"}
              </MenuTrigger>
              <MenuPopup align="end">
                <MenuGroup>
                  <MenuGroupLabel>Show</MenuGroupLabel>
                  <MenuCheckboxItem
                    checked={commentFilter.bots}
                    closeOnClick={false}
                    onCheckedChange={(bots) => setCommentFilter((value) => ({ ...value, bots }))}
                  >
                    Bot comments
                  </MenuCheckboxItem>
                  <MenuCheckboxItem
                    checked={commentFilter.resolved}
                    closeOnClick={false}
                    onCheckedChange={(resolved) =>
                      setCommentFilter((value) => ({ ...value, resolved }))
                    }
                  >
                    Resolved or dismissed
                  </MenuCheckboxItem>
                </MenuGroup>
              </MenuPopup>
            </Menu>
            <Button
              size="xs"
              variant="ghost-muted"
              aria-label={
                commentOrder === "newest"
                  ? "Show oldest comments first"
                  : "Show newest comments first"
              }
              onClick={() => setCommentOrder((value) => (value === "newest" ? "oldest" : "newest"))}
            >
              <ArrowDownUpIcon aria-hidden className="size-3" />
              {commentOrder === "newest" ? "Newest first" : "Oldest first"}
            </Button>
          </div>
        }
      >
        {activityPending ? (
          <PullRequestConversationGhost />
        ) : activityError ? (
          <PullRequestActivityUnavailableState compact error={activityError} onRetry={onRefresh} />
        ) : (
          <>
            {detail.commentsTruncated ? (
              <p className="mb-2 rounded-md border border-warning/30 bg-warning-surface px-2 py-1.5 text-xs">
                This conversation is longer than this page reads in one go. The most recent{" "}
                {detail.comments.length} are here; open it on the host to read the rest.
              </p>
            ) : null}
            {detail.comments.length === 0 ? (
              <p className="py-2 text-xs text-muted-foreground">No comments yet.</p>
            ) : filteredEntries.length === 0 ? (
              <p className="py-2 text-xs text-muted-foreground">
                {filteredOutCount === 1
                  ? "The only comment is hidden by the filter."
                  : `All ${filteredOutCount} comments are hidden by the filter.`}
              </p>
            ) : (
              <div className="space-y-3">
                {commentOrder === "oldest" ? showOldestCommentsButton : null}
                {visibleEntries.map(renderEntry)}
                {commentOrder === "newest" ? showOldestCommentsButton : null}
                {shownComments > COMMENT_PAGE ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="w-full"
                    onClick={() => setShown({ url: detail.url, count: COMMENT_PAGE })}
                  >
                    Show only {COMMENT_PAGE} recent comments
                  </Button>
                ) : null}
              </div>
            )}
          </>
        )}
      </Section>
    </div>
  );
}
