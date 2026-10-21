import { commentAnchor, type ComposerObjectLink } from "@t3tools/shared/composerObjectLinks";
import { repositoryContextRecord } from "@t3tools/client-runtime/context-repositories";
import {
  gitHubIssueContextRecord,
  gitHubRefContextRecord,
} from "@t3tools/client-runtime/state/github-issues";
import {
  linearIssueContextRecord,
  linearObjectContextRecord,
  promptLinkContextRecord,
} from "@t3tools/shared/integrationContextRecords";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { notionPageContextRecord } from "@t3tools/client-runtime/state/notion";
import { notionEnvironment } from "~/state/notion";
import { granolaNoteContextRecord } from "@t3tools/client-runtime/state/granola";
import { granolaEnvironment } from "~/state/granola";
import {
  discordThreadContextRecord,
  slackThreadContextRecord,
} from "@t3tools/shared/integrationContextRecords";
import type {
  DiscordErrorReason,
  GranolaError,
  NotionError,
  PullRequestDetail,
  ScopedThreadRef,
  SlackErrorReason,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";

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
import { discordEnvironment } from "~/state/discord";
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
// that cannot be read says why, once per session; the rest only show their broken chip.
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
      ? "The agent gets the link instead. Connect Slack in Settings → Integrations."
      : failure instanceof Error
        ? failure.message
        : undefined,
  });
}

// Like Slack, an unconnected or revoked Discord bot says so once per session.
let toldDiscordIsUnavailable = false;

function reportUnreadableDiscordLink(failure: unknown) {
  if (typeof failure !== "object" || failure === null) return;
  if (!("_tag" in failure) || failure._tag !== "DiscordError" || !("reason" in failure)) return;
  const reason = failure.reason as DiscordErrorReason;
  const unavailable = reason === "not-connected" || reason === "revoked";
  if (unavailable) {
    if (toldDiscordIsUnavailable) return;
    toldDiscordIsUnavailable = true;
  }
  toastManager.add({
    type: unavailable ? "info" : "error",
    title: unavailable
      ? "Connect Discord to attach messages"
      : "Could not read that Discord message",
    description: unavailable
      ? "The agent gets the link instead. Connect Discord in Settings → Integrations."
      : failure instanceof Error
        ? failure.message
        : undefined,
  });
}

// Like Slack, an unconnected Granola says so once per session; later links only show their chip.
let toldGranolaIsUnavailable = false;

