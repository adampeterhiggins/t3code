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
  const root = trimTrailingSeparators(workspaceRoot?.trim() ?? "");
  // A filesystem or drive root would turn every absolute path relative.
  if (!/[\\/][^\\/]/.test(root)) return command;
  const caseInsensitive = isWindowsAbsolutePath(root);
  const normalizeForCompare = (path: string) => {
    const trimmed = trimTrailingSeparators(unquote(path));
    return caseInsensitive ? trimmed.toLowerCase() : trimmed;
  };
  const rootForCompare = normalizeForCompare(root);

  let formatted = command;
  if ((caseInsensitive ? command.toLowerCase() : command).includes(rootForCompare)) {
    let rewriteEnd = command.length;
    for (const match of command.matchAll(DIRECTORY_CHANGE_PATTERN)) {
      const target = match[2];
      const normalizedTarget = target === undefined ? undefined : normalizeForCompare(target);
      if (normalizedTarget === rootForCompare || normalizedTarget === ".") continue;
      rewriteEnd = match.index + match[0].length;
      break;
    }
    const rootPath = new RegExp(
      `(^|[\\s'"=(])${escapeRegExp(root)}(?:([\\\\/])(?=[^\\s'"\`;&|)\\\\/])|[\\\\/]*(?=$|[\\s'"\`;&|):]))`,
      caseInsensitive ? "gi" : "g",
    );
    formatted =
      command
        .slice(0, rewriteEnd)
        .replace(rootPath, (_match, before: string, separator: string | undefined) =>
          separator ? before : `${before}.`,
        ) + command.slice(rewriteEnd);
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
