import { ThreadId } from "@t3tools/contracts";
import { claudeSkillInvocation } from "@t3tools/shared/toolActivity";
import { turnItemNeedsDetailFetch } from "@t3tools/client-runtime/work-log/item-detail";
import { resolveToolPreview } from "@t3tools/client-runtime/work-log/tool-preview";
import { workEntryReadOutput } from "./MessagesTimeline.logic";
import type { ReactNode, ComponentProps } from "react";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import {
  formatCommandForWorkspace,
  formatToolTextForWorkspace,
} from "@t3tools/client-runtime/work-log/command-display";
import {
  toolEntryShowsPathBreadcrumbs,
  toolPathTargets,
} from "@t3tools/client-runtime/work-log/tool-paths";
import { formatWorkspaceRelativePath } from "../../filePathDisplay";
import type { WorkLogEntry } from "../../session-logic";
import {
  toolCallPreviewHeading,
  toolCallPreviewReadContent,
  toolCallPreviewRepeatsFilePath,
  toolCallPreviewStatus,
} from "../../lib/toolCallPreview";
import { formatSecondsTimestamp } from "../../timestampFormat";
import { ToolCallBody } from "../ToolCallBody";
import { ToolPathText } from "./ToolPathText";
import { CommandToolPreview } from "./CommandToolPreview";
import { PreviewCornerAction } from "./PreviewCornerAction";
import { V2ItemInspector, FetchedToolOutput } from "./V2ItemInspector";
import { toolGroupAction, workEntryReadRawPaths } from "./MessagesTimeline.logic";

/** Shared by chat, agent transcripts, and the agent Tools list. Details mount only while open. */
export type ToolCallContext = Pick<
  ComponentProps<typeof V2ItemInspector>,
  "onOpenThread" | "onOpenTurnDiff" | "onRollbackCheckpoint" | "onImageExpand"
> & {
  activeThreadEnvironmentId: ComponentProps<typeof V2ItemInspector>["environmentId"];
  markdownCwd: string | undefined;
  timestampFormat: TimestampFormat;
};

export function workEntryRawCommand(
  workEntry: Pick<WorkLogEntry, "command" | "rawCommand">,
): string | null {
  const rawCommand = workEntry.rawCommand?.trim();
  if (!rawCommand || !workEntry.command) {
    return null;
  }
  return rawCommand === workEntry.command.trim() ? null : rawCommand;
}

export function buildToolCallExpandedBody(
  workEntry: WorkLogEntry,
  workspaceRoot: string | undefined,
  visibleLabel: string,
  viewedImagePath: string | null,
): string | null {
  const blocks: string[] = [];
  const seen = new Set<string>([visibleLabel.trim()]);
  const addBlock = (value: string | null | undefined) => {
    const text = value?.trim();
    if (!text || seen.has(text)) return;
    seen.add(text);
    blocks.push(text);
  };
  if (workEntry.itemType === "dynamic_tool" && workEntry.toolData !== undefined) {
    const input =
      workEntry.structuredPayload?.type === "dynamic_tool"
        ? workEntry.structuredPayload.input
        : workEntry.toolData !== null &&
            typeof workEntry.toolData === "object" &&
            "input" in workEntry.toolData
          ? workEntry.toolData.input
          : undefined;
    if (input !== undefined) addBlock(`Tool input\n${JSON.stringify(input, null, 2)}`);
  }
  const command = workEntry.command?.trim();
  const raw = workEntryRawCommand(workEntry);
  if (command && formatCommandForWorkspace(command, workspaceRoot) === visibleLabel.trim()) {
    seen.add(command);
  } else {
    const shownCommand = raw ?? command;
    addBlock(shownCommand && formatCommandForWorkspace(shownCommand, workspaceRoot));
  }
  const detail = workEntry.detail?.trim();
  if (detail !== viewedImagePath?.trim()) {
    // A command's detail is its output, shown as written.
    addBlock(
      detail && !command ? formatToolTextForWorkspace(workEntry, detail, workspaceRoot) : detail,
    );
  }
  const viewedImagePaths = new Set(
    viewedImagePath
      ? [viewedImagePath.trim(), formatWorkspaceRelativePath(viewedImagePath, workspaceRoot)]
      : [],
  );
  const changedFiles = (workEntry.changedFiles ?? []).flatMap((filePath) => {
    const formattedPath = formatWorkspaceRelativePath(filePath, workspaceRoot);
    return viewedImagePaths.has(filePath) ||
      viewedImagePaths.has(formattedPath) ||
      filePath.trim() === detail ||
      formattedPath === detail
      ? []
      : [formattedPath];
  });
  if (changedFiles.length > 0) {
    addBlock([...new Set(changedFiles)].join("\n"));
  }
  return blocks.length > 0 ? blocks.join("\n\n") : null;
}

