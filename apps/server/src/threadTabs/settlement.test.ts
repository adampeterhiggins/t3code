import {
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
  };
}

function turnStartRequested(threadId: string): OrchestrationEvent {
  return {
    sequence: 1,
    eventId: EventId.make(`turn-start-${threadId}`),
    aggregateKind: "thread",
    aggregateId: ThreadId.make(threadId),
    occurredAt: NOW,
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
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

it.effect("a turn in any tab wakes the settled tabs of its group", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const threads = [
        makeThread("primary", "settled"),
        makeThread("sent-tab", null),
        makeThread("pinned-tab", "active"),
        makeThread("settled-tab", "settled"),
        makeThread("standalone", "settled"),
      ];
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
        yield* sql`
          INSERT INTO fork_thread_tabs (thread_id, group_id, position, created_at) VALUES
            ('primary', 'primary', 0, ${NOW}),
            ('sent-tab', 'primary', 1, ${NOW}),
            ('pinned-tab', 'primary', 2, ${NOW}),
            ('settled-tab', 'primary', 3, ${NOW})
        `;

        const reactor = yield* ThreadTabSettlementReactor.ThreadTabSettlementReactor;
        yield* reactor.start();
        yield* PubSub.publish(domainEvents, turnStartRequested("standalone"));
        yield* PubSub.publish(domainEvents, turnStartRequested("sent-tab"));

        const woken = [yield* Queue.take(dispatched), yield* Queue.take(dispatched)];
        yield* reactor.drain;
        assert.deepStrictEqual(
          woken
            .map((command) =>
              command.type === "thread.unsettle" ? [command.threadId, command.reason] : [],
            )
            .sort(),
          [
            ["primary", "user"],
            ["settled-tab", "user"],
          ],
        );
        assert.strictEqual(yield* Queue.size(dispatched), 0);
      }).pipe(
        Effect.provide(ThreadTabSettlementReactor.layer.pipe(Layer.provideMerge(dependencies))),
      );
    }),
  ).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);
