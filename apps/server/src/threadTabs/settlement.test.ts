import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ensureThreadTabsSchema } from "./schema.ts";
import * as ThreadTabSettlementReactor from "./settlement.ts";

const NOW = "2026-09-28T12:00:00.000Z";

function makeThread(
  id: string,
  settledOverride: OrchestrationThreadShell["settledOverride"],
  overrides: Partial<OrchestrationThreadShell> = {},
): OrchestrationThreadShell {
  return {
    id: ThreadId.make(id),
    projectId: ProjectId.make("project"),
    title: id,
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
    runtimeMode: "full-access",
    interactionMode: "default",
    pullRequests: [],
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
    settledOverride,
    settledAt: settledOverride === "settled" ? NOW : null,
    session: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...overrides,
  };
}

const eventBase = (threadId: string, commandId: string | null = null) => ({
  sequence: 1,
  eventId: EventId.make(`event-${threadId}`),
  aggregateKind: "thread" as const,
  aggregateId: ThreadId.make(threadId),
  occurredAt: NOW,
  commandId: commandId === null ? null : CommandId.make(commandId),
  causationEventId: null,
  correlationId: null,
  metadata: {},
});

function turnStartRequested(threadId: string): OrchestrationEvent {
  return {
    ...eventBase(threadId),
    type: "thread.turn-start-requested",
    payload: {
      threadId: ThreadId.make(threadId),
      messageId: MessageId.make(`message-${threadId}`),
      runtimeMode: "full-access",
      interactionMode: "default",
      createdAt: NOW,
    },
  };
}

function unsettled(threadId: string): OrchestrationEvent {
  return {
    ...eventBase(threadId),
    type: "thread.unsettled",
    payload: { threadId: ThreadId.make(threadId), reason: "user", updatedAt: NOW },
  };
}

function settled(threadId: string, commandId: string): OrchestrationEvent {
  return {
    ...eventBase(threadId, commandId),
    type: "thread.settled",
    payload: { threadId: ThreadId.make(threadId), settledAt: NOW, updatedAt: NOW },
  };
}

const openPullRequest: OrchestrationThreadShell["pullRequests"][number] = {
  host: "github.com",
  repository: "owner/repo",
  number: 1,
  url: "https://github.com/owner/repo/pull/1",
  source: "agent",
  linkedAt: NOW,
  snapshot: {
    state: "open",
    title: "Open work",
    headBranch: "feature",
    baseBranch: "main",
    isDraft: false,
    updatedAt: NOW,
    syncedAt: NOW,
  },
  stack: null,
};

/**
 * Publishes events for a group of every thread except `standalone`, then asserts the reactor
 * dispatches exactly the expected `[type, threadId]` commands, in any order.
 */
const expectDispatches = (
  threads: ReadonlyArray<OrchestrationThreadShell>,
  events: ReadonlyArray<OrchestrationEvent>,
  expected: ReadonlyArray<readonly [string, string]>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const domainEvents = yield* PubSub.unbounded<OrchestrationEvent>();
      const dispatched = yield* Queue.unbounded<OrchestrationCommand>();

      const dependencies = Layer.mergeAll(
        Layer.mock(ProjectionSnapshotQuery)({
          getThreadShellById: (threadId) =>
            Effect.succeed(Option.fromUndefinedOr(threads.find((t) => t.id === threadId))),
        }),
        Layer.mock(OrchestrationEngineService)({
          dispatch: (command) => Queue.offer(dispatched, command).pipe(Effect.as({ sequence: 1 })),
          subscribeDomainEvents: PubSub.subscribe(domainEvents).pipe(
            Effect.map((subscription) => Stream.fromSubscription(subscription)),
          ),
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
              VALUES (${thread.id}, 'primary', ${position}, ${NOW})
            `,
          { discard: true },
        );

        const reactor = yield* ThreadTabSettlementReactor.ThreadTabSettlementReactor;
        yield* reactor.start();
        yield* PubSub.publishAll(domainEvents, events);
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

it.effect("a turn or unsettle in any tab wakes the settled tabs of its group", () =>
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
      [turnStartRequested("standalone"), turnStartRequested("sent-tab")],
      woken,
    );
    yield* expectDispatches(threads, [unsettled("standalone"), unsettled("sent-tab")], woken);
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
      settled("standalone", "server:auto-settle:standalone:1"),
      settled("merged-tab", "server:auto-settle:merged-tab:1"),
    ],
    [
      ["thread.settle", "neutral-tab"],
      ["thread.settle", "primary"],
    ],
  ),
);

it.effect("a settle is undone while another tab in the group is working", () =>
  expectDispatches(
    [
      makeThread("primary", "settled"),
      makeThread("running-tab", null, {
        session: {
          threadId: ThreadId.make("running-tab"),
          status: "running",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: null,
          updatedAt: NOW,
        },
      }),
      makeThread("idle-tab", null),
    ],
    [settled("primary", "client:settle:1")],
    [["thread.unsettle", "primary"]],
  ),
);

it.effect("only an automatic settle waits on another tab's open pull request", () =>
  Effect.gen(function* () {
    const threads = [
      makeThread("primary", "settled"),
      makeThread("open-pr-tab", null, { pullRequests: [openPullRequest] }),
    ];
    yield* expectDispatches(
      threads,
      [settled("primary", "server:auto-settle:primary:1")],
      [["thread.unsettle", "primary"]],
    );
    yield* expectDispatches(
      threads,
      [settled("primary", "client:settle:1")],
      [["thread.settle", "open-pr-tab"]],
    );
  }),
);
