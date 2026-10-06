import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import {
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type RefObject,
} from "react";

import { useResizeDrag } from "../../hooks/useResizeDrag";
import { useSplitViewStore } from "../../splitViewStore";
import { cn } from "~/lib/utils";
import ChatView from "../ChatView";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SplitPaneContext, useSplitViewActions } from "./splitPane";

/** A pane's swap handle being dragged, and the pane under the pointer. */
interface PaneDrag {
  fromKey: string;
  overKey: string | null;
}

/** Neither pane can be dragged narrower than this, unless the split is too narrow for both. */
const MIN_PANE_WIDTH = 320;

function paneKeyAt(x: number, y: number): string | null {
  return (
    document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-split-pane-key]")?.dataset
      .splitPaneKey ?? null
  );
}

function SplitPane({
  threadRef,
  focused,
  side,
  drag,
  handleProps,
  onFocus,
}: {
  threadRef: ScopedThreadRef;
  focused: boolean;
  side: "start" | "end";
  drag: PaneDrag | null;
  handleProps: HTMLAttributes<HTMLButtonElement>;
  onFocus: () => void;
}) {
  const context = useMemo(() => ({ focused }), [focused]);
  const paneKey = scopedThreadKey(threadRef);
  const dropTarget = drag !== null && drag.fromKey !== paneKey && drag.overKey === paneKey;
  return (
    <SplitPaneContext.Provider value={context}>
      <div
        data-split-pane={side}
        data-split-pane-key={paneKey}
        data-split-pane-focused={focused ? "true" : "false"}
        className={cn(
          // Layout containment keeps each pane's fixed title-bar controls inside the pane and
          // stops one pane's reflow from invalidating the other.
          "relative flex min-h-0 min-w-0 flex-1 basis-0 [contain:layout]",
          side === "start"
            ? // Native window controls sit over the end pane only.
              "[--workspace-controls-right:0.75rem] [--workspace-native-controls-inset:0px]"
            : // The collapsed-sidebar toggle and traffic lights sit over the start pane only.
              "[--workspace-titlebar-content-left:var(--workspace-gutter)]",
        )}
        // The start pane takes `--split-start-ratio` of the width and the end pane the rest.
        style={
          side === "start"
            ? { order: 0, flexGrow: "var(--split-start-ratio)" }
            : { order: 2, flexGrow: "calc(1 - var(--split-start-ratio))" }
        }
        onPointerDownCapture={focused ? undefined : onFocus}
      >
        {focused ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 z-50 h-0.5 bg-primary"
          />
        ) : null}
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label="Swap panes"
                className={cn(
                  "group/split-handle absolute top-0 left-1/2 z-50 flex h-3 w-14 -translate-x-1/2 touch-none items-center justify-center rounded-b-md [-webkit-app-region:no-drag] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
                  drag?.fromKey === paneKey ? "cursor-grabbing" : "cursor-grab",
                )}
                {...handleProps}
              />
            }
          >
            <span
              className={cn(
                "h-1 w-8 rounded-full transition-colors",
                drag?.fromKey === paneKey
                  ? "bg-primary"
                  : "bg-muted-foreground/25 group-hover/split-handle:bg-muted-foreground/60",
              )}
            />
          </TooltipTrigger>
          <TooltipPopup side="bottom">Drag to swap panes</TooltipPopup>
        </Tooltip>
        {drag !== null ? (
          // Covers the chat while a handle is dragged, so the timeline ignores the pointer and
          // the pane under it can be found by hit-testing.
          <div
            aria-hidden
            className={cn(
              "absolute inset-0 z-40 cursor-grabbing",
              dropTarget && "bg-primary/5 ring-2 ring-primary ring-inset",
            )}
          />
        ) : null}
        <ChatView
          environmentId={threadRef.environmentId}
          threadId={threadRef.threadId}
          routeKind="server"
          reserveTitleBarControlInset={side === "end"}
        />
      </div>
    </SplitPaneContext.Provider>
  );
}

/**
 * The line between the panes. Dragging it writes the width straight to the split's CSS variable
 * each frame and stores the ratio on release; double-clicking evens the panes out.
 */
