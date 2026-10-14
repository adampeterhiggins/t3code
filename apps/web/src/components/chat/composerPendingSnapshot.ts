export interface ComposerSnapshot {
  value: string;
  cursor: number;
  expandedCursor: number;
  contextIds: string[];
}

/** Use the replacement's caret while the controlled editor still holds the previous text. */
export function resolveComposerSnapshot(
  value: string,
  editor: ComposerSnapshot | undefined,
  pending: ComposerSnapshot | null,
): ComposerSnapshot | undefined {
  if (pending?.value === value && editor?.value !== value) return pending;
  return editor;
}
