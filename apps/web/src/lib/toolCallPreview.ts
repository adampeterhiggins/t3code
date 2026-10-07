import { formatCommandForWorkspace } from "@t3tools/client-runtime/work-log/command-display";
import { resolveWorkEntryToolPresentation } from "@t3tools/client-runtime/work-log/presentation";

import { formatWorkspaceRelativePath } from "../filePathDisplay";
import { type WorkLogEntry, workLogEntryIsToolLike } from "../session-logic";

/**
 * Collapsible tool rows preview their details on hover. Thoughts and answered
 * questions are not tool calls, and a row with nothing to expand has nothing to preview.
 */
export function workEntryHasToolCallPreview(entry: WorkLogEntry, canExpand: boolean): boolean {
  return (
    canExpand &&
    workLogEntryIsToolLike(entry) &&
    entry.itemType !== "reasoning" &&
    entry.questionAnswer === undefined
  );
}

/**
 * The preview card's heading: the tool's name, then either the workspace-relative
 * command it ran or the full row label when that says more than the name.
 */
export function toolCallPreviewHeading(
  entry: WorkLogEntry,
  workspaceRoot: string | undefined,
  rowLabel: string,
): { title: string; command: string | null; text: string | null } {
  const command = entry.command?.trim()
    ? formatCommandForWorkspace(entry.command, workspaceRoot)
    : null;
  const title =
    resolveWorkEntryToolPresentation(entry)?.displayName ??
    entry.toolTitle ??
    (command ? "Command" : rowLabel);
  return { title, command, text: !command && title !== rowLabel ? rowLabel : null };
}

/**
 * A file-change preview already names the file beside the diff. Drop a heading
 * that is only that path, in either absolute or workspace-relative form.
 */
export function toolCallPreviewRepeatsFilePath(
  text: string | null,
  fileName: string | null,
  workspaceRoot: string | undefined,
): boolean {
  const label = text?.trim();
  if (!label || !fileName) return false;
  return label === fileName || label === formatWorkspaceRelativePath(fileName, workspaceRoot);
}

/** The lifecycle word shown in the preview footer. */
export function toolCallPreviewStatus(entry: WorkLogEntry): string | null {
  const status = entry.toolLifecycleStatus;
  if (status === undefined || status === "idle") return null;
  return status === "inProgress" ? "running" : status;
}
