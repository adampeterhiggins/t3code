import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { newCommandId, readThread, unavailable } from "../../threadAccess.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { ApprovalToolkit } from "./tools.ts";

const invalid = (message: string) =>
  new OrchestratorMcpFailure({ code: "invalid_request", message });

export const ApprovalToolkitHandlersLive = McpToolAccess.toLayer(ApprovalToolkit, {
  t3_approval_respond: McpToolAccess.writesThreads(
    (input) => [input.threadId],
    (input) =>
      Effect.gen(function* () {
        const context = yield* readThread(input.threadId, ["runtimeRequests"]);
        // Only an agent access token acts as the user; a thread's agent leaves approvals to the user.
        if (context.scope.client === undefined) {
          return yield* new OrchestratorMcpFailure({
            code: "capability_denied",
            message: "Only an agent access token can answer another thread's approvals.",
          });
        }
        const request = context.projection.runtimeRequests.find(
          (candidate) => candidate.id === input.requestId,
        );
        if (
          request === undefined ||
          request.kind === "user_input" ||
          request.kind === "auth_refresh" ||
          request.kind === "dynamic_tool_call"
        ) {
          return yield* invalid("The approval request was not found on this thread.");
        }
        if (request.status !== "pending") {
          return yield* invalid(`The approval request is already ${request.status}.`);
        }
        const { turnItems } = yield* context.threads
          .getThreadRecords(input.threadId, ["turnItems"], { turnItemTypes: ["approval_request"] })
          .pipe(Effect.mapError(unavailable));
        const item = turnItems.find(
          (candidate) =>
            candidate.type === "approval_request" && candidate.requestId === input.requestId,
        );
        const options = item?.type === "approval_request" ? (item.options ?? []) : [];
        if (options.length > 0 && !options.some((option) => option.decision === input.decision)) {
          return yield* invalid(
            `This request offers ${options.map((option) => option.decision).join(", ")}.`,
          );
        }
        const result = yield* context.threads
          .dispatch({
            type: "runtime-request.respond",
            commandId: yield* newCommandId(),
            threadId: input.threadId,
            requestId: input.requestId,
            decision: input.decision,
          })
          .pipe(Effect.mapError(unavailable));
        return { sequence: result.sequence };
      }),
  ),
});
