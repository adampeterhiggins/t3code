/**
 * Tints whole transcript items: tool calls, which cannot hold a text selection, and messages
 * picked by shift-click. A stylesheet keyed by item id survives virtual rows remounting and
 * recycling, which attributes set on the rows would not.
 */
export function TranscriptSelectionStyle({ itemIds }: { itemIds: ReadonlyArray<string> }) {
  if (itemIds.length === 0) return null;
  const selectors = itemIds.flatMap((itemId) => {
    const id = CSS.escape(itemId);
    return [
      `[data-assistant-citation-viewport] [data-work-entry-id="${id}"]`,
      `[data-assistant-citation-viewport] [data-timeline-row-kind="message"][data-message-id="${id}"]`,
    ];
  });
  return (
    <style>{`${selectors.join(",\n")} {
  border-radius: var(--radius-md);
  background-color: color-mix(in oklab, var(--primary) 14%, transparent);
}`}</style>
  );
}
