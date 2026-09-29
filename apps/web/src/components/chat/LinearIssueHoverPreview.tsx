import type { EnvironmentId } from "@t3tools/contracts";
import type { ReactElement } from "react";

import { useLinearLinkClickHandler } from "~/browser/useLinearLinkClickHandler";
import { linearEnvironment } from "~/state/linear";
import { useEnvironmentQuery } from "~/state/query";
import { LinearIssueMarkdown } from "../contextChipParts";
import { CursorPreviewCard } from "./CursorPreviewCard";

const keepAnchorDefault = () => {};

/** Hover card for a Linear issue row: the snapshot an attached chip would carry. */
export function LinearIssueHoverPreview(props: {
  environmentId: EnvironmentId;
  issueId: string;
  trigger: ReactElement;
}) {
  return (
    <CursorPreviewCard trigger={props.trigger}>
      <LinearIssuePreviewBody environmentId={props.environmentId} issueId={props.issueId} />
    </CursorPreviewCard>
  );
}

function LinearIssuePreviewBody(props: { environmentId: EnvironmentId; issueId: string }) {
  const issue = useEnvironmentQuery(
    linearEnvironment.issue({ environmentId: props.environmentId, input: { id: props.issueId } }),
  );
  // Outside a thread there is no in-app browser to target, so the anchor's own default
  // (a new tab, or the system browser on desktop) is the fallback.
  const openLinearLink = useLinearLinkClickHandler(keepAnchorDefault);
  const detail = issue.data;
  if (detail === null) {
    return <p className="text-muted-foreground">{issue.error ?? "Loading issue…"}</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3 text-muted-foreground">
        <span className="min-w-0 truncate">
          {detail.identifier} · {detail.stateName}
        </span>
        <a
          href={detail.url}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 underline-offset-2 hover:text-foreground hover:underline"
          onClick={(event) => openLinearLink(event, detail.url)}
        >
          Open in Linear
        </a>
      </div>
      <LinearIssueMarkdown markdown={detail.markdown} url={detail.url} />
    </div>
  );
}
