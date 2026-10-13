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

function readPathKey(path: string, workspaceRoot: string | undefined): string {
  return formatWorkspaceRelativePath(path.trim(), workspaceRoot);
}

/** `Read <path>` or `Read <path> +N more`, the compact label a file read wears. */
function parseReadLabel(text: string): { path: string; extra: number } | null {
  const more = / \+(\d+) more$/.exec(text);
  const head = (more ? text.slice(0, more.index) : text).trim();
  if (!head.startsWith("Read ")) return null;
  const path = head.slice("Read ".length).trim();
  if (!path) return null;
  return { path, extra: more ? Number(more[1]) : 0 };
}

/**
 * True when `text` names exactly these files and nothing else. A read's tool
 * title, row label, and body are three spellings of the same path — absolute,
 * `checkout/file`, or the path alone — so an exact string compare misses them.
 */
function toolCallPreviewRepeatsReadPaths(
  text: string | null,
  paths: readonly string[],
  workspaceRoot: string | undefined,
): boolean {
  const label = text?.trim();
  if (!label || paths.length === 0) return false;
  const keys = new Set(paths.map((path) => readPathKey(path, workspaceRoot)));
  const lines = label
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 1) {
    const parsed = parseReadLabel(lines[0]!);
    if (parsed) {
      return parsed.extra + 1 === paths.length && keys.has(readPathKey(parsed.path, workspaceRoot));
    }
    return paths.length === 1 && keys.has(readPathKey(lines[0]!, workspaceRoot));
  }
  if (lines.length !== paths.length) return false;
  const lineKeys = new Set(lines.map((line) => readPathKey(line, workspaceRoot)));
  return lineKeys.size === keys.size && [...lineKeys].every((key) => keys.has(key));
}

/** Drop path lines the heading already shows. A line range stays. */
function toolCallPreviewWithoutRepeatedReadPaths(
  text: string | null,
  paths: readonly string[],
  workspaceRoot: string | undefined,
): string | null {
  if (!text || paths.length === 0) return text;
  const keys = new Set(paths.map((path) => readPathKey(path, workspaceRoot)));
  const kept = text.split("\n").filter((line) => {
    const trimmed = line.trim();
    return trimmed.length > 0 && !keys.has(readPathKey(trimmed, workspaceRoot));
  });
  const next = kept.join("\n").trim();
  return next.length > 0 ? next : null;
}

/**
 * A read preview's secondary label and body, with paths the heading already
 * names removed. The file contents stay with the caller.
 */
export function toolCallPreviewReadContent(input: {
  readonly title: string;
  readonly text: string | null;
  readonly body: string | null;
  readonly paths: readonly string[];
  readonly workspaceRoot: string | undefined;
}): { text: string | null; body: string | null } {
  if (input.paths.length === 0) return { text: input.text, body: input.body };
  const titleNames = toolCallPreviewRepeatsReadPaths(input.title, input.paths, input.workspaceRoot);
  const textNames = toolCallPreviewRepeatsReadPaths(input.text, input.paths, input.workspaceRoot);
  const text = titleNames && textNames ? null : input.text;
  const headingNames = titleNames || (text !== null && textNames);
  return {
    text,
    body: headingNames
      ? toolCallPreviewWithoutRepeatedReadPaths(input.body, input.paths, input.workspaceRoot)
      : input.body,
  };
}

/** The lifecycle word shown in the preview footer. */
export function toolCallPreviewStatus(entry: WorkLogEntry): string | null {
  const status = entry.toolLifecycleStatus;
  if (status === undefined || status === "idle") return null;
  return status === "inProgress" ? "running" : status;
}
