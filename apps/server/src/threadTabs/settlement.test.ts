import {
  CommandId,
  EventId,
  ProjectId,
  ProviderInstanceId,
  RuntimeRequestId,
  ThreadId,
  type OrchestrationV2ServerCommand,
  type OrchestrationV2StoredEvent,
  type OrchestrationV2ThreadShell,
  type ThreadPullRequestLink,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import { OrchestrationEventStore } from "../persistence/OrchestrationEventStore.ts";
import { ensureThreadTabsSchema } from "./schema.ts";
import * as ThreadTabSettlementReactor from "./settlement.ts";

const NOW = DateTime.makeUnsafe("2026-10-05T12:00:00.000Z");
const NOW_ISO = DateTime.formatIso(NOW);

function makeThread(
  id: string,
  settledOverride: OrchestrationV2ThreadShell["settledOverride"],
  overrides: Partial<OrchestrationV2ThreadShell> = {},
): OrchestrationV2ThreadShell {
  return {
    id: ThreadId.make(id),
    projectId: ProjectId.make("project"),
    title: id,
    providerInstanceId: ProviderInstanceId.make("codex"),
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    pullRequests: [],
    lineage: { rootThreadId: ThreadId.make(id), parentThreadId: null, relationshipToParent: null },
    forkedFrom: null,
    createdBy: "user",
    creationSource: "web",
    activeProviderThreadId: null,
    latestRunId: null,
    activeRunId: null,
    activityRunStatus: null,
    status: "idle",
    pendingRuntimeRequest: null,
    latestVisibleMessage: null,
    latestUserMessageAt: null,
    hasActionableProposedPlan: false,
    pendingBackgroundTasks: [],
    providerInstanceHistory: [],
    itemCount: 0,
    visibleItemCount: 0,
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
    settledOverride,
    settledAt: settledOverride === "settled" ? NOW : null,
    deletedAt: null,
    ...overrides,
  };
}

/**
 * The reactor reads only an event's type, thread, and command id, so the fixtures leave the
 * rest of each domain event out.
 */
function stored(
  type: "run.created" | "thread.unsettled" | "thread.settled",
  threadId: string,
  commandId: string | null = null,
): OrchestrationV2StoredEvent {
  return {
    sequence: 1,
    commandId: commandId === null ? null : CommandId.make(commandId),
    event: {
      id: EventId.make(`event-${type}-${threadId}`),
      type,
      threadId: ThreadId.make(threadId),
      occurredAt: NOW,
    } as unknown as OrchestrationV2StoredEvent["event"],
  };
}

const openPullRequest: ThreadPullRequestLink = {
  host: "github.com",
  repository: "owner/repo",
  number: 1,
  url: "https://github.com/owner/repo/pull/1",
  source: "agent",
  linkedAt: NOW_ISO,
  snapshot: {
    state: "open",
    title: "Open work",
    headBranch: "feature",
    baseBranch: "main",
    isDraft: false,
    updatedAt: NOW_ISO,
    syncedAt: NOW_ISO,
  },
  stack: null,
};

/**
 * Streams events for a group of every thread except `standalone`, then asserts the reactor
 * dispatches exactly the expected `[type, threadId]` commands, in any order.
 */
const expectDispatches = (
  threads: ReadonlyArray<OrchestrationV2ThreadShell>,
  events: ReadonlyArray<OrchestrationV2StoredEvent>,
  expected: ReadonlyArray<readonly [string, string]>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const storedEvents = yield* Queue.unbounded<OrchestrationV2StoredEvent>();
      const dispatched = yield* Queue.unbounded<OrchestrationV2ServerCommand>();

      const dependencies = Layer.mergeAll(
        Layer.mock(Orchestrator.OrchestratorV2)({
          getThreadShell: (threadId) =>
            Effect.succeed(threads.find((thread) => thread.id === threadId) ?? null),
          dispatch: (command) =>
            Queue.offer(dispatched, command).pipe(Effect.as({ sequence: 1, storedEvents: [] })),
          streamStoredEventsFrom: () => Stream.fromQueue(storedEvents),
        }),
        Layer.mock(OrchestrationEventStore)({
          latestAgentSequence: () => Effect.succeed(0),
        }),
        NodeCrypto.layer,
      );

      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* ensureThreadTabsSchema();
        yield* Effect.forEach(
          threads.filter((thread) => thread.id !== "standalone"),
          (thread, position) =>
            sql`
              INSERT INTO fork_thread_tabs (thread_id, group_id, position, created_at)
              VALUES (${thread.id}, 'primary', ${position}, ${NOW_ISO})
            `,
          { discard: true },
        );

        const reactor = yield* ThreadTabSettlementReactor.ThreadTabSettlementReactor;
        yield* reactor.start();
        yield* Queue.offerAll(storedEvents, events);
        const commands = yield* Effect.forEach(expected, () => Queue.take(dispatched));
        yield* reactor.drain;
        assert.deepStrictEqual(
          commands
            .map((command) =>
              command.type === "thread.settle" || command.type === "thread.unsettle"
                ? [command.type, command.threadId]
                : [command.type],
            )
            .sort(),
          [...expected].map((pair) => [...pair]).sort(),
        );
        assert.strictEqual(yield* Queue.size(dispatched), 0);
      }).pipe(
        Effect.provide(ThreadTabSettlementReactor.layer.pipe(Layer.provideMerge(dependencies))),
      );
    }),
  ).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" })));

