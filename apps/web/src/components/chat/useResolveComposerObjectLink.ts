import type { ComposerObjectLink } from "@t3tools/client-runtime/composer-object-links";
import { repositoryContextRecord } from "@t3tools/client-runtime/context-repositories";
import { gitHubIssueContextRecord } from "@t3tools/client-runtime/state/github-issues";
import { linearIssueContextRecord } from "@t3tools/client-runtime/state/linear";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { notionPageContextRecord } from "@t3tools/client-runtime/state/notion";
import { notionEnvironment } from "~/state/notion";
import { slackThreadContextRecord } from "@t3tools/client-runtime/state/slack";
import type {
  NotionError,
  PullRequestDetail,
  ScopedThreadRef,
  SlackErrorReason,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useCallback } from "react";

import { type ComposerThreadTarget, useComposerDraftStore } from "~/composerDraftStore";
import { useIssueContextStore } from "~/issueContextStore";
import { useEnvironmentSettings } from "~/hooks/useSettings";
import type { ComposerContextReference } from "~/lib/composerContextReferences";
import { reviewCommentContextReference } from "~/lib/composerContextRecords";
import { getRenderablePatch } from "~/lib/diffRendering";
import { resolvePullRequestPreviewTarget } from "~/lib/openPullRequestLink";
import { ensureLocalApi } from "~/localApi";
import { useRepositoryContextStore } from "~/repositoryContextStore";
import { useProjects } from "~/state/entities";
import { githubIssueEnvironment } from "~/state/githubIssues";
import { linearEnvironment } from "~/state/linear";
import { pullRequestEnvironment } from "~/state/pullRequests";
import { serverEnvironment } from "~/state/server";
import { slackEnvironment } from "~/state/slack";
import { useAtomCommand } from "~/state/use-atom-command";
import { useAtomQueryRunner } from "~/state/use-atom-query-runner";
import {
  buildPullRequestCommentReferenceContext,
  buildPullRequestLinesReferenceContext,
  buildPullRequestReferenceContext,
  findPullRequestComment,
  pullRequestDiffLinesAnchor,
} from "../pullRequest/pullRequestDetail.logic";
import { toastManager } from "../ui/toast";

// Slack is the integration people are least likely to have connected, so the first Slack link
// that cannot be read says why, once per session; the rest stay links quietly.
let toldSlackIsUnavailable = false;

function reportUnreadableSlackLink(failure: unknown) {
  if (typeof failure !== "object" || failure === null) return;
  if (!("_tag" in failure) || failure._tag !== "SlackError" || !("reason" in failure)) return;
  const reason = failure.reason as SlackErrorReason;
  const unavailable = reason === "not-connected" || reason === "not-configured";
  if (unavailable) {
    if (toldSlackIsUnavailable) return;
    toldSlackIsUnavailable = true;
  }
  toastManager.add({
    type: unavailable ? "info" : "error",
    title: unavailable ? "Connect Slack to attach messages" : "Could not read that Slack message",
    description: unavailable
      ? "The link was kept as a link. Connect Slack in Settings → Integrations."
      : failure instanceof Error
        ? failure.message
        : undefined,
  });
}

/**
 * A page Notion will not show is usually one nobody shared with the connection. Only the user
 * can share it, in Notion, so the toast stays until they act: open the page there, then retry.
 */
function reportUnreadableNotionLink(
  failure: unknown,
  url: string,
  retry: (() => void) | undefined,
) {
  const reason =
    typeof failure === "object" && failure !== null && "reason" in failure
      ? (failure.reason as NotionError["reason"])
      : null;
  if (reason !== "not-found") {
    toastManager.add({
      type: "info",
      title: "Could not attach that Notion page",
      description:
        failure instanceof Error
          ? `The link was kept. ${failure.message}`
          : "The link was kept. Check the Notion connection in Settings → Integrations.",
    });
    return;
  }
  const toastId = toastManager.add({
    type: "info",
    title: "T3 Code can't read this Notion page",
    description:
      "In Notion, open the page's ••• menu → Connections and add your T3 Code connection, then retry.",
    timeout: 0,
    ...(retry
      ? {
          actionProps: {
            children: "Retry",
            onClick: () => {
              toastManager.close(toastId);
              retry();
            },
          },
        }
      : {}),
    data: {
      hideCopyButton: true,
      secondaryActionProps: {
        children: "Open in Notion",
        onClick: () => void ensureLocalApi().shell.openExternal(url),
      },
    },
  });
}

export interface ResolvedComposerObjectLink {
  readonly reference: ComposerContextReference;
  /** Stores the payload behind the chip. Call it once the reference is in the prompt. */
  readonly commit: () => void;
}

/**
 * Turns a link into the chip its attach picker would have made: the issue or pull request is
 * fetched and snapshotted the same way. Null when it cannot be read (Linear, Slack, or Notion
 * not connected or turned off, `gh` signed out, a repository no project here is checked out from), so the caller
 * keeps the link.
 */
