import type { EnvironmentId } from "@t3tools/contracts";
import { type ReactElement, useState } from "react";

import { linearEnvironment } from "~/state/linear";
import { useEnvironmentQuery } from "~/state/query";
import { LinearIssueMarkdown } from "../contextChipParts";
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
            <LinearIssueMarkdown markdown={detail.markdown} />
          )}
        </div>
      </PreviewCardPopup>
    </PreviewCard>
  );
}
