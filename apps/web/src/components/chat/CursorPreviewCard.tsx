import {
  type PointerEvent,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { PreviewCard, PreviewCardPopup, PreviewCardTrigger } from "../ui/preview-card";

interface PointerSample {
  readonly target: Element;
  readonly x: number;
  readonly y: number;
}

interface CursorAnchor {
  readonly contextElement: Element;
  getBoundingClientRect: () => DOMRect;
}

// Clear of the cursor on both axes so the card opens diagonally, leaving the line under the
// cursor and the text left of it readable, but close enough to move into.
const CURSOR_OFFSET_PX = 14;

/**
 * Pins a preview card diagonally off the point where the cursor rested on its trigger. Spread
 * `triggerProps` on the trigger, call `pin` when the card opens, and spread `popupProps` on the
 * popup. The point is kept relative to the trigger, so the card follows it when the list scrolls.
 */
export function useCursorAnchor() {
  const pointerRef = useRef<PointerSample | null>(null);
  const [anchor, setAnchor] = useState<CursorAnchor | undefined>(undefined);
  const pin = useCallback(() => {
    const pointer = pointerRef.current;
    if (pointer === null) {
      setAnchor(undefined);
      return;
    }
    const start = pointer.target.getBoundingClientRect();
    const dx = pointer.x - start.left;
    const dy = pointer.y - start.top;
    setAnchor({
      contextElement: pointer.target,
      getBoundingClientRect: () => {
        const rect = pointer.target.getBoundingClientRect();
        return DOMRect.fromRect({ x: rect.left + dx, y: rect.top + dy, width: 0, height: 0 });
      },
    });
  }, []);
  const onPointerMove = useCallback((event: PointerEvent<Element>) => {
    pointerRef.current = { target: event.currentTarget, x: event.clientX, y: event.clientY };
  }, []);
  return {
    pin,
    triggerProps: { onPointerMove },
    popupProps: {
      anchor,
      side: "bottom",
      align: "start",
      sideOffset: CURSOR_OFFSET_PX,
      alignOffset: CURSOR_OFFSET_PX,
    } as const,
  };
}

/**
 * Hover card for a picker row. It opens where the cursor rested and stays put. It closes when the
 * pointer leaves the row and card, on any key, or when the list scrolls, but not while scrolling
 * the card itself. `children` mount only while the card is open, so a body that fetches its
 * detail does not fetch for every row a user scans past.
 */
export function CursorPreviewCard(props: {
  trigger: ReactElement;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const cursorAnchor = useCursorAnchor();
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const insideCard = (event: Event) =>
      event.target instanceof Node && popupRef.current?.contains(event.target) === true;
    const close = (event: Event) => {
      if (!insideCard(event)) setOpen(false);
    };
    const options = { capture: true, passive: true } as const;
    window.addEventListener("keydown", close, true);
    window.addEventListener("wheel", close, options);
    window.addEventListener("scroll", close, options);
    return () => {
      window.removeEventListener("keydown", close, true);
      window.removeEventListener("wheel", close, options);
      window.removeEventListener("scroll", close, options);
    };
  }, [open]);

  return (
    <PreviewCard
      open={open}
      onOpenChange={(next) => {
        if (next) cursorAnchor.pin();
        setOpen(next);
      }}
    >
      <PreviewCardTrigger
        render={props.trigger}
        delay={400}
        closeDelay={150}
        {...cursorAnchor.triggerProps}
      />
      <PreviewCardPopup
        ref={popupRef}
        {...cursorAnchor.popupProps}
        className={props.className ?? "w-96 max-w-[calc(100vw-2rem)]"}
      >
        <div className="p-3 text-xs">{props.children}</div>
      </PreviewCardPopup>
    </PreviewCard>
  );
}
