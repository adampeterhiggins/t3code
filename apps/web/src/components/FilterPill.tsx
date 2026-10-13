import { XIcon } from "lucide-react";
import type { ReactNode } from "react";

/** One applied filter selection, removable with its ×. The sidebar's filter pill, for dialogs. */
export function FilterPill(props: { icon: ReactNode; label: string; onRemove: () => void }) {
  return (
    <span className="flex h-6 max-w-full min-w-0 items-center gap-1 rounded-full border pr-0.5 pl-2 text-foreground text-xs">
      <span className="flex size-3.5 shrink-0 items-center justify-center [&_svg]:size-3.5">
        {props.icon}
      </span>
      <span className="min-w-0 truncate">{props.label}</span>
      <button
        type="button"
        aria-label={`Remove ${props.label} filter`}
        className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
        onClick={props.onRemove}
      >
        <XIcon aria-hidden className="size-3" />
      </button>
    </span>
  );
}
