import { Columns2Icon, FileTextIcon } from "lucide-react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function SidebarSavedDraftsIndicator({ savedDraftCount }: { savedDraftCount: number }) {
  const savedDraftsLabel = `${savedDraftCount} draft${savedDraftCount === 1 ? "" : "s"}`;
  return savedDraftCount > 0 ? (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="img"
            aria-label={savedDraftsLabel}
            className="inline-flex shrink-0 items-center gap-0.5 text-muted-foreground/60 tabular-nums"
          />
        }
      >
        <FileTextIcon aria-hidden className="size-3" />
        {savedDraftCount}
      </TooltipTrigger>
      <TooltipPopup side="top">{savedDraftsLabel}</TooltipPopup>
    </Tooltip>
  ) : null;
}
/** Marks a row whose chat is one side of the split view on screen. */
export function SidebarSplitIndicator() {
  return (
    <span
      role="img"
      aria-label="Shown side by side"
      className="inline-flex shrink-0 items-center text-muted-foreground"
    >
      <Columns2Icon className="size-3.5" />
    </span>
  );
}
