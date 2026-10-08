import type {
  CreateThreadTabInput,
  EnvironmentId,
  ForkThreadTabInput,
  MessageId,
  OrchestrationV2ProjectedTurnItem,
  RunId,
  ThreadId,
  ThreadTabHandoffInput,
  ThreadTabMembership,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { RemoteEnvironmentAuthorization } from "./authorization/service.ts";
import type { PreparedConnection } from "./connection/model.ts";
import { environmentEndpointUrl } from "./environment/endpoint.ts";
import { ManagedRelayDpopSigner } from "./relay/managedRelay.ts";
import { executeAuthenticatedEnvironmentHttpRequest } from "./state/environmentHttpAuth.ts";

export const listThreadTabMemberships = Effect.fn("clientRuntime.threadTabs.memberships")(
  function* (prepared: PreparedConnection) {
    const signer = yield* Effect.serviceOption(ManagedRelayDpopSigner);
    const remoteAuthorization = yield* Effect.serviceOption(RemoteEnvironmentAuthorization);
    return yield* executeAuthenticatedEnvironmentHttpRequest({
      prepared,
      signer,
      remoteAuthorization,
      group: "threadTabs",
      method: "GET",
      url: (base) => environmentEndpointUrl(base, "/api/thread-tabs"),
      timeoutMs: 20_000,
      request: ({ client, headers }) => client.memberships({ headers }),
    });
  },
);

/**
 * Sidebar keys to hide, each mapped to the row that stands for its tab group: the first open
 * tab in membership order, so closing the first tab promotes the next one.
 */
export function hiddenTabThreadKeys<
  T extends {
    readonly id: ThreadId;
    readonly environmentId: EnvironmentId;
    readonly archivedAt: string | null;
  },
>(
  threads: ReadonlyArray<T>,
  membershipsByEnvironment: ReadonlyMap<EnvironmentId, ReadonlyArray<ThreadTabMembership>>,
): ReadonlyMap<string, string> {
  const shells = new Map(threads.map((thread) => [`${thread.environmentId}:${thread.id}`, thread]));
  const hidden = new Map<string, string>();
  for (const [environmentId, memberships] of membershipsByEnvironment) {
    const representatives = new Map<string, string>();
    for (const membership of memberships) {
      const key = `${environmentId}:${membership.threadId}`;
      if (shells.get(key)?.archivedAt !== null) continue;
      const representative = representatives.get(membership.groupId);
      if (representative === undefined) representatives.set(membership.groupId, key);
      else hidden.set(key, representative);
    }
  }
  return hidden;
}

/**
 * New shells must wait for their membership lookup before becoming standalone sidebar rows.
 * Previously classified rows stay visible while that lookup is in flight. A failed lookup
 * also classifies its captured shells, allowing ordinary threads on upstream servers through.
 */
export function hiddenSidebarTabThreadKeys<
  T extends {
    readonly id: ThreadId;
    readonly environmentId: EnvironmentId;
    readonly archivedAt: string | null;
  },
>(
  threads: ReadonlyArray<T>,
  membershipsByEnvironment: ReadonlyMap<EnvironmentId, ReadonlyArray<ThreadTabMembership>>,
  checkedThreadKeys: ReadonlySet<string>,
  loadingEnvironmentIds: ReadonlySet<EnvironmentId>,
): ReadonlyMap<string, string> {
  const hidden = new Map(hiddenTabThreadKeys(threads, membershipsByEnvironment));
  for (const thread of threads) {
    const key = `${thread.environmentId}:${thread.id}`;
    if (
      loadingEnvironmentIds.has(thread.environmentId) &&
      !checkedThreadKeys.has(key) &&
      !hidden.has(key)
    ) {
      // No group representative is known yet; keep routing to the thread itself.
      hidden.set(key, key);
    }
  }
  return hidden;
}

/**
 * The thread a sidebar row opens: for a tab group's row, whichever of its tabs was opened most
 * recently, so returning to the group lands on the tab left open. Other keys open themselves.
 */
export function threadTabGroupTarget(
  rowKey: string,
  hiddenTabThreads: ReadonlyMap<string, string>,
  openedAtByThreadKey: Readonly<Record<string, number>>,
): string {
  let target = rowKey;
  let targetOpenedAt = openedAtByThreadKey[rowKey] ?? Number.NEGATIVE_INFINITY;
  for (const [key, representative] of hiddenTabThreads) {
    if (representative !== rowKey) continue;
    const openedAt = openedAtByThreadKey[key];
    if (openedAt !== undefined && openedAt > targetOpenedAt) {
      target = key;
      targetOpenedAt = openedAt;
    }
  }
  return target;
}

/**
 * The thread a group's own sidebar row opens. A row whose group is already open keeps the tab
 * you're on. Coming from anywhere else, it opens the group's most recently opened tab.
 */
export function threadTabGroupHeaderTarget(
  rowKey: string,
  openThreadKey: string | null,
  tabGroups: ReadonlyMap<string, string>,
  foldedTabThreads: ReadonlyMap<string, string>,
  openedAtByThreadKey: Readonly<Record<string, number>>,
): string {
  if (openThreadKey !== null && (tabGroups.get(openThreadKey) ?? openThreadKey) === rowKey) {
    return openThreadKey;
  }
  return threadTabGroupTarget(rowKey, foldedTabThreads, openedAtByThreadKey);
}

export const listThreadTabs = Effect.fn("clientRuntime.threadTabs.list")(function* (
  prepared: PreparedConnection,
  threadId: ThreadId,
) {
  const signer = yield* Effect.serviceOption(ManagedRelayDpopSigner);
  const remoteAuthorization = yield* Effect.serviceOption(RemoteEnvironmentAuthorization);
  return yield* executeAuthenticatedEnvironmentHttpRequest({
    prepared,
    signer,
    remoteAuthorization,
    group: "threadTabs",
    method: "GET",
    url: (base) => environmentEndpointUrl(base, `/api/thread-tabs/${threadId}`),
    timeoutMs: 20_000,
    request: ({ client, headers }) => client.list({ params: { threadId }, headers }),
  });
});

export const createThreadTab = Effect.fn("clientRuntime.threadTabs.create")(function* (
  prepared: PreparedConnection,
  sourceThreadId: ThreadId,
  input: CreateThreadTabInput,
) {
  const signer = yield* Effect.serviceOption(ManagedRelayDpopSigner);
  const remoteAuthorization = yield* Effect.serviceOption(RemoteEnvironmentAuthorization);
  return yield* executeAuthenticatedEnvironmentHttpRequest({
    prepared,
    signer,
    remoteAuthorization,
    group: "threadTabs",
    method: "POST",
    url: (base) => environmentEndpointUrl(base, `/api/thread-tabs/${sourceThreadId}`),
    timeoutMs: 20_000,
    request: ({ client, headers }) =>
      client.create({ params: { threadId: sourceThreadId }, payload: input, headers }),
  });
});

/** Forks a completed response natively into a new tab of `threadId`'s group. */
export const forkThreadTabFromRun = Effect.fn("clientRuntime.threadTabs.fork")(function* (
  prepared: PreparedConnection,
  threadId: ThreadId,
  input: ForkThreadTabInput,
) {
  const signer = yield* Effect.serviceOption(ManagedRelayDpopSigner);
  const remoteAuthorization = yield* Effect.serviceOption(RemoteEnvironmentAuthorization);
  return yield* executeAuthenticatedEnvironmentHttpRequest({
    prepared,
    signer,
    remoteAuthorization,
    group: "threadTabs",
    method: "POST",
    url: (base) => environmentEndpointUrl(base, `/api/thread-tabs/${threadId}/fork`),
    timeoutMs: 20_000,
    request: ({ client, headers }) =>
      client.fork({ params: { threadId }, payload: input, headers }),
  });
});

/** Where a native fork starts: the run of a completed response, in the thread that owns it. */
export interface ThreadForkPoint {
  readonly sourceThreadId: ThreadId;
  readonly runId: RunId;
}

const forkPointOf = (entry: OrchestrationV2ProjectedTurnItem): ThreadForkPoint | null =>
  entry.item.type === "assistant_message" &&
  entry.item.status === "completed" &&
  entry.item.runId !== null
    ? { sourceThreadId: entry.sourceThreadId, runId: entry.item.runId }
    : null;

/**
 * The fork point for carrying a whole chat into a new tab: its latest completed response, which
 * may be inherited from an earlier fork. Null when no response has finished yet.
 */
export function latestThreadForkPoint(
  items: ReadonlyArray<OrchestrationV2ProjectedTurnItem>,
): ThreadForkPoint | null {
  for (let index = items.length - 1; index >= 0; index--) {
    const point = forkPointOf(items[index]!);
    if (point) return point;
  }
  return null;
}

/**
 * The fork point for re-asking a user message in a new tab: the last completed response before
 * it. Null when the message is not loaded or nothing finished before it.
 */
export function threadForkPointBeforeMessage(
  items: ReadonlyArray<OrchestrationV2ProjectedTurnItem>,
  messageId: MessageId,
): ThreadForkPoint | null {
  const index = items.findIndex(
    (entry) => entry.item.type === "user_message" && entry.item.messageId === messageId,
  );
  return index < 0 ? null : latestThreadForkPoint(items.slice(0, index));
}

export const prepareThreadTabHandoff = Effect.fn("clientRuntime.threadTabs.handoff")(function* (
  prepared: PreparedConnection,
  threadId: ThreadId,
  input: ThreadTabHandoffInput,
) {
  const signer = yield* Effect.serviceOption(ManagedRelayDpopSigner);
  const remoteAuthorization = yield* Effect.serviceOption(RemoteEnvironmentAuthorization);
  return yield* executeAuthenticatedEnvironmentHttpRequest({
    prepared,
    signer,
    remoteAuthorization,
    group: "threadTabs",
    method: "POST",
    url: (base) => environmentEndpointUrl(base, `/api/thread-tabs/${threadId}/handoff`),
    timeoutMs: 20_000,
    request: ({ client, headers }) =>
      client.handoff({ params: { threadId }, payload: input, headers }),
  });
});
