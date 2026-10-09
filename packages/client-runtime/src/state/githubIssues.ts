import { type GitHubIssueThreadLink, type ThreadId, WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";

export {
  gitHubIssueContextRecord,
  gitHubIssueLabel,
} from "@t3tools/shared/integrationContextRecords";

export function createGitHubIssueEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    // Keyed by checkout, query text, and state. Callers debounce typing.
    issues: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:github-issues:issues",
      tag: WS_METHODS.githubIssuesList,
      staleTimeMs: 30_000,
    }),
    // One issue's full snapshot, for hover previews; cached briefly so re-hovering is instant.
    issue: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:github-issues:issue",
      tag: WS_METHODS.githubIssuesGet,
      staleTimeMs: 60_000,
    }),
    // Fetched once when an issue is attached; the result is snapshotted into the message.
    getIssue: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:github-issues:get-issue",
      tag: WS_METHODS.githubIssuesGet,
    }),
    // A linked issue's live state, without the body and comments.
    issueSummary: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:github-issues:issue-summary",
      tag: WS_METHODS.githubIssuesGetSummary,
      staleTimeMs: 60_000,
    }),
    // Every thread group's linked GitHub issue in the environment.
    threadLinks: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:github-issues:thread-links",
      tag: WS_METHODS.githubIssuesSubscribeThreadLinks,
    }),
    linkThread: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:github-issues:link-thread",
      tag: WS_METHODS.githubIssuesLinkThread,
    }),
    unlinkThread: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:github-issues:unlink-thread",
      tag: WS_METHODS.githubIssuesUnlinkThread,
    }),
  };
}

/** The GitHub issue linked to the thread's tab group, if any. */
export function gitHubIssueLinkForThread(
  links: ReadonlyArray<GitHubIssueThreadLink> | null | undefined,
  threadId: ThreadId,
): GitHubIssueThreadLink | null {
  return links?.find((link) => link.threadIds.includes(threadId)) ?? null;
}

/**
 * Live threads in a group linked to the issue, newest first. The pickers offer to open these
 * instead of starting another thread.
 */
export function threadsForGitHubIssue<
  T extends {
    readonly id: ThreadId;
    readonly archivedAt: string | null;
    readonly updatedAt: string;
  },
>(
  threads: ReadonlyArray<T>,
  links: ReadonlyArray<GitHubIssueThreadLink> | null | undefined,
  url: string,
): T[] {
  const linkedThreadIds = new Set(
    (links ?? []).filter((link) => link.url === url).flatMap((link) => link.threadIds),
  );
  if (linkedThreadIds.size === 0) return [];
  return threads
    .filter((thread) => thread.archivedAt === null && linkedThreadIds.has(thread.id))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
