import type { CreateThreadTabInput, ThreadId, ThreadTabHandoffInput } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { RemoteEnvironmentAuthorization } from "./authorization/service.ts";
import type { PreparedConnection } from "./connection/model.ts";
import { environmentEndpointUrl } from "./environment/endpoint.ts";
import { ManagedRelayDpopSigner } from "./relay/managedRelay.ts";
import { executeAuthenticatedEnvironmentHttpRequest } from "./state/environmentHttpAuth.ts";

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
