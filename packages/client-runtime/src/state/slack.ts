import {
  type ComposerContextId,
  type SlackThreadContext,
  type SlackThreadContextRecord,
  WS_METHODS,
} from "@t3tools/contracts";
import { sanitizeComposerContextLabel } from "@t3tools/shared/composerContextReferences";
import { Atom } from "effect/reactivity";

import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";

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
  };
}

/**
 * The composer chip record for a fetched thread. The id is stable per message and scope, so
 * attaching the same thread twice in one draft points both chips at one payload.
 */
export function slackThreadContextRecord(thread: SlackThreadContext): SlackThreadContextRecord {
  const id = `${thread.teamId}_${thread.channelId}_${thread.ts.replace(".", "-")}`;
  return {
    version: 1,
    kind: "slack-thread",
    contextId: `slack-${thread.scope}_${id}`.slice(0, 128) as ComposerContextId,
    label: sanitizeComposerContextLabel(
      `${thread.channelLabel} · ${thread.authorName}`,
      "slack-thread",
    ),
    teamId: thread.teamId,
    channelId: thread.channelId,
    channelLabel: thread.channelLabel.slice(0, 2_048),
    ts: thread.ts,
    threadTs: thread.threadTs,
    url: thread.url,
    authorName: thread.authorName.slice(0, 2_048),
    title: thread.title.slice(0, 2_048),
    replyCount: thread.replyCount,
    scope: thread.scope,
    markdown: thread.markdown,
  };
}
