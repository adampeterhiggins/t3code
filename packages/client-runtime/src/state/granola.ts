import { type GranolaThreadLink, type ThreadId, WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";

export { granolaNoteContextRecord } from "@t3tools/shared/integrationContextRecords";

export function createGranolaEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    connection: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:granola:connection",
      tag: WS_METHODS.granolaSubscribeState,
    }),
    startLogin: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:granola:start-login",
      tag: WS_METHODS.granolaStartLogin,
      concurrency: { mode: "singleFlight", key: ({ environmentId }) => environmentId },
    }),
    cancelLogin: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:granola:cancel-login",
      tag: WS_METHODS.granolaCancelLogin,
    }),
    disconnect: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:granola:disconnect",
      tag: WS_METHODS.granolaDisconnect,
    }),
    notes: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:granola:notes",
      tag: WS_METHODS.granolaSearchNotes,
      staleTimeMs: 30_000,
    }),
    getNote: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:granola:get-note",
      tag: WS_METHODS.granolaGetNote,
    }),
    // A whole note, read once a picker row's hover preview opens.
    note: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:granola:note",
      tag: WS_METHODS.granolaGetNote,
      staleTimeMs: 5 * 60_000,
    }),
    // A note's title and meeting, for naming bare note links in messages.
    noteSummary: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:granola:note-summary",
      tag: WS_METHODS.granolaGetNoteSummary,
      staleTimeMs: 10 * 60_000,
    }),
    // Every thread group's linked Granola note in the environment.
    threadLinks: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:granola:thread-links",
      tag: WS_METHODS.granolaSubscribeThreadLinks,
    }),
    linkThread: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:granola:link-thread",
      tag: WS_METHODS.granolaLinkThread,
    }),
    unlinkThread: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:granola:unlink-thread",
      tag: WS_METHODS.granolaUnlinkThread,
    }),
  };
}

/** The Granola note linked to the thread's tab group, if any. */
export function granolaLinkForThread(
  links: ReadonlyArray<GranolaThreadLink> | null | undefined,
  threadId: ThreadId,
): GranolaThreadLink | null {
  return links?.find((link) => link.threadIds.includes(threadId)) ?? null;
}
