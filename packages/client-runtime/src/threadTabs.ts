import type {
  CreateThreadTabInput,
  EnvironmentId,
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
    for (const membership of memberships) {
      if (membership.threadId === membership.groupId) continue;
      const rootKey = `${environmentId}:${membership.groupId}`;
      if (shells.get(rootKey)?.archivedAt === null) {
        hidden.set(`${environmentId}:${membership.threadId}`, rootKey);
      }
    }
  }
  return hidden;
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
