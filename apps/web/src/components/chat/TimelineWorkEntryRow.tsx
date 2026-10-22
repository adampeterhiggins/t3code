import { WorkLogDetails, WorkLogRow } from "./WorkLog";
import {
  getQuestionAnswerPreview,
  getQuestionAnswerText,
  getQuestionTextPreview,
  hasQuestionAnswer,
} from "@t3tools/client-runtime/work-log/user-input";
import {
  ORCHESTRATION_V2_WORKSPACE_PREPARATION_FAILURE_CODE,
  type EnvironmentId,
  ThreadId,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { Link } from "@tanstack/react-router";
import { notificationChildThreadId } from "@t3tools/client-runtime/state/thread-execution";
import {
  resolveViewedImageAsset,
  workEntryViewedImagePath,
} from "@t3tools/client-runtime/work-log/presentation";
import { turnItemHasDetail } from "@t3tools/client-runtime/work-log/item-detail";
import {
  toolEntryShowsPathBreadcrumbs,
  toolPathTargets,
} from "@t3tools/client-runtime/work-log/tool-paths";
import { memo, use, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  workEntryDisplayIndicatesToolFailure,
  workEntrySignalsSevereFailure,
  workLogEntryIsToolLike,
} from "../../session-logic";
import ChatMarkdown from "../ChatMarkdown";
import { ChatMarkdownAssetImage } from "./ChatMarkdownMedia";
import { ChevronRightIcon, CircleAlertIcon, CornerDownRightIcon } from "lucide-react";
import { InlineButton } from "../ui/button";
import { useAssetUrls } from "../../assets/assetUrls";
import { useQuietThreadShell, useThreadShell } from "../../state/entities";
import { usePreferredOpenPrLink, usePullRequestPreviewTarget } from "~/lib/openPullRequestLink";
import { PullRequestLinkPreview } from "../pullRequest/PullRequestLinkPreview";
import { parseComposerObjectLink } from "@t3tools/shared/composerObjectLinks";
import { useLinkClickHandler } from "~/browser/useOpenLink";
import { isPreviewableObjectLink, LinkedObjectLinkPreview } from "./LinkedObjectLinkPreview";
import {
  threadReadLabelPrefix,
  threadReadTargetId,
  threadReadTargetTitle,
  workEntryDisplayLabel,
} from "./MessagesTimeline.logic";
import { cn } from "~/lib/utils";
import { formatSecondsTimestamp, formatUpcomingTimestamp } from "../../timestampFormat";
import { PreviewCard, PreviewCardPopup, PreviewCardTrigger } from "../ui/preview-card";
import { useCursorAnchor } from "./CursorPreviewCard";
import { workEntryHasToolCallPreview } from "../../lib/toolCallPreview";
import { ToolPathText } from "./ToolPathText";
import { ThoughtPreviewContent } from "./ThoughtPreviewContent";
import { ToolCallDetails, toolCallDetailOutput } from "./ToolCallDetail";
import { SubagentNotificationLink } from "./V2LifecycleRow";
import {
  TimelineRowCtx,
  TimelineRowActivityCtx,
  WorkGroupPreviewCtx,
  WorkGroupViewCtx,
  type TimelineWorkEntry,
} from "./timelineRowContext";
import { ElapsedTimer, MESSAGE_HEADING_LEVEL, TimelineRowTimestamp } from "./TimelineRowParts";
import {
  SLOW_TOOL_CALL_MS,
  workEntryDurationMs,
  workEntryTiming,
} from "./TimelineWorkGroupRows.logic";
import { formatDuration } from "@t3tools/shared/orchestrationTiming";
import { type TimestampFormat } from "@t3tools/contracts/settings";
import { observeVisibleAnimation } from "../../lib/visibleAnimation";
import { failedToolIconClassName, ToolActivityIconView } from "./TimelineToolActivityIcon";
import {
  workToneIcon,
  workEntryRawCommand,
  buildToolCallExpandedBody,
  workEntryIconName,
  remarkThoughtPreview,
  pullRequestNotificationLabel,
  linkWatchNotificationLabel,
} from "./TimelineWorkEntryRow.logic";

export function useThreadReadTarget(entry: TimelineWorkEntry, environmentId: EnvironmentId) {
  const rawThreadId = threadReadTargetId(entry);
  const threadId = rawThreadId === null ? null : ThreadId.make(rawThreadId);
  const shell = useThreadShell(threadId ? scopeThreadRef(environmentId, threadId) : null);
  const title = threadReadTargetTitle(shell);
  return threadId && title ? { threadId, title } : null;
}

export function threadReadLabel(label: string, target: ReturnType<typeof useThreadReadTarget>) {
  const prefix = target && threadReadLabelPrefix(label);
  return prefix ? { ...target, prefix, text: `${prefix} “${target.title}”` } : null;
}

export function ThreadReadLabel({
  label,
  environmentId,
  linked,
}: {
  label: NonNullable<ReturnType<typeof threadReadLabel>>;
  environmentId: EnvironmentId;
  linked: boolean;
}) {
  return (
    <span className="flex min-w-0">
      <span className="shrink-0">{label.prefix} “</span>
      {linked ? (
        <Link
          to="/$environmentId/$threadId"
          params={{ environmentId, threadId: label.threadId }}
          className="min-w-0 truncate rounded-sm text-foreground underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          onClick={stopRowToggle}
          onKeyDown={stopRowToggle}
        >
          {label.title}
        </Link>
      ) : (
        <span className="min-w-0 truncate">{label.title}</span>
      )}
      <span className="shrink-0">”</span>
    </span>
  );
}

const stopRowToggle = (e: { stopPropagation: () => void }) => e.stopPropagation();

function PullRequestNotificationLabel({
  label,
  environmentId,
}: {
  label: NonNullable<ReturnType<typeof pullRequestNotificationLabel>>;
  environmentId: EnvironmentId;
}) {
  const { threadRef } = use(TimelineRowCtx);
  const previewTarget = usePullRequestPreviewTarget(environmentId, label.url);
  const openPrLink = usePreferredOpenPrLink(threadRef ?? undefined);
  const link = (
    <a
      href={label.url}
      target="_blank"
      rel="noreferrer"
      className="rounded-sm text-foreground underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
      onClick={(event) => openPrLink(event, label.url)}
      onKeyDown={stopRowToggle}
    >
      {label.reference}
    </a>
  );
  return (
    <>
      {previewTarget === null ? (
        link
      ) : (
        <PullRequestLinkPreview link={link} originalUrl={label.url} target={previewTarget} />
      )}
      {label.rest}
    </>
  );
}

function LinkWatchNotificationLabel({
  label,
  environmentId,
}: {
  label: NonNullable<ReturnType<typeof linkWatchNotificationLabel>>;
  environmentId: EnvironmentId;
}) {
  const { threadRef } = use(TimelineRowCtx);
  const openLink = useLinkClickHandler(threadRef);
  const objectLink = parseComposerObjectLink(label.url);
  if (!isPreviewableObjectLink(objectLink)) return `${label.subject}${label.rest}`;
  const link = (
    <a
      href={label.url}
      target="_blank"
      rel="noreferrer"
      className="rounded-sm text-foreground underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
      onClick={(event) => {
        event.stopPropagation();
        openLink(event, label.url);
      }}
      onKeyDown={stopRowToggle}
    >
      {label.subject}
    </a>
  );
  return (
    <>
      <LinkedObjectLinkPreview
        link={link}
        objectLink={objectLink}
        environmentId={environmentId}
        threadRef={threadRef ?? null}
      />
      {label.rest}
    </>
  );
}

/** Whether a call is still running: an in-progress status alone can outlive an interrupted run. */
export function useWorkEntryIsRunning() {
  const { isWorking, latestRunId } = use(TimelineRowActivityCtx);
  return (entry: TimelineWorkEntry) =>
    isWorking && entry.runId === latestRunId && entry.toolLifecycleStatus === "inProgress";
}

function ThoughtMarkdown({
  entry,
  streaming,
  className,
}: {
  entry: TimelineWorkEntry;
  streaming: boolean;
  className: string;
}) {
  const ctx = use(TimelineRowCtx);
  return (
    <ChatMarkdown
      className={className}
      text={entry.detail ?? ""}
      cwd={ctx.markdownCwd}
      threadRef={ctx.threadRef ?? undefined}
      skills={ctx.skills}
      isStreaming={streaming}
      headingLevelOffset={MESSAGE_HEADING_LEVEL}
      onUseArtifactTemplate={ctx.onUseArtifactTemplate}
      onImageExpand={ctx.onImageExpand}
      lineBreaks
    />
  );
}

export function ReasoningTraceContent({ entries }: { entries: ReadonlyArray<TimelineWorkEntry> }) {
  const isStreaming = useWorkEntryIsRunning();
  return (
    <WorkLogDetails followLive={entries.some(isStreaming)}>
      {entries.map((entry) => (
        <ThoughtMarkdown
          key={entry.id}
          entry={entry}
          streaming={isStreaming(entry)}
          className="text-foreground"
        />
      ))}
    </WorkLogDetails>
  );
}

/** Mounted only while the row's hover card is open. */
function ThoughtPreview({ entry }: { entry: TimelineWorkEntry }) {
  const { timestampFormat } = use(TimelineRowCtx);
  const streaming = useWorkEntryIsRunning()(entry);
  return (
    <ThoughtPreviewContent
      streaming={streaming}
      timestamp={formatSecondsTimestamp(entry.createdAt, timestampFormat)}
    >
      <ThoughtMarkdown entry={entry} streaming={streaming} className="text-xs" />
    </ThoughtPreviewContent>
  );
}

type WorkEntryRowProps = {
  workEntry: TimelineWorkEntry;
  workspaceRoot: string | undefined;
  displayLabel?: string | undefined;
  onToggleEntry?: ((collapsed: boolean) => void) | undefined;
};

export const SimpleWorkEntryRow = memo(function SimpleWorkEntryRow(props: WorkEntryRowProps) {
  const ctx = use(TimelineRowCtx);
  const item = props.workEntry.projectedItem?.item;
  const childThreadId =
    item?.type === "notification" ? notificationChildThreadId(item.source) : undefined;
  // Transcript citations find, pick, and tint each call by this id.
  return (
    <div data-work-entry-id={props.workEntry.id}>
      {item?.type !== "notification" || childThreadId === undefined ? (
        <WorkEntryLogRow {...props} />
      ) : (
        <SubagentNotificationLink
          parentRef={scopeThreadRef(ctx.activeThreadEnvironmentId, item.threadId)}
          childThreadId={childThreadId}
          outcome={item.outcome}
          createdAt={props.workEntry.createdAt}
          timestampFormat={ctx.timestampFormat}
          onOpenThread={ctx.onOpenThread}
          fallback={<WorkEntryLogRow {...props} />}
        />
      )}
    </div>
  );
});

function WorkEntryLogRow(props: WorkEntryRowProps) {
  const { workEntry, workspaceRoot, displayLabel } = props;
  const ctx = use(TimelineRowCtx);
  const { threadRef, onImageExpand, timestampFormat } = ctx;
  const { retryableWorkspacePreparationRunIds, onRetryWorkspacePreparation } = ctx;
  const threadTarget = useThreadReadTarget(workEntry, ctx.activeThreadEnvironmentId);
  const createdThread =
    workEntry.projectedItem?.item.type === "thread_created"
      ? workEntry.projectedItem.item
      : undefined;
  const notifiedSubagentThreadId =
    workEntry.projectedItem?.item.type === "notification"
      ? notificationChildThreadId(workEntry.projectedItem.item.source)
      : undefined;
  // The thread's pull request links name the one older watch notifications are about.
  const watchedThread = useQuietThreadShell(
    workEntry.projectedItem?.item.type === "notification" &&
      workEntry.projectedItem.item.source.kind === "monitor"
      ? (threadRef ?? null)
      : null,
  );
  const groupView = use(WorkGroupViewCtx);
  const inPreviewCard = use(WorkGroupPreviewCtx);
  const running = useWorkEntryIsRunning()(workEntry);
  const [expanded, setExpanded] = useState(
    () => groupView?.state.expandedEntries.has(workEntry.id) ?? false,
  );
  const [previewOpen, setPreviewOpen] = useState(false);
  const previewAnchor = useCursorAnchor();
  const toggleExpanded = () => {
    setPreviewOpen(false);
    const next = !expanded;
    if (groupView) {
      groupView.onToggleEntry(!next);
      if (next) groupView.state.expandedEntries.add(workEntry.id);
      else groupView.state.expandedEntries.delete(workEntry.id);
    } else {
      props.onToggleEntry?.(!next);
    }
    setExpanded(next);
  };
  const failureItem = workEntry.projectedItem?.item;
  if (failureItem?.type === "error" && failureItem.status === "failed") {
    const warning = failureItem.failure.class === "usage_limit";
    const resetAt = failureItem.failure.resetAt;
    const resetTime = resetAt ? formatUpcomingTimestamp(resetAt, timestampFormat) : null;
    const label = warning
      ? `Usage limit reached.${resetTime ? ` Retry after ${resetTime}.` : ""}`
      : workEntry.label;
    const retryRunId =
      failureItem.runId !== null &&
      retryableWorkspacePreparationRunIds.has(failureItem.runId) &&
      failureItem.failure.code === ORCHESTRATION_V2_WORKSPACE_PREPARATION_FAILURE_CODE
        ? failureItem.runId
        : null;
    return (
      <WorkLogRow
        data-v2-item-type="error"
        data-v2-item-visibility={workEntry.projectedItem?.visibility}
        wrapLabel
        icon={
          <CircleAlertIcon
            className={cn("size-4", warning ? "text-warning" : "text-destructive")}
          />
        }
        label={
          <span
            className={cn("text-sm font-medium", warning ? "text-warning" : "text-destructive")}
          >
            {label}
          </span>
        }
        trailing={
          // Matches the timestamp's size and centres on the first label line, since wrapLabel top-aligns the row.
          <span className="flex min-h-6 shrink-0 items-center gap-2 text-xs">
            {retryRunId !== null && onRetryWorkspacePreparation ? (
              <InlineButton onClick={() => onRetryWorkspacePreparation(retryRunId)}>
                Retry
              </InlineButton>
            ) : null}
            <InlineButton
              tone="muted"
              render={
                <Link
                  to="/settings/diagnostics"
                  search={{ machine: ctx.activeThreadEnvironmentId }}
                />
              }
            >
              View diagnostics
            </InlineButton>
            <TimelineRowTimestamp
              createdAt={workEntry.createdAt}
              timestampFormat={timestampFormat}
              alwaysVisible
            />
          </span>
        }
      >
        {!warning ? (
          <p className="ms-7 whitespace-pre-wrap break-words px-0.5 py-1 text-sm leading-relaxed text-foreground/80">
            {failureItem.failure.message}
          </p>
        ) : null}
      </WorkLogRow>
    );
  }
  const iconConfig = workToneIcon(workEntry.tone);
  const showWarningIndicator = workEntry.sourceActivityKind === "runtime.warning";
  const showFailedIndicator =
    !showWarningIndicator && workEntryDisplayIndicatesToolFailure(workEntry);
  const showDestructiveRowStyle =
    !showWarningIndicator &&
    showFailedIndicator &&
    (workEntrySignalsSevereFailure(workEntry) || !workLogEntryIsToolLike(workEntry));
  const entryIconName =
    showWarningIndicator || showDestructiveRowStyle ? "circle-alert" : workEntryIconName(workEntry);
  const entryToolIcon =
    showWarningIndicator || showDestructiveRowStyle
      ? undefined
      : (workEntry.toolIcon ?? workEntry.toolSource?.icon);
  const isReasoning = workEntry.itemType === "reasoning";
  const questionHeading = workEntry.questionAnswer
    ? getQuestionTextPreview(workEntry.questionAnswer)
    : "";
  const previewText =
    isReasoning && expanded
      ? workEntry.toolLifecycleStatus === "inProgress"
        ? "Thinking"
        : "Thought"
      : questionHeading || (displayLabel ?? workEntryDisplayLabel(workEntry, workspaceRoot));
  const answerPreview =
    workEntry.questionAnswer && hasQuestionAnswer(workEntry.questionAnswer)
      ? getQuestionAnswerPreview(workEntry.questionAnswer)
      : null;
  const viewedImagePath = workEntryViewedImagePath(workEntry);
  const { plainOutput, plainOutputFetches } = toolCallDetailOutput(workEntry, workspaceRoot);
  const viewedImage =
    viewedImagePath && threadRef
      ? resolveViewedImageAsset(viewedImagePath, {
          threadId: threadRef.threadId,
          workspaceRoot,
        })
      : null;
  const canExpand =
    previewText.trim().length > 0 ||
    (workEntry.itemType === "dynamic_tool" && workEntry.toolData !== undefined) ||
    Boolean(
      workEntryRawCommand(workEntry) ||
      workEntry.command?.trim() ||
      workEntry.detail?.trim() ||
      workEntry.changedFiles?.length ||
      viewedImage,
    );
  const expandedBody =
    expanded && !isReasoning
      ? plainOutput !== undefined
        ? plainOutput
        : buildToolCallExpandedBody(
            workEntry,
            workspaceRoot,
            previewText,
            viewedImage ? viewedImagePath : null,
          )
      : null;
  const canExpandProjectedItem =
    plainOutput !== undefined
      ? Boolean(plainOutput || viewedImage || workEntry.questionAnswer || plainOutputFetches)
      : workEntry.projectedItem === undefined
        ? canExpand
        : isReasoning
          ? Boolean(workEntry.detail?.trim())
          : Boolean(
              viewedImage ||
              workEntry.questionAnswer ||
              turnItemHasDetail(workEntry.projectedItem.item),
            );
  const iconWrapperClass = cn(
    "flex size-4 items-center justify-center",
    showWarningIndicator
      ? "text-warning"
      : showDestructiveRowStyle
        ? "text-destructive"
        : showFailedIndicator
          ? failedToolIconClassName
          : workEntry.tone === "tool"
            ? "text-icon-muted"
            : iconConfig.className,
  );
  const headingClass = showWarningIndicator
    ? "font-medium text-warning"
    : showDestructiveRowStyle
      ? "font-medium text-destructive"
      : workLogEntryIsToolLike(workEntry)
        ? "text-secondary-label"
        : "text-foreground/80";
  const showsPaths = toolEntryShowsPathBreadcrumbs(workEntry);
  const threadLabel = isReasoning ? null : threadReadLabel(previewText, threadTarget);
  const pullRequestLabel = pullRequestNotificationLabel(
    workEntry,
    previewText,
    watchedThread?.pullRequests ?? [],
  );
  const linkWatchLabel = linkWatchNotificationLabel(workEntry, previewText);
  const accessiblePreview = [threadLabel?.text ?? previewText, answerPreview]
    .filter(Boolean)
    .join(": ");
  const accessibleDisplayText = showFailedIndicator
    ? `${accessiblePreview}, tool call failed`
    : accessiblePreview;
  const rowToggleProps = canExpandProjectedItem
    ? {
        role: "button" as const,
        tabIndex: 0 as const,
        "aria-label": accessibleDisplayText,
        "aria-expanded": expanded,
        onClick: toggleExpanded,
        onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
          if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            toggleExpanded();
          }
        },
      }
    : {};

  const row = (
    <WorkLogRow
      data-v2-item-type={workEntry.projectedItem?.item.type}
      data-v2-item-visibility={workEntry.projectedItem?.visibility}
      wrapLabel={answerPreview !== null}
      {...rowToggleProps}
      icon={
        <span
          className={iconWrapperClass}
          role={showFailedIndicator ? "img" : undefined}
          aria-label={showFailedIndicator ? "Tool call failed" : undefined}
        >
          <ToolActivityIconView
            icon={entryToolIcon}
            fallbackName={entryIconName}
            className="block size-4 shrink-0 stroke-2"
            muted
          />
        </span>
      }
      label={
        answerPreview !== null ? (
          <QuestionAnswerLabel
            question={previewText}
            answer={answerPreview}
            className={headingClass}
            answerMuted={expanded}
          />
        ) : (
          <div className="min-w-0 flex-1 overflow-hidden">
            <p className="flex min-w-0 w-full items-baseline gap-1.5 text-sm leading-relaxed">
              <span
                ref={inPreviewCard && running ? observeVisibleAnimation : undefined}
                className={cn(
                  "min-w-0 flex-1",
                  showsPaths ? "overflow-hidden" : "truncate",
                  headingClass,
                  inPreviewCard && running && "live-tool-shine",
                )}
              >
                {isReasoning && !expanded ? (
                  <ChatMarkdown
                    inline
                    text={workEntry.detail ?? previewText}
                    cwd={ctx.markdownCwd}
                    parseRawHtml={false}
                    extraRemarkPlugins={[
                      [
                        remarkThoughtPreview,
                        workEntry.toolLifecycleStatus === "inProgress" ? "Thinking" : "Thought",
                      ],
                    ]}
                  />
                ) : pullRequestLabel ? (
                  <PullRequestNotificationLabel
                    label={pullRequestLabel}
                    environmentId={ctx.activeThreadEnvironmentId}
                  />
                ) : linkWatchLabel ? (
                  <LinkWatchNotificationLabel
                    label={linkWatchLabel}
                    environmentId={ctx.activeThreadEnvironmentId}
                  />
                ) : threadLabel ? (
                  <ThreadReadLabel
                    label={threadLabel}
                    environmentId={ctx.activeThreadEnvironmentId}
                    linked
                  />
                ) : showsPaths ? (
                  <ToolPathText
                    targets={toolPathTargets(workEntry)}
                    text={previewText}
                    environmentId={ctx.activeThreadEnvironmentId}
                    workspaceRoot={workspaceRoot}
                    singleLine
                  />
                ) : (
                  previewText
                )}
              </span>
            </p>
          </div>
        )
      }
      trailing={
        <>
          {createdThread ? (
            <InlineButton
              aria-label={`Open ${createdThread.title ?? "created thread"}`}
              onClick={(event) => {
                event.stopPropagation();
                ctx.onOpenThread(createdThread.targetThreadId);
              }}
              onKeyDown={stopRowToggle}
            >
              Open chat
            </InlineButton>
          ) : null}
          {notifiedSubagentThreadId ? (
            <InlineButton
              aria-label="Open subagent thread"
              onClick={(event) => {
                event.stopPropagation();
                ctx.onOpenThread(notifiedSubagentThreadId);
              }}
              onKeyDown={stopRowToggle}
            >
              Open subagent
            </InlineButton>
          ) : null}
          {inPreviewCard ? (
            <WorkEntryDuration
              workEntry={workEntry}
              running={running}
              timestampFormat={timestampFormat}
            />
          ) : (
            <TimelineRowTimestamp
              createdAt={workEntry.createdAt}
              timestampFormat={timestampFormat}
            />
          )}
          <span
            className={cn(
              "flex size-4 shrink-0 items-center justify-center",
              !canExpandProjectedItem && "invisible",
            )}
            aria-hidden
          >
            <ChevronRightIcon
              className={cn(
                "size-3 shrink-0 text-icon-muted opacity-70 transition-transform duration-200",
                expanded && "rotate-90",
              )}
            />
          </span>
        </>
      }
    >
      {expanded && viewedImage && threadRef ? (
        <WorkLogDetails kind="media">
          <ChatMarkdownAssetImage
            environmentId={threadRef.environmentId}
            resource={viewedImage.resource}
            alt={viewedImage.alt}
            srcFragment={viewedImage.srcFragment}
            workspaceRoot={workspaceRoot}
            maxHeightRem={16}
            onImageExpand={onImageExpand}
          />
        </WorkLogDetails>
      ) : null}
      {expanded && workEntry.questionAnswer ? (
        <QuestionAnswerHistory answer={workEntry.questionAnswer} />
      ) : null}
      {expanded && isReasoning ? <ReasoningTraceContent entries={[workEntry]} /> : null}
      {expanded &&
      !isReasoning &&
      !workEntry.questionAnswer &&
      canExpandProjectedItem &&
      (expandedBody ||
        plainOutputFetches ||
        (workEntry.projectedItem && plainOutput === undefined)) ? (
        <WorkLogDetails kind="panel">
          <ToolCallDetails
            {...ctx}
            workEntry={workEntry}
            workspaceRoot={workspaceRoot}
            textBody={expandedBody}
            previewText={previewText}
            icon={null}
          />
        </WorkLogDetails>
      ) : null}
    </WorkLogRow>
  );

  const hasThoughtPreview = isReasoning && Boolean(workEntry.detail?.trim());
  // The card stays mounted while expanded so toggling never remounts the row.
  if (!hasThoughtPreview && !workEntryHasToolCallPreview(workEntry, canExpandProjectedItem))
    return row;
  return (
    <PreviewCard
      open={!expanded && previewOpen}
      onOpenChange={(open) => {
        if (open) previewAnchor.pin();
        setPreviewOpen(!expanded && open);
      }}
    >
      <PreviewCardTrigger
        render={row}
        delay={300}
        closeDelay={150}
        {...previewAnchor.triggerProps}
      />
      <PreviewCardPopup {...previewAnchor.popupProps} className="w-md max-w-[calc(100vw-2rem)]">
        {hasThoughtPreview ? (
          <ThoughtPreview entry={workEntry} />
        ) : (
          <ToolCallDetails
            preview
            {...ctx}
            workEntry={workEntry}
            workspaceRoot={workspaceRoot}
            previewText={previewText}
            icon={
              <span className={cn(iconWrapperClass, "mt-px size-3.5 shrink-0")}>
                <ToolActivityIconView
                  icon={entryToolIcon}
                  fallbackName={entryIconName}
                  className="block size-3.5 shrink-0 stroke-2"
                  muted
                />
              </span>
            }
          />
        )}
      </PreviewCardPopup>
    </PreviewCard>
  );
}

