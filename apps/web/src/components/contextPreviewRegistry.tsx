import { COMPOSER_CONTEXT_KINDS, type KnownComposerContextKind } from "@t3tools/contracts";
import type { ComponentProps, ComponentType, ReactElement } from "react";

import { isPullRequestSummaryContext } from "~/lib/composerContextRecords";
import { preloadGhosttyTerminal } from "~/terminal/ghostty/surface";
import { ModelPreview, type ModelPreviewProps } from "./chat/ModelContextChip";
import { TerminalPreview, type TerminalPreviewProps } from "./chat/TerminalContextPreview";
import type { ContextChipKind } from "./ContextChip";
import {
  CheckoutDetails,
  ContextChipButton,
  HoverPopover,
  PullRequestSummaryHover,
  ThreadTabSummaryDetails,
  UnreadLinkDetails,
} from "./contextChipParts";
import {
  ElementPreview,
  FilePreview,
  ImagePreview,
  MentionPreview,
  PreviewAnnotationPreview,
  ReviewCommentPreview,
  SkillPreview,
  SubagentPreview,
  type ElementPreviewProps,
  type FilePreviewProps,
  type ImagePreviewProps,
  type MentionPreviewProps,
  type PreviewAnnotationPreviewProps,
  type ReviewCommentPreviewProps,
  type SkillPreviewProps,
  type SubagentPreviewProps,
} from "./contextPreviews";
import { LinkedObjectDetails } from "./linkedObjectPresentation";
import { ThreadHoverCardPopup, ThreadPreview, type ThreadPreviewProps } from "./ThreadHoverCard";
import { PreviewCard, PreviewCardPopup, PreviewCardTrigger } from "./ui/preview-card";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

/*
 * Each context kind's hover preview lives here, and every surface that draws a chip for the kind
 * (the composer, sent messages, `$skill` in message text, links in markdown) shows it through
 * this registry. A surface supplies the chip and the preview's input; it never picks the preview.
 */

type LinkedObjectPreviewProps = ComponentProps<typeof LinkedObjectDetails>;

/** What each kind's preview reads. Surfaces map their own records onto these. */
export interface ContextPreviewPropsByKind {
  image: ImagePreviewProps;
  file: FilePreviewProps;
  terminal: TerminalPreviewProps;
  element: ElementPreviewProps;
  "preview-annotation": PreviewAnnotationPreviewProps;
  "review-comment": ReviewCommentPreviewProps;
  mention: MentionPreviewProps;
  skill: SkillPreviewProps;
  "thread-tab": ComponentProps<typeof ThreadTabSummaryDetails>;
  "linear-issue": LinkedObjectPreviewProps;
  "linear-object": LinkedObjectPreviewProps;
  "github-issue": LinkedObjectPreviewProps;
  repository: LinkedObjectPreviewProps;
  checkout: ComponentProps<typeof CheckoutDetails>;
  "slack-thread": LinkedObjectPreviewProps;
  "discord-thread": LinkedObjectPreviewProps;
  "notion-page": LinkedObjectPreviewProps;
  "google-file": LinkedObjectPreviewProps;
  "granola-note": LinkedObjectPreviewProps;
  thread: ThreadPreviewProps;
  subagent: SubagentPreviewProps;
  "prompt-link": LinkedObjectPreviewProps;
  "github-ref": LinkedObjectPreviewProps;
  "unread-link": ComponentProps<typeof UnreadLinkDetails>;
  model: ModelPreviewProps;
}

export interface ContextPreviewHoverProps<TPreview> {
  /** The surface's chip. Popover triggers should be buttons, so a click can pin them open. */
  trigger: ReactElement<ComponentProps<"button">>;
  accessibleLabel: string;
  preview: TPreview;
}

/** Where a surface's hover opens, relative to its trigger. The registry still picks the container. */
export interface ContextPreviewPlacement {
  side?: "top" | "right" | "bottom" | "left" | undefined;
  align?: "start" | "center" | "end" | undefined;
  sideOffset?: number | undefined;
}

