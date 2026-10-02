import {
  type ComposerContextId,
  type NotionPageContext,
  type NotionPageContextRecord,
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
export function notionPageContextRecord(page: NotionPageContext): NotionPageContextRecord {
  return {
    version: 1,
    kind: "notion-page",
    contextId: `notion-page_${page.id}` as ComposerContextId,
    label: sanitizeComposerContextLabel(page.title, "notion-page"),
    pageId: page.id,
    title: page.title.slice(0, 2048),
    url: page.url.slice(0, 2048),
    markdown: page.markdown,
  };
}