/** A call the provider never timed keeps its timestamp. */
function WorkEntryDuration({
  workEntry,
  running,
  timestampFormat,
}: {
  workEntry: TimelineWorkEntry;
  running: boolean;
  timestampFormat: TimestampFormat;
}) {
  const durationMs = workEntryDurationMs(workEntry);
  if (!running && durationMs === null) {
    return (
      <TimelineRowTimestamp
        createdAt={workEntry.createdAt}
        timestampFormat={timestampFormat}
        alwaysVisible
      />
    );
  }
  return (
    <span
      className={cn(
        "me-1 shrink-0 whitespace-nowrap text-xs tabular-nums",
        running || (durationMs ?? 0) >= SLOW_TOOL_CALL_MS
          ? "text-foreground"
          : "text-muted-foreground",
      )}
    >
      {running ? (
        <>
          <ElapsedTimer since={workEntryTiming(workEntry).startedAt} />…
        </>
      ) : (
        formatDuration(durationMs ?? 0)
      )}
    </span>
  );
}

export function QuestionAnswerLabel({
  question,
  answer,
  className,
  answerMuted = false,
}: {
  question: ReactNode;
  answer: string;
  className?: string;
  answerMuted?: boolean;
}) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className={cn("line-clamp-2 break-words", className)}>{question}</span>
      <span
        className={cn(
          "flex min-w-0 items-center gap-1.5",
          answerMuted ? "text-muted-foreground" : "text-foreground",
        )}
      >
        <CornerDownRightIcon aria-hidden className="size-3.5 shrink-0 text-icon-muted" />
        <span className="min-w-0 truncate">{answer}</span>
      </span>
    </span>
  );
}

