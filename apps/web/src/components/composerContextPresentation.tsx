import type {
  CheckoutContextRecord,
  DiscordThreadContextRecord,
  ElementContextRecord,
  EnvironmentId,
  GitHubIssueContextRecord,
  GitHubRefContextRecord,
  GranolaNoteContextRecord,
  KnownComposerContextKind,
  LinearIssueContextRecord,
  NotionPageContextRecord,
  PreviewAnnotationPayload,
  PromptLinkContextRecord,
  RepositoryContextRecord,
  SlackThreadContextRecord,
  SubagentContextRecord,
  ThreadContextRecord,
  ThreadTabContextRecord,
  UnreadLinkContextRecord,
} from "@t3tools/contracts";
import { formatAttachmentSize } from "@t3tools/client-runtime/state/attachments";
import { videoMimeType } from "@t3tools/shared/video";
import {
  FolderIcon,
  MessageCircleIcon,
  MessagesSquareIcon,
  MousePointerClickIcon,
} from "lucide-react";
import { createContext, type MouseEvent, type ReactElement, use } from "react";

import type { ComposerFileAttachment, ComposerImageAttachment } from "~/composerDraftStore";
import type { IssueContextRecord } from "~/issueContextStore";
import { composerFileNeedsReattach } from "~/composerDraftStore";
import { useTheme } from "~/hooks/useTheme";
import {
  formatAttachmentUploadProgress,
  type AttachmentUploadState,
} from "~/lib/attachmentUploadState";
import { PullRequestGlyph } from "~/components/pullRequest/pullRequestIcons";
import {
  fileContextReference,
  imageContextReference,
  isPullRequestSummaryContext,
  pullRequestContextDisplayState,
  pullRequestContextKindLabel,
  previewAnnotationContextId,
  previewAnnotationContextLabel,
  previewAnnotationContextRecord,
  reviewCommentContextId,
  reviewCommentContextLabel,
  terminalContextReference,
  uploadedAttachmentContextRecord,
} from "~/lib/composerContextRecords";
import {
  formatTerminalContextLabel,
  isTerminalContextExpired,
  type TerminalContextDraft,
} from "~/lib/terminalContext";
import { basenameOfPath } from "~/pierre-icons";
import type { ReviewCommentContext } from "~/reviewCommentContext";
import { FileTagChipContent } from "./chat/FileTagChip";
import { SkillChipIcon } from "./chat/SkillChipIcon";
import { SubagentChipTrigger, subagentChipAccessibleLabel } from "./chat/SubagentContextChip";
import { TerminalChipTrigger } from "./chat/TerminalContextPreview";
import { ContextChip } from "./ContextChip";
import {
  ContextChipButton,
  FileChip,
  ImageChipButton,
  PULL_REQUEST_CHIP_KINDS,
  PullRequestChipTrigger,
  UnreadLinkChipTrigger,
  unreadLinkAccessibleLabel,
  UnresolvedChip,
} from "./contextChipParts";
import {
  buttonContextChip,
  createContextPresentationRegistry,
  type ContextPresentationHandler,
} from "./contextPreviewRegistry";
import {
  isLinkedObjectContextKind,
  linkedObjectIcon,
  linkedObjectKindLabel,
  type LinkedObjectContextKind,
} from "./linkedObjectPresentation";
import { ThreadChipTrigger } from "./ThreadContextChip";

/** A `$skill` drawn in the prompt, as its chip reads it. */
export interface ComposerSkillChipRecord {
  name: string;
  label: string;
  description: string | null;
  /** The instructions file, when the provider still offers the skill. */
  path: string | null;
}

