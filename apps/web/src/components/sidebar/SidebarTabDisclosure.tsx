import { ChevronDownIcon, LayersIcon } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";

import { cn } from "~/lib/utils";

import { sidebarTabToggleLabel } from "../Sidebar.logic";
import { animateSidebarDisclosure } from "../Sidebar.motion";

import { PreviewCard, PreviewCardPopup, PreviewCardTrigger } from "../ui/preview-card";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/**
 * The group's tab count. With `onToggle`, it opens and folds that group's tabs. While folded,
 * hovering it shows `preview`, a list to switch tabs from without opening the group.
 */
function SidebarTabCountBadge(props: {
  count: number;
  toggleCount: number;
  open: boolean;
  onToggle?: ((event: ReactMouseEvent) => void) | undefined;
  preview?: ReactNode;
  onPreviewOpenChange?: ((open: boolean) => void) | undefined;
}) {
  const { onPreviewOpenChange } = props;
  const [previewOpen, setPreviewOpenState] = useState(false);
  const setPreviewOpen = (open: boolean) => {
    setPreviewOpenState(open);
    onPreviewOpenChange?.(open);
  };
  const className =
    "inline-flex shrink-0 items-center gap-0.5 text-xs tabular-nums text-muted-foreground/70";
  if (!props.onToggle) {
    return props.open ? null : (
      <span className={className}>
        <LayersIcon aria-hidden className="size-3" />
        {props.count}
        <span className="sr-only"> tabs</span>
      </span>
    );
  }
  const label = sidebarTabToggleLabel(props.open, props.toggleCount);
  const button = (
    <button
      type="button"
      aria-label={label}
      aria-expanded={props.open}
      data-testid="sidebar-tab-group-toggle"
      onClick={(event) => {
        setPreviewOpen(false);
        props.onToggle?.(event);
      }}
      onDoubleClick={(event) => event.stopPropagation()}
      className={cn(
        className,
        "-mx-1 cursor-pointer rounded-sm px-1 outline-none transition-colors hover:bg-sidebar-row-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
      )}
    />
  );
  const body = (
    <>
      <LayersIcon aria-hidden className="size-3" />
      {props.count}
      {/* The chevron marks the badge as a control: always while open, on hover while folded. */}
      <ChevronDownIcon
        aria-hidden
        className={cn(
          "size-3 transition-[rotate,opacity] motion-reduce:transition-none",
          props.open
            ? "rotate-180"
            : "opacity-0 group-hover/sidebar-row:opacity-100 group-has-[:focus-visible]/sidebar-row:opacity-100",
        )}
      />
    </>
  );
  if (!props.open && props.preview != null) {
    // The card renders in a portal but its events still bubble through the row in React, which
    // would open the row's thread, start a row drag, or open its context menu.
    const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();
    return (
      <PreviewCard open={previewOpen} onOpenChange={setPreviewOpen}>
        <PreviewCardTrigger delay={300} closeDelay={150} render={button}>
          {body}
        </PreviewCardTrigger>
        <PreviewCardPopup
          side="right"
          align="start"
          sideOffset={8}
          className="w-80 max-w-[calc(100vw-2rem)]"
        >
          <div
            className="p-1"
            onClick={(event) => {
              stop(event);
              // Every control in the list opens a tab, so a click there is done with the card.
              if (event.target instanceof Element && event.target.closest("button")) {
                setPreviewOpen(false);
              }
            }}
            onDoubleClick={stop}
            onPointerDown={stop}
            onKeyDown={stop}
            onContextMenu={stop}
          >
            {props.preview}
          </div>
        </PreviewCardPopup>
      </PreviewCard>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger render={button}>{body}</TooltipTrigger>
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
}
/**
 * Mounts `children` while open and animates its height on the way in and out.
 * The first render never animates, so a page load or remount lands in place.
 */
export function SidebarDisclosure(props: {
  open: boolean;
  children: ReactNode;
  onSettled?: (() => void) | undefined;
}) {
  const { open, onSettled } = props;
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  const ref = useRef<HTMLDivElement>(null);
  const animationRef = useRef<Animation | null>(null);
  const settledOpenRef = useRef(open);
  useLayoutEffect(() => {
    const node = ref.current;
    if (settledOpenRef.current === open || node === null) return;
    settledOpenRef.current = open;
    const animation = animateSidebarDisclosure(node, open, animationRef.current);
    animationRef.current = animation;
    const settle = () => {
      if (animationRef.current !== animation) return;
      animationRef.current = null;
      if (!open) setMounted(false);
      onSettled?.();
    };
    if (animation === null) settle();
    // A finished animation stops holding the collapsed height, so the unmount
    // must commit before the next paint or the full list flashes back for a
    // frame. Committing first also lets onSettled measure the settled layout.
    else
      animation.addEventListener("finish", () => flushSync(settle), {
        once: true,
      });
  }, [open, onSettled]);
  useEffect(() => () => animationRef.current?.cancel(), []);
  if (!mounted) return null;
  return (
    <div ref={ref} className="overflow-hidden">
      {props.children}
    </div>
  );
}

export function useSidebarRowTabs(
  props: {
    onToggleTabs?: ((rowThreadKey: string) => void) | undefined;
    tabsOpen: boolean;
    tabCount: number;
    tabToggleCount: number;
    tabPreview?: ReactNode;
    tabs: ReactNode;
    onTabsResized?: (() => void) | undefined;
  },
  rowThreadKey: string,
) {
  const onToggleTabs = props.onToggleTabs;
  const handleToggleTabsClick = (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    onToggleTabs?.(rowThreadKey);
  };
  // The row's own tooltip would cover the badge's tab list, so it stays shut while that is open.
  const [tabPreviewOpenRaw, setTabPreviewOpen] = useState(false);
  const tabPreviewOpen = tabPreviewOpenRaw && !props.tabsOpen && props.tabCount > 1;
  const tabCountBadge =
    props.tabCount > 1 ? (
      <SidebarTabCountBadge
        count={props.tabCount}
        toggleCount={props.tabToggleCount}
        open={props.tabsOpen}
        onToggle={onToggleTabs ? handleToggleTabsClick : undefined}
        preview={props.tabPreview}
        onPreviewOpenChange={setTabPreviewOpen}
      />
    ) : null;
  const tabList =
    props.tabs != null ? (
      <SidebarDisclosure open={props.tabsOpen} onSettled={props.onTabsResized}>
        {props.tabs}
      </SidebarDisclosure>
    ) : null;

  return { tabPreviewOpen, tabCountBadge, tabList };
}
