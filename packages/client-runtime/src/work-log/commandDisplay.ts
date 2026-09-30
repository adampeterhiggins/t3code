import { isToolLifecycleItemType } from "@t3tools/contracts";
import { isWindowsAbsolutePath } from "@t3tools/shared/path";

// A statement that changes directory: `cd`, `pushd`, or PowerShell's
// `Set-Location`/`Push-Location`, with an optional (possibly quoted) target.
const DIRECTORY_CHANGE_PATTERN =
  /(^|[\s;&|('"])(?:cd|pushd|set-location|sl|push-location)(?:\s+(?:--\s+)?('[^']*'|"[^"]*"|[^\s;&|)]+))?(?=$|[\s;&|)])/gi;
// `cd .` at the start of a statement, with its separator. Always a no-op.
const NO_OP_CD_PATTERN =
  /(^|&&|;|\n|\(|'|")[^\S\n]*(?:cd|set-location)\s+(?:--\s+)?(?:\.|'\.'|"\.")[^\S\n]*(?:&&|;|\n)\s*/gi;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function trimTrailingSeparators(value: string): string {
  return value.replace(/[\\/]+$/, "");
}

function unquote(value: string): string {
  const first = value[0];
  return (first === "'" || first === '"') && value.endsWith(first) && value.length > 1
    ? value.slice(1, -1)
    : value;
}

interface WorkspacePaths {
  readonly rootForCompare: string;
  readonly normalizeForCompare: (path: string) => string;
  readonly mentionedIn: (text: string) => boolean;
  readonly relativize: (text: string) => string;
}

function workspacePaths(workspaceRoot: string | null | undefined): WorkspacePaths | null {
  const root = trimTrailingSeparators(workspaceRoot?.trim() ?? "");
  // A filesystem or drive root would turn every absolute path relative.
  if (!/[\\/][^\\/]/.test(root)) return null;
  const caseInsensitive = isWindowsAbsolutePath(root);
  const normalizeForCompare = (path: string) => {
    const trimmed = trimTrailingSeparators(unquote(path));
    return caseInsensitive ? trimmed.toLowerCase() : trimmed;
  };
  const rootForCompare = normalizeForCompare(root);
  const rootPath = new RegExp(
    `(^|[\\s'"=(])${escapeRegExp(root)}(?:([\\\\/])(?=[^\\s'"\`;&|)\\\\/])|[\\\\/]*(?=$|[\\s'"\`;&|):]))`,
    caseInsensitive ? "gi" : "g",
  );
  return {
    rootForCompare,
    normalizeForCompare,
    mentionedIn: (text) => (caseInsensitive ? text.toLowerCase() : text).includes(rootForCompare),
    relativize: (text) =>
      text.replace(rootPath, (_match, before: string, separator: string | undefined) =>
        separator ? before : `${before}.`,
      ),
  };
}

/**
 * Shows paths inside `workspaceRoot` relative to it, e.g. in a file tool's
 * `Read: /repo/src/a.ts` label. Paths elsewhere are left absolute.
 */
export function formatPathsForWorkspace(
  text: string,
  workspaceRoot: string | null | undefined,
): string {
  const paths = workspacePaths(workspaceRoot);
  return paths?.mentionedIn(text) ? paths.relativize(text) : text;
}

/**
 * Formats a work entry's tool label (`Read: /repo/src/a.ts`, an image path, a
 * changed file) with workspace paths relative. Prose rows such as task
 * summaries and errors keep their paths as written.
 */
export function formatToolTextForWorkspace(
  entry: { readonly itemType?: string | undefined },
  text: string,
  workspaceRoot: string | null | undefined,
): string {
  return entry.itemType !== undefined && isToolLifecycleItemType(entry.itemType)
    ? formatPathsForWorkspace(text, workspaceRoot)
    : text;
}

/**
 * Formats a shell command for display in a thread whose commands start in
 * `workspaceRoot`. Agents often prefix commands with `cd <workspace> &&` and
 * spell out absolute paths even though the shell already starts there; both
 * bury the part of the command that matters.
 *
 * The result means the same thing when run from the workspace: a `cd` to the
 * workspace is dropped, and workspace paths become relative. Rewriting stops at
 * the first `cd` elsewhere, since relative paths after it would resolve against
 * a different directory.
 */
export function formatCommandForWorkspace(
  command: string,
  workspaceRoot: string | null | undefined,
): string {
  const paths = workspacePaths(workspaceRoot);
  if (!paths) return command;

  let formatted = command;
  if (paths.mentionedIn(command)) {
    let rewriteEnd = command.length;
    for (const match of command.matchAll(DIRECTORY_CHANGE_PATTERN)) {
      const target = match[2];
      const normalizedTarget = target === undefined ? undefined : paths.normalizeForCompare(target);
      if (normalizedTarget === paths.rootForCompare || normalizedTarget === ".") continue;
      rewriteEnd = match.index + match[0].length;
      break;
    }
    formatted = paths.relativize(command.slice(0, rewriteEnd)) + command.slice(rewriteEnd);
  }
  // Each pass consumes the separator that the next adjacent `cd .` needs.
  for (let previous = ""; previous !== formatted;) {
    previous = formatted;
    formatted = formatted.replace(NO_OP_CD_PATTERN, (_match, before: string) =>
      before === "&&" || before === ";" ? `${before} ` : before,
    );
  }
  return formatted.trim() || command;
}
