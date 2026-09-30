import type { SetPullRequestWatchInput, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { RemoteEnvironmentAuthorization } from "./authorization/service.ts";
import type { PreparedConnection } from "./connection/model.ts";
import { environmentEndpointUrl } from "./environment/endpoint.ts";
import { ManagedRelayDpopSigner } from "./relay/managedRelay.ts";
import { executeAuthenticatedEnvironmentHttpRequest } from "./state/environmentHttpAuth.ts";

export const listPullRequestWatches = Effect.fn("clientRuntime.pullRequestWatches.list")(function* (
  prepared: PreparedConnection,
  threadId: ThreadId,
) {
  const signer = yield* Effect.serviceOption(ManagedRelayDpopSigner);
  const remoteAuthorization = yield* Effect.serviceOption(RemoteEnvironmentAuthorization);
  return yield* executeAuthenticatedEnvironmentHttpRequest({
    prepared,
    signer,
    remoteAuthorization,
    group: "pullRequestWatches",
    method: "GET",
    url: (base) => environmentEndpointUrl(base, `/api/pull-request-watches/${threadId}`),
    timeoutMs: 20_000,
    request: ({ client, headers }) => client.list({ params: { threadId }, headers }),
  });
});

export const setPullRequestWatch = Effect.fn("clientRuntime.pullRequestWatches.set")(function* (
  prepared: PreparedConnection,
  threadId: ThreadId,
  input: SetPullRequestWatchInput,
) {
  const signer = yield* Effect.serviceOption(ManagedRelayDpopSigner);
  const remoteAuthorization = yield* Effect.serviceOption(RemoteEnvironmentAuthorization);
  return yield* executeAuthenticatedEnvironmentHttpRequest({
    prepared,
    signer,
    remoteAuthorization,
    group: "pullRequestWatches",
    method: "POST",
    url: (base) => environmentEndpointUrl(base, `/api/pull-request-watches/${threadId}`),
    timeoutMs: 20_000,
    request: ({ client, headers }) => client.set({ params: { threadId }, payload: input, headers }),
  });
});
