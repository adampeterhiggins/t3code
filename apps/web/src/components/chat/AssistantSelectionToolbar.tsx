import {
  ASSISTANT_CITATION_MAX_MARKDOWN_LENGTH,
  ASSISTANT_CITATION_MAX_TEXT_LENGTH,
  MessageId,
  type AssistantCitation,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { QuoteIcon, XIcon } from "lucide-react";
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  captureAssistantTextSelection,
  captureTranscriptSelectionEdges,
  TRANSCRIPT_TOOL_SELECTOR,
  transcriptItemIdAt,
  type AssistantCitationSourceAnchor,
  type TranscriptQuote,
} from "~/lib/assistantTextSelection";
import {
  isSelectionRectVisible,
  observeSelectionActions,
  resolveSelectionActionPosition,
  type SelectionActionPoint,
} from "~/lib/selectionActions";
import { serializeSelectedMarkdownQuote } from "~/markdown-clipboard";
import { assistantCitationLabel } from "@t3tools/shared/assistantCitations";
import type { TimelineEntry } from "../../session-logic";
import { Button } from "../ui/button";
import { buildTranscriptCitation, transcriptItemId } from "./transcriptCitation.logic";
import { TranscriptSelectionStyle } from "./TranscriptSelectionStyle";

const TRANSCRIPT_HIGHLIGHT_NAME = "t3-transcript-selection";

/**
 * Shift-clicking tool calls quotes whole timeline items. The anchor keeps the text selection
 * it started from, so the excerpt can begin partway through a response in either direction.
 */
type RowSelection = {
  anchor: { itemId: string; forward?: TranscriptQuote; backward?: TranscriptQuote };
  focusId: string;
};

/** Adds the selection's Markdown when it says more than the plain text and fits. */
function withSelectedMarkdown(citation: AssistantCitation, range: Range): AssistantCitation {
  const markdown = serializeSelectedMarkdownQuote(range);
  return markdown.trim().length === 0 ||
    markdown === citation.text ||
    markdown.length > ASSISTANT_CITATION_MAX_MARKDOWN_LENGTH
    ? citation
    : { ...citation, markdown };
}

/** Selected text that may run across rows, clipped by the viewport and any scrolling block. */
function isRangeVisible(range: Range, viewport: HTMLElement): boolean {
  const viewportRect = viewport.getBoundingClientRect();
  if (!isSelectionRectVisible(range.getBoundingClientRect(), [viewportRect])) return false;
  // A selection can cross blocks with different clipping ancestors.
  const common = range.commonAncestorContainer;
  const walker = document.createTreeWalker(common, NodeFilter.SHOW_TEXT);
  let node = common.nodeType === Node.TEXT_NODE ? common : walker.nextNode();
  for (; node; node = walker.nextNode()) {
    if (!range.intersectsNode(node)) continue;
    if (node.parentElement && getComputedStyle(node.parentElement).userSelect === "none") continue;
    const fragment = document.createRange();
    fragment.selectNodeContents(node);
    if (node === range.startContainer) fragment.setStart(node, range.startOffset);
    if (node === range.endContainer) fragment.setEnd(node, range.endOffset);
    if (!fragment.toString().trim()) continue;
    const lines = Array.from(fragment.getClientRects());
    if (!lines.some((line) => isSelectionRectVisible(line, [viewportRect]))) continue;
    const clips: Pick<DOMRect, "left" | "right" | "top" | "bottom">[] = [viewportRect];
    for (
      let element = node.parentElement;
      element && element !== viewport;
      element = element.parentElement
    ) {
      const style = getComputedStyle(element);
      const clipX = style.overflowX !== "visible";
      const clipY = style.overflowY !== "visible";
      if (!clipX && !clipY) continue;
      const bounds = element.getBoundingClientRect();
      const left = bounds.left + element.clientLeft;
      const top = bounds.top + element.clientTop;
      clips.push({
        left: clipX ? left : -Infinity,
        right: clipX ? left + element.clientWidth : Infinity,
        top: clipY ? top : -Infinity,
        bottom: clipY ? top + element.clientHeight : Infinity,
      });
    }
    if (lines.some((line) => isSelectionRectVisible(line, clips))) return true;
  }
  return false;
}

