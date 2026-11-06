import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { AssistantCitation, ThreadId } from "@t3tools/contracts";
import {
  assistantCitationLabel,
  serializeAssistantCitation,
} from "@t3tools/shared/assistantCitations";
import { Link, useNavigate } from "@tanstack/react-router";
import { PencilIcon, QuoteIcon } from "lucide-react";
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import {
  findAssistantCitationSourceAnchor,
  type AssistantCitationSourceAnchor,
} from "~/lib/assistantTextSelection";
import {
  assistantCitationHash,
  assistantCitationNavigation,
} from "../../lib/assistantCitationNavigation";
import { cn } from "~/lib/utils";
import { useThreadShell } from "~/state/entities";
import ChatMarkdown, { type ChatMarkdownContextReference } from "../ChatMarkdown";
import { ContextChip, ContextChipAction, ContextChipLabel } from "../ContextChip";
import { ContextChipPopover } from "../contextChipParts";
import { Popover, PopoverClose, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { PreviewCard, PreviewCardPopup, PreviewCardTrigger } from "../ui/preview-card";
import { getVirtualizedScrollFadeClassName } from "../ui/scroll-area";
import {
  AssistantCitationCommentEditor,
  type AssistantCitationDestinations,
  type CitationCommentInputHandle,
  type CitationCommentInputProps,
} from "./AssistantCitationCommentEditor";
import { resolveAssistantCitationCommentDismissal } from "./assistantCitationCommentDismissal";
import { observeAssistantCitationCommentSource } from "./AssistantCitationSource";
import { composerFloatingLayerProps, isInsideComposerMenuLayer } from "./composerEventScope";
import { observeResize } from "~/lib/observeResize";
import { textDirection } from "~/textDirection";

export function AssistantCitationChip({
  citation,
  composer = false,
  currentThreadId,
  renderContextReference,
  commentEditor,
}: {
  citation: AssistantCitation;
  composer?: boolean;
  /** The thread showing the chip; a quote from any other thread names where it came from. */
  currentThreadId?: ThreadId | undefined;
  /** Draws chips in the comment the way the surrounding text draws its own. */
  renderContextReference?: ((reference: ChatMarkdownContextReference) => ReactNode) | undefined;
  commentEditor?: {
    open: boolean;
    sourceAnchor?: AssistantCitationSourceAnchor | undefined;
    onOpenChange: (open: boolean) => void;
    onCancel?: () => void;
    onSave: (comment: string) => boolean;
    onSaveAndSend?: (comment: string) => boolean;
    onSaveAndSaveDraft?: (comment: string) => boolean;
    saveAndSendQueues?: boolean;
    onDraftChange?: (comment: string) => void;
    onRestoreFocus?: () => void;
    destinations?: AssistantCitationDestinations;
    renderInput: (props: CitationCommentInputProps) => ReactNode;
  };
}) {
  const navigate = useNavigate();
  const commentInputRef = useRef<CitationCommentInputHandle>(null);
  const commentPopupRef = useRef<HTMLDivElement>(null);
  const draftCommentRef = useRef<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [voiceSetupOpen, setVoiceSetupOpen] = useState(false);
  const [unavailableSourceAnchor, setUnavailableSourceAnchor] =
    useState<AssistantCitationSourceAnchor | null>(null);
  const commentOpen = commentEditor?.open ?? false;
  const sourceAnchor = commentEditor?.sourceAnchor;
  const activeSourceAnchor = sourceAnchor === unavailableSourceAnchor ? undefined : sourceAnchor;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- drops the uncommitted comment draft held in a ref once the parent closes the comment editor
  useEffect(() => {
    if (!commentOpen) draftCommentRef.current = null;
  }, [commentOpen]);
  const settleDraftOnClose = (reason: string): boolean => {
    const dismissal = resolveAssistantCitationCommentDismissal({
      reason,
      draft: draftCommentRef.current,
      savedComment: citation.comment,
    });
    if (dismissal.kind === "commit") return commentEditor?.onSave(dismissal.comment) ?? true;
    return dismissal.kind !== "keep-open";
  };
  const onSourceUnavailable = useEffectEvent(() => {
    if (!sourceAnchor) return;
    if (settleDraftOnClose("none")) {
      commentEditor?.onOpenChange(false);
    } else {
      setUnavailableSourceAnchor(sourceAnchor);
    }
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- observes the cited DOM source while the comment editor is open and reacts when it disappears
  useEffect(() => {
    if (!commentOpen || sourceAnchor === unavailableSourceAnchor) return;
    const anchor = sourceAnchor ?? findAssistantCitationSourceAnchor(document, citation);
    if (!anchor) return;
    return observeAssistantCitationCommentSource({
      anchor,
      citation,
      onUnavailable: onSourceUnavailable,
    });
  }, [citation, commentOpen, sourceAnchor, unavailableSourceAnchor]);
  const popupAnchor = activeSourceAnchor
    ? {
        contextElement: activeSourceAnchor.source,
        getBoundingClientRect: () => {
          const rects = activeSourceAnchor.range.getClientRects();
          const rect =
            rects.item(rects.length - 1) ?? activeSourceAnchor.range.getBoundingClientRect();
          // Code blocks and tables scroll sideways inside the message, so the cited
          // text can end in their hidden overflow. Base UI only shifts the popup while
          // it still touches the anchor, so clamp the anchor to the message's width.
          const bounds = activeSourceAnchor.source.getBoundingClientRect();
          const left = Math.min(Math.max(rect.left, bounds.left), bounds.right);
          const right = Math.max(Math.min(rect.right, bounds.right), left);
          return new DOMRect(left, rect.top, right - left, rect.height);
        },
      }
    : undefined;
  const label = assistantCitationLabel(citation);
  const quotedElsewhere = currentThreadId !== undefined && citation.threadId !== currentThreadId;
  const sourceThread = useThreadShell(
    quotedElsewhere ? scopeThreadRef(citation.environmentId, citation.threadId) : null,
  );
  const sourceTitle = quotedElsewhere ? sourceThread?.title || "another thread" : null;
  const sourceLine = sourceTitle ? (
    <span className="min-w-0 truncate">
      From <span className="text-foreground">{sourceTitle}</span>
    </span>
  ) : null;
  const sourceLinkProps = {
    to: "/$environmentId/$threadId" as const,
    params: { environmentId: citation.environmentId, threadId: citation.threadId },
    hash: assistantCitationHash(citation),
    "data-markdown-copy": serializeAssistantCitation(citation),
    resetScroll: false,
    onClick: (event: ReactMouseEvent<HTMLAnchorElement>) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      event.preventDefault();
      void navigate(assistantCitationNavigation(citation));
    },
  };
  // Hovering the label previews the quote, as a sent message's chip does; the preview stays
  // closed while the comment editor is open so the two never stack.
  const composerSourceLink = (
    <PreviewCard open={previewOpen && !commentOpen} onOpenChange={setPreviewOpen}>
      <PreviewCardTrigger
        delay={350}
        closeDelay={120}
        render={
          <Link
            {...sourceLinkProps}
            className="inline-flex h-full min-w-0 items-center gap-[0.33em] rounded-sm text-inherit no-underline focus-visible:outline-2 focus-visible:outline-foreground"
            aria-label={`View cited assistant text: ${label}`}
          />
        }
      >
        <QuoteIcon aria-hidden="true" />
        <ContextChipLabel className="max-w-[16em]" dir={textDirection(label)}>
          {label}
        </ContextChipLabel>
      </PreviewCardTrigger>
      <PreviewCardPopup {...composerFloatingLayerProps} className="w-96 max-w-[calc(100vw-2rem)]">
        <div className="flex max-h-[calc(var(--available-height)_-_1rem_-_2px)] flex-col gap-2 p-3 text-sm">
          {sourceLine ? (
            <div className="flex text-xs text-muted-foreground">{sourceLine}</div>
          ) : null}
          <AssistantCitationQuote
            citation={citation}
            renderContextReference={renderContextReference}
          />
        </div>
      </PreviewCardPopup>
    </PreviewCard>
  );
  if (!composer) {
    return (
      <ContextChipPopover
        kind="citation"
        icon={<QuoteIcon />}
        label={label}
        accessibleLabel={`Quoted assistant text: ${label}`}
        copyMarkdown={serializeAssistantCitation(citation)}
      >
        <div className="flex max-h-[calc(var(--available-height)_-_1rem_-_2px)] flex-col gap-2 p-1 text-sm">
          <div className="flex justify-end gap-3 text-xs text-muted-foreground">
            {sourceLine ? <span className="me-auto flex min-w-0">{sourceLine}</span> : null}
            <PopoverClose
              render={
                <Link
                  {...sourceLinkProps}
                  className="shrink-0 underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                />
              }
            >
              Go to source
            </PopoverClose>
          </div>
          <AssistantCitationQuote
            citation={citation}
            renderContextReference={renderContextReference}
          />
        </div>
      </ContextChipPopover>
    );
  }
  return (
    <ContextChip
      kind="citation"
      contentEditable={false}
      data-assistant-citation-chip="true"
      data-markdown-copy={serializeAssistantCitation(citation)}
    >
      {composerSourceLink}
      {commentEditor ? (
        <Popover
          open={commentEditor.open && !voiceSetupOpen}
          onOpenChange={(open, eventDetails) => {
            // The comment's own `@` and `#` menu floats outside this popup.
            if (
              !open &&
              eventDetails.reason === "outside-press" &&
              isInsideComposerMenuLayer(eventDetails.event.target)
            ) {
              eventDetails.cancel();
              return;
            }
            if (!open && !settleDraftOnClose(eventDetails.reason)) {
              eventDetails.cancel();
              return;
            }
            commentEditor.onOpenChange(open);
          }}
        >
          <PopoverTrigger
            aria-label={citation.comment ? "Edit citation comment" : "Add comment to citation"}
            data-citation-comment-trigger="true"
            render={<ContextChipAction />}
          >
            <PencilIcon aria-hidden="true" />
          </PopoverTrigger>
          {commentEditor.open ? (
            <PopoverPopup
              // The editor stays mounted while its voice setup dialog replaces the popover.
              keepMounted
              {...composerFloatingLayerProps}
              side={activeSourceAnchor ? "bottom" : "top"}
              align="end"
              anchor={popupAnchor}
              initialFocus={() => {
                commentInputRef.current?.focus();
                return false;
              }}
              finalFocus={
                commentEditor.onRestoreFocus
                  ? () => {
                      const activeElement = document.activeElement;
                      if (
                        activeElement === document.body ||
                        (activeElement !== null && commentPopupRef.current?.contains(activeElement))
                      ) {
                        commentEditor.onRestoreFocus?.();
                      }
                      return false;
                    }
                  : undefined
              }
              ref={commentPopupRef}
              aria-label="Edit citation comment"
              width="md"
              padding="compact"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <AssistantCitationCommentEditor
                key={serializeAssistantCitation(citation)}
                citation={citation}
                inputRef={commentInputRef}
                renderInput={commentEditor.renderInput}
                onVoiceSetupOpenChange={setVoiceSetupOpen}
                onDraftChange={(comment) => {
                  draftCommentRef.current = comment;
                  commentEditor.onDraftChange?.(comment);
                }}
                onSubmit={(comment) => {
                  if (!commentEditor.onSave(comment)) return false;
                  commentEditor.onOpenChange(false);
                  return true;
                }}
                {...(commentEditor.onSaveAndSend
                  ? {
                      onSubmitAndSend: (comment: string) => {
                        if (!commentEditor.onSaveAndSend?.(comment)) return false;
                        commentEditor.onOpenChange(false);
                        return true;
                      },
                      submitAndSendQueues: commentEditor.saveAndSendQueues ?? false,
                    }
                  : {})}
                {...(commentEditor.onSaveAndSaveDraft
                  ? {
                      onSubmitAndSaveDraft: (comment: string) => {
                        if (!commentEditor.onSaveAndSaveDraft?.(comment)) return false;
                        commentEditor.onOpenChange(false);
                        return true;
                      },
                    }
                  : {})}
                destinations={
                  commentEditor.destinations
                    ? {
                        ...commentEditor.destinations,
                        onSubmit: (destination, action, comment) => {
                          if (!commentEditor.destinations?.onSubmit(destination, action, comment)) {
                            return false;
                          }
                          commentEditor.onOpenChange(false);
                          return true;
                        },
                      }
                    : undefined
                }
                onCancel={() => {
                  if (commentEditor.onCancel) {
                    commentEditor.onCancel();
                  } else {
                    commentEditor.onOpenChange(false);
                  }
                }}
              />
            </PopoverPopup>
          ) : null}
        </Popover>
      ) : null}
    </ContextChip>
  );
}

function AssistantCitationQuote({
  citation,
  renderContextReference,
}: {
  citation: AssistantCitation;
  renderContextReference: ((reference: ChatMarkdownContextReference) => ReactNode) | undefined;
}) {
  const [fade, setFade] = useState({ top: false, bottom: false });
  const updateFade = (element: HTMLElement) => {
    const top = element.scrollTop > 1;
    const bottom = element.scrollHeight - element.clientHeight - element.scrollTop > 1;
    setFade((current) =>
      current.top === top && current.bottom === bottom ? current : { top, bottom },
    );
  };
  const observeFade = (element: HTMLDivElement | null) =>
    element ? observeResize(element, () => updateFade(element)) : undefined;
  return (
    <div
      ref={observeFade}
      onScroll={(event) => updateFade(event.currentTarget)}
      className={cn(
        "max-h-64 min-h-0 space-y-3 self-stretch overflow-y-auto wrap-break-word",
        getVirtualizedScrollFadeClassName(fade),
      )}
    >
      <blockquote
        className="border-l-2 border-border pl-3 text-muted-foreground"
        dir={textDirection(citation.text)}
      >
        {citation.markdown === undefined ? (
          <span className="whitespace-pre-wrap">{citation.text}</span>
        ) : (
          <ChatMarkdown text={citation.markdown} cwd={undefined} />
        )}
      </blockquote>
      {citation.comment ? (
        <div dir={textDirection(citation.comment)}>
          <ChatMarkdown
            text={citation.comment}
            cwd={undefined}
            lineBreaks
            renderContextReference={renderContextReference}
          />
        </div>
      ) : null}
    </div>
  );
}