/**
 * How a kind previews on hover. `details: "none"` is a decision, not a gap: the chip has nothing
 * to show beyond its label.
 */
export type ContextPreview<TPreview> =
  | { details: "none" }
  | {
      details: "tooltip";
      Body: ComponentType<TPreview>;
      variant?: ComponentProps<typeof TooltipPopup>["variant"];
      /** A popup of the kind's own, in place of the plain tooltip. */
      Popup?: ComponentType<ComponentProps<typeof TooltipPopup>>;
    }
  | {
      details: "popover";
      Body: ComponentType<TPreview>;
      onIntent?: () => void;
      stayOpenAfterPress?: boolean;
      /** Replaces the popover for records that preview elsewhere, such as pull request summaries. */
      Hover?: ComponentType<ContextPreviewHoverProps<TPreview>>;
    }
  | { details: "card"; Body: ComponentType<TPreview> };

export type ContextPreviewDetails = ContextPreview<unknown>["details"];

export interface ContextPresentationCapability {
  expanded: "none" | "inline-block" | "modal";
  defaultDraftView: "compact" | "expanded";
}

export interface ContextPresentationDefinition<K extends KnownComposerContextKind> {
  capabilities: ContextPresentationCapability;
  preview: ContextPreview<ContextPreviewPropsByKind[K]>;
}

export type ContextPresentationDefinitions = {
  readonly [K in KnownComposerContextKind]: ContextPresentationDefinition<K>;
};

const COMPACT = { expanded: "none", defaultDraftView: "compact" } as const;

const linkedObjectPreview = { details: "popover", Body: LinkedObjectDetails } as const;

/** A pull request summary previews as its pull request; other review comments as the comment. */
function ReviewCommentHover(props: ContextPreviewHoverProps<ReviewCommentPreviewProps>) {
  const { comment, environmentId } = props.preview;
  if (isPullRequestSummaryContext(comment) && comment.pullRequest !== undefined) {
    return (
      <PullRequestSummaryHover
        trigger={props.trigger}
        metadata={comment.pullRequest}
        environmentId={environmentId}
      />
    );
  }
  return (
    <HoverPopover trigger={props.trigger} accessibleLabel={props.accessibleLabel}>
      <ReviewCommentPreview {...props.preview} />
    </HoverPopover>
  );
}

export const CONTEXT_PRESENTATION_DEFINITIONS: ContextPresentationDefinitions = {
  image: {
    capabilities: { expanded: "modal", defaultDraftView: "compact" },
    preview: { details: "card", Body: ImagePreview },
  },
  file: {
    capabilities: { expanded: "modal", defaultDraftView: "compact" },
    preview: { details: "card", Body: FilePreview },
  },
  terminal: {
    capabilities: COMPACT,
    preview: {
      details: "popover",
      Body: TerminalPreview,
      onIntent: preloadGhosttyTerminal,
      stayOpenAfterPress: true,
    },
  },
  element: { capabilities: COMPACT, preview: { details: "popover", Body: ElementPreview } },
  "preview-annotation": {
    capabilities: { expanded: "modal", defaultDraftView: "compact" },
    preview: { details: "popover", Body: PreviewAnnotationPreview },
  },
  "review-comment": {
    capabilities: COMPACT,
    preview: { details: "popover", Body: ReviewCommentPreview, Hover: ReviewCommentHover },
  },
  mention: {
    capabilities: COMPACT,
    preview: { details: "tooltip", Body: MentionPreview, variant: "code" },
  },
  skill: { capabilities: COMPACT, preview: { details: "popover", Body: SkillPreview } },
  "thread-tab": {
    capabilities: COMPACT,
    preview: { details: "popover", Body: ThreadTabSummaryDetails },
  },
  "linear-issue": { capabilities: COMPACT, preview: linkedObjectPreview },
  "linear-object": { capabilities: COMPACT, preview: linkedObjectPreview },
  "github-issue": { capabilities: COMPACT, preview: linkedObjectPreview },
  repository: { capabilities: COMPACT, preview: linkedObjectPreview },
  checkout: { capabilities: COMPACT, preview: { details: "popover", Body: CheckoutDetails } },
  "slack-thread": { capabilities: COMPACT, preview: linkedObjectPreview },
  "discord-thread": { capabilities: COMPACT, preview: linkedObjectPreview },
  "notion-page": { capabilities: COMPACT, preview: linkedObjectPreview },
  "google-file": { capabilities: COMPACT, preview: linkedObjectPreview },
  "granola-note": { capabilities: COMPACT, preview: linkedObjectPreview },
  thread: {
    capabilities: COMPACT,
    preview: { details: "tooltip", Body: ThreadPreview, Popup: ThreadHoverCardPopup },
  },
  subagent: { capabilities: COMPACT, preview: { details: "card", Body: SubagentPreview } },
  "prompt-link": { capabilities: COMPACT, preview: linkedObjectPreview },
  "github-ref": { capabilities: COMPACT, preview: linkedObjectPreview },
  "unread-link": {
    capabilities: COMPACT,
    preview: { details: "popover", Body: UnreadLinkDetails },
  },
  model: { capabilities: COMPACT, preview: { details: "card", Body: ModelPreview } },
};

