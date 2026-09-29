import type { EnvironmentId } from "@t3tools/contracts";
import { type ReactElement, useState } from "react";

import { linearEnvironment } from "~/state/linear";
import { useEnvironmentQuery } from "~/state/query";
import { ThreadTabSummaryDetails } from "../contextChipParts";
import { PreviewCard, PreviewCardPopup, PreviewCardTrigger } from "../ui/preview-card";

/**
 * Hover card for a Linear issue row: the snapshot an attached chip would carry. The issue is
 * fetched only once the card opens, so scanning a list does not fetch every row.
 */
export function LinearIssueHoverPreview(props: {
  environmentId: EnvironmentId;
  issueId: string;
  trigger: ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const issue = useEnvironmentQuery(
    open
      ? linearEnvironment.issue({
          environmentId: props.environmentId,
          input: { id: props.issueId },
        })
      : null,
  );
  const detail = issue.data;
  return (
    <PreviewCard open={open} onOpenChange={setOpen}>
      <PreviewCardTrigger render={props.trigger} delay={400} closeDelay={120} />
      <PreviewCardPopup side="right" align="start" className="w-96 max-w-[calc(100vw-2rem)]">
        <div className="flex flex-col gap-2 p-3 text-xs">
          {detail === null ? (
            <p className="text-muted-foreground">{issue.error ?? "Loading issue…"}</p>
          ) : (
            <>
              <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                <span className="shrink-0 font-medium">{detail.identifier}</span>
                <span aria-hidden>·</span>
                <span className="min-w-0 truncate">
                  {[detail.stateName, detail.priorityLabel, detail.assigneeName ?? "Unassigned"]
                    .filter((part) => part !== null)
                    .join(" · ")}
                </span>
              </div>
              <p className="font-medium text-foreground text-sm leading-snug text-pretty">
                {detail.title}
              </p>
              <ThreadTabSummaryDetails summary={detail.markdown} />
            </>
          )}
        </div>
      </PreviewCardPopup>
    </PreviewCard>
  );
}
