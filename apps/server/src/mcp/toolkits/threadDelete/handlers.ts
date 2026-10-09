import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { dispatchFailure, newCommandId, readThread } from "../../threadAccess.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { ThreadDeleteToolkit } from "./tools.ts";

export const ThreadDeleteToolkitHandlersLive = McpToolAccess.toLayer(ThreadDeleteToolkit, {
  t3_thread_delete: McpToolAccess.writesThreads(
    (input) => [input.threadId],
    (input) =>
      Effect.gen(function* () {
        const { scope, threads, projection } = yield* readThread(input.threadId);
        // Only an agent access token acts as the user; a thread's agent archives instead.
        if (scope.client === undefined) {
          return yield* new OrchestratorMcpFailure({
            code: "capability_denied",
            message: "Only an agent access token can delete threads. Archive the thread instead.",
          });
        }
        // The same command the app sends, so running work and children end the same way.
        const result = yield* threads
          .dispatch({
            type: "thread.delete",
            commandId: yield* newCommandId(),
            threadId: projection.thread.id,
          })
          .pipe(Effect.mapError(dispatchFailure));
        return { sequence: result.sequence };
      }),
  ),
});