function reportUnreadableGranolaLink(failure: unknown) {
  const reason =
    typeof failure === "object" && failure !== null && "reason" in failure
      ? (failure.reason as GranolaError["reason"])
      : null;
  const unavailable = reason === "not-connected";
  if (unavailable) {
    if (toldGranolaIsUnavailable) return;
    toldGranolaIsUnavailable = true;
  }
  toastManager.add({
    type: "info",
    title: unavailable
      ? "Connect Granola to attach meeting notes"
      : "Could not attach that Granola note",
    description: unavailable
      ? "The agent gets the link instead. Connect Granola in Settings → Integrations."
      : failure instanceof Error
        ? `The agent gets the link instead. ${failure.message}`
        : "The agent gets the link instead.",
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
          ? `The agent gets the link instead. ${failure.message}`
          : "The agent gets the link instead. Check the Notion connection in Settings → Integrations.",
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
      actionLayout: "stacked-end",
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
 * fetched and snapshotted the same way.
 * - `skipped`: it was never tried (its integration is turned off, or a pull request on a host no
 *   project here is checked out from), so the link stays a plain link.
 * - `unreadable`: it was tried and could not be read (not connected, `gh` signed out, not found,
 *   a comment or lines the host did not return), so the caller shows that it failed.
 */
export function useResolveComposerObjectLink(input: {
  threadRef: ScopedThreadRef;
  draftTarget: ComposerThreadTarget;
}) {
  const { threadRef, draftTarget } = input;
  const environmentId = threadRef.environmentId;
  const slackEnabled = useEnvironmentSettings(environmentId, (s) => s.enableSlackIntegration);
  const discordEnabled = useEnvironmentSettings(environmentId, (s) => s.enableDiscordIntegration);
  const notionEnabled = useEnvironmentSettings(environmentId, (s) => s.enableNotionIntegration);
  const granolaEnabled = useEnvironmentSettings(environmentId, (s) => s.enableGranolaIntegration);
  const getLinearIssue = useAtomCommand(linearEnvironment.getIssue, { reportFailure: false });
  const getLinearObject = useAtomCommand(linearEnvironment.getObject, { reportFailure: false });
  const getGitHubIssue = useAtomCommand(githubIssueEnvironment.getIssue, { reportFailure: false });
  const getGitHubRef = useAtomCommand(githubIssueEnvironment.getRef, { reportFailure: false });
  const getNotionPage = useAtomCommand(notionEnvironment.getPage, { reportFailure: false });
  const getSlackThread = useAtomCommand(slackEnvironment.getThread, { reportFailure: false });
  const getDiscordThread = useAtomCommand(discordEnvironment.getThread, { reportFailure: false });
  const getGranolaNote = useAtomCommand(granolaEnvironment.getNote, { reportFailure: false });
  const getPullRequest = useAtomQueryRunner(pullRequestEnvironment.detail, {
    reportFailure: false,
  });
  const getPullRequestActivity = useAtomQueryRunner(pullRequestEnvironment.activity, {
    reportFailure: false,
  });
  const getFreshPullRequestActivity = useAtomQueryRunner(pullRequestEnvironment.activity, {
    reportFailure: false,
    refresh: true,
  });
  const getPullRequestDiff = useAtomQueryRunner(pullRequestEnvironment.diff, {
    reportFailure: false,
  });
  const projects = useProjects();
  const serverConfig = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const capabilities = serverConfig?.environment.capabilities;

  return async (
    link: ComposerObjectLink,
    options?: {
      /** Tries the same link again, offered where the user can fix what stopped it. */
      readonly retry?: () => void;
    },
  ): Promise<ResolvedComposerObjectLink | "skipped" | "unreadable"> => {
    switch (link.kind) {
      case "notion-page": {
        if (!notionEnabled) return "skipped";
        const result = await getNotionPage({ environmentId, input: { id: link.pageId } });
        if (result._tag === "Failure") {
          if (!isAtomCommandInterrupted(result))
            reportUnreadableNotionLink(squashAtomCommandFailure(result), link.url, options?.retry);
          return "unreadable";
        }
        const record = notionPageContextRecord(result.value);
        return {
          reference: { kind: record.kind, contextId: record.contextId, label: record.label },
          commit: () => useIssueContextStore.getState().upsert(threadRef.threadId, record),
        };
      }
      case "granola-note": {
        if (!granolaEnabled) return "skipped";
        const result = await getGranolaNote({ environmentId, input: { id: link.noteId } });
        if (result._tag === "Failure") {
          if (!isAtomCommandInterrupted(result))
            reportUnreadableGranolaLink(squashAtomCommandFailure(result));
          return "unreadable";
        }
        const record = granolaNoteContextRecord(result.value);
        return {
          reference: { kind: record.kind, contextId: record.contextId, label: record.label },
          commit: () => useIssueContextStore.getState().upsert(threadRef.threadId, record),
        };
      }
      case "linear-issue": {
        const result = await getLinearIssue({ environmentId, input: { id: link.identifier } });
        if (result._tag === "Failure") return "unreadable";
        const record = linearIssueContextRecord(result.value);
        return {
          reference: { kind: "linear-issue", contextId: record.contextId, label: record.label },
          commit: () => useIssueContextStore.getState().upsert(threadRef.threadId, record),
        };
      }
      case "linear-object": {
        const result = await getLinearObject({
          environmentId,
          input: { objectType: link.objectType, id: link.slugId },
        });
        if (result._tag === "Failure") return "unreadable";
        const record = linearObjectContextRecord(result.value);
        return {
          reference: { kind: "linear-object", contextId: record.contextId, label: record.label },
          commit: () => useIssueContextStore.getState().upsert(threadRef.threadId, record),
        };
      }
      case "slack-message": {
        if (!slackEnabled) return "skipped";
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
          return "unreadable";
        }
        const record = slackThreadContextRecord(result.value);
        return {
          reference: { kind: "slack-thread", contextId: record.contextId, label: record.label },
          commit: () => useIssueContextStore.getState().upsert(threadRef.threadId, record),
        };
      }
      case "discord-message": {
        if (!discordEnabled) return "skipped";
        const result = await getDiscordThread({
          environmentId,
          input: {
            guildId: link.guildId,
            channelId: link.channelId,
            messageId: link.messageId,
            url: link.url,
            scope: "thread",
          },
        });
        if (result._tag === "Failure") {
          if (!isAtomCommandInterrupted(result)) {
            reportUnreadableDiscordLink(squashAtomCommandFailure(result));
          }
          return "unreadable";
        }
        const record = discordThreadContextRecord(result.value);
        return {
          reference: { kind: "discord-thread", contextId: record.contextId, label: record.label },
          commit: () => useIssueContextStore.getState().upsert(threadRef.threadId, record),
        };
      }
      case "github-issue": {
        const result = await getGitHubIssue({ environmentId, input: { url: link.url } });
        if (result._tag === "Failure") return "unreadable";
        const record = gitHubIssueContextRecord(result.value);
        return {
          reference: { kind: "github-issue", contextId: record.contextId, label: record.label },
          commit: () => useIssueContextStore.getState().upsert(threadRef.threadId, record),
        };
      }
      case "github-ref": {
        const result = await getGitHubRef({ environmentId, input: { url: link.url } });
        if (result._tag === "Failure") return "unreadable";
        const record = gitHubRefContextRecord(result.value);
        return {
          reference: { kind: "github-ref", contextId: record.contextId, label: record.label },
          commit: () => useIssueContextStore.getState().upsert(threadRef.threadId, record),
        };
      }
      case "pull-request": {
        const target = resolvePullRequestPreviewTarget({
          environmentId,
          projects,
          capabilities,
          url: link.url,
        });
        if (target === null) return "skipped";
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
        // The shared read can predate a remark posted moments ago, which is exactly when one
        // gets pasted, so a miss asks the host again before giving up.
        const findComment = async () => {
          const shared = await getPullRequestActivity(target);
          const found =
            shared._tag === "Success" ? findPullRequestComment(shared.value, link.url) : null;
          if (found !== null) return found;
          const fresh = await getFreshPullRequestActivity({
            ...target,
            input: { ...target.input, allowStale: false },
          });
          return fresh._tag === "Success" ? findPullRequestComment(fresh.value, link.url) : null;
        };
        const commentLink = linesAnchor === null && commentAnchor(new URL(link.url).hash) !== "";
        const [result, linked] = await Promise.all([
          getPullRequest(target),
          commentLink ? findComment() : null,
        ]);
        if (result._tag === "Failure") return "unreadable";
        // A remark that cannot be found stays a link, like lines the diff cannot show: the whole
        // change would drop exactly what the link pointed at.
        if (commentLink && linked === null) return "unreadable";
        const comment =
          linesAnchor !== null
            ? await findLines(result.value)
            : linked === null
              ? buildPullRequestReferenceContext(result.value)
              : buildPullRequestCommentReferenceContext(result.value, linked);
        if (comment === null) return "unreadable";
        return {
          reference: reviewCommentContextReference(comment),
          commit: () =>
            useComposerDraftStore
              .getState()
              .addReviewComment(draftTarget, comment, { appendReference: false }),
        };
      }
      case "prompt-link": {
        const record = promptLinkContextRecord(link);
        return {
          reference: { kind: "prompt-link", contextId: record.contextId, label: record.label },
          commit: () => useIssueContextStore.getState().upsert(threadRef.threadId, record),
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
  };
}