it.effect("a new run or unsettle in any tab wakes the settled tabs of its group", () =>
  Effect.gen(function* () {
    const threads = [
      makeThread("primary", "settled"),
      makeThread("sent-tab", null),
      makeThread("pinned-tab", "active"),
      makeThread("settled-tab", "settled"),
      makeThread("standalone", "settled"),
    ];
    const woken = [
      ["thread.unsettle", "primary"],
      ["thread.unsettle", "settled-tab"],
    ] as const;
    yield* expectDispatches(
      threads,
      [stored("run.created", "standalone"), stored("run.created", "sent-tab")],
      woken,
    );
    yield* expectDispatches(
      threads,
      [stored("thread.unsettled", "standalone"), stored("thread.unsettled", "sent-tab")],
      woken,
    );
  }),
);

it.effect("settling any tab settles the rest of its group", () =>
  expectDispatches(
    [
      makeThread("primary", "active"),
      makeThread("neutral-tab", null),
      makeThread("settled-tab", "settled"),
      makeThread("merged-tab", "settled"),
      makeThread("standalone", null),
    ],
    [
      stored("thread.settled", "standalone", "server:auto-settle:standalone:1"),
      stored("thread.settled", "merged-tab", "server:auto-settle:merged-tab:1"),
    ],
    [
      ["thread.settle", "neutral-tab"],
      ["thread.settle", "primary"],
    ],
  ),
);

it.effect("a settle is undone while another tab in the group is working", () =>
  Effect.gen(function* () {
    for (const working of [
      makeThread("working-tab", null, { activityRunStatus: "running" }),
      makeThread("working-tab", null, {
        pendingRuntimeRequest: {
          id: RuntimeRequestId.make("request-1"),
          kind: "command",
          createdAt: NOW,
        },
      }),
      // A message the orchestrator has not started a run for yet (the test clock reads 0).
      makeThread("working-tab", null, { latestUserMessageAt: DateTime.makeUnsafe(0) }),
    ]) {
      yield* expectDispatches(
        [makeThread("primary", "settled"), working, makeThread("idle-tab", null)],
        [stored("thread.settled", "primary", "client:settle:1")],
        [["thread.unsettle", "primary"]],
      );
    }
  }),
);

it.effect("only an automatic settle waits on another tab's open pull request", () =>
  Effect.gen(function* () {
    const threads = [
      makeThread("primary", "settled"),
      makeThread("open-pr-tab", null, { pullRequests: [openPullRequest] }),
    ];
    yield* expectDispatches(
      threads,
      [stored("thread.settled", "primary", "server:auto-settle:primary:1")],
      [["thread.unsettle", "primary"]],
    );
    yield* expectDispatches(
      threads,
      [stored("thread.settled", "primary", "client:settle:1")],
      [["thread.settle", "open-pr-tab"]],
    );
  }),
);
