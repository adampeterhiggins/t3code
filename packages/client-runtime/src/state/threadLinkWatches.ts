import {
  type ThreadId,
  type ThreadLinkKind,
  type ThreadLinkWatch,
  WS_METHODS,
} from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";

import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";

export function createThreadLinkWatchEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    // Every thread's link watches in the environment. Older servers have none.
    watches: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:thread-link-watches",
      tag: WS_METHODS.threadLinkWatchesSubscribe,
    }),
    setWatching: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:thread-link-watches:set",
      tag: WS_METHODS.threadLinkWatchSet,
    }),
  };
}

/** The thread's watch of its link of `kind`, if it has one. */
export function threadLinkWatchFor(
  watches: ReadonlyArray<ThreadLinkWatch> | null | undefined,
  threadId: ThreadId,
  kind: ThreadLinkKind,
): ThreadLinkWatch | null {
  return watches?.find((watch) => watch.threadId === threadId && watch.kind === kind) ?? null;
}
