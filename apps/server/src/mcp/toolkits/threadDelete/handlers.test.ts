import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
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
import * as McpToolAccess from "../../McpToolAccess.ts";
import { ThreadDeleteToolkitHandlersLive } from "./handlers.ts";
import { ThreadDeleteToolkit } from "./tools.ts";

const threadId = ThreadId.make("target-thread");
const deletedId = ThreadId.make("deleted-thread");

const clientScope: McpInvocationContext.McpInvocationScope = {
  environmentId: EnvironmentId.make("environment"),
  requestNamespace: "agent-access:session-1",
  thread: undefined,
  client: { sessionId: "session-1", label: "EOD brief", access: "full-access" },
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

const remove = (scope: McpInvocationContext.McpInvocationScope, target: ThreadId = threadId) =>
  Effect.gen(function* () {
    const dispatched: Array<OrchestrationV2Command> = [];
    const shell = (id: ThreadId) =>
      ({
        id,
        projectId: ProjectId.make("project"),
        runtimeMode: "full-access",
        interactionMode: "default",
        activeRunId: "run",
        providerInstanceId: "codex",
        archivedAt: null,
        deletedAt: id === deletedId ? "2026-10-01T00:00:00.000Z" : null,
      }) as unknown as OrchestrationV2ThreadShell;
    const dependencies = Layer.mergeAll(
      NodeCrypto.layer,
      Layer.succeed(McpInvocationContext.McpInvocationContext, scope),
      Layer.mock(ThreadManagement.ThreadManagementService)({
        getThreadShell: (id) => Effect.succeed(shell(id)),
        getProjectThreadRecords: ({ threadId: id }) =>
          Effect.succeed({ thread: shell(id) } as never),
        dispatch: (command) => {
          dispatched.push(command as OrchestrationV2Command);
          return Effect.succeed({ sequence: 7, storedEvents: [] } as never);
        },
      }),
    );
    const toolkit = yield* ThreadDeleteToolkit.pipe(
      Effect.provide(
        McpToolAccess.HandlersLayer.layer(ThreadDeleteToolkitHandlersLive).pipe(
          Layer.provide(dependencies),
        ),
      ),
    );
    const results = yield* toolkit
      .handle("t3_thread_delete", { threadId: target })
      .pipe(Stream.unwrap, Stream.runCollect, Effect.provide(dependencies));
    return { result: results.at(-1)?.result, dispatched };
  });

it.effect("an agent access token deletes a thread with the app's delete command", () =>
  Effect.gen(function* () {
    const { result, dispatched } = yield* remove(clientScope);
    expect(result).toEqual({ sequence: 7 });
    expect(dispatched).toMatchObject([{ type: "thread.delete", threadId }]);
  }),
);

it.effect("an agent inside a thread cannot delete threads", () =>
  Effect.gen(function* () {
    const { result, dispatched } = yield* remove(threadScope);
    expect(result).toMatchObject({ code: "capability_denied" });
    expect(dispatched).toEqual([]);
  }),
);

it.effect("a read-only client and an already deleted thread are refused", () =>
  Effect.gen(function* () {
    const readOnly = yield* remove({
      ...clientScope,
      client: { sessionId: "session-1", label: "Reader", access: "read-only" },
    });
    expect(readOnly.result).toMatchObject({ code: "capability_denied" });
    const gone = yield* remove(clientScope, deletedId);
    expect(gone.result).toMatchObject({ code: "thread_not_found" });
    expect([...readOnly.dispatched, ...gone.dispatched]).toEqual([]);
  }),
);
