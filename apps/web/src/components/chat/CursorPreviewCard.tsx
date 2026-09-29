import { type ReactElement, type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { PreviewCard, PreviewCardPopup, PreviewCardTrigger } from "../ui/preview-card";

interface Point {
  readonly x: number;
  readonly y: number;
}

// Clear of the cursor so the card never sits under it, but close enough to move into.
const CURSOR_OFFSET_PX = 14;

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
  const [anchorPoint, setAnchorPoint] = useState<Point | null>(null);
  const pointerRef = useRef<Point>({ x: 0, y: 0 });
  const popupRef = useRef<HTMLDivElement>(null);
  const anchor = useMemo(
    () =>
      anchorPoint === null
        ? undefined
        : {
            getBoundingClientRect: () =>
              DOMRect.fromRect({ x: anchorPoint.x, y: anchorPoint.y, width: 0, height: 0 }),
          },
    [anchorPoint],
  );

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
        if (next) setAnchorPoint(pointerRef.current);
        setOpen(next);
      }}
    >
      <PreviewCardTrigger
        render={props.trigger}
        delay={400}
        closeDelay={150}
        onPointerMove={(event) => {
          pointerRef.current = { x: event.clientX, y: event.clientY };
        }}
      />
      <PreviewCardPopup
        ref={popupRef}
        anchor={anchor}
        side="bottom"
        align="start"
        sideOffset={CURSOR_OFFSET_PX}
        className={props.className ?? "w-96 max-w-[calc(100vw-2rem)]"}
      >
        <div className="p-3 text-xs">{props.children}</div>
      </PreviewCardPopup>
    </PreviewCard>
  );
}
