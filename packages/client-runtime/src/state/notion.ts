import { WS_METHODS } from "@t3tools/contracts";
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
  };
}
