import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentHttpApi,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import {
  annotateEnvironmentRequest,
  failEnvironmentInvalidRequest,
  failEnvironmentNotFound,
  requireEnvironmentScope,
} from "../auth/http.ts";

/**
 * Chat tabs are not yet ported to orchestration V2. Until they are, the API
 * reports no tab groups and refuses to create or hand off tabs, so clients
 * fall back to plain threads. `fork_thread_tabs` rows are left untouched.
 */
export const threadTabsHttpApiLayer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "threadTabs",
  Effect.fnUntraced(function* (handlers) {
    return handlers
      .handle(
        "memberships",
        Effect.fn("environment.threadTabs.memberships")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          return [];
        }),
      )
      .handle(
        "list",
        Effect.fn("environment.threadTabs.list")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          return yield* failEnvironmentNotFound("thread_not_found");
        }),
      )
      .handle(
        "create",
        Effect.fn("environment.threadTabs.create")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* failEnvironmentInvalidRequest("invalid_command");
        }),
      )
      .handle(
        "handoff",
        Effect.fn("environment.threadTabs.handoff")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* failEnvironmentInvalidRequest("invalid_command");
        }),
      );
  }),
);
