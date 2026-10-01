import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import type { ReactElement } from "react";

import { useLinkClickHandler } from "~/browser/useOpenLink";
import { githubIssueEnvironment } from "~/state/githubIssues";
import { useEnvironmentQuery } from "~/state/query";
import { GitHubIssueDetails } from "../contextChipParts";
import { CursorPreviewCard } from "./CursorPreviewCard";
import { ThreadsInUse } from "./StartFromPreviews";

const NO_THREADS: ReadonlyArray<EnvironmentThreadShell> = [];

/** How an issue's state reads in rows and the header chip: open in green, closed in violet. */
export const GITHUB_ISSUE_STATE_PRESENTATION = {
  open: { label: "Open", toneClassName: "text-emerald-600 dark:text-emerald-300/90" },
  closed: { label: "Closed", toneClassName: "text-violet-600 dark:text-violet-300/90" },
} as const;

/**
 * Hover card for a GitHub issue row: the snapshot an attached chip would carry, and the threads
 * already linked to the issue.
 */
export function GitHubIssueHoverPreview(props: {
  environmentId: EnvironmentId;
  url: string;
  /** Where "Open on GitHub" can open in-app; without one the link opens outside the app. */
  threadRef?: ScopedThreadRef | null;
  threads?: ReadonlyArray<EnvironmentThreadShell>;
  onOpenThread?: (thread: EnvironmentThreadShell) => void;
  trigger: ReactElement;
}) {
  return (
    <CursorPreviewCard trigger={props.trigger}>
      <GitHubIssuePreviewBody {...props} />
    </CursorPreviewCard>
  );
}

function GitHubIssuePreviewBody(props: {
  environmentId: EnvironmentId;
  url: string;
  threadRef?: ScopedThreadRef | null;
  threads?: ReadonlyArray<EnvironmentThreadShell>;
  onOpenThread?: (thread: EnvironmentThreadShell) => void;
}) {
  const issue = useEnvironmentQuery(
    githubIssueEnvironment.issue({
      environmentId: props.environmentId,
      input: { url: props.url },
    }),
  );
  const openLink = useLinkClickHandler(props.threadRef);
  const detail = issue.data;
  if (detail === null) {
    return <p className="text-muted-foreground">{issue.error ?? "Loading issue…"}</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <GitHubIssueDetails record={detail} onOpenLink={openLink} />
      <ThreadsInUse
        threads={props.threads ?? NO_THREADS}
        {...(props.onOpenThread ? { onOpenThread: props.onOpenThread } : {})}
      />
    </div>
  );
}
