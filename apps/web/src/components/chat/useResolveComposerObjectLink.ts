import type { ComposerObjectLink } from "@t3tools/client-runtime/composer-object-links";
import { repositoryContextRecord } from "@t3tools/client-runtime/context-repositories";
import { gitHubIssueContextRecord } from "@t3tools/client-runtime/state/github-issues";
import { linearIssueContextRecord } from "@t3tools/client-runtime/state/linear";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useCallback } from "react";

import { type ComposerThreadTarget, useComposerDraftStore } from "~/composerDraftStore";
import { useIssueContextStore } from "~/issueContextStore";
import type { ComposerContextReference } from "~/lib/composerContextReferences";
import { reviewCommentContextReference } from "~/lib/composerContextRecords";
import { resolvePullRequestPreviewTarget } from "~/lib/openPullRequestLink";
import { useRepositoryContextStore } from "~/repositoryContextStore";
import { useProjects } from "~/state/entities";
import { githubIssueEnvironment } from "~/state/githubIssues";
import { linearEnvironment } from "~/state/linear";
import { pullRequestEnvironment } from "~/state/pullRequests";
import { serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";
import { useAtomQueryRunner } from "~/state/use-atom-query-runner";
import {
  buildPullRequestCommentReferenceContext,
  buildPullRequestReferenceContext,
  findPullRequestComment,
} from "../pullRequest/pullRequestDetail.logic";

export interface ResolvedComposerObjectLink {
  readonly reference: ComposerContextReference;
  /** Stores the payload behind the chip. Call it once the reference is in the prompt. */
  readonly commit: () => void;
}

/**
 * Turns a link into the chip its attach picker would have made: the issue or pull request is
 * fetched and snapshotted the same way. Null when it cannot be read (Linear not connected, `gh`
 * signed out, a repository no project here is checked out from), so the caller keeps the link.
 */
export function useResolveComposerObjectLink(input: {
  threadRef: ScopedThreadRef;
  draftTarget: ComposerThreadTarget;
}) {
  const { threadRef, draftTarget } = input;
  const environmentId = threadRef.environmentId;
  const getLinearIssue = useAtomCommand(linearEnvironment.getIssue, { reportFailure: false });
  const getGitHubIssue = useAtomCommand(githubIssueEnvironment.getIssue, { reportFailure: false });
  const getPullRequest = useAtomQueryRunner(pullRequestEnvironment.detail, {
    reportFailure: false,
  });
  const getPullRequestActivity = useAtomQueryRunner(pullRequestEnvironment.activity, {
    reportFailure: false,
  });
  const projects = useProjects();
  const serverConfig = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const pullRequestsEnabled = serverConfig?.environment.capabilities.pullRequests === true;

  return useCallback(
    async (link: ComposerObjectLink): Promise<ResolvedComposerObjectLink | null> => {
      switch (link.kind) {
        case "linear-issue": {
          const result = await getLinearIssue({ environmentId, input: { id: link.identifier } });
          if (result._tag === "Failure") return null;
          const record = linearIssueContextRecord(result.value);
          return {
            reference: { kind: "linear-issue", contextId: record.contextId, label: record.label },
            commit: () => useIssueContextStore.getState().upsert(threadRef.threadId, record),
          };
        }
        case "github-issue": {
          const result = await getGitHubIssue({ environmentId, input: { url: link.url } });
          if (result._tag === "Failure") return null;
          const record = gitHubIssueContextRecord(result.value);
          return {
            reference: { kind: "github-issue", contextId: record.contextId, label: record.label },
            commit: () => useIssueContextStore.getState().upsert(threadRef.threadId, record),
          };
        }
        case "pull-request": {
          const target = resolvePullRequestPreviewTarget({
            environmentId,
            projects,
            pullRequestsEnabled,
            url: link.url,
          });
          if (target === null) return null;
          // A link to one remark (`#issuecomment-1`) attaches that remark, not the whole change.
          const [result, activity] = await Promise.all([
            getPullRequest(target),
            new URL(link.url).hash.length > 1 ? getPullRequestActivity(target) : null,
          ]);
          if (result._tag === "Failure") return null;
          const linked =
            activity?._tag === "Success" ? findPullRequestComment(activity.value, link.url) : null;
          const comment =
            linked === null
              ? buildPullRequestReferenceContext(result.value)
              : buildPullRequestCommentReferenceContext(result.value, linked);
          return {
            reference: reviewCommentContextReference(comment),
            commit: () =>
              useComposerDraftStore
                .getState()
                .addReviewComment(draftTarget, comment, { appendReference: false }),
          };
        }
        case "repository": {
          const record = repositoryContextRecord(link);
          return {
            reference: { kind: "repository", contextId: record.contextId, label: record.label },
            commit: () => useRepositoryContextStore.getState().upsert(threadRef.threadId, record),
          };
        }
      }
    },
    [
      draftTarget,
      environmentId,
      getGitHubIssue,
      getLinearIssue,
      getPullRequest,
      getPullRequestActivity,
      projects,
      pullRequestsEnabled,
      threadRef.threadId,
    ],
  );
}
