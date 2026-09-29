import {
  type ComposerContextId,
  type LinearIssueContext,
  type LinearIssueContextRecord,
  WS_METHODS,
} from "@t3tools/contracts";
import { sanitizeComposerContextLabel } from "@t3tools/shared/composerContextReferences";
import { Atom } from "effect/unstable/reactivity";

import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";

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
    // Fetched once when an issue is attached; the result is snapshotted into the message.
    getIssue: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:linear:get-issue",
      tag: WS_METHODS.linearGetIssue,
    }),
  };
}

/**
 * The composer chip record for a fetched issue. The id is stable per issue, so attaching the
 * same issue twice in one draft points both chips at one payload.
 */
export function linearIssueContextRecord(issue: LinearIssueContext): LinearIssueContextRecord {
  return {
    version: 1,
    kind: "linear-issue",
    // Linear issue ids are UUIDs, which already fit the context id pattern.
    contextId: `linear-issue_${issue.id}` as ComposerContextId,
    label: sanitizeComposerContextLabel(issue.identifier, "linear-issue"),
    issueId: issue.id,
    identifier: issue.identifier,
    title: issue.title.slice(0, 2_048),
    url: issue.url,
    stateName: issue.stateName,
    markdown: issue.markdown,
  };
}