const KNOWN_KINDS: ReadonlySet<string> = new Set(COMPOSER_CONTEXT_KINDS);

function isKnownContextKind(kind: string): kind is KnownComposerContextKind {
  return KNOWN_KINDS.has(kind);
}

/** The body a kind's hover shows, for surfaces that open it from something other than a chip. */
export function ContextPreviewBody<K extends KnownComposerContextKind>(props: {
  kind: K;
  preview: ContextPreviewPropsByKind[K];
}) {
  const spec: ContextPreview<ContextPreviewPropsByKind[K]> =
    CONTEXT_PRESENTATION_DEFINITIONS[props.kind].preview;
  if (spec.details === "none") return null;
  const Body = spec.Body;
  return <Body {...props.preview} />;
}

export interface ContextChipSpec<
  K extends KnownComposerContextKind,
> extends ContextPreviewHoverProps<ContextPreviewPropsByKind[K]> {}

/** The common chip: a button that does nothing but open its kind's preview. */
export function buttonContextChip<K extends KnownComposerContextKind>(input: {
  kind: K & ContextChipKind;
  icon: ReactElement;
  label: string;
  /** What the chip is, for screen readers: "Skill", "Linear issue". */
  kindLabel: string;
  copyMarkdown?: string | undefined;
  preview: ContextPreviewPropsByKind[K];
}): ContextChipSpec<K> {
  const accessibleLabel = `${input.kindLabel}, ${input.label}`;
  return {
    trigger: (
      <ContextChipButton
        kind={input.kind}
        icon={input.icon}
        label={input.label}
        aria-label={`${accessibleLabel}. Show details`}
        copyMarkdown={input.copyMarkdown}
      />
    ),
    accessibleLabel,
    preview: input.preview,
  };
}

/**
 * A trigger with its kind's registered hover preview around it. Rows and links use this as
 * chips do; `disabled` keeps the trigger mounted while the preview can't open, such as mid-drag.
 */
