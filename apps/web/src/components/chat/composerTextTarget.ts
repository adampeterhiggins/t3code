import { type ComposerTrigger, detectComposerTrigger } from "../../composer-logic";

/**
 * Text the composer edits besides its prompt, such as a citation's comment. Menus, links, and
 * attachments write into it the way they write into the prompt. `read` is null once it closed,
 * so work that finishes afterwards leaves it alone.
 */
export interface ComposerTextTarget {
  readonly key: string;
  readonly read: () => string | null;
  /** The caret as an offset into the text `read` returns. */
  readonly caret: () => number;
  readonly replace: (start: number, end: number, text: string) => boolean;
  readonly focus: () => void;
}

function insertSpaced(
  target: ComposerTextTarget,
  text: string,
  at: (value: string) => number,
): boolean {
  const value = target.read();
  if (value === null || text.length === 0) return false;
  const offset = Math.max(0, Math.min(value.length, at(value)));
  const spaced = offset > 0 && !/\s/.test(value[offset - 1] ?? "") ? ` ${text}` : text;
  return target.replace(offset, offset, spaced);
}

/** Inserts `text` at the caret, spaced from a word that ends there. */
export function insertAtComposerTextTargetCaret(target: ComposerTextTarget, text: string): boolean {
  return insertSpaced(target, text, () => target.caret());
}

/** Inserts `text` at the end, spaced from a word that ends there. */
export function insertAtComposerTextTargetEnd(target: ComposerTextTarget, text: string): boolean {
  return insertSpaced(target, text, (value) => value.length);
}

/**
 * A citation comment takes the `@` and `#` menus, which attach context. Skills and slash commands
 * act on the message or composer, so they stay the prompt's.
 */
export function citationCommentTrigger(text: string, cursor: number): ComposerTrigger | null {
  const trigger = detectComposerTrigger(text, cursor);
  return trigger?.kind === "path" || trigger?.kind === "pull-request" ? trigger : null;
}
