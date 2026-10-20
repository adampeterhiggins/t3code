import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { formatAttachmentSize } from "@t3tools/client-runtime/state/attachments";
import { deriveThreadAgentFleet } from "@t3tools/client-runtime/state/agent-fleet";
import type {
  ElementContextRecord,
  EnvironmentId,
  PreviewAnnotationContextRecord,
  ScopedThreadRef,
  ServerProviderSkill,
  SubagentContextRecord,
  ThreadContextRecord,
} from "@t3tools/contracts";
import { filePreviewKind } from "@t3tools/shared/filePreview";
import { PaintbrushIcon } from "lucide-react";

import { formatWorkspaceRelativePath } from "~/filePathDisplay";
import type { ReviewCommentContext } from "~/reviewCommentContext";
import { useProject, useThreadProjection, useThreadShell } from "~/state/entities";
import ChatMarkdown from "./ChatMarkdown";
import { showAgentInPanel } from "./chat/agentContextMenu";
import {
  AgentPreviewContent,
  useEnvironmentShells,
  useProviderEntries,
} from "./chat/AgentFleetRow";
import { PreviewCornerAction } from "./chat/PreviewCornerAction";
import { WorkspaceEntryTooltip } from "./chat/WorkspaceEntryIcon";
import { ImageAttachmentPreview } from "./contextChipParts";
import { AttachmentQuickLookPreview } from "./files/AttachmentQuickLook";
import { ReadOnlySourcePreview } from "./files/AttachmentFilePreview";
import { ReviewCommentCard } from "./ReviewCommentCard";
import { ThreadPreviewHoverCard } from "./ThreadHoverCard";

/*
 * Hover bodies for context kinds that have no better home. Every surface reaches these through
 * the context presentation registry, never directly, so a kind reads the same everywhere.
 */

export interface ImagePreviewProps {
  name: string;
  sizeBytes: number;
  previewUrl: string | undefined;
  /** Why the upload failed, when it did. */
  failure?: string | undefined;
}

export function ImagePreview(props: ImagePreviewProps) {
  return (
    <div className="w-96 max-w-full">
      {props.previewUrl ? <ImageAttachmentPreview url={props.previewUrl} /> : null}
      <AttachmentFacts name={props.name} sizeBytes={props.sizeBytes} failure={props.failure} />
    </div>
  );
}

/** File kinds whose hover card can show their opening contents. */
const QUICK_LOOK_KINDS = new Set(["text", "markdown", "html"]);

export interface FilePreviewProps {
  name: string;
  sizeBytes: number;
  mimeType: string;
  /** The bytes, when this client already holds them; hovering never fetches an upload. */
  file?: Blob | undefined;
  failure?: string | undefined;
  /** A draft file whose bytes were not saved with the draft. */
  needsReattach?: boolean | undefined;
}

export function FilePreview(props: FilePreviewProps) {
  if (props.needsReattach) {
    return (
      <p className="w-96 max-w-full px-3 py-2 text-xs">
        {props.name} was not saved with this draft. Attach it again to send it.
      </p>
    );
  }
  const quickLook = props.file && QUICK_LOOK_KINDS.has(filePreviewKind(props)) ? props.file : null;
  return (
    <div className="w-96 max-w-full">
      {quickLook ? (
        <AttachmentQuickLookPreview file={quickLook} name={props.name} mimeType={props.mimeType} />
      ) : null}
      <AttachmentFacts name={props.name} sizeBytes={props.sizeBytes} failure={props.failure} />
    </div>
  );
}

function AttachmentFacts(props: { name: string; sizeBytes: number; failure?: string | undefined }) {
  return (
    <p className="whitespace-pre-wrap wrap-break-word px-3 py-2 text-xs">
      {props.name}
      {"\n"}
      {formatAttachmentSize(props.sizeBytes)}
      {props.failure ? `\n\n${props.failure}` : null}
    </p>
  );
}

export interface MentionPreviewProps {
  path: string;
  /** What to show for the path, such as a link's target with its line. Defaults to the path. */
  label?: string | undefined;
  environmentId: EnvironmentId | null;
  cwd?: string | undefined;
}

export function MentionPreview(props: MentionPreviewProps) {
  return (
    <div className="overflow-x-auto whitespace-nowrap scrollbar-thumb-border/78 scrollbar-track-transparent [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border/78 [&::-webkit-scrollbar-track]:bg-transparent">
      <WorkspaceEntryTooltip
        path={props.path}
        {...(props.label === undefined ? {} : { label: props.label })}
        environmentId={props.environmentId}
        cwd={props.cwd}
      />
    </div>
  );
}

export interface SkillPreviewProps {
  label: string;
  description: string | null;
  /** Opens the skill's instructions file; absent where the file can't be opened. */
  onOpenInstructions?: (() => void) | undefined;
}

