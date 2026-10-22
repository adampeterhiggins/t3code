import { useAtomValue } from "@effect/atom-react";
import { gitHubIssueLinkForThread } from "@t3tools/client-runtime/state/github-issues";
import type { EnvironmentId, GitHubIssueThreadLink, ScopedThreadRef } from "@t3tools/contracts";
import { ExternalLinkIcon, PencilIcon, UnlinkIcon } from "lucide-react";

import { useLinkClickHandler } from "~/browser/useOpenLink";
import { cn } from "~/lib/utils";
import { githubIssueEnvironment } from "~/state/githubIssues";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { GitHubIcon } from "../Icons";
import { MenuItem, MenuSeparator } from "../ui/menu";
import { GITHUB_ISSUE_STATE_PRESENTATION } from "./GitHubIssueHoverPreview";
import { openGitHubIssuePicker } from "./GitHubIssuePicker";
import { ThreadLinkRow } from "./ThreadLinkRow";

/** Every GitHub issue link in the environment. Null until the server answers. */
export function useGitHubIssueThreadLinks(environmentId: EnvironmentId | null) {
  return useEnvironmentQuery(
    environmentId === null
      ? null
      : githubIssueEnvironment.threadLinks({ environmentId, input: {} }),
  ).data;
}

/** The GitHub issue linked to the thread's tab group, if any. */
export function useThreadGitHubIssueLink(threadRef: ScopedThreadRef | null) {
  const links = useGitHubIssueThreadLinks(threadRef?.environmentId ?? null);
  return threadRef === null ? null : gitHubIssueLinkForThread(links, threadRef.threadId);
}

export function useUnlinkGitHubIssue() {
  const unlinkThread = useAtomCommand(githubIssueEnvironment.unlinkThread);
  return (threadRef: ScopedThreadRef) =>
    unlinkThread({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId },
    });
}

/**
 * The thread details row for the thread's linked GitHub issue, with whether it is open. State is
 * read from GitHub when the row mounts and cached for a minute; the link itself stays put when
 * GitHub is unreachable.
 */
export function GitHubIssueThreadLinkRow(props: {
  threadRef: ScopedThreadRef;
  link: GitHubIssueThreadLink;
}) {
  const { threadRef, link } = props;
  const summary = useEnvironmentQuery(
    githubIssueEnvironment.issueSummary({
      environmentId: threadRef.environmentId,
      input: { url: link.url },
    }),
  ).data;
  const openLink = useLinkClickHandler(threadRef);
  const unlink = useUnlinkGitHubIssue();
  const canEdit = useAtomValue(
    githubIssueEnvironment.linkThread.permissionAtom(threadRef.environmentId),
  );
  const title = summary?.title ?? link.title;
  const url = summary?.url ?? link.url;
  const state = summary ? GITHUB_ISSUE_STATE_PRESENTATION[summary.state] : null;

  return (
    <ThreadLinkRow
      watchKind="github"
      linkUrl={link.url}
      icon={<GitHubIcon className="size-4 shrink-0" />}
      label={`#${link.number} ${title}`}
      accessibleLabel={`Linked GitHub issue ${link.repository}#${link.number}: ${title}`}
      threadRef={threadRef}
      url={url}
      trailing={
        state ? (
          <span className={cn("shrink-0 text-2xs", state.toneClassName)}>{state.label}</span>
        ) : null
      }
    >
      <MenuItem
        render={<a href={url} target="_blank" rel="noreferrer" />}
        onClick={(event) => openLink(event, url)}
      >
        <ExternalLinkIcon />
        Open on GitHub
      </MenuItem>
      {canEdit ? (
        <>
          <MenuItem onClick={() => openGitHubIssuePicker(threadRef, "link")}>
            <PencilIcon />
            Change issue…
          </MenuItem>
          <MenuSeparator />
          <MenuItem onClick={() => void unlink(threadRef)}>
            <UnlinkIcon />
            Unlink issue
          </MenuItem>
        </>
      ) : null}
    </ThreadLinkRow>
  );
}