function wholeItemIds(citation: AssistantCitation | null, partialItemId?: string): string[] {
  return (citation?.segments ?? [])
    .map((segment) => segment.id)
    .filter((id) => id !== partialItemId);
}

export function AssistantSelectionToolbar({
  viewport,
  threadRef,
  entries,
  workspaceRoot,
  onCite,
}: {
  viewport: HTMLElement | null;
  threadRef: ScopedThreadRef;
  entries: ReadonlyArray<TimelineEntry>;
  workspaceRoot: string | undefined;
  onCite: (citation: AssistantCitation, sourceAnchor?: AssistantCitationSourceAnchor) => boolean;
}) {
  const [selection, setSelection] = useState<{
    citation: AssistantCitation;
    position: SelectionActionPoint;
    sourceAnchor?: AssistantCitationSourceAnchor;
    range: Range;
  } | null>(null);
  const [rowSelection, setRowSelection] = useState<RowSelection | null>(null);
  const toolbarRef = useRef<HTMLButtonElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<ReturnType<typeof observeSelectionActions> | null>(null);
  const rowSelectionActive = rowSelection !== null;
  const rowSelectionActiveRef = useRef(rowSelectionActive);
  useLayoutEffect(() => {
    rowSelectionActiveRef.current = rowSelectionActive;
  }, [rowSelectionActive]);

  const itemIndex = (itemId: string) =>
    entries.findIndex((entry) => transcriptItemId(entry) === itemId);
  const rowQuote = (() => {
    if (!rowSelection) return undefined;
    const { anchor, focusId } = rowSelection;
    const anchorIndex = itemIndex(anchor.itemId);
    const focusIndex = itemIndex(focusId);
    if (anchorIndex < 0 || focusIndex < 0 || anchorIndex === focusIndex) return undefined;
    return anchorIndex < focusIndex ? anchor.forward : anchor.backward;
  })();
  const rowCitation = rowSelection
    ? buildTranscriptCitation({
        threadRef,
        entries,
        from: { itemId: rowSelection.anchor.itemId, ...(rowQuote ? { quote: rowQuote } : {}) },
        to: { itemId: rowSelection.focusId },
        workspaceRoot,
      })
    : null;

  const transcriptCitationFor = useEffectEvent(
    (edges: NonNullable<ReturnType<typeof captureTranscriptSelectionEdges>>) =>
      buildTranscriptCitation({
        threadRef,
        entries,
        from: edges.first,
        to: edges.last,
        workspaceRoot,
      }),
  );
  /** A shift-click that starts row selection grows the current text selection toward it. */
  const anchorFromTextSelection = useEffectEvent(
    (clickedId: string): RowSelection["anchor"] | null => {
      if (!viewport) return null;
      const edges = captureTranscriptSelectionEdges(viewport, window.getSelection(), {
        part: "extended",
        allowSingleItem: true,
      });
      if (!edges) return null;
      if (itemIndex(clickedId) >= itemIndex(edges.first.itemId)) {
        const { itemId, quote } = edges.first;
        return { itemId, ...(quote ? { forward: quote } : {}) };
      }
      const { itemId, quote } = edges.last;
      return { itemId, ...(quote ? { backward: quote } : {}) };
    },
  );

  useEffect(() => {
    if (!viewport || !rowSelectionActive) return;
    const clear = (event: Event) => {
      if (event instanceof KeyboardEvent) {
        if (event.key !== "Escape" || event.isComposing) return;
      } else {
        const pointer = event as PointerEvent;
        if (pointer.shiftKey || pillRef.current?.contains(pointer.target as Node)) return;
      }
      setRowSelection(null);
    };
    document.addEventListener("keydown", clear);
    document.addEventListener("pointerdown", clear, true);
    return () => {
      document.removeEventListener("keydown", clear);
      document.removeEventListener("pointerdown", clear, true);
    };
  }, [rowSelectionActive, viewport]);

  useEffect(() => {
    const range = rowQuote?.range;
    const registry = typeof CSS !== "undefined" ? CSS.highlights : undefined;
    if (!range || typeof Highlight === "undefined" || !registry) return;
    const highlight = new Highlight(range);
    registry.set(TRANSCRIPT_HIGHLIGHT_NAME, highlight);
    return () => {
      if (registry.get(TRANSCRIPT_HIGHLIGHT_NAME) === highlight) {
        registry.delete(TRANSCRIPT_HIGHLIGHT_NAME);
      }
    };
  }, [rowQuote]);

  useEffect(() => {
    if (!viewport) return;
    // Tool rows toggle on click and are not selectable, so shift-click picks them instead.
    // Once picking, shift-clicking a message picks the whole message too.
    const pickedItemId = (event: MouseEvent) => {
      if (!event.shiftKey || event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey) {
        return null;
      }
      const target = event.target instanceof Element ? event.target : null;
      const tool = target?.closest<HTMLElement>(TRANSCRIPT_TOOL_SELECTOR);
      if (tool && viewport.contains(tool)) return tool.dataset.workEntryId ?? null;
      return rowSelectionActiveRef.current ? transcriptItemIdAt(viewport, target) : null;
    };
    const keepSelection = (event: MouseEvent) => {
      if (pickedItemId(event) !== null) event.preventDefault();
    };
    const pick = (event: MouseEvent) => {
      const itemId = pickedItemId(event);
      if (itemId === null) return;
      event.preventDefault();
      event.stopPropagation();
      const anchor = rowSelectionActiveRef.current ? null : anchorFromTextSelection(itemId);
      window.getSelection()?.removeAllRanges();
      setSelection(null);
      setRowSelection((current) =>
        current
          ? { ...current, focusId: itemId }
          : { anchor: anchor ?? { itemId }, focusId: itemId },
      );
    };
    viewport.addEventListener("pointerdown", keepSelection, true);
    viewport.addEventListener("mousedown", keepSelection, true);
    viewport.addEventListener("click", pick, true);
    return () => {
      viewport.removeEventListener("pointerdown", keepSelection, true);
      viewport.removeEventListener("mousedown", keepSelection, true);
      viewport.removeEventListener("click", pick, true);
    };
  }, [viewport]);

  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar || !selection) return;
    const rect = toolbar.getBoundingClientRect();
    toolbar.style.left = `${Math.max(8, Math.min(selection.position.x, window.innerWidth - rect.width - 8))}px`;
    toolbar.style.top = `${Math.max(8, Math.min(selection.position.y, window.innerHeight - rect.height - 8))}px`;
  }, [selection]);

  useEffect(() => {
    if (!viewport) return;
    const clear = () => setSelection(null);
    const update = (pointer: SelectionActionPoint | null) => {
      const nativeSelection = window.getSelection();
      const show = (
        citation: AssistantCitation,
        range: Range,
        sourceAnchor?: AssistantCitationSourceAnchor,
      ) => {
        const rects = range.getClientRects();
        const pointerOnText =
          pointer !== null &&
          Array.from(rects).some(
            (line) =>
              pointer.x >= line.left - 8 &&
              pointer.x <= line.right + 8 &&
              pointer.y >= line.top - 8 &&
              pointer.y <= line.bottom + 8,
          );
        setSelection({
          citation,
          range,
          ...(sourceAnchor ? { sourceAnchor } : {}),
          position: resolveSelectionActionPosition({
            bounds: viewport.getBoundingClientRect(),
            selectionRect: rects.item(rects.length - 1) ?? range.getBoundingClientRect(),
            pointer: pointerOnText ? pointer : null,
            viewport: { width: window.innerWidth, height: window.innerHeight },
          }),
        });
      };
      const edges = captureTranscriptSelectionEdges(viewport, nativeSelection, {
        part: "selected",
      });
      if (edges) {
        const citation = transcriptCitationFor(edges);
        if (citation && isRangeVisible(edges.range, viewport)) show(citation, edges.range);
        else clear();
        return;
      }
      const captured = captureAssistantTextSelection(viewport, nativeSelection);
      const messageId = captured?.source.dataset.assistantCitationSource;
      if (!captured || !messageId || !isRangeVisible(captured.range, viewport)) {
        clear();
        return;
      }
      show(
        { version: 1, ...threadRef, messageId: MessageId.make(messageId), ...captured.selector },
        captured.range,
        { source: captured.source, range: captured.range, viewport },
      );
    };
    const actions = observeSelectionActions({
      element: viewport,
      getActionElement: () => toolbarRef.current,
      restoreAfterScroll: true,
      onSelection: update,
      onDismiss: clear,
    });
    actionsRef.current = actions;
    const focusActions = (event: KeyboardEvent) => {
      const toolbar = toolbarRef.current;
      if (
        event.key !== "Tab" ||
        event.shiftKey ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.isComposing ||
        event.defaultPrevented ||
        !toolbar ||
        toolbar.contains(event.target as Node)
      ) {
        return;
      }
      if (toolbar.disabled) return;
      event.preventDefault();
      event.stopPropagation();
      toolbar.focus({ preventScroll: true });
    };
    document.addEventListener("keydown", focusActions, true);
    document.addEventListener("selectionchange", actions.selectionChanged);
    return () => {
      document.removeEventListener("keydown", focusActions, true);
      document.removeEventListener("selectionchange", actions.selectionChanged);
      actions.dispose();
      actionsRef.current = null;
    };
  }, [threadRef, viewport]);

  const pill =
    rowSelection && rowCitation ? (
      <RowSelectionPill
        pillRef={pillRef}
        citation={rowCitation}
        onCite={() => {
          if (onCite(rowCitation)) setRowSelection(null);
        }}
        onDismiss={() => setRowSelection(null)}
      />
    ) : null;
  const highlightedItemIds = rowSelection
    ? wholeItemIds(rowCitation, rowQuote ? rowSelection.anchor.itemId : undefined)
    : wholeItemIds(selection?.citation ?? null).filter(
        (id) => selection?.citation.segments?.find((segment) => segment.id === id)?.kind === "tool",
      );
  const highlightStyle = <TranscriptSelectionStyle itemIds={highlightedItemIds} />;
  if (!selection) {
    return (
      <>
        {highlightStyle}
        {pill}
      </>
    );
  }
  const tooLong = selection.citation.text.length > ASSISTANT_CITATION_MAX_TEXT_LENGTH;
  const dismiss = () => {
    actionsRef.current?.cancel();
    setSelection(null);
  };
  const cite = () => {
    if (tooLong) return false;
    // A transcript excerpt rendered its Markdown when captured.
    const citation = selection.sourceAnchor
      ? withSelectedMarkdown(selection.citation, selection.range)
      : selection.citation;
    if (!onCite(citation, selection.sourceAnchor)) return false;
    window.getSelection()?.removeAllRanges();
    dismiss();
    return true;
  };
  return (
    <>
      {highlightStyle}
      {pill}
      {createPortal(
        <Button
          ref={toolbarRef}
          type="button"
          size="xs"
          variant="glass"
          disabled={tooLong}
          aria-label={tooLong ? "Selection is too long to cite" : "Cite selection in composer"}
          className="fixed z-50 max-w-[calc(100vw-1rem)]"
          style={{ left: selection.position.x, top: selection.position.y }}
          onPointerDown={(event) => event.preventDefault()}
          onClick={cite}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              dismiss();
            }
          }}
        >
          <QuoteIcon aria-hidden="true" className="size-3.5" />
          {tooLong ? "Shorten selection" : "Cite"}
        </Button>,
        document.body,
      )}
    </>
  );
}

/** Row selection outlives scrolling, so its action stays put at the foot of the timeline. */
function RowSelectionPill({
  pillRef,
  citation,
  onCite,
  onDismiss,
}: {
  pillRef: React.RefObject<HTMLDivElement | null>;
  citation: AssistantCitation;
  onCite: () => void;
  onDismiss: () => void;
}) {
  const tooLong = citation.text.length > ASSISTANT_CITATION_MAX_TEXT_LENGTH;
  const label = assistantCitationLabel(citation);
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center px-4">
      <div ref={pillRef} className="pointer-events-auto flex min-w-0 items-center gap-1">
        <Button
          type="button"
          size="xs"
          variant="glass"
          disabled={tooLong}
          aria-label={tooLong ? "Selection is too long to cite" : `Cite ${label} in composer`}
          className="min-w-0"
          onClick={onCite}
        >
          <QuoteIcon aria-hidden="true" className="size-3.5" />
          <span className="truncate">{tooLong ? "Shorten selection" : `Cite ${label}`}</span>
        </Button>
        <Button
          type="button"
          size="icon-xs"
          variant="glass"
          aria-label="Clear selection"
          onClick={onDismiss}
        >
          <XIcon aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