function QuestionAnswerHistory({
  answer,
}: {
  answer: import("@t3tools/contracts").UserInputAttachmentAnswerPayload;
}) {
  const { activeThreadEnvironmentId } = use(TimelineRowCtx);
  const attachments = Object.values(answer.attachmentsByQuestionId).flat();
  const resources = attachments.map((attachment) => ({
    _tag: "attachment" as const,
    attachmentId: attachment.id,
  }));
  const urls = useAssetUrls(activeThreadEnvironmentId, resources);
  return (
    <div className="ms-7 mt-2 space-y-2" onClick={stopRowToggle}>
      {[
        ...new Set([
          ...Object.keys(answer.questionTextById ?? {}),
          ...Object.keys(answer.answers),
          ...Object.keys(answer.attachmentsByQuestionId),
        ]),
      ].map((questionId) => (
        <div key={questionId} className="space-y-1">
          {answer.questionTextById?.[questionId] ? (
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">
              {answer.questionTextById[questionId]}
            </p>
          ) : null}
          {getQuestionAnswerText(answer.answers[questionId]) ? (
            <p className="ms-3 whitespace-pre-wrap text-sm text-muted-foreground">
              {getQuestionAnswerText(answer.answers[questionId])}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {(answer.attachmentsByQuestionId[questionId] ?? []).map((attachment) => {
              const url = urls[attachments.indexOf(attachment)];
              return (
                <a
                  key={attachment.id}
                  href={url ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm underline"
                >
                  {attachment.type === "image" && url ? (
                    <img
                      src={url}
                      alt={attachment.name}
                      className="h-20 max-w-32 rounded object-contain"
                    />
                  ) : (
                    attachment.name
                  )}
                </a>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
