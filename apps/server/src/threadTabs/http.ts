import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentHttpApi,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";

import {
  annotateEnvironmentRequest,
  failEnvironmentInternal,
  failEnvironmentInvalidRequest,
  failEnvironmentNotFound,
  requireEnvironmentScope,
} from "../auth/http.ts";
import * as ThreadTabs from "./ThreadTabs.ts";

const mapThreadTabsError = (error: ThreadTabs.ThreadTabsError) =>
  Effect.gen(function* () {
    switch (error.reason) {
      case "thread_not_found":
        return yield* failEnvironmentNotFound("thread_not_found");
      case "invalid_request":
        return yield* failEnvironmentInvalidRequest("invalid_command");
      case "dispatch_failed":
      case "internal":
        return yield* failEnvironmentInternal("internal_error", error);
    }
  });

export const layer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "threadTabs",
  Effect.fnUntraced(function* (handlers) {
    const tabs = yield* ThreadTabs.ThreadTabs;
    return handlers
      .handle(
        "memberships",
        Effect.fn("environment.threadTabs.memberships")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          return yield* tabs.memberships.pipe(Effect.catch(mapThreadTabsError));
        }),
      )
      .handle(
        "list",
        Effect.fn("environment.threadTabs.list")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          return yield* tabs.group(args.params.threadId).pipe(Effect.catch(mapThreadTabsError));
        }),
      )
      .handle(
        "create",
        Effect.fn("environment.threadTabs.create")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* tabs
            .create(args.params.threadId, args.payload)
            .pipe(Effect.catch(mapThreadTabsError));
        }),
      )
      .handle(
        "setName",
        Effect.fn("environment.threadTabs.setName")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* tabs
            .setName(args.params.threadId, args.payload.name)
            .pipe(Effect.catch(mapThreadTabsError));
        }),
      )
      .handle(
        "fork",
        Effect.fn("environment.threadTabs.fork")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* tabs
            .fork(args.params.threadId, args.payload)
            .pipe(Effect.catch(mapThreadTabsError));
        }),
      )
      .handle(
        "handoff",
        Effect.fn("environment.threadTabs.handoff")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* tabs
            .handoff(args.params.threadId, args.payload)
            .pipe(Effect.catch(mapThreadTabsError));
        }),
      );
  }),
).pipe(Layer.provide(ThreadTabs.layer));
