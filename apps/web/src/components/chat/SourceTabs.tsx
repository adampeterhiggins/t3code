import { cn } from "~/lib/utils";
import { Button } from "../ui/button";

/** The query can switch tabs, so the active one scrolls into the row's view when it becomes active. */
function revealActiveTab(tab: HTMLElement | null) {
  const list = tab?.parentElement;
  if (!tab || !list) return;
  const bounds = list.getBoundingClientRect();
  const rect = tab.getBoundingClientRect();
  if (rect.left < bounds.left) list.scrollLeft -= bounds.left - rect.left;
  else if (rect.right > bounds.right) list.scrollLeft += rect.right - bounds.right;
}

/**
 * Tabs over a picker list that offers more than one kind of item, such as the `#` menu's pull
 * requests and issues. Clicking one keeps focus where it was, so typing continues the query and
 * arrows still drive the list. Too many tabs for the width scroll sideways.
 */
export function SourceTabs<Id extends string>(props: {
  options: ReadonlyArray<{ id: Id; label: string }>;
  activeId: Id;
  onSelect: (id: Id) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn(props.className, "overflow-x-auto [scrollbar-width:none] *:shrink-0")}
      // A mouse wheel only scrolls vertically, which this row cannot.
      onWheel={(event) => {
        if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
          event.currentTarget.scrollLeft += event.deltaY;
        }
      }}
    >
      {props.options.map((tab) => (
        <Button
          key={tab.id}
          ref={tab.id === props.activeId ? revealActiveTab : undefined}
          type="button"
          role="tab"
          size="xs"
          aria-selected={tab.id === props.activeId}
          variant={tab.id === props.activeId ? "secondary" : "ghost-muted"}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => props.onSelect(tab.id)}
        >
          {tab.label}
        </Button>
      ))}
    </div>
  );
}