export type ComposerDraftContextRecord =
  | { kind: "notion-page"; record: NotionPageContextRecord }
  | { kind: "granola-note"; record: GranolaNoteContextRecord }
  | { kind: "terminal"; record: TerminalContextDraft }
  | { kind: "review-comment"; record: ReviewCommentContext }
  | {
      kind: "preview-annotation";
      record: PreviewAnnotationPayload;
      screenshot?: ComposerImageAttachment | undefined;
    }
  | { kind: "thread-tab"; record: ThreadTabContextRecord }
  | { kind: "linear-issue"; record: LinearIssueContextRecord }
  | { kind: "github-issue"; record: GitHubIssueContextRecord }
  | { kind: "repository"; record: RepositoryContextRecord }
  | { kind: "checkout"; record: CheckoutContextRecord }
  | { kind: "slack-thread"; record: SlackThreadContextRecord }
  | { kind: "discord-thread"; record: DiscordThreadContextRecord }
  | { kind: "image"; record: ComposerImageAttachment; upload?: AttachmentUploadState | undefined }
  | { kind: "file"; record: ComposerFileAttachment; upload?: AttachmentUploadState | undefined }
  | { kind: "thread"; record: ThreadContextRecord }
  | { kind: "subagent"; record: SubagentContextRecord }
  | { kind: "prompt-link"; record: PromptLinkContextRecord }
  | { kind: "github-ref"; record: GitHubRefContextRecord }
  | { kind: "unread-link"; record: UnreadLinkContextRecord };

/**
 * What a composer chip can draw: a record the draft holds, or a prompt token the editor draws as
 * a chip. The draft never holds element records; a pasted reference to one still gets its chip.
 */
export type ComposerContextChipEntry =
  | ComposerDraftContextRecord
  | { kind: "mention"; record: { path: string } }
  | { kind: "skill"; record: ComposerSkillChipRecord }
  | { kind: "element"; record: ElementContextRecord };

export interface ComposerContextActions {
  environmentId: EnvironmentId | null;
  cwd?: string | undefined;
  expandImage: (imageId: string) => void;
  expandVideo: (fileId: string) => void;
  openFile: (fileId: string) => void;
  openMention: (path: string) => void;
  openPullRequest: (event: MouseEvent<HTMLElement>, url: string) => void;
  openLink: (event: MouseEvent<HTMLElement>, url: string) => void;
  retryUnreadLink: (record: UnreadLinkContextRecord) => void;
  keepUnreadLinkAsText: (record: UnreadLinkContextRecord) => void;
}

export const ComposerContextActionsContext = createContext<ComposerContextActions>({
  environmentId: null,
  expandImage: () => {},
  expandVideo: () => {},
  openFile: () => {},
  openMention: () => {},
  openPullRequest: () => {},
  openLink: () => {},
  retryUnreadLink: () => {},
  keepUnreadLinkAsText: () => {},
});

export type ComposerDraftContextRecords = ReadonlyMap<string, ComposerDraftContextRecord>;

export const EMPTY_COMPOSER_CONTEXT_RECORDS: ComposerDraftContextRecords = new Map();

export function uploadedContextRecordFromDraft(entry: ComposerDraftContextRecord) {
  if (entry.kind !== "image" && entry.kind !== "file") return null;
  return uploadedAttachmentContextRecord(entry.record, entry.upload);
}

export const ComposerContextRecordsContext = createContext<ComposerDraftContextRecords>(
  EMPTY_COMPOSER_CONTEXT_RECORDS,
);

export function composerContextRecordsFromDraft(input: {
  terminalContexts: ReadonlyArray<TerminalContextDraft>;
  reviewComments?: ReadonlyArray<ReviewCommentContext>;
  previewAnnotations?: ReadonlyArray<PreviewAnnotationPayload>;
  threadTabs?: ReadonlyArray<ThreadTabContextRecord>;
  issues?: ReadonlyArray<IssueContextRecord>;
  repositories?: ReadonlyArray<RepositoryContextRecord>;
  checkouts?: ReadonlyArray<CheckoutContextRecord>;
  threadContexts?: ReadonlyArray<ThreadContextRecord>;
  images?: ReadonlyArray<ComposerImageAttachment>;
  files?: ReadonlyArray<ComposerFileAttachment>;
  uploadsByImageId?: Readonly<Record<string, AttachmentUploadState>>;
}): ComposerDraftContextRecords {
  const records = new Map<string, ComposerDraftContextRecord>();
  for (const record of input.images ?? []) {
    records.set(imageContextReference(record).contextId, {
      kind: "image",
      record,
      upload: input.uploadsByImageId?.[record.id],
    });
  }
  for (const record of input.files ?? []) {
    records.set(fileContextReference(record).contextId, {
      kind: "file",
      record,
      upload: input.uploadsByImageId?.[record.id],
    });
  }
  for (const record of input.terminalContexts) {
    records.set(terminalContextReference(record).contextId, { kind: "terminal", record });
  }
  for (const record of input.reviewComments ?? []) {
    records.set(reviewCommentContextId(record.id), { kind: "review-comment", record });
  }
  const imagesById = new Map((input.images ?? []).map((image) => [image.id, image]));
  for (const record of input.previewAnnotations ?? []) {
    records.set(previewAnnotationContextId(record.id), {
      kind: "preview-annotation",
      record,
      screenshot: imagesById.get(record.id),
    });
  }
  for (const record of input.threadTabs ?? []) {
    records.set(record.contextId, { kind: "thread-tab", record });
  }
  for (const record of input.issues ?? []) {
    records.set(record.contextId, issueDraftContextRecord(record));
  }
  for (const record of input.repositories ?? []) {
    records.set(record.contextId, { kind: "repository", record });
  }
  for (const record of input.checkouts ?? []) {
    records.set(record.contextId, { kind: "checkout", record });
  }
  for (const record of input.threadContexts ?? []) {
    records.set(record.contextId, { kind: "thread", record });
  }
  return records;
}

