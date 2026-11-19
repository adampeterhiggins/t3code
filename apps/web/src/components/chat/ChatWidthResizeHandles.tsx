import { useGT } from "gt-react";
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
  const gt = useGT();
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    side: "start" | "end";
    startX: number;
    startWidth: number;
    availableWidth: number;
    width: number | null;
  } | null>(null);
  const [resizing, setResizing] = useState(false);

  const startDrag = (side: "start" | "end", event: PointerEvent<HTMLDivElement>) => {
    const overlay = overlayRef.current;
    const lane = event.currentTarget.parentElement;
    if (event.button !== 0 || !overlay || !lane) return;
    event.preventDefault();
    // Measured once: the details card moving inline mid-drag changes the space, and
    // re-measuring would feed the width back into itself.
    const styles = getComputedStyle(overlay);
    const availableWidth =
      overlay.clientWidth -
      Number.parseFloat(styles.paddingLeft) -
      Number.parseFloat(styles.paddingRight);
    dragRef.current = {
      side,
      startX: event.clientX,
      startWidth: lane.getBoundingClientRect().width,
      availableWidth,
      width: null,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setResizing(true);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    drag.width = resolveDraggedChatWidth({ ...drag, deltaX: event.clientX - drag.startX });
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
    "aria-label": gt("Resize chat width"),
    title: gt("Drag to resize, double-click to reset"),
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
        <div
          {...handleProps}
          className={cn(handleClassName, "-start-3")}
          onPointerDown={(event) => startDrag("start", event)}
        >
          <div className={lineClassName} />
        </div>
        <div
          {...handleProps}
          className={cn(handleClassName, "-end-3")}
          onPointerDown={(event) => startDrag("end", event)}
        >
          <div className={lineClassName} />
        </div>
      </div>
      {resizing ? <div className="pointer-events-auto fixed inset-0 cursor-col-resize" /> : null}
    </div>
  );
}
