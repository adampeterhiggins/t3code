import { useAtomValue } from "@effect/atom-react";
import { gitHubIssueLinkForThread } from "@t3tools/client-runtime/state/github-issues";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { ExternalLinkIcon, PencilIcon, UnlinkIcon } from "lucide-react";

import { useLinkClickHandler } from "~/browser/useOpenLink";
import { cn } from "~/lib/utils";
import { githubIssueEnvironment } from "~/state/githubIssues";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { GitHubIcon } from "../Icons";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { GITHUB_ISSUE_STATE_PRESENTATION } from "./GitHubIssueHoverPreview";
import { openGitHubIssuePicker } from "./GitHubIssuePicker";

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
 * The chat header's chip for the thread's linked GitHub issue, with whether it is open. State is
 * read from GitHub when the chip mounts and cached for a minute; the link itself stays put when
 * GitHub is unreachable.
 */
export function GitHubIssueThreadLinkChip(props: { threadRef: ScopedThreadRef }) {
  const { threadRef } = props;
  const link = useThreadGitHubIssueLink(threadRef);
  const summary = useEnvironmentQuery(
    link === null
      ? null
      : githubIssueEnvironment.issueSummary({
          environmentId: threadRef.environmentId,
          input: { url: link.url },
        }),
  ).data;
  const openLink = useLinkClickHandler(threadRef);
  const unlink = useUnlinkGitHubIssue();
  const canEdit = useAtomValue(
    githubIssueEnvironment.linkThread.permissionAtom(threadRef.environmentId),
  );
  if (link === null) return null;
  const title = summary?.title ?? link.title;
  const url = summary?.url ?? link.url;
  const state = summary ? GITHUB_ISSUE_STATE_PRESENTATION[summary.state] : null;

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            size="compact"
            variant="ghost-muted"
            aria-label={`Linked GitHub issue ${link.repository}#${link.number}: ${title}`}
            title={title}
          />
        }
      >
        <GitHubIcon />
        <span className="tabular-nums">#{link.number}</span>
        {state ? <span className={cn("shrink-0", state.toneClassName)}>{state.label}</span> : null}
      </MenuTrigger>
      <MenuPopup align="end">
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
      </MenuPopup>
    </Menu>
  );
}
