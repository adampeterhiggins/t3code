import { isSvgAttachment } from "@t3tools/shared/image";

import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { useRightPanelStore } from "~/rightPanelStore";
import {
  COMPOSER_CONTEXT_KINDS,
  type ComposerContextId,
  type KnownComposerContextKind,
  type KnownComposerContextRecord,
} from "@t3tools/contracts";
import { formatAttachmentSize } from "@t3tools/client-runtime/state/attachments";
import {
  use,
  type ComponentProps,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";

import {
  type ChatFileAttachment,
  type ChatImageAttachment,
  isImageAttachment,
  isVideoAttachment,
} from "../../types";
import { ThreadChipTrigger } from "../ThreadContextChip";
import { ModelChipTrigger, modelChipAccessibleLabel } from "./ModelContextChip";
import {
  FolderIcon,
  MessageCircleIcon,
  MessagesSquareIcon,
  MousePointerClickIcon,
} from "lucide-react";
import { buildExpandedImagePreview } from "./ExpandedImagePreview";
import { WorkspaceEntryIcon } from "./WorkspaceEntryIcon";
import { TerminalChipTrigger } from "./TerminalContextPreview";
import { useLinkClickHandler } from "~/browser/useOpenLink";
import { useOpenInPreferredEditor } from "~/editorPreferences";
import { primaryServerAvailableEditorsAtom } from "~/state/server";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { useAtomValue } from "@effect/atom-react";
import {
  ContextChipButton,
  FileChip,
  ImageChipButton,
  PULL_REQUEST_CHIP_KINDS,
  PullRequestChipTrigger,
  UnreadLinkChipTrigger,
  unreadLinkAccessibleLabel,
  UnresolvedChip,
} from "../contextChipParts";
import {
  isPullRequestSummaryContext,
  pullRequestContextDisplayState,
  pullRequestContextKindLabel,
  reviewCommentContextLabel,
} from "~/lib/composerContextRecords";
import { formatComposerContextReference } from "@t3tools/shared/composerContextReferences";
import { ContextChip, ContextChipLabel } from "../ContextChip";
import { createContextPresentationRegistry } from "../contextPresentationRegistry";
import { buttonContextChip, ContextPreviewHover } from "../contextPreviewRegistry";
import {
  isLinkedObjectContextRecord,
  LINKED_OBJECT_CONTEXT_KINDS,
  linkedObjectIcon,
  linkedObjectKindLabel,
  type LinkedObjectContextKind,
} from "../linkedObjectPresentation";
import { SubagentChipTrigger, subagentChipAccessibleLabel } from "./SubagentContextChip";
import type { ChatMarkdownContextReference } from "../ChatMarkdown";
import { messageSkillByName, messageSkillChip } from "./SkillInlineText";
import { type ReviewCommentContext } from "../../reviewCommentContext";
import { TimelineRowCtx, type TimelineRowSharedState } from "./timelineRowContext";

interface UserMessageContextRenderContext {
  environmentId: import("@t3tools/contracts").EnvironmentId;
  reference: ChatMarkdownContextReference;
  annotationImage: ChatImageAttachment | null;
  attachment: ChatImageAttachment | ChatFileAttachment | null;
  copyMarkdown: string;
  row: TimelineRowSharedState;
  onExpandImage: (image: ChatImageAttachment) => void;
  onExpandVideo: (file: ChatFileAttachment) => void;
  onOpenFile: (file: ChatFileAttachment) => void;
  onOpenLink: (event: ReactMouseEvent<HTMLElement>, url: string) => void;
  checkoutActions?: { onOpen?: () => void; onLink?: () => void };
}

function UnavailableUserMessageContextChip(props: UserMessageContextRenderContext) {
  return (
    <UnresolvedChip
      label={props.reference.label}
      copyMarkdown={props.copyMarkdown}
      tooltip="This context is no longer available."
    />
  );
}

function reviewCommentFromRecord(
  record: Extract<KnownComposerContextRecord, { kind: "review-comment" }>,
): ReviewCommentContext {
  return {
    id: record.contextId,
    sectionId: record.sectionId,
    sectionTitle: record.sectionTitle,
    filePath: record.filePath,
    startIndex: record.startIndex,
    endIndex: record.endIndex,
    rangeLabel: record.rangeLabel,
    text: record.text,
    diff: record.diff,
    ...(record.fenceLanguage !== undefined ? { fenceLanguage: record.fenceLanguage } : {}),
    ...(record.pullRequest !== undefined ? { pullRequest: record.pullRequest } : {}),
    ...(record.thread !== undefined ? { thread: record.thread } : {}),
  };
}

function previewChip<K extends KnownComposerContextKind>(
  kind: K,
  chip: (
    record: KnownComposerContextRecord,
    context: UserMessageContextRenderContext,
  ) => {
    trigger: ReactElement;
    accessibleLabel: string;
    preview: unknown;
  } | null,
) {
  return {
    kind,
    canRender: (record: KnownComposerContextRecord) => record.kind === kind,
    render: (record: KnownComposerContextRecord, context: UserMessageContextRenderContext) => {
      const spec = chip(record, context);
      if (spec === null) return <UnavailableUserMessageContextChip {...context} />;
      return (
        <ContextPreviewHover
          kind={kind}
          trigger={spec.trigger as ReactElement<ComponentProps<"button">>}
          accessibleLabel={spec.accessibleLabel}
          preview={spec.preview as never}
        />
      );
    },
  };
}

function linkedObjectChip<K extends LinkedObjectContextKind>(kind: K) {
  return (record: KnownComposerContextRecord, context: UserMessageContextRenderContext) =>
    record.kind === kind && isLinkedObjectContextRecord(record)
      ? buttonContextChip({
          kind,
          icon: linkedObjectIcon(record),
          label: record.label,
          kindLabel: linkedObjectKindLabel(record),
          copyMarkdown: context.copyMarkdown,
          preview: { record, onOpenLink: context.onOpenLink },
        })
      : null;
}

const userMessageContextPresentationRegistry = createContextPresentationRegistry<
  KnownComposerContextRecord,
  UserMessageContextRenderContext,
  ReactNode
>({
  requiredKinds: COMPOSER_CONTEXT_KINDS,
  handlers: [
    previewChip("mention", (record, context) => {
      if (record.kind !== "mention") return null;
      const { row } = context;
      return {
        trigger: (
          <ContextChip
            kind="mention"
            render={<button type="button" />}
            aria-label={`Preview ${record.path}`}
            data-markdown-copy={context.copyMarkdown}
            onClick={() => {
              if (row.threadRef) useRightPanelStore.getState().openFile(row.threadRef, record.path);
            }}
          >
            <WorkspaceEntryIcon
              path={record.path}
              environmentId={row.activeThreadEnvironmentId}
              cwd={row.workspaceRoot}
              theme={row.resolvedTheme}
            />
            <ContextChipLabel>{record.label}</ContextChipLabel>
          </ContextChip>
        ),
        accessibleLabel: record.path,
        preview: {
          path: record.path,
          environmentId: row.activeThreadEnvironmentId,
          cwd: row.workspaceRoot,
        },
      };
    }),
    previewChip("skill", (record, context) =>
      record.kind === "skill"
        ? messageSkillChip({
            name: record.name,
            label: record.label,
            skill: messageSkillByName(context.row.skills, record.name),
            copyMarkdown: context.copyMarkdown,
            threadRef: context.row.threadRef,
          })
        : null,
    ),
    previewChip("thread", (record, context) =>
      record.kind === "thread"
        ? {
            trigger: <ThreadChipTrigger record={record} copyMarkdown={context.copyMarkdown} />,
            accessibleLabel: `Thread, ${record.title}`,
            preview: { record },
          }
        : null,
    ),
    previewChip("model", (record, context) =>
      record.kind === "model"
        ? {
            trigger: <ModelChipTrigger record={record} copyMarkdown={context.copyMarkdown} />,
            accessibleLabel: modelChipAccessibleLabel(record),
            preview: { record },
          }
        : null,
    ),
    previewChip("image", (record, context) => {
      const attachment = context.attachment;
      if (record.kind !== "image" || attachment === null || !isImageAttachment(attachment)) {
        return null;
      }
      return {
        trigger: (
          <ImageChipButton
            name={record.name}
            previewUrl={attachment.previewUrl}
            size={formatAttachmentSize(record.sizeBytes)}
            data-markdown-copy={context.copyMarkdown}
            onClick={() => context.onExpandImage(attachment)}
          />
        ),
        accessibleLabel: `Image attachment, ${record.name}`,
        preview: {
          name: record.name,
          sizeBytes: record.sizeBytes,
          previewUrl: attachment.previewUrl,
        },
      };
    }),
    previewChip("file", (record, context) => {
      const attachment = context.attachment;
      if (record.kind !== "file" || attachment === null || attachment.type !== "file") return null;
      const isVideo = isVideoAttachment(attachment);
      const size = formatAttachmentSize(record.sizeBytes);
      return {
        trigger: (
          <FileChip
            name={record.name}
            svgPreview={
              isSvgAttachment(attachment)
                ? { environmentId: context.environmentId, attachmentId: attachment.id }
                : undefined
            }
            size={size}
            isVideo={isVideo}
            theme={context.row.resolvedTheme}
            disabled={
              attachment.downloadable === false && (!isVideo || attachment.previewUrl === undefined)
            }
            accessibleLabel={`${isVideo ? "Video" : "File"} attachment, ${record.name}, ${size}`}
            copyMarkdown={context.copyMarkdown}
            onOpen={() =>
              isVideo ? context.onExpandVideo(attachment) : context.onOpenFile(attachment)
            }
          />
        ),
        accessibleLabel: `File attachment, ${record.name}`,
        preview: { name: record.name, sizeBytes: record.sizeBytes, mimeType: record.mimeType },
      };
    }),
    {
      kind: "terminal",
      canRender: (record) => record.kind === "terminal",
      render: (record, context) =>
        record.kind === "terminal" ? (
          <span data-markdown-copy={context.copyMarkdown}>
            <ContextPreviewHover
              kind="terminal"
              accessibleLabel={`Terminal excerpt, ${record.label}`}
              preview={{
                label: record.label,
                terminalLabel: record.terminalLabel,
                lineStart: record.lineStart,
                lineEnd: record.lineEnd,
                text: record.text,
                styledText: record.styledText,
                expired: false,
              }}
              trigger={
                <TerminalChipTrigger
                  label={record.label}
                  expired={false}
                  copyMarkdown={context.copyMarkdown}
                />
              }
            />
          </span>
        ) : (
          <UnavailableUserMessageContextChip {...context} />
        ),
    },
    previewChip("element", (record, context) =>
      record.kind === "element"
        ? buttonContextChip({
            kind: "element",
            icon: <MousePointerClickIcon />,
            label: record.label,
            kindLabel: "Browser element",
            copyMarkdown: context.copyMarkdown,
            preview: { record },
          })
        : null,
    ),
    previewChip("preview-annotation", (record, context) => {
      if (record.kind !== "preview-annotation") return null;
      const image = context.annotationImage;
      const screenshotUrl = image?.previewUrl ?? null;
      return buttonContextChip({
        kind: "preview-annotation",
        icon: <MousePointerClickIcon />,
        label: record.label,
        kindLabel: "Preview annotation",
        copyMarkdown: context.copyMarkdown,
        preview: {
          record,
          screenshotUrl,
          onExpandScreenshot:
            image && screenshotUrl
              ? () => {
                  const preview = buildExpandedImagePreview([image], image.id);
                  if (preview) context.row.onImageExpand(preview);
                }
              : undefined,
        },
      });
    }),
    previewChip("review-comment", (record, context) => {
      if (record.kind !== "review-comment") return null;
      const { row } = context;
      const isPullRequest = isPullRequestSummaryContext(record);
      const label = reviewCommentContextLabel(record);
      const kindLabel = isPullRequest ? pullRequestContextKindLabel(record) : "Review comment";
      const kind = isPullRequest
        ? PULL_REQUEST_CHIP_KINDS[pullRequestContextDisplayState(record) ?? "unknown"]
        : "review-comment";
      const preview = {
        comment: reviewCommentFromRecord(record),
        environmentId: row.activeThreadEnvironmentId,
        workspaceRoot: row.workspaceRoot,
        markdownCwd: row.markdownCwd,
        threadRef: row.threadRef ?? undefined,
      };
      const accessibleLabel = `${kindLabel}, ${label}${record.pullRequest ? `, ${record.pullRequest.title}` : ""}`;
      if (isPullRequest && record.pullRequest !== undefined) {
        return {
          trigger: (
            <PullRequestChipTrigger
              metadata={record.pullRequest}
              label={label}
              kindLabel={kindLabel}
              kind={kind}
              copyMarkdown={context.copyMarkdown}
              onOpen={row.openPullRequest}
            />
          ),
          accessibleLabel,
          preview,
        };
      }
      return {
        trigger: (
          <ContextChipButton
            kind={kind}
            icon={isPullRequest ? <PullRequestGlyph.pullRequest /> : <MessageCircleIcon />}
            label={label}
            aria-label={`${accessibleLabel}. Show details`}
            copyMarkdown={context.copyMarkdown}
          />
        ),
        accessibleLabel,
        preview,
      };
    }),
    previewChip("thread-tab", (record, context) =>
      record.kind === "thread-tab"
        ? buttonContextChip({
            kind: "thread-tab",
            icon: <MessagesSquareIcon />,
            label: record.label,
            kindLabel: "Chat summary",
            copyMarkdown: context.copyMarkdown,
            preview: { summary: record.summary },
          })
        : null,
    ),
    ...LINKED_OBJECT_CONTEXT_KINDS.map((kind) => previewChip(kind, linkedObjectChip(kind))),
    previewChip("checkout", (record, context) =>
      record.kind === "checkout"
        ? buttonContextChip({
            kind: "checkout",
            icon: <FolderIcon />,
            label: record.label,
            kindLabel: "Checkout",
            copyMarkdown: context.copyMarkdown,
            preview: { record, ...context.checkoutActions },
          })
        : null,
    ),
    previewChip("subagent", (record, context) =>
      record.kind === "subagent"
        ? {
            trigger: <SubagentChipTrigger record={record} copyMarkdown={context.copyMarkdown} />,
            accessibleLabel: subagentChipAccessibleLabel(record),
            preview: { record },
          }
        : null,
    ),
    previewChip("unread-link", (record, context) =>
      record.kind === "unread-link"
        ? {
            trigger: <UnreadLinkChipTrigger record={record} copyMarkdown={context.copyMarkdown} />,
            accessibleLabel: unreadLinkAccessibleLabel(record),
            preview: { record, onOpenLink: context.onOpenLink },
          }
        : null,
    ),
  ],
  fallback: (_kind, _record, context) => <UnavailableUserMessageContextChip {...context} />,
});

export function UserMessageContextReferenceChip(props: {
  reference: ChatMarkdownContextReference;
  record: KnownComposerContextRecord | undefined;
  annotationImage: ChatImageAttachment | null;
  attachment: ChatImageAttachment | ChatFileAttachment | null;
  onExpandImage: (image: ChatImageAttachment) => void;
  onExpandVideo: (file: ChatFileAttachment) => void;
  onOpenFile: (file: ChatFileAttachment) => void;
}) {
  const row = use(TimelineRowCtx);
  const onOpenLink = useLinkClickHandler(row.threadRef);
  const checkout = props.record?.kind === "checkout" ? props.record : null;
  const editors = useAtomValue(primaryServerAvailableEditorsAtom);
  const openInEditor = useOpenInPreferredEditor(checkout?.environmentId ?? null, editors);
  const linkCheckout = useAtomCommand(threadEnvironment.linkCheckout, { reportFailure: true });
  const copyMarkdown = formatComposerContextReference({
    kind: props.reference.kind,
    contextId: props.reference.contextId as ComposerContextId,
    label: props.reference.label,
  });
  return userMessageContextPresentationRegistry.render(props.reference.kind, props.record, {
    environmentId: row.activeThreadEnvironmentId,
    reference: props.reference,
    annotationImage: props.annotationImage,
    attachment: props.attachment,
    row,
    copyMarkdown,
    onExpandImage: props.onExpandImage,
    onExpandVideo: props.onExpandVideo,
    onOpenFile: props.onOpenFile,
    onOpenLink,
    ...(checkout === null
      ? {}
      : {
          checkoutActions: {
            onOpen: () => {
              void openInEditor(checkout.path);
            },
            ...(row.threadRef === null
              ? {}
              : {
                  onLink: () => {
                    void linkCheckout({
                      environmentId: row.threadRef!.environmentId,
                      input: {
                        threadId: row.threadRef!.threadId,
                        path: checkout.path,
                        name: checkout.label,
                      },
                    });
                  },
                }),
          },
        }),
  });
}
