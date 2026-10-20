import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";

export { messageDraftsForThread } from "@t3tools/contracts";

export function createMessageDraftEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    // Every thread's drafts in the environment; small, so one stream serves the tray and sidebar.
    drafts: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:message-drafts:drafts",
      tag: WS_METHODS.messageDraftsSubscribe,
    }),
    save: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:message-drafts:save",
      tag: WS_METHODS.messageDraftsSave,
    }),
    take: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:message-drafts:take",
      tag: WS_METHODS.messageDraftsTake,
    }),
    remove: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:message-drafts:delete",
      tag: WS_METHODS.messageDraftsDelete,
    }),
    send: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:message-drafts:send",
      tag: WS_METHODS.messageDraftsSend,
    }),
  };
}