/** Long form first: the preview has room for the full description. */
export function skillPreviewDescription(
  skill: Pick<ServerProviderSkill, "description" | "shortDescription">,
): string | null {
  return skill.description?.trim() || skill.shortDescription?.trim() || null;
}

export function SkillPreview(props: SkillPreviewProps) {
  return (
    <div className="space-y-3 p-2 text-sm">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 truncate font-medium">{props.label}</p>
        {props.onOpenInstructions ? (
          <PreviewCornerAction onClick={props.onOpenInstructions}>
            View instructions
          </PreviewCornerAction>
        ) : null}
      </div>
      {props.description ? (
        <ChatMarkdown text={props.description} cwd={undefined} />
      ) : (
        <p>No description is available for this skill.</p>
      )}
    </div>
  );
}

export interface ElementPreviewProps {
  record: Pick<
    ElementContextRecord,
    "pageTitle" | "pageUrl" | "selector" | "tagName" | "source" | "htmlPreview" | "styles"
  >;
}

export function ElementPreview({ record }: ElementPreviewProps) {
  const sourceLabel = record.source?.fileName
    ? `${record.source.fileName}${record.source.lineNumber === null ? "" : `:${record.source.lineNumber}`}`
    : null;
  return (
    <div className="max-w-full overflow-hidden rounded-lg border border-border/70 bg-background/70">
      <div className="border-b border-border/70 px-3 py-2.5">
        <div className="truncate text-message-foreground text-xs font-medium">
          {record.pageTitle?.trim() || record.pageUrl}
        </div>
        <div className="mt-0.5 truncate text-secondary-label text-3xs">{record.pageUrl}</div>
      </div>
      <div className="space-y-2 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2 text-xs">
          <code className="truncate text-message-foreground">
            {record.selector || `<${record.tagName}>`}
          </code>
          {sourceLabel ? (
            <span className="ml-auto shrink-0 text-secondary-label">{sourceLabel}</span>
          ) : null}
        </div>
        {record.htmlPreview?.trim() ? (
          <div className="flex h-40 flex-col overflow-hidden rounded border border-border">
            <ReadOnlySourcePreview name="element.html" text={record.htmlPreview} />
          </div>
        ) : null}
        {record.styles?.trim() ? (
          <div className="flex h-32 flex-col overflow-hidden rounded border border-border">
            <ReadOnlySourcePreview name="styles.css" text={record.styles} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

export interface PreviewAnnotationPreviewProps {
  record: Pick<
    PreviewAnnotationContextRecord,
    "pageTitle" | "pageUrl" | "comment" | "targetSummary" | "styleChanges" | "elements"
  >;
  screenshotUrl: string | null;
  onExpandScreenshot?: (() => void) | undefined;
}

export function PreviewAnnotationPreview(props: PreviewAnnotationPreviewProps) {
  const { record } = props;
  const elements = record.elements ?? [];
  const screenshot = props.screenshotUrl ? (
    <img
      src={props.screenshotUrl}
      alt="Annotated preview crop"
      className="max-h-64 w-full object-contain"
    />
  ) : null;
  return (
    <div className="max-w-full overflow-hidden rounded-lg border border-border/70 bg-background/70">
      {screenshot === null ? (
        <div className="border-b border-border/70 bg-muted/40 px-3 py-2 text-secondary-label text-xs">
          Screenshot unavailable
        </div>
      ) : props.onExpandScreenshot ? (
        <button
          type="button"
          className="block max-h-64 w-full cursor-zoom-in overflow-hidden border-b border-border/70 bg-muted"
          aria-label="Expand annotated screenshot"
          onClick={props.onExpandScreenshot}
        >
          {screenshot}
        </button>
      ) : (
        <div className="max-h-64 overflow-hidden border-b border-border/70 bg-muted">
          {screenshot}
        </div>
      )}
      <div className="min-w-0 px-3 py-2.5">
        <div className="text-message-foreground text-xs font-medium">
          {record.pageTitle?.trim() || record.pageUrl || "Preview annotation"}
        </div>
        {record.comment ? (
          <div className="mt-1 whitespace-pre-wrap wrap-break-word text-sm">{record.comment}</div>
        ) : null}
        <div className="mt-1 flex items-center gap-2 text-secondary-label text-3xs">
          {record.targetSummary ? <span className="truncate">{record.targetSummary}</span> : null}
          {record.styleChanges.length > 0 ? (
            <span className="inline-flex shrink-0 items-center gap-1">
              <PaintbrushIcon className="size-3" />
              {record.styleChanges.length}
            </span>
          ) : null}
        </div>
        {elements.length > 0 ? (
          <div className="mt-2 space-y-2 border-t border-border/60 pt-2">
            {elements.map((element) => {
              const source = element.source;
              const sourceLabel = source?.fileName
                ? `${source.fileName}${source.lineNumber === null ? "" : `:${source.lineNumber}`}`
                : null;
              return (
                <div
                  key={`${element.selector}\u0000${element.tagName}\u0000${sourceLabel ?? ""}\u0000${element.htmlPreview}`}
                  className="min-w-0"
                >
                  <div className="flex min-w-0 items-center gap-2 text-xs">
                    <code className="truncate text-message-foreground">
                      {element.selector || `<${element.tagName}>`}
                    </code>
                    {sourceLabel ? (
                      <span className="ml-auto shrink-0 text-secondary-label">{sourceLabel}</span>
                    ) : null}
                  </div>
                  {element.htmlPreview?.trim() ? (
                    <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap rounded bg-muted/60 px-2 py-1.5 text-3xs leading-relaxed">
                      {element.htmlPreview.trim()}
                    </pre>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export interface ReviewCommentPreviewProps {
  comment: ReviewCommentContext;
  /** Where the comment's remarks resolve relative links, and its path is shown from. */
  workspaceRoot?: string | undefined;
  markdownCwd?: string | undefined;
  threadRef?: ScopedThreadRef | undefined;
  /** The live environment, for a pull request summary's preview. */
  environmentId: EnvironmentId | null;
}

export function ReviewCommentPreview(props: ReviewCommentPreviewProps) {
  const renderRemark = (body: string) => (
    <ChatMarkdown
      text={body}
      cwd={props.markdownCwd}
      threadRef={props.threadRef}
      className="text-foreground"
    />
  );
  return (
    <ReviewCommentCard
      comment={props.comment}
      displayPath={formatWorkspaceRelativePath(props.comment.filePath, props.workspaceRoot)}
      renderRemark={renderRemark}
      threadRef={props.threadRef}
      note={
        props.comment.text.trim().length > 0 ? (
          <div className="whitespace-pre-wrap wrap-break-word">
            {renderRemark(props.comment.text.trim())}
          </div>
        ) : null
      }
    />
  );
}

export interface ThreadPreviewProps {
  record: Pick<ThreadContextRecord, "environmentId" | "threadId" | "title">;
  /** On another machine than the one the message is for, so its agent can't read it. */
  unreadable?: boolean | undefined;
}

export function ThreadPreview(props: ThreadPreviewProps) {
  const { environmentId, threadId } = props.record;
  const shell = useThreadShell({ environmentId, threadId });
  const project = useProject(shell ? { environmentId, projectId: shell.projectId } : null);
  if (props.unreadable) {
    return (
      <p className="px-1 py-2 text-xs">
        On another machine, so this machine's agent can't read it. Remove it or switch back to send.
      </p>
    );
  }
  if (!shell) return <p className="px-1 py-2 text-xs">Thread no longer available</p>;
  return (
    <ThreadPreviewHoverCard
      shell={shell}
      project={project}
      title={shell.title?.trim() || props.record.title}
    />
  );
}

export type SubagentChipRecord = Pick<
  SubagentContextRecord,
  "environmentId" | "ownerThreadId" | "childThreadId" | "subagentId" | "handle" | "title" | "status"
>;

export interface SubagentPreviewProps {
  record: SubagentChipRecord;
}

/** The agent's Agents panel preview, found among its owner's agents. Mounted while open. */
export function SubagentPreview(props: SubagentPreviewProps) {
  const { record } = props;
  const ownerRef = scopeThreadRef(record.environmentId, record.ownerThreadId);
  const owner = useThreadProjection(ownerRef)?.projection ?? null;
  const shells = useEnvironmentShells(record.environmentId);
  const providers = useProviderEntries(record.environmentId);
  const project = useProject(
    owner ? scopeProjectRef(record.environmentId, owner.thread.projectId) : null,
  );
  const key = record.childThreadId ?? `subagent:${record.subagentId}`;
  const entry =
    deriveThreadAgentFleet({
      threadId: record.ownerThreadId,
      subagents: owner?.subagents ?? [],
      shells,
    }).find((candidate) => candidate.key === key) ?? null;
  if (entry === null) {
    return (
      <p className="w-100 max-w-full px-3 py-2.5 text-xs text-muted-foreground">
        {owner === null ? "Loading agent…" : `@${record.handle} is no longer recorded.`}
      </p>
    );
  }
  return (
    <div className="w-100 max-w-full">
      <AgentPreviewContent
        parentRef={ownerRef}
        entry={entry}
        provider={providers.get(entry.providerInstanceId)}
        workspaceRoot={owner?.thread.worktreePath ?? project?.workspaceRoot ?? null}
        onOpen={() => showAgentInPanel(ownerRef, entry.key)}
      />
    </div>
  );
}