export function useResolveComposerObjectLink(input: {
  threadRef: ScopedThreadRef;
  draftTarget: ComposerThreadTarget;
}) {
  const { threadRef, draftTarget } = input;
  const environmentId = threadRef.environmentId;
  const slackEnabled = useEnvironmentSettings(environmentId, (s) => s.enableSlackIntegration);
  const notionEnabled = useEnvironmentSettings(environmentId, (s) => s.enableNotionIntegration);
  const getLinearIssue = useAtomCommand(linearEnvironment.getIssue, { reportFailure: false });
  const getGitHubIssue = useAtomCommand(githubIssueEnvironment.getIssue, { reportFailure: false });
  const getNotionPage = useAtomCommand(notionEnvironment.getPage, { reportFailure: false });
  const getSlackThread = useAtomCommand(slackEnvironment.getThread, { reportFailure: false });
  const getPullRequest = useAtomQueryRunner(pullRequestEnvironment.detail, {
    reportFailure: false,
  });
  const getPullRequestActivity = useAtomQueryRunner(pullRequestEnvironment.activity, {
    reportFailure: false,
  });
  const getPullRequestDiff = useAtomQueryRunner(pullRequestEnvironment.diff, {
    reportFailure: false,
  });
  const projects = useProjects();
  const serverConfig = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const pullRequestsEnabled = serverConfig?.environment.capabilities.pullRequests === true;

  return useCallback(
    async (
      link: ComposerObjectLink,
      options?: {
        /** Tries the same link again, offered where the user can fix what stopped it. */
        readonly retry?: () => void;
      },
    ): Promise<ResolvedComposerObjectLink | null> => {
      switch (link.kind) {
        case "notion-page": {
          if (!notionEnabled) return null;
          const result = await getNotionPage({ environmentId, input: { id: link.pageId } });
          if (result._tag === "Failure") {
            if (!isAtomCommandInterrupted(result))
              reportUnreadableNotionLink(
                squashAtomCommandFailure(result),
                link.url,
                options?.retry,
              );
            return null;
          }
          const record = notionPageContextRecord(result.value);
          return {
            reference: { kind: record.kind, contextId: record.contextId, label: record.label },
            commit: () => useIssueContextStore.getState().upsert(threadRef.threadId, record),
          };
        }
        case "linear-issue": {
          const result = await getLinearIssue({ environmentId, input: { id: link.identifier } });
          if (result._tag === "Failure") return null;
          const record = linearIssueContextRecord(result.value);
          return {
            reference: { kind: "linear-issue", contextId: record.contextId, label: record.label },
            commit: () => useIssueContextStore.getState().upsert(threadRef.threadId, record),
          };
        }
        case "slack-message": {
          if (!slackEnabled) return null;
          const result = await getSlackThread({
            environmentId,
            input: {
              channelId: link.channelId,
              ts: link.ts,
              ...(link.threadTs === null ? {} : { threadTs: link.threadTs }),
              url: link.url,
              scope: "thread",
            },
          });
          if (result._tag === "Failure") {
            if (!isAtomCommandInterrupted(result)) {
              reportUnreadableSlackLink(squashAtomCommandFailure(result));
            }
            return null;
          }
          const record = slackThreadContextRecord(result.value);
          return {
            reference: { kind: "slack-thread", contextId: record.contextId, label: record.label },
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
          const linesAnchor = pullRequestDiffLinesAnchor(link.url);
          // A link to lines of a file (`#diff-…L4-L14`) attaches those lines, read from the diff
          // a slice at a time until the file turns up. One the diff cannot show stays a link,
          // since the whole change would drop exactly what the link pointed at.
          const findLines = async (detail: PullRequestDetail) => {
            let cursor: string | null = null;
            do {
              const page = await getPullRequestDiff({
                environmentId: target.environmentId,
                input: { ...target.input, ...(cursor === null ? {} : { cursor }) },
              });
              if (page._tag === "Failure") return null;
              const parsed = getRenderablePatch(page.value.patch, "pull-request-link");
              const files = parsed?.kind === "files" ? parsed.sourceFiles : [];
              if (files.length > 0) {
                const lines = buildPullRequestLinesReferenceContext(detail, files, link.url);
                if (lines !== null) return lines;
              }
              cursor = page.value.nextCursor;
            } while (cursor !== null);
            return null;
          };
          // A link to one remark (`#issuecomment-1`) attaches that remark, not the whole change.
          const [result, activity] = await Promise.all([
            getPullRequest(target),
            linesAnchor === null && new URL(link.url).hash.length > 1
              ? getPullRequestActivity(target)
              : null,
          ]);
          if (result._tag === "Failure") return null;
          const linked =
            activity?._tag === "Success" ? findPullRequestComment(activity.value, link.url) : null;
          const comment =
            linesAnchor !== null
              ? await findLines(result.value)
              : linked === null
                ? buildPullRequestReferenceContext(result.value)
                : buildPullRequestCommentReferenceContext(result.value, linked);
          if (comment === null) return null;
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
      getPullRequestDiff,
      getNotionPage,
      getSlackThread,
      notionEnabled,
      projects,
      pullRequestsEnabled,
      slackEnabled,
      threadRef.threadId,
    ],
  );
}
