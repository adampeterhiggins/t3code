import type { ThreadId } from "@t3tools/contracts";
import { COMPOSER_CONTEXT_TERMINAL_STYLED_TEXT_MAX_CHARS } from "@t3tools/contracts";
import {
  formatComposerContextReference,
  toKindScopedComposerContextId,
} from "@t3tools/shared/composerContextReferences";

export interface TerminalContextSelection {
  terminalId: string;
  terminalLabel: string;
  lineStart: number;
  lineEnd: number;
  text: string;
  /** `text` with its SGR colors and styles, for display only. */
  styledText?: string;
}

export interface TerminalContextDraft extends TerminalContextSelection {
  id: string;
  threadId: ThreadId;
  createdAt: string;
}

export const INLINE_TERMINAL_CONTEXT_PLACEHOLDER = "\uFFFC";

export interface TerminalContextReferenceSource {
  id: string;
  terminalLabel: string;
  lineStart: number;
  lineEnd: number;
}

export function formatTerminalContextReference(context: TerminalContextReferenceSource): string {
  return formatComposerContextReference({
    kind: "terminal",
    contextId: toKindScopedComposerContextId("terminal", context.id),
    label: formatTerminalContextLabel(context),
  });
}

// CSI sequences (SGR and anything else), OSC sequences ended by BEL or ST, and lone escapes.
// oxlint-disable-next-line no-control-regex
const ESCAPE_PATTERN = /\x1b\[([0-9:;?<=>]*)([ -/]*[@-~])|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b./g;

/**
 * Keep only the text and its SGR sequences. Ghostty's VT selection output also carries
 * terminal state, such as the whole 256-color palette as OSC 4, that a preview never needs.
 */
function stripNonSgrSequences(input: string): string {
  return input.replace(ESCAPE_PATTERN, (sequence, _params, final) =>
    final === "m" ? sequence : "",
  );
}

export function normalizeTerminalContextText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/^\n+|\n+$/g, "");
}

/**
 * The styled copy worth keeping: only when it carries escape sequences (otherwise it repeats
 * `text`) and fits the record bound, past which the preview falls back to plain text.
 */
export function keepTerminalContextStyledText(styledText: string | undefined): string | undefined {
  if (styledText === undefined) return undefined;
  const normalized = normalizeTerminalContextText(stripNonSgrSequences(styledText));
  if (!normalized.includes("\x1b")) return undefined;
  return normalized.length <= COMPOSER_CONTEXT_TERMINAL_STYLED_TEXT_MAX_CHARS
    ? normalized
    : undefined;
}

function hasTerminalContextText(context: { text: string }): boolean {
  return normalizeTerminalContextText(context.text).length > 0;
}

export function isTerminalContextExpired(context: { text: string }): boolean {
  return !hasTerminalContextText(context);
}

export function filterTerminalContextsWithText<T extends { text: string }>(
  contexts: ReadonlyArray<T>,
): T[] {
  return contexts.filter((context) => hasTerminalContextText(context));
}

function normalizeTerminalContextSelection(
  selection: TerminalContextSelection,
): TerminalContextSelection | null {
  const text = normalizeTerminalContextText(selection.text);
  const terminalId = selection.terminalId.trim();
  const terminalLabel = selection.terminalLabel.trim();
  if (text.length === 0 || terminalId.length === 0 || terminalLabel.length === 0) {
    return null;
  }
  const lineStart = Math.max(1, Math.floor(selection.lineStart));
  const lineEnd = Math.max(lineStart, Math.floor(selection.lineEnd));
  return {
    terminalId,
    terminalLabel,
    lineStart,
    lineEnd,
    text,
  };
}

function formatTerminalContextRange(selection: { lineStart: number; lineEnd: number }): string {
  return selection.lineStart === selection.lineEnd
    ? `line ${selection.lineStart}`
    : `lines ${selection.lineStart}-${selection.lineEnd}`;
}

export function formatTerminalContextLabel(selection: {
  terminalLabel: string;
  lineStart: number;
  lineEnd: number;
}): string {
  return `${selection.terminalLabel} ${formatTerminalContextRange(selection)}`;
}

export function migrateLegacyTerminalContextPlaceholders(
  prompt: string,
  contexts: ReadonlyArray<TerminalContextReferenceSource>,
): string {
  if (!prompt.includes(INLINE_TERMINAL_CONTEXT_PLACEHOLDER)) return prompt;
  let index = 0;
  return prompt.replaceAll(INLINE_TERMINAL_CONTEXT_PLACEHOLDER, () => {
    const context = contexts[index];
    index += 1;
    return context ? formatTerminalContextReference(context) : "";
  });
}

/**
 * An upper bound on the terminal columns `line` occupies, so a grid this wide never wraps it.
 * East Asian wide characters and emoji take two cells; erring wide only leaves blank columns.
 * Box drawing, arrows, and private-use Nerd Font glyphs (prompt segments) take one.
 */
export function terminalTextColumns(line: string): number {
  let columns = 0;
  for (const character of line) {
    const code = character.codePointAt(0) ?? 0;
    const narrow =
      code < 0x1100 ||
      (code >= 0x2000 && code <= 0x25ff) ||
      (code >= 0xe000 && code <= 0xf8ff) ||
      code >= 0xf0000;
    columns += narrow ? 1 : 2;
  }
  return columns;
}
