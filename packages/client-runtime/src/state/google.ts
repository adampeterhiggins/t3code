import { type GoogleThreadLink, type ThreadId, WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";

export { googleFileContextRecord } from "@t3tools/source-control-definitions/integrationContextRecords";

export function createGoogleEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    connection: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:google:connection",
      tag: WS_METHODS.googleSubscribeState,
    }),
    startLogin: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:google:start-login",
      tag: WS_METHODS.googleStartLogin,
      concurrency: { mode: "singleFlight", key: ({ environmentId }) => environmentId },
    }),
    completeLogin: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:google:complete-login",
      tag: WS_METHODS.googleCompleteLogin,
    }),
    cancelLogin: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:google:cancel-login",
      tag: WS_METHODS.googleCancelLogin,
    }),
    disconnect: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:google:disconnect",
      tag: WS_METHODS.googleDisconnect,
    }),
    files: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:google:files",
      tag: WS_METHODS.googleSearchFiles,
      staleTimeMs: 30_000,
    }),
    // The calendars a search can read, for the picker's calendar filter.
    calendars: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:google:calendars",
      tag: WS_METHODS.googleListCalendars,
      staleTimeMs: 5 * 60_000,
    }),
    getFile: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:google:get-file",
      tag: WS_METHODS.googleGetFile,
    }),
    // The same read for a link's hover card, so hovering it again is instant.
    file: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:google:file",
      tag: WS_METHODS.googleGetFile,
      staleTimeMs: 5 * 60_000,
    }),
    // Every thread group's linked Google page in the environment.
    threadLinks: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:google:thread-links",
      tag: WS_METHODS.googleSubscribeThreadLinks,
    }),
    linkThread: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:google:link-thread",
      tag: WS_METHODS.googleLinkThread,
    }),
    unlinkThread: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:google:unlink-thread",
      tag: WS_METHODS.googleUnlinkThread,
    }),
  };
}
/** The Google page linked to the thread's tab group, if any. */
export function googleLinkForThread(
  links: ReadonlyArray<GoogleThreadLink> | null | undefined,
  threadId: ThreadId,
): GoogleThreadLink | null {
  return links?.find((link) => link.threadIds.includes(threadId)) ?? null;
}
