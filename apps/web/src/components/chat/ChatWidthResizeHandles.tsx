import { useRef, useState, type PointerEvent } from "react";
import { updateClientSettings } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import { forwardWheelToTimeline } from "./timelineMinimapWheel";
import { applyChatCustomWidth, resolveDraggedChatWidth } from "./ChatWidthResizeHandles.logic";

/** Drag either edge of the chat lane to resize it around its centre; double-click resets. */
export function ChatWidthResizeHandles({
  timelineElement,
}: {
  timelineElement: HTMLElement | null;
}) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  // The width dragged so far; null until the pointer moves.
  const dragRef = useRef<{ width: number | null } | null>(null);
  const [resizing, setResizing] = useState(false);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    dragRef.current = { width: null };
    event.currentTarget.setPointerCapture(event.pointerId);
    setResizing(true);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const lane = overlayRef.current;
    if (!drag || !lane) return;
    // Measured per move: a wider chat can move the details card inline, which insets the lane.
    const styles = getComputedStyle(lane);
    const bounds = lane.getBoundingClientRect();
    const left = bounds.left + Number.parseFloat(styles.paddingLeft);
    const availableWidth = bounds.right - Number.parseFloat(styles.paddingRight) - left;
    drag.width = resolveDraggedChatWidth({
      pointerX: event.clientX,
      centerX: left + availableWidth / 2,
      availableWidth,
    });
    // Write the variable directly while dragging; the setting is persisted once on release.
    applyChatCustomWidth(document.documentElement, drag.width);
  };

  const endDrag = () => {
    const width = dragRef.current?.width ?? null;
    dragRef.current = null;
    setResizing(false);
    if (width !== null) void updateClientSettings({ chatCustomWidth: width });
  };

  const handleClassName =
    "group/chat-resize pointer-events-auto absolute inset-y-0 flex w-3 cursor-col-resize touch-none justify-center";
  const lineClassName = cn(
    "h-full w-0.5 rounded-full transition-colors",
    resizing ? "bg-primary" : "bg-transparent group-hover/chat-resize:bg-primary/60",
  );
  const handleProps = {
    role: "separator",
    "aria-orientation": "vertical",
    "aria-label": "Resize chat width",
    title: "Drag to resize, double-click to reset",
    onPointerDown,
    onPointerMove,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
    onDoubleClick: () => void updateClientSettings({ chatCustomWidth: null }),
  } as const;

  return (
    <div
      className="chat-composer-lane pointer-events-none absolute inset-0 z-10 max-sm:hidden"
      ref={(node) => {
        overlayRef.current = node;
        if (!node || !timelineElement) return;
        // The handles sit in the timeline's gutter, which otherwise scrolls it.
        const onWheel = (event: WheelEvent) => forwardWheelToTimeline(event, timelineElement);
        node.addEventListener("wheel", onWheel, { passive: false });
        return () => node.removeEventListener("wheel", onWheel);
      }}
    >
      <div className="relative mx-auto h-full max-w-(--chat-content-max-width)">
        <div {...handleProps} className={cn(handleClassName, "-start-3")}>
          <div className={lineClassName} />
        </div>
        <div {...handleProps} className={cn(handleClassName, "-end-3")}>
          <div className={lineClassName} />
        </div>
      </div>
      {resizing ? <div className="pointer-events-auto fixed inset-0 cursor-col-resize" /> : null}
    </div>
  );
}
