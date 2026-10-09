import { type NotionThreadLink, type ThreadId, WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";

export { notionPageContextRecord } from "@t3tools/shared/integrationContextRecords";

export function createNotionEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    connection: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:notion:connection",
      tag: WS_METHODS.notionSubscribeState,
    }),
    startLogin: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:notion:start-login",
      tag: WS_METHODS.notionStartLogin,
      concurrency: { mode: "singleFlight", key: ({ environmentId }) => environmentId },
    }),
    completeLogin: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:notion:complete-login",
      tag: WS_METHODS.notionCompleteLogin,
    }),
    cancelLogin: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:notion:cancel-login",
      tag: WS_METHODS.notionCancelLogin,
    }),
    disconnect: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:notion:disconnect",
      tag: WS_METHODS.notionDisconnect,
    }),
    pages: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:notion:pages",
      tag: WS_METHODS.notionSearchPages,
      staleTimeMs: 30_000,
    }),
    getPage: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:notion:get-page",
      tag: WS_METHODS.notionGetPage,
    }),
    // Every thread group's linked Notion page in the environment.
    threadLinks: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:notion:thread-links",
      tag: WS_METHODS.notionSubscribeThreadLinks,
    }),
    linkThread: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:notion:link-thread",
      tag: WS_METHODS.notionLinkThread,
    }),
    unlinkThread: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:notion:unlink-thread",
      tag: WS_METHODS.notionUnlinkThread,
    }),
  };
}
/** The Notion page linked to the thread's tab group, if any. */
export function notionLinkForThread(
  links: ReadonlyArray<NotionThreadLink> | null | undefined,
  threadId: ThreadId,
): NotionThreadLink | null {
  return links?.find((link) => link.threadIds.includes(threadId)) ?? null;
}
