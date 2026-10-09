import type { PreviewCard as PreviewCardPrimitive } from "@base-ui/react/preview-card";
import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, PullRequestActor, PullRequestRef } from "@t3tools/contracts";
import {
  cloneElement,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";

import { useLinkClickHandler } from "~/browser/useOpenLink";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { pullRequestEnvironment } from "~/state/pullRequests";
import { useAtomQueryRunner } from "~/state/use-atom-query-runner";
import { useEnvironmentQuery } from "~/state/query";

import { useCursorAnchor } from "../chat/CursorPreviewCard";
import { PreviewCard, PreviewCardPopup, PreviewCardTrigger } from "../ui/preview-card";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  findPullRequestComment,
  pullRequestCommentChoiceLocation,
  pullRequestDiffLinesAnchor,
} from "./pullRequestDetail.logic";
import { PullRequestActorAvatar, resolvePullRequestState } from "./pullRequestPresentation";

interface PullRequestLinkPreviewTarget {
  readonly environmentId: EnvironmentId;
  readonly input: PullRequestRef;
}

function actorLabel(actor: PullRequestActor | null): string {
  if (actor === null) return "ghost";
  return actor.name && actor.name !== actor.login ? `${actor.name} (@${actor.login})` : actor.login;
}

/** A link to one remark (`#issuecomment-1`, `#discussion_r1`) rather than the whole change. */
function linksToComment(url: string): boolean {
  try {
    return new URL(url).hash.length > 1 && pullRequestDiffLinesAnchor(url) === null;
  } catch {
    return false;
  }
}

type PullRequestLinkElement = ReactElement<
  ComponentPropsWithoutRef<"a"> | ComponentPropsWithoutRef<"button">
>;

export function PullRequestLinkPreview({
  link,
  originalUrl,
  target,
  confirmBeforeOpen,
  onOpenPullRequest,
  onOpenFallback,
  fallback,
}: {
  link: PullRequestLinkElement;
  originalUrl: string;
  target: PullRequestLinkPreviewTarget;
  confirmBeforeOpen?: boolean;
  onOpenPullRequest?: (url: string) => boolean;
  onOpenFallback?: (url: string) => Promise<void>;
  fallback?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const cursorAnchor = useCursorAnchor();
  const previewActionsRef = useRef<PreviewCardPrimitive.Root.Actions | null>(null);
  const [resolvingClick, setResolvingClick] = useState(false);
  const openLink = useLinkClickHandler(null);
  const detailQuery = useEnvironmentQuery(
    open
      ? pullRequestEnvironment.detail({
          environmentId: target.environmentId,
          input: target.input,
        })
      : null,
  );
  const activityQuery = useEnvironmentQuery(
    open && linksToComment(originalUrl)
      ? pullRequestEnvironment.activity({
          environmentId: target.environmentId,
          input: target.input,
        })
      : null,
  );
  const readPreview = useAtomQueryRunner(pullRequestEnvironment.preview, {
    reportFailure: false,
    reportDefect: false,
  });
  const trigger =
    confirmBeforeOpen === true
      ? cloneElement(link, {
          onClick: (event: MouseEvent<HTMLAnchorElement | HTMLButtonElement>) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            event.stopPropagation();
            if (resolvingClick) return;
            setOpen(false);
            setResolvingClick(true);
            void readPreview(target)
              .then(async (result) => {
                if (isAtomCommandInterrupted(result)) return;
                if (result._tag === "Success" && onOpenPullRequest?.(result.value.url)) return;
                await onOpenFallback?.(originalUrl);
              })
              .catch((error: unknown) => {
                console.error("[pull-request-link-preview] failed to open link", error);
              })
              .finally(() => setResolvingClick(false));
          },
        })
      : link;
  const detail = detailQuery.data;
  const showCard = detail !== null || (detailQuery.error !== null && fallback !== undefined);
  const showUrlTooltip = open && detailQuery.error !== null && !showCard;
  const state =
    detail === null
      ? null
      : resolvePullRequestState({ state: detail.state, isDraft: detail.isDraft });
  const linkedComment =
    activityQuery.data === null ? null : findPullRequestComment(activityQuery.data, originalUrl);

  return (
    <PreviewCard
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) cursorAnchor.pin();
        setOpen(nextOpen);
      }}
      actionsRef={previewActionsRef}
    >
      <Tooltip
        open={showUrlTooltip}
        onOpenChange={(nextOpen) => {
          // Cancel the card's delayed hover too, without changing its content preview.
          if (!nextOpen && !showCard) previewActionsRef.current?.close();
        }}
      >
        <PreviewCardTrigger
          render={<TooltipTrigger render={trigger} />}
          delay={350}
          closeDelay={120}
          {...cursorAnchor.triggerProps}
        />
        <TooltipPopup side="top">{originalUrl}</TooltipPopup>
      </Tooltip>
      {showCard ? (
        <PreviewCardPopup {...cursorAnchor.popupProps} className="w-80 max-w-[calc(100vw-2rem)]">
          <div className="p-3">
            {detail === null ? (
              fallback
            ) : (
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-1.5 text-2xs text-muted-foreground">
                  <span className="min-w-0 truncate">{detail.repository}</span>
                  <span className="shrink-0">#{detail.number}</span>
                  <span aria-hidden>·</span>
                  {state === null ? null : (
                    <span className="inline-flex shrink-0 items-center gap-1">
                      <state.Icon aria-hidden className={`size-3 ${state.toneClassName}`} />
                      {state.label}
                    </span>
                  )}
                  <a
                    href={linkedComment?.comment.url ?? detail.url}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-auto shrink-0 pl-2 underline-offset-2 hover:text-foreground hover:underline"
                    onClick={(event) => openLink(event, linkedComment?.comment.url ?? detail.url)}
                  >
                    Open
                  </a>
                </div>
                <p className="mt-1 text-sm font-medium leading-snug text-foreground text-pretty">
                  {detail.title}
                </p>
                {linkedComment === null ? (
                  <div className="mt-2 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                    <PullRequestActorAvatar actor={detail.author} className="size-4" />
                    <span className="min-w-0 truncate">{actorLabel(detail.author)}</span>
                    <span aria-hidden>·</span>
                    <span className="shrink-0">
                      opened {formatRelativeTimeLabel(detail.createdAt)}
                    </span>
                  </div>
                ) : (
                  <div className="mt-2 border-t border-border/60 pt-2">
                    <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                      <PullRequestActorAvatar
                        actor={linkedComment.comment.author}
                        className="size-4"
                      />
                      <span className="min-w-0 truncate">
                        {actorLabel(linkedComment.comment.author)}
                      </span>
                      <span aria-hidden>·</span>
                      <span className="shrink-0">
                        {formatRelativeTimeLabel(linkedComment.comment.createdAt)}
                      </span>
                      <span className="ml-auto min-w-0 truncate pl-2">
                        {pullRequestCommentChoiceLocation(linkedComment)}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-4 whitespace-pre-wrap break-words text-xs text-foreground">
                      {linkedComment.comment.body}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </PreviewCardPopup>
      ) : null}
    </PreviewCard>
  );
}