const toolCallExpandedBodyClassName =
  "max-h-64 cursor-text overflow-auto whitespace-pre-wrap break-words font-mono text-secondary-label text-(length:--font-size-code,var(--text-2xs)) leading-relaxed select-text";

type WorkEntryDetailProps = ToolCallContext & {
  workEntry: WorkLogEntry;
  workspaceRoot: string | undefined;
  /** Reads and skills show this text instead of the item inspector. */
  plainOutput: string | null | undefined;
  /** The plain output still has output the timeline withheld. */
  plainOutputFetches: boolean;
  /** The hover card header already shows the inspector's corner action. */
  hidePreviewActions?: boolean;
  /** The hover card header already shows Open thread. */
  hideOpenThread?: boolean | undefined;
};

/** An open tool row's details: the item inspector for projected items, otherwise plain text. */
function WorkEntryDetailBody(
  props: WorkEntryDetailProps & {
    textBody: string | null;
    hideCommand?: boolean;
    hideExitCode?: boolean;
    highlightSyntax?: boolean;
  },
) {
  const ctx = props;
  const { workEntry } = props;
  if (workEntry.projectedItem && props.plainOutput === undefined) {
    return (
      <V2ItemInspector
        projectedItem={workEntry.projectedItem}
        environmentId={ctx.activeThreadEnvironmentId}
        cwd={ctx.markdownCwd}
        workspaceRoot={props.workspaceRoot}
        hideCommand={props.hideCommand}
        hideExitCode={props.hideExitCode}
        highlightSyntax={props.highlightSyntax}
        onOpenThread={ctx.onOpenThread}
        onOpenTurnDiff={ctx.onOpenTurnDiff}
        {...(ctx.onRollbackCheckpoint ? { onRollbackCheckpoint: ctx.onRollbackCheckpoint } : {})}
        onImageExpand={ctx.onImageExpand}
        hidePreviewActions={ctx.hidePreviewActions}
        hideOpenThread={ctx.hideOpenThread}
      />
    );
  }
  return (
    <>
      {props.textBody ? (
        toolGroupAction(workEntry) === "read" ? (
          <div className={toolCallExpandedBodyClassName}>
            <ToolPathText
              targets={toolPathTargets(workEntry)}
              text={props.textBody}
              environmentId={ctx.activeThreadEnvironmentId}
              workspaceRoot={props.workspaceRoot}
            />
          </div>
        ) : (
          <ToolCallBody className={toolCallExpandedBodyClassName} text={props.textBody} />
        )
      ) : null}
      {props.plainOutputFetches && workEntry.projectedItem ? (
        <FetchedToolOutput
          projectedItem={workEntry.projectedItem}
          environmentId={ctx.activeThreadEnvironmentId}
          onImageExpand={ctx.onImageExpand}
        />
      ) : null}
    </>
  );
}

/**
 * A collapsed tool row's hover card: the tool's heading, the command or full
 * label, then the same details the row expands to. Mounts only while open, so
 * rows never build (or fetch) preview details on render.
 */