function SplitDivider({ containerRef }: { containerRef: RefObject<HTMLDivElement | null> }) {
  const handlers = useResizeDrag<HTMLDivElement>(() => {
    const container = containerRef.current;
    const startPane = container?.querySelector<HTMLElement>(':scope > [data-split-pane="start"]');
    if (!container || !startPane) return null;
    // The divider itself is 1px wide.
    const available = container.clientWidth - 1;
    if (available <= 0) return null;
    const minWidth = Math.min(MIN_PANE_WIDTH, available / 2);
    return {
      width: startPane.getBoundingClientRect().width,
      edge: "right",
      resize: (width) => {
        const clamped = Math.min(Math.max(width, minWidth), available - minWidth);
        container.style.setProperty("--split-start-ratio", String(clamped / available));
        return clamped;
      },
      finish: (width) => useSplitViewStore.getState().resize(width / available),
    };
  });
  return (
    <div className="relative z-50 w-px shrink-0 bg-border" style={{ order: 1 }}>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize split panes"
        className="group absolute inset-y-0 -inset-x-1 cursor-col-resize touch-none select-none [-webkit-app-region:no-drag]"
        onDoubleClick={() => useSplitViewStore.getState().resize(0.5)}
        {...handlers}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors duration-150 group-hover:bg-primary/60 group-active:bg-primary"
        />
      </div>
    </div>
  );
}

/**
 * Two chat views side by side, in the order the split stores them. Panes are keyed by thread and
 * placed with CSS `order` over a fixed DOM order, so moving focus or swapping sides never moves
 * or remounts either timeline. Dragging a pane's top handle onto the other pane swaps them, and
 * dragging the divider between them resizes them.
 */
export function SplitChatPanes({
  routeRef,
  partnerRef,
}: {
  routeRef: ScopedThreadRef;
  partnerRef: ScopedThreadRef;
}) {
  const { focusPane } = useSplitViewActions();
  const routeKey = scopedThreadKey(routeRef);
  const routeFirst = useSplitViewStore((state) => state.panes?.[0] === routeKey);
  const startRatio = useSplitViewStore((state) => state.startRatio);
  const containerRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<PaneDrag | null>(null);
  const panes = [routeRef, partnerRef].toSorted((a, b) =>
    scopedThreadKey(a).localeCompare(scopedThreadKey(b)),
  );

  const handleProps = (paneKey: string): HTMLAttributes<HTMLButtonElement> => ({
    onPointerDown: (event) => {
      if (event.button !== 0) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      setDrag({ fromKey: paneKey, overKey: paneKey });
    },
    onPointerMove: (event) => {
      if (drag?.fromKey !== paneKey) return;
      const overKey = paneKeyAt(event.clientX, event.clientY);
      if (overKey !== drag.overKey) setDrag({ fromKey: paneKey, overKey });
    },
    onPointerUp: (event) => {
      const overKey = paneKeyAt(event.clientX, event.clientY);
      setDrag(null);
      if (drag?.fromKey === paneKey && overKey !== null && overKey !== paneKey) {
        useSplitViewStore.getState().swap();
      }
    },
    onLostPointerCapture: () => setDrag(null),
    // Pointer clicks only swap by dragging; keyboard activation swaps directly.
    onClick: (event) => {
      if (event.detail === 0) useSplitViewStore.getState().swap();
    },
  });

  return (
    <div
      ref={containerRef}
      className="flex min-h-0 min-w-0 flex-1"
      style={{ "--split-start-ratio": startRatio } as CSSProperties}
    >
      {panes.map((ref) => {
        const key = scopedThreadKey(ref);
        const focused = key === routeKey;
        const index = focused === routeFirst ? 0 : 1;
        return (
          <SplitPane
            key={key}
            threadRef={ref}
            focused={focused}
            side={index === 0 ? "start" : "end"}
            drag={drag}
            handleProps={handleProps(key)}
            onFocus={() => focusPane(ref)}
          />
        );
      })}
      <SplitDivider containerRef={containerRef} />
    </div>
  );
}