function issueDraftContextRecord(record: IssueContextRecord): ComposerDraftContextRecord {
  switch (record.kind) {
    case "notion-page":
      return { kind: "notion-page", record };
    case "granola-note":
      return { kind: "granola-note", record };
    case "linear-issue":
      return { kind: "linear-issue", record };
    case "github-issue":
      return { kind: "github-issue", record };
    case "slack-thread":
      return { kind: "slack-thread", record };
    case "discord-thread":
      return { kind: "discord-thread", record };
    case "subagent":
      return { kind: "subagent", record };
    case "prompt-link":
      return { kind: "prompt-link", record };
    case "github-ref":
      return { kind: "github-ref", record };
    case "unread-link":
      return { kind: "unread-link", record };
  }
}

function uploadStatusSuffix(upload: AttachmentUploadState | undefined): string | null {
  if (upload?.status === "uploading") return formatAttachmentUploadProgress(upload.progress);
  if (upload?.status === "failed") return "upload failed";
  return null;
}

function UnresolvedContextChip(props: { label: string }) {
  return (
    <UnresolvedChip
      label={props.label}
      tooltip="This context is no longer available. Remove it or attach it again."
    />
  );
}

interface ComposerContextRenderContext {
  label: string;
  actions: ComposerContextActions;
  resolvedTheme: "light" | "dark";
}

type ComposerHandler<K extends KnownComposerContextKind> = ContextPresentationHandler<
  K,
  ComposerContextChipEntry,
  ComposerContextRenderContext
>;

function linkedObjectHandler<K extends LinkedObjectContextKind>(kind: K): ComposerHandler<K> {
  return {
    chip: (entry, { actions }) =>
      entry.kind === kind && isLinkedObjectEntry(entry)
        ? buttonContextChip({
            kind,
            icon: linkedObjectIcon(entry.record),
            label: entry.record.label,
            kindLabel: linkedObjectKindLabel(entry.record),
            preview: { record: entry.record, onOpenLink: actions.openLink },
          })
        : null,
  };
}

function isLinkedObjectEntry(
  entry: ComposerContextChipEntry,
): entry is Extract<ComposerContextChipEntry, { kind: LinkedObjectContextKind }> {
  return isLinkedObjectContextKind(entry.kind);
}

const composerContextPresentationRegistry = createContextPresentationRegistry<
  ComposerContextChipEntry,
  ComposerContextRenderContext