export function ContextPreviewHover<K extends KnownComposerContextKind>(
  props: ContextChipSpec<K> & {
    kind: K;
    placement?: ContextPreviewPlacement | undefined;
    disabled?: boolean | undefined;
  },
) {
  const spec: ContextPreview<ContextPreviewPropsByKind[K]> =
    CONTEXT_PRESENTATION_DEFINITIONS[props.kind].preview;
  const side = props.placement?.side ?? "top";
  const placement = {
    side,
    ...(props.placement?.align ? { align: props.placement.align } : {}),
    ...(props.placement?.sideOffset !== undefined
      ? { sideOffset: props.placement.sideOffset }
      : {}),
  };
  switch (spec.details) {
    case "none":
      return props.trigger;
    case "tooltip": {
      const Body = spec.Body;
      const Popup = spec.Popup;
      return (
        <Tooltip disabled={props.disabled}>
          <TooltipTrigger render={props.trigger} />
          {Popup ? (
            <Popup {...placement}>
              <Body {...props.preview} />
            </Popup>
          ) : (
            <TooltipPopup
              {...placement}
              {...(spec.variant ? { variant: spec.variant } : {})}
              className="whitespace-pre-wrap"
            >
              <Body {...props.preview} />
            </TooltipPopup>
          )}
        </Tooltip>
      );
    }
    case "popover": {
      if (spec.Hover) {
        const Hover = spec.Hover;
        return (
          <Hover
            trigger={props.trigger}
            accessibleLabel={props.accessibleLabel}
            preview={props.preview}
          />
        );
      }
      const Body = spec.Body;
      return (
        <HoverPopover
          trigger={props.trigger}
          accessibleLabel={props.accessibleLabel}
          onIntent={spec.onIntent}
          stayOpenAfterPress={spec.stayOpenAfterPress}
          {...placement}
          disabled={props.disabled}
        >
          <Body {...props.preview} />
        </HoverPopover>
      );
    }
    case "card": {
      const Body = spec.Body;
      return (
        <PreviewCard {...(props.disabled ? { open: false } : {})}>
          <PreviewCardTrigger delay={350} closeDelay={120} render={props.trigger} />
          <PreviewCardPopup align="start" {...placement} className="max-w-[calc(100vw-2rem)]">
            <Body {...props.preview} />
          </PreviewCardPopup>
        </PreviewCard>
      );
    }
  }
}

/**
 * How one surface draws a kind's chip. `chip` returns the trigger and the preview's input, or
 * null when the surface can't draw this record; the registry adds the kind's preview, so a
 * handler can't show a different one.
 */
export interface ContextPresentationHandler<K extends KnownComposerContextKind, TRecord, TContext> {
  chip: (record: TRecord, context: TContext) => ContextChipSpec<K> | null;
}

/** One handler per known kind: a surface that leaves a kind out does not compile. */
export type ContextPresentationHandlers<TRecord, TContext> = {
  readonly [K in KnownComposerContextKind]: ContextPresentationHandler<K, TRecord, TContext>;
};

export interface ContextPresentationRegistry<TRecord, TContext> {
  render(kind: string, record: TRecord | undefined, context: TContext): ReactElement;
}

export function createContextPresentationRegistry<TRecord, TContext>(options: {
  handlers: ContextPresentationHandlers<TRecord, TContext>;
  /** Drawn for unknown kinds, missing records, and records a handler can't draw. */
  fallback: (kind: string, record: TRecord | undefined, context: TContext) => ReactElement;
}): ContextPresentationRegistry<TRecord, TContext> {
  for (const kind of COMPOSER_CONTEXT_KINDS) {
    if (!Object.hasOwn(options.handlers, kind)) {
      throw new Error(`Missing context presentation handler: ${kind}`);
    }
  }
  return {
    render(kind, record, context) {
      if (!isKnownContextKind(kind) || record === undefined) {
        return options.fallback(kind, record, context);
      }
      return renderKnown(kind, options.handlers, record, context, options.fallback);
    },
  };
}

function renderKnown<K extends KnownComposerContextKind, TRecord, TContext>(
  kind: K,
  handlers: ContextPresentationHandlers<TRecord, TContext>,
  record: TRecord,
  context: TContext,
  fallback: (kind: string, record: TRecord | undefined, context: TContext) => ReactElement,
): ReactElement {
  const handler: ContextPresentationHandler<K, TRecord, TContext> = handlers[kind];
  const chip = handler.chip(record, context);
  if (chip === null) return fallback(kind, record, context);
  return <ContextPreviewHover kind={kind} {...chip} />;
}