function ToolCallPreviewContent(
  props: WorkEntryDetailProps & { previewText: string; icon: ReactNode },
) {
  const { timestampFormat, activeThreadEnvironmentId } = props;
  const { workEntry, workspaceRoot, plainOutput } = props;
  const heading = toolCallPreviewHeading(workEntry, workspaceRoot, props.previewText);
  const fileChange = workEntry.structuredPayload;
  const fileName = fileChange?.type === "file_change" ? fileChange.fileName : null;
  const rawTextBody =
    plainOutput !== undefined
      ? plainOutput
      : workEntry.projectedItem
        ? null
        : buildToolCallExpandedBody(
            workEntry,
            workspaceRoot,
            heading.command ?? props.previewText,
            null,
          );
  // A read's title, row label, and body are three spellings of one path.
  const readPreview =
    toolGroupAction(workEntry) === "read"
      ? toolCallPreviewReadContent({
          title: heading.title,
          text: heading.text,
          body: rawTextBody,
          paths: workEntryReadRawPaths(workEntry),
          workspaceRoot,
        })
      : null;
  const headingText = readPreview
    ? readPreview.text
    : toolCallPreviewRepeatsFilePath(heading.text, fileName, workspaceRoot)
      ? null
      : heading.text;
  const textBody = readPreview ? readPreview.body : rawTextBody;
  const item = workEntry.projectedItem?.item;
  const toolPreview = item ? resolveToolPreview(item) : null;
  const openThreadId =
    toolPreview?.kind === "thread" ||
    toolPreview?.kind === "task" ||
    toolPreview?.kind === "agent-message"
      ? toolPreview.threadId
      : null;
  const headerAction = heading.command
    ? null
    : item?.type === "file_change" && item.runId !== null
      ? {
          label: "Open diff",
          onClick: () => props.onOpenTurnDiff(item.runId!, item.fileName),
        }
      : item?.type === "fork"
        ? {
            label: "Open fork",
            onClick: () => props.onOpenThread(item.targetThreadId),
          }
        : item?.type === "subagent" && item.childThreadId !== null
          ? {
              label: "Open subagent thread",
              onClick: () => props.onOpenThread(item.childThreadId!),
            }
          : openThreadId
            ? {
                label: "Open thread",
                onClick: () => props.onOpenThread(ThreadId.make(openThreadId)),
              }
            : null;
  if (heading.command) {
    const item = workEntry.projectedItem?.item;
    return (
      <CommandToolPreview
        heading={
          <>
            {props.icon}
            <span className="min-w-0 break-all">{heading.title}</span>
          </>
        }
        command={heading.command}
        status={toolCallPreviewStatus(workEntry)}
        timestamp={formatSecondsTimestamp(workEntry.createdAt, timestampFormat)}
        exitCode={item?.type === "command_execution" ? item.exitCode : undefined}
      >
        <WorkEntryDetailBody {...props} textBody={textBody} hideCommand hideExitCode />
      </CommandToolPreview>
    );
  }
  return (
    <div className="flex max-h-[60vh] flex-col gap-1.5 overflow-auto p-3">
      <div className="flex items-start justify-between gap-3 text-xs">
        <div className="flex min-w-0 items-start gap-1.5 text-secondary-label">
          {props.icon}
          <span className="min-w-0 break-all">
            <ToolPathText
              targets={toolPathTargets(workEntry)}
              text={heading.title}
              environmentId={activeThreadEnvironmentId}
              workspaceRoot={workspaceRoot}
            />
          </span>
        </div>
        {headerAction ? (
          <PreviewCornerAction onClick={headerAction.onClick}>
            {headerAction.label}
          </PreviewCornerAction>
        ) : null}
      </div>
      {headingText ? (
        <p className="text-xs break-words whitespace-pre-wrap text-foreground/85 select-text">
          {toolEntryShowsPathBreadcrumbs(workEntry) ? (
            <ToolPathText
              targets={toolPathTargets(workEntry)}
              text={headingText}
              environmentId={activeThreadEnvironmentId}
              workspaceRoot={workspaceRoot}
            />
          ) : (
            headingText
          )}
        </p>
      ) : null}
      <WorkEntryDetailBody
        {...props}
        textBody={textBody}
        hideCommand
        highlightSyntax
        hidePreviewActions={headerAction !== null}
        hideOpenThread={headerAction?.label === "Open thread"}
      />
      <p className="font-mono text-3xs text-muted-foreground select-text">
        {[
          formatSecondsTimestamp(workEntry.createdAt, timestampFormat),
          toolCallPreviewStatus(workEntry),
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
    </div>
  );
}

/** The same read/skill special cases apply in every surface that opens a call. */
export function ToolCallDetails(
  props: ToolCallContext & {
    workEntry: WorkLogEntry;
    workspaceRoot: string | undefined;
    previewText: string;
    icon: ReactNode;
    preview?: boolean | undefined;
    textBody?: string | null;
  },
) {
  const { workEntry, workspaceRoot } = props;
  const { plainOutput, plainOutputFetches } = toolCallDetailOutput(workEntry, workspaceRoot);
  if (props.preview)
    return (
      <ToolCallPreviewContent
        {...props}
        plainOutput={plainOutput}
        plainOutputFetches={plainOutputFetches}
      />
    );
  return (
    <WorkEntryDetailBody
      {...props}
      plainOutput={plainOutput}
      plainOutputFetches={plainOutputFetches}
      textBody={
        props.textBody !== undefined
          ? props.textBody
          : plainOutput !== undefined
            ? plainOutput
            : buildToolCallExpandedBody(workEntry, workspaceRoot, props.previewText, null)
      }
      highlightSyntax={workEntry.itemType === "command_execution"}
    />
  );
}

/** Output selection is shared as well as its renderer. */
export function toolCallDetailOutput(workEntry: WorkLogEntry, workspaceRoot: string | undefined) {
  const payload = workEntry.structuredPayload;
  const skill =
    payload?.type === "dynamic_tool"
      ? claudeSkillInvocation(payload.toolName, payload.input)
      : undefined;
  const plainOutput =
    toolGroupAction(workEntry) === "read"
      ? workEntryReadOutput(workEntry, workspaceRoot)
      : skill
        ? (skill.args ?? null)
        : undefined;
  const plainOutputFetches =
    plainOutput !== undefined &&
    workEntry.projectedItem !== undefined &&
    turnItemNeedsDetailFetch(workEntry.projectedItem.item);
  return { plainOutput, plainOutputFetches };
}
