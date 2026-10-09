import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";

export { slackThreadContextRecord } from "@t3tools/shared/integrationContextRecords";

export function createSlackEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    // The environment's Slack connection, including an in-progress login.
    connection: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:slack:connection",
      tag: WS_METHODS.slackSubscribeState,
    }),
    startLogin: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:slack:start-login",
      tag: WS_METHODS.slackStartLogin,
      concurrency: { mode: "singleFlight", key: ({ environmentId }) => environmentId },
    }),
    completeLogin: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:slack:complete-login",
      tag: WS_METHODS.slackCompleteLogin,
    }),
    cancelLogin: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:slack:cancel-login",
      tag: WS_METHODS.slackCancelLogin,
    }),
    disconnect: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:slack:disconnect",
      tag: WS_METHODS.slackDisconnect,
    }),
    // Keyed by query text. Callers debounce typing: Slack search is rate-limited per minute.
    messages: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:slack:messages",
      tag: WS_METHODS.slackSearchMessages,
      staleTimeMs: 30_000,
    }),
    // Fetched once when a message is attached; the result is snapshotted into the message.
    getThread: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:slack:get-thread",
      tag: WS_METHODS.slackGetThread,
    }),
    // Keyed by link. The server keeps each preview, so one read per session is enough.
    linkPreview: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:slack:link-preview",
      tag: WS_METHODS.slackGetLinkPreview,
      staleTimeMs: Number.POSITIVE_INFINITY,
    }),
  };
}
