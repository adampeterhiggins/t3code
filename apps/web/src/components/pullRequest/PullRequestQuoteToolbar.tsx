import { ASSISTANT_CITATION_MAX_TEXT_LENGTH } from "@t3tools/contracts";
import { useGT } from "gt-react";
import { QuoteIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { captureAssistantTextSelection } from "~/lib/assistantTextSelection";
import {
  observeSelectionActions,
  resolveSelectionActionPosition,
  type SelectionActionPoint,
} from "~/lib/selectionActions";
import { serializeSelectedMarkdownQuote } from "~/markdown-clipboard";
import { Button } from "../ui/button";

const QUOTE_SOURCE_SELECTOR = "[data-pull-request-quote]";

export interface PullRequestQuote {
  readonly source: "description" | "comment";
  readonly author: string;
  readonly avatarUrl: string | null;
  readonly url: string | null;
  readonly text: string;
  readonly plainText: string;
}

/** Marks rendered pull request prose whose selected text can be cited into the composer. */
export function PullRequestQuoteSource({
  source,
  author,
  url,
  className,
  children,
}: {
  source: PullRequestQuote["source"];
  author: { readonly login: string; readonly avatarUrl?: string | null | undefined } | null;
  url: string | null;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div
      className={className}
      data-pull-request-quote={source}
      data-quote-author={author?.login ?? "ghost"}
      data-quote-avatar={author?.avatarUrl ?? undefined}
      data-quote-url={url ?? undefined}
    >
      {children}
    </div>
  );
}

/** Keeps the selection's formatting, such as inline code, when it fits. */
function selectedText(range: Range, plain: string): string {
  const markdown = serializeSelectedMarkdownQuote(range);
  return markdown.trim().length === 0 || markdown.length > ASSISTANT_CITATION_MAX_TEXT_LENGTH
    ? plain
    : markdown;
}

/**
 * The "Cite" button for text selected in a pull request's description or comments, the same
 * affordance an assistant response gives its own selections.
 */
export function PullRequestQuoteToolbar({
  viewport,
  onCite,
}: {
  viewport: HTMLElement | null;
  onCite: (quote: PullRequestQuote) => void;
}) {
  const gt = useGT();
  const [selection, setSelection] = useState<{
    source: HTMLElement;
    range: Range;
    text: string;
    position: SelectionActionPoint;
  } | null>(null);
  const toolbarRef = useRef<HTMLButtonElement>(null);
  const actionsRef = useRef<ReturnType<typeof observeSelectionActions> | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- positions the toolbar DOM node within the window
  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar || !selection) return;
    const rect = toolbar.getBoundingClientRect();
    toolbar.style.left = `${Math.max(8, Math.min(selection.position.x, window.innerWidth - rect.width - 8))}px`;
    toolbar.style.top = `${Math.max(8, Math.min(selection.position.y, window.innerHeight - rect.height - 8))}px`;
  }, [selection]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- document selection listeners on the viewport
  useEffect(() => {
    if (!viewport?.ownerDocument) return;
    const clear = () => setSelection(null);
    const update = (pointer: SelectionActionPoint | null) => {
      const captured = captureAssistantTextSelection(
        viewport,
        window.getSelection(),
        QUOTE_SOURCE_SELECTOR,
      );
      if (!captured) {
        clear();
        return;
      }
      const rect = captured.range.getBoundingClientRect();
      const viewportRect = viewport.getBoundingClientRect();
      if (rect.bottom < viewportRect.top || rect.top > viewportRect.bottom || rect.width === 0) {
        clear();
        return;
      }
      const rects = captured.range.getClientRects();
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
        source: captured.source,
        range: captured.range,
        text: captured.selector.text,
        position: resolveSelectionActionPosition({
          bounds: viewportRect,
          selectionRect: rects.item(rects.length - 1) ?? rect,
          pointer: pointerOnText ? pointer : null,
          viewport: { width: window.innerWidth, height: window.innerHeight },
        }),
      });
    };
    const actions = observeSelectionActions({
      element: viewport,
      getActionElement: () => toolbarRef.current,
      onSelection: update,
      onDismiss: clear,
    });
    actionsRef.current = actions;
    document.addEventListener("selectionchange", actions.selectionChanged);
    return () => {
      document.removeEventListener("selectionchange", actions.selectionChanged);
      actions.dispose();
      actionsRef.current = null;
    };
  }, [viewport]);

  if (!selection) return null;
  const tooLong = selection.text.length > ASSISTANT_CITATION_MAX_TEXT_LENGTH;
  const dismiss = () => {
    actionsRef.current?.cancel();
    setSelection(null);
  };
  const cite = () => {
    if (tooLong) return;
    const { dataset } = selection.source;
    onCite({
      source: dataset.pullRequestQuote === "description" ? "description" : "comment",
      author: dataset.quoteAuthor ?? "ghost",
      avatarUrl: dataset.quoteAvatar ?? null,
      url: dataset.quoteUrl ?? null,
      text: selectedText(selection.range, selection.text),
      plainText: selection.text,
    });
    window.getSelection()?.removeAllRanges();
    dismiss();
  };
  return createPortal(
    <Button
      ref={toolbarRef}
      type="button"
      size="xs"
      variant="glass"
      disabled={tooLong}
      aria-label={tooLong ? gt("Selection is too long to cite") : gt("Cite selection in composer")}
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
      {tooLong ? gt("Shorten selection") : gt("Cite", { $context: "quote selected text" })}
    </Button>,
    document.body,
  );
}
