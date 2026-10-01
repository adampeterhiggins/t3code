/**
 * The sidebar header's tabs button. A click shows or hides tabs, as it always has; a right-click
 * (or the context-menu key) opens a menu for how many of a chat's tabs list under its row and
 * their order. Hide and the shown choices map onto Show tabs, so its keybinding still flips
 * between Hide and whatever was shown last.
 */
import type { SidebarTabSortDirection, SidebarTabSortOrder } from "@t3tools/contracts/settings";
import { CheckIcon, LayersIcon } from "lucide-react";
import { useRef, useState } from "react";

import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuSeparator,
  MenuShortcut,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
} from "../ui/menu";
import { SidebarHeaderIconButton } from "./SidebarThreadHeader";

const TAB_LIMIT_CHOICES = [2, 3, 4, 5, 6, 8, 10];
/** What "Show up to" starts at when Settings switches to it from Hide or Show all. */
export const DEFAULT_SIDEBAR_TAB_LIMIT = 4;
export const SIDEBAR_TAB_SORT_ORDERS = [
  "latest_response",
  "created_at",
  "last_opened",
  "manual",
] as const;

export const SIDEBAR_TAB_SORT_ORDER_LABELS: Record<SidebarTabSortOrder, string> = {
  latest_response: "Latest response",
  created_at: "Created",
  last_opened: "Last opened",
  manual: "Manual",
};

/** Created reads as age; the other timed orders read as recency. */
export function sidebarTabSortDirectionLabel(
  order: SidebarTabSortOrder,
  direction: SidebarTabSortDirection,
): string {
  if (order === "created_at") return direction === "desc" ? "Newest first" : "Oldest first";
  return direction === "desc" ? "Most recent first" : "Least recent first";
}

export function SidebarTabsMenu(props: {
  shown: boolean;
  /** Null lists every tab. */
  limit: number | null;
  sortOrder: SidebarTabSortOrder;
  sortDirection: SidebarTabSortDirection;
  shortcutLabel: string | null;
  onToggle: () => void;
  onShownChange: (shown: boolean, limit: number | null) => void;
  onSortOrderChange: (order: SidebarTabSortOrder) => void;
  onSortDirectionChange: (direction: SidebarTabSortDirection) => void;
}) {
  const shownValue = !props.shown ? "hide" : props.limit === null ? "all" : "limit";
  const limitChoices =
    props.limit === null || TAB_LIMIT_CHOICES.includes(props.limit)
      ? TAB_LIMIT_CHOICES
      : [...TAB_LIMIT_CHOICES, props.limit].toSorted((left, right) => left - right);
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const toggleLabel = props.shown ? "Hide tabs" : "Show tabs";
  return (
    <Menu open={open} onOpenChange={setOpen}>
      <SidebarHeaderIconButton
        ref={buttonRef}
        label={toggleLabel}
        tooltip={`${toggleLabel}${props.shortcutLabel ? ` (${props.shortcutLabel})` : ""}. Right-click for options`}
        aria-pressed={props.shown}
        aria-haspopup="menu"
        aria-expanded={open}
        isActive={props.shown}
        onClick={props.onToggle}
        onContextMenu={(event) => {
          event.preventDefault();
          setOpen(true);
        }}
      >
        <LayersIcon />
      </SidebarHeaderIconButton>
      <MenuPopup anchor={buttonRef} align="end" className="min-w-56">
        <MenuGroup>
          <MenuGroupLabel>Tabs in sidebar</MenuGroupLabel>
          <MenuRadioGroup
            value={shownValue}
            onValueChange={(value) => {
              if (value === "hide") props.onShownChange(false, props.limit);
              if (value === "all") props.onShownChange(true, null);
            }}
          >
            <MenuRadioItem value="hide">
              <span className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 flex-1 truncate">Hide tabs</span>
                {props.shortcutLabel ? <MenuShortcut>{props.shortcutLabel}</MenuShortcut> : null}
                <MenuRadioItemIndicator />
              </span>
            </MenuRadioItem>
          </MenuRadioGroup>
          <MenuSub>
            <MenuSubTrigger>
              <span className="min-w-0 flex-1 truncate">
                {shownValue === "limit" ? `Show up to ${props.limit}` : "Show up to…"}
              </span>
              {shownValue === "limit" ? <CheckIcon aria-hidden className="size-3.5" /> : null}
            </MenuSubTrigger>
            <MenuSubPopup className="min-w-24">
              <MenuRadioGroup
                value={shownValue === "limit" ? props.limit : null}
                onValueChange={(value) => {
                  if (typeof value === "number") props.onShownChange(true, value);
                }}
              >
                {limitChoices.map((limit) => (
                  <MenuRadioItem key={limit} value={limit}>
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="min-w-0 flex-1 tabular-nums">{limit}</span>
                      <MenuRadioItemIndicator />
                    </span>
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuSubPopup>
          </MenuSub>
          <MenuRadioGroup
            value={shownValue}
            onValueChange={(value) => {
              if (value === "all") props.onShownChange(true, null);
            }}
          >
            <MenuRadioItem value="all">
              <span className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 flex-1 truncate">Show all</span>
                <MenuRadioItemIndicator />
              </span>
            </MenuRadioItem>
          </MenuRadioGroup>
        </MenuGroup>
        <MenuSeparator />
        <MenuGroup>
          <MenuGroupLabel>Sort tabs by</MenuGroupLabel>
          <MenuRadioGroup
            value={props.sortOrder}
            onValueChange={(value) => {
              const order = SIDEBAR_TAB_SORT_ORDERS.find((candidate) => candidate === value);
              if (order) props.onSortOrderChange(order);
            }}
          >
            {SIDEBAR_TAB_SORT_ORDERS.map((order) => (
              <MenuRadioItem key={order} value={order}>
                <span className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 flex-1 truncate">
                    {SIDEBAR_TAB_SORT_ORDER_LABELS[order]}
                  </span>
                  {order === "manual" ? (
                    <span className="text-secondary-label text-xs">Drag to reorder</span>
                  ) : null}
                  <MenuRadioItemIndicator />
                </span>
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuGroup>
        {/* Manual has no direction: it is whatever order the tabs were dragged into. */}
        {props.sortOrder === "manual" ? null : (
          <>
            <MenuSeparator />
            <MenuRadioGroup
              value={props.sortDirection}
              onValueChange={(value) => {
                if (value === "desc" || value === "asc") props.onSortDirectionChange(value);
              }}
            >
              {(["desc", "asc"] as const).map((direction) => (
                <MenuRadioItem key={direction} value={direction}>
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 flex-1 truncate">
                      {sidebarTabSortDirectionLabel(props.sortOrder, direction)}
                    </span>
                    <MenuRadioItemIndicator />
                  </span>
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </>
        )}
      </MenuPopup>
    </Menu>
  );
}
