import { type LinearThreadLink, type ThreadId, WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";

export { linearIssueContextRecord } from "@t3tools/shared/integrationContextRecords";

export function createLinearEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    // The environment's Linear connection, including an in-progress login.
    connection: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:linear:connection",
      tag: WS_METHODS.linearSubscribeState,
    }),
    startLogin: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:linear:start-login",
      tag: WS_METHODS.linearStartLogin,
      concurrency: { mode: "singleFlight", key: ({ environmentId }) => environmentId },
    }),
    completeLogin: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:linear:complete-login",
      tag: WS_METHODS.linearCompleteLogin,
    }),
    cancelLogin: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:linear:cancel-login",
      tag: WS_METHODS.linearCancelLogin,
    }),
    disconnect: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:linear:disconnect",
      tag: WS_METHODS.linearDisconnect,
    }),
    // Keyed by query text. Callers debounce typing: Linear allows 30 searches a minute.
    issues: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:linear:issues",
      tag: WS_METHODS.linearListIssues,
      staleTimeMs: 30_000,
    }),
    // Teams, statuses, projects, people, and labels for the picker's filter menus.
    filterOptions: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:linear:filter-options",
      tag: WS_METHODS.linearGetFilterOptions,
      staleTimeMs: 5 * 60_000,
    }),
    // One issue's full snapshot, for hover previews; cached briefly so re-hovering is instant.
    issue: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:linear:issue",
      tag: WS_METHODS.linearGetIssue,
      staleTimeMs: 60_000,
    }),
    // Fetched once when an issue is attached; the result is snapshotted into the message.
    getIssue: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:linear:get-issue",
      tag: WS_METHODS.linearGetIssue,
    }),
    // A linked issue's live status, without the body and comments.
    issueSummary: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:linear:issue-summary",
      tag: WS_METHODS.linearGetIssueSummary,
      staleTimeMs: 60_000,
    }),
    // Every thread group's linked issue in the environment.
    threadLinks: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:linear:thread-links",
      tag: WS_METHODS.linearSubscribeThreadLinks,
    }),
    linkThread: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:linear:link-thread",
      tag: WS_METHODS.linearLinkThread,
    }),
    unlinkThread: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:linear:unlink-thread",
      tag: WS_METHODS.linearUnlinkThread,
    }),
  };
}

/** The issue linked to the thread's tab group, if any. */
export function linearLinkForThread(
  links: ReadonlyArray<LinearThreadLink> | null | undefined,
  threadId: ThreadId,
): LinearThreadLink | null {
  return links?.find((link) => link.threadIds.includes(threadId)) ?? null;
}

/**
 * Live threads in a group linked to the issue, newest first. The picker offers to open these
 * instead of starting another thread.
 */
export function threadsForLinearIssue<
  T extends {
    readonly id: ThreadId;
    readonly archivedAt: string | null;
    readonly updatedAt: string;
  },
>(
  threads: ReadonlyArray<T>,
  links: ReadonlyArray<LinearThreadLink> | null | undefined,
  issueId: string,
): T[] {
  const linkedThreadIds = new Set(
    (links ?? []).filter((link) => link.issueId === issueId).flatMap((link) => link.threadIds),
  );
  if (linkedThreadIds.size === 0) return [];
  return threads
    .filter((thread) => thread.archivedAt === null && linkedThreadIds.has(thread.id))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * The Linear desktop app's link for a linear.app URL: same path on the `linear:` scheme. Returns
 * null for anything that is not a linear.app link.
 */
export function linearAppUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "linear.app") return null;
  return `linear:/${parsed.pathname}${parsed.search}${parsed.hash}`;
}
