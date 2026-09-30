import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentHttpApi,
} from "@t3tools/contracts";
import {
  threadPullRequestKeysEqual,
  visibleThreadPullRequests,
} from "@t3tools/shared/threadPullRequests";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import {
  annotateEnvironmentRequest,
  failEnvironmentInternal,
  failEnvironmentInvalidRequest,
  failEnvironmentNotFound,
  requireEnvironmentScope,
} from "../auth/http.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { PullRequestWatchReactor } from "./reactor.ts";
import {
  deletePullRequestWatches,
  listPullRequestWatches,
  upsertPullRequestWatch,
} from "./store.ts";

export const pullRequestWatchesHttpApiLayer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "pullRequestWatches",
  Effect.fnUntraced(function* (handlers) {
    const snapshots = yield* ProjectionSnapshotQuery;
    const reactor = yield* PullRequestWatchReactor;

    return handlers
      .handle(
        "list",
        Effect.fn("environment.pullRequestWatches.list")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          return yield* listPullRequestWatches(args.params.threadId).pipe(
            Effect.catch((cause) => failEnvironmentInternal("internal_error", cause)),
          );
        }),
      )
      .handle(
        "set",
        Effect.fn("environment.pullRequestWatches.set")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          const { threadId } = args.params;
          const { action, ...key } = args.payload;
          const shell = yield* snapshots
            .getThreadShellById(threadId)
            .pipe(Effect.catch((cause) => failEnvironmentInternal("internal_error", cause)));
          if (Option.isNone(shell)) return yield* failEnvironmentNotFound("thread_not_found");
          const linked = visibleThreadPullRequests(shell.value.pullRequests).some((link) =>
            threadPullRequestKeysEqual(link, key),
          );
          if (!linked && action !== "stop") {
            return yield* failEnvironmentInvalidRequest("invalid_command");
          }

          const updatedAt = DateTime.formatIso(yield* DateTime.now);
          yield* Effect.gen(function* () {
            const existing = (yield* listPullRequestWatches(threadId)).find((watch) =>
              threadPullRequestKeysEqual(watch, key),
            );
            switch (action) {
              case "watch":
                if (existing === undefined) {
                  yield* upsertPullRequestWatch({
                    threadId,
                    ...key,
                    status: "active",
                    attemptsUsed: 0,
                    handled: [],
                    updatedAt,
                  });
                }
                return;
              case "pause":
                if (existing !== undefined) {
                  yield* upsertPullRequestWatch({ ...existing, status: "paused", updatedAt });
                }
                return;
              case "resume":
                // A fresh budget, so resuming is also how a spent watch is allowed to try again.
                if (existing !== undefined) {
                  yield* upsertPullRequestWatch({
                    ...existing,
                    status: "active",
                    attemptsUsed: 0,
                    updatedAt,
                  });
                }
                return;
              case "stop":
                yield* deletePullRequestWatches(threadId, key);
                return;
            }
          }).pipe(Effect.catch((cause) => failEnvironmentInternal("internal_error", cause)));

          yield* reactor.evaluate(threadId);
          return yield* listPullRequestWatches(threadId).pipe(
            Effect.catch((cause) => failEnvironmentInternal("internal_error", cause)),
          );
        }),
      );
  }),
);
