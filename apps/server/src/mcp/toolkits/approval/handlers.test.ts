import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  RuntimeRequestId,
  ThreadId,
  type OrchestrationV2Command,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { ApprovalToolkitHandlersLive } from "./handlers.ts";
import { ApprovalToolkit } from "./tools.ts";

const threadId = ThreadId.make("target-thread");
const projectId = ProjectId.make("project");
const pendingId = RuntimeRequestId.make("request-pending");
const questionId = RuntimeRequestId.make("request-question");
const resolvedId = RuntimeRequestId.make("request-resolved");

const clientScope: McpInvocationContext.McpInvocationScope = {
  environmentId: EnvironmentId.make("environment"),
  requestNamespace: "agent-access:session-1",
  thread: undefined,
  client: { sessionId: "session-1", label: "EOD brief", runtimeModeCeiling: "full-access" },
  issuedAt: 0,
  capabilities: new Set(["orchestration"]),
};

const threadScope: McpInvocationContext.McpInvocationScope = {
  ...clientScope,
  thread: {
    threadId: ThreadId.make("caller-thread"),
    providerSessionId: "session",
    providerInstanceId: ProviderInstanceId.make("codex"),
  },
  client: undefined,
};

const harness = (scope: McpInvocationContext.McpInvocationScope) => {
  const dispatched: Array<OrchestrationV2Command> = [];
  const target = {
    id: threadId,
    projectId,
    runtimeMode: "full-access",
    interactionMode: "default",
    archivedAt: null,
    deletedAt: null,
  } as OrchestrationV2ThreadShell;
  const request = (id: RuntimeRequestId, kind: string, status: string) => ({ id, kind, status });
  const dependencies = Layer.mergeAll(
    NodeCrypto.layer,
    Layer.succeed(McpInvocationContext.McpInvocationContext, scope),
    Layer.mock(ThreadManagement.ThreadManagementService)({
      getThreadShell: (id) =>
        Effect.succeed(
          id === threadId
            ? target
            : ({ ...target, id, activeRunId: "run", providerInstanceId: "codex" } as never),
        ),
      getProjectThreadRecords: () =>
        Effect.succeed({
          thread: target,
          runtimeRequests: [
            request(pendingId, "command", "pending"),
            request(questionId, "user_input", "pending"),
            request(resolvedId, "file-change", "resolved"),
          ],
        } as never),
      getThreadRecords: () =>
        Effect.succeed({
          thread: target,
          turnItems: [
            {
              type: "approval_request",
              requestId: pendingId,
              requestKind: "command",
              options: [
                { decision: "accept", label: "Allow" },
                { decision: "decline", label: "Deny" },
              ],
            },
          ],
        } as never),
      dispatch: (command) => {
        dispatched.push(command as OrchestrationV2Command);
        return Effect.succeed({ sequence: 7, storedEvents: [] } as never);
      },
    }),
  );
  return { dispatched, dependencies };
};

const respond = (
  scope: McpInvocationContext.McpInvocationScope,
  params: { requestId: RuntimeRequestId; decision: "accept" | "acceptAlways" | "decline" },
) =>
  Effect.gen(function* () {
    const { dispatched, dependencies } = harness(scope);
    const toolkit = yield* ApprovalToolkit.pipe(
      Effect.provide(ApprovalToolkitHandlersLive.pipe(Layer.provide(dependencies))),
    );
    const results = yield* toolkit
      .handle("t3_approval_respond", { threadId, ...params })
      .pipe(Stream.unwrap, Stream.runCollect, Effect.provide(dependencies));
    return { result: results.at(-1)?.result, dispatched };
  });

it.effect("an agent access token answers another thread's approval", () =>
  Effect.gen(function* () {
    const { result, dispatched } = yield* respond(clientScope, {
      requestId: pendingId,
      decision: "accept",
    });
    expect(result).toEqual({ sequence: 7 });
    expect(dispatched).toMatchObject([
      { type: "runtime-request.respond", threadId, requestId: pendingId, decision: "accept" },
    ]);
  }),
);

it.effect("refuses questions, answered requests, and decisions the request does not offer", () =>
  Effect.gen(function* () {
    const question = yield* respond(clientScope, { requestId: questionId, decision: "accept" });
    expect(question.result).toMatchObject({ code: "invalid_request" });
    const resolved = yield* respond(clientScope, { requestId: resolvedId, decision: "accept" });
    expect(resolved.result).toMatchObject({ code: "invalid_request" });
    const unoffered = yield* respond(clientScope, {
      requestId: pendingId,
      decision: "acceptAlways",
    });
    expect(unoffered.result).toMatchObject({ code: "invalid_request" });
    expect([...question.dispatched, ...resolved.dispatched, ...unoffered.dispatched]).toEqual([]);
  }),
);

it.effect("an agent inside a thread cannot answer approvals", () =>
  Effect.gen(function* () {
    const { result, dispatched } = yield* respond(threadScope, {
      requestId: pendingId,
      decision: "accept",
    });
    expect(result).toMatchObject({ code: "capability_denied" });
    expect(dispatched).toEqual([]);
  }),
);
