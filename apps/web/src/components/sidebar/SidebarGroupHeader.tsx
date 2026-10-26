import type { ThreadGroup } from "@t3tools/contracts/settings";
import { PencilIcon, ChevronDownIcon } from "lucide-react";
import { cn } from "../../lib/utils";
import { projectIconColorClassName } from "../../projectIconColors";
import { ThreadGroupIcon } from "./ThreadGroupIcon";

// Titles a user-made group in its accent. Click the title to collapse it; click the pencil, or
// right-click, to rename or restyle.
export function SidebarGroupHeader(props: {
  name: string;
  style: ThreadGroup | undefined;
  count: number;
  collapsed: boolean;
  onEdit: (name: string) => void;
  onToggle: () => void;
}) {
  const accent = props.style?.accent;
  return (
    <div
      className="group/group-header flex h-8 items-center gap-2 px-2 text-xs font-medium text-sidebar-muted-foreground"
      onContextMenu={(event) => {
        event.preventDefault();
        props.onEdit(props.name);
      }}
    >
      <button
        type="button"
        aria-expanded={!props.collapsed}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        onClick={props.onToggle}
      >
        <ThreadGroupIcon style={props.style} />
        <span
          className={cn("min-w-0 flex-1 truncate", accent && projectIconColorClassName(accent))}
        >
          {props.name}
        </span>
        {props.count === 0 ? (
          <span className="shrink-0 font-normal text-muted-foreground/70">Empty</span>
        ) : props.collapsed ? (
          <span className="shrink-0 font-normal text-muted-foreground/70">{props.count}</span>
        ) : null}
      </button>
      <button
        type="button"
        aria-label={`Edit group ${props.name}`}
        className="invisible shrink-0 cursor-pointer rounded-sm p-0.5 text-muted-foreground outline-none group-hover/group-header:visible hover:text-foreground focus-visible:visible focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        onClick={() => props.onEdit(props.name)}
      >
        <PencilIcon aria-hidden className="size-3" />
      </button>
      <button
        type="button"
        tabIndex={-1}
        aria-hidden
        className="shrink-0 cursor-pointer"
        onClick={props.onToggle}
      >
        <ChevronDownIcon
          className={cn("size-3 transition-transform", !props.collapsed && "rotate-180")}
        />
      </button>
    </div>
  );
}