>({
  handlers: {
    image: {
      chip: (entry, { actions }) => {
        if (entry.kind !== "image") return null;
        const { record, upload } = entry;
        return {
          trigger: (
            <ImageChipButton
              name={record.name}
              previewUrl={record.previewUrl}
              size={formatAttachmentSize(record.sizeBytes)}
              suffix={uploadStatusSuffix(upload)}
              onClick={() => actions.expandImage(record.id)}
            />
          ),
          accessibleLabel: `Image attachment, ${record.name}`,
          preview: {
            name: record.name,
            sizeBytes: record.sizeBytes,
            previewUrl: record.previewUrl,
            failure: upload?.status === "failed" ? upload.reason : undefined,
          },
        };
      },
    },
    file: {
      chip: (entry, { actions, resolvedTheme }) => {
        if (entry.kind !== "file") return null;
        const { record, upload } = entry;
        const needsReattach = composerFileNeedsReattach(record);
        const size = formatAttachmentSize(record.sizeBytes);
        const isVideo = videoMimeType(record) !== null;
        return {
          trigger: (
            <FileChip
              name={record.name}
              size={size}
              isVideo={isVideo}
              theme={resolvedTheme}
              error={upload?.status === "failed"}
              unresolved={needsReattach}
              suffix={needsReattach ? "attach again" : uploadStatusSuffix(upload)}
              accessibleLabel={`${isVideo && !needsReattach ? "Preview video" : "File"} attachment, ${record.name}, ${size}`}
              onOpen={
                needsReattach
                  ? undefined
                  : () => (isVideo ? actions.expandVideo(record.id) : actions.openFile(record.id))
              }
            />
          ),
          accessibleLabel: `File attachment, ${record.name}`,
          preview: {
            name: record.name,
            sizeBytes: record.sizeBytes,
            mimeType: record.mimeType,
            file: record.file ?? undefined,
            failure: upload?.status === "failed" ? upload.reason : undefined,
            needsReattach,
          },
        };
      },
    },
    terminal: {
      chip: (entry) => {
        if (entry.kind !== "terminal") return null;
        const label = formatTerminalContextLabel(entry.record);
        const expired = isTerminalContextExpired(entry.record);
        return {
          trigger: <TerminalChipTrigger label={label} expired={expired} />,
          accessibleLabel: `Terminal excerpt, ${label}`,
          preview: {
            label,
            terminalLabel: entry.record.terminalLabel,
            lineStart: entry.record.lineStart,
            lineEnd: entry.record.lineEnd,
            text: entry.record.text,
            styledText: entry.record.styledText,
            expired,
          },
        };
      },
    },
    element: {
      chip: (entry) =>
        entry.kind === "element"
          ? buttonContextChip({
              kind: "element",
              icon: <MousePointerClickIcon />,
              label: entry.record.label,
              kindLabel: "Browser element",
              preview: { record: entry.record },
            })
          : null,
    },
    "preview-annotation": {
      chip: (entry) =>
        entry.kind === "preview-annotation"
          ? buttonContextChip({
              kind: "preview-annotation",
              icon: <MousePointerClickIcon />,
              label: previewAnnotationContextLabel(entry.record),
              kindLabel: "Preview annotation",
              preview: {
                record: previewAnnotationContextRecord(entry.record),
                screenshotUrl:
                  entry.record.screenshot?.dataUrl || entry.screenshot?.previewUrl || null,
              },
            })
          : null,
    },
    "review-comment": {
      chip: (entry, { actions }) => {
        if (entry.kind !== "review-comment") return null;
        const comment = entry.record;
        const label = reviewCommentContextLabel(comment);
        const isPullRequest = isPullRequestSummaryContext(comment);
        const kindLabel = isPullRequest ? pullRequestContextKindLabel(comment) : "Review comment";
        const kind = isPullRequest
          ? PULL_REQUEST_CHIP_KINDS[pullRequestContextDisplayState(comment) ?? "unknown"]
          : "review-comment";
        const preview = {
          comment,
          environmentId: actions.environmentId,
          workspaceRoot: actions.cwd,
        };
        if (isPullRequest && comment.pullRequest !== undefined) {
          return {
            trigger: (
              <PullRequestChipTrigger
                metadata={comment.pullRequest}
                label={label}
                kindLabel={kindLabel}
                kind={kind}
                onOpen={actions.openPullRequest}
              />
            ),
            accessibleLabel: `${kindLabel}, ${label}`,
            preview,
          };
        }
        return {
          trigger: (
            <ContextChipButton
              kind={kind}
              icon={isPullRequest ? <PullRequestGlyph.pullRequest /> : <MessageCircleIcon />}
              label={label}
              aria-label={`${kindLabel}, ${label}. Show details`}
            />
          ),
          accessibleLabel: `${kindLabel}, ${label}`,
          preview,
        };
      },
    },
    mention: {
      chip: (entry, { actions, resolvedTheme }) => {
        if (entry.kind !== "mention") return null;
        const { path } = entry.record;
        return {
          trigger: (
            <ContextChip
              kind="mention"
              render={<button type="button" />}
              onClick={() => actions.openMention(path)}
              aria-label={`Preview ${path}`}
              contentEditable={false}
              spellCheck={false}
              data-composer-mention-chip="true"
            >
              <FileTagChipContent
                path={path}
                environmentId={actions.environmentId}
                cwd={actions.cwd}
                label={basenameOfPath(path)}
                theme={resolvedTheme}
              />
            </ContextChip>
          ),
          accessibleLabel: path,
          preview: { path, environmentId: actions.environmentId, cwd: actions.cwd },
        };
      },
    },
    skill: {
      chip: (entry, { actions }) => {
        if (entry.kind !== "skill") return null;
        const { label, description, path } = entry.record;
        return buttonContextChip({
          kind: "skill",
          icon: <SkillChipIcon />,
          label,
          kindLabel: "Skill",
          preview: {
            label,
            description,
            onOpenInstructions:
              path && actions.environmentId ? () => actions.openMention(path) : undefined,
          },
        });
      },
    },
    "thread-tab": {
      chip: (entry) =>
        entry.kind === "thread-tab"
          ? buttonContextChip({
              kind: "thread-tab",
              icon: <MessagesSquareIcon />,
              label: entry.record.label,
              kindLabel: "Chat summary",
              preview: { summary: entry.record.summary },
            })
          : null,
    },
    "linear-issue": linkedObjectHandler("linear-issue"),
    "github-issue": linkedObjectHandler("github-issue"),
    repository: linkedObjectHandler("repository"),
    checkout: {
      chip: (entry) =>
        entry.kind === "checkout"
          ? buttonContextChip({
              kind: "checkout",
              icon: <FolderIcon />,
              label: entry.record.label,
              kindLabel: "Checkout",
              preview: { record: entry.record },
            })
          : null,
    },
    "slack-thread": linkedObjectHandler("slack-thread"),
    "discord-thread": linkedObjectHandler("discord-thread"),
    "notion-page": linkedObjectHandler("notion-page"),
    "granola-note": linkedObjectHandler("granola-note"),
    thread: {
      chip: (entry, { actions }) => {
        if (entry.kind !== "thread") return null;
        const unreadable =
          actions.environmentId !== null && entry.record.environmentId !== actions.environmentId;
        return {
          trigger: <ThreadChipTrigger record={entry.record} unreadable={unreadable} />,
          accessibleLabel: `Thread, ${entry.record.title}`,
          preview: { record: entry.record, unreadable },
        };
      },
    },
    subagent: {
      chip: (entry) =>
        entry.kind === "subagent"
          ? {
              trigger: <SubagentChipTrigger record={entry.record} />,
              accessibleLabel: subagentChipAccessibleLabel(entry.record),
              preview: { record: entry.record },
            }
          : null,
    },
    "prompt-link": linkedObjectHandler("prompt-link"),
    "github-ref": linkedObjectHandler("github-ref"),
    "unread-link": {
      chip: (entry, { actions }) => {
        if (entry.kind !== "unread-link") return null;
        const { record } = entry;
        return {
          trigger: <UnreadLinkChipTrigger record={record} />,
          accessibleLabel: unreadLinkAccessibleLabel(record),
          preview: {
            record,
            onOpenLink: actions.openLink,
            onRetry: () => actions.retryUnreadLink(record),
            onKeepAsText: () => actions.keepUnreadLinkAsText(record),
          },
        };
      },
    },
  },
  fallback: (_kind, _entry, context) => <UnresolvedContextChip label={context.label} />,
});

/** A composer chip for a record the draft holds, such as a `$skill` or `@path` in the prompt. */
export function ComposerContextRecordChip(props: {
  entry: ComposerContextChipEntry;
  label: string;
}): ReactElement {
  const actions = use(ComposerContextActionsContext);
  const { resolvedTheme } = useTheme();
  return composerContextPresentationRegistry.render(props.entry.kind, props.entry, {
    label: props.label,
    actions,
    resolvedTheme,
  });
}

/** Compact chip for one reference. Unknown kinds and missing records use the registry fallback. */
export function ComposerContextReferenceChip(props: {
  kind: string;
  contextId: string;
  label: string;
}): ReactElement {
  const records = use(ComposerContextRecordsContext);
  const actions = use(ComposerContextActionsContext);
  const { resolvedTheme } = useTheme();
  return composerContextPresentationRegistry.render(props.kind, records.get(props.contextId), {
    label: props.label,
    actions,
    resolvedTheme,
  });
}
