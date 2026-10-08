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
import * as Deferred from "effect/Deferred";
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
const WAKE_AT = DateTime.add(NOW, { hours: 1 });
const snoozed = { snoozedUntil: WAKE_AT, snoozedAt: NOW };

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
 * Include only the event fields the reactor reads; thread state comes from the shell lookup.
 */
function stored(
  type:
    | "run.created"
    | "thread.unsettled"
    | "thread.settled"
    | "thread.snoozed"
    | "thread.unsnoozed"
    | "thread.pinned"
    | "run.updated"
    | "runtime-request.updated",
  threadId: string,
  commandId: string | null = null,
  payload = { snoozedUntil: WAKE_AT, status: "completed" },
): OrchestrationV2StoredEvent {
  return {
    sequence: 1,
    commandId: commandId === null ? null : CommandId.make(commandId),
    event: {
      id: EventId.make(`event-${type}-${threadId}`),
      type,
      threadId: ThreadId.make(threadId),
      occurredAt: NOW,
      payload,
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
  expected: ReadonlyArray<readonly [string, string, string?]>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const observed = yield* Deferred.make<void>();
      const dispatched = yield* Queue.unbounded<OrchestrationV2ServerCommand>();

      const dependencies = Layer.mergeAll(
        Layer.mock(Orchestrator.OrchestratorV2)({
          getThreadShell: (threadId) =>
            Effect.succeed(threads.find((thread) => thread.id === threadId) ?? null),
          dispatch: (command) =>
            Queue.offer(dispatched, command).pipe(Effect.as({ sequence: 1, storedEvents: [] })),
          streamStoredEventsFrom: () =>
            Stream.fromIterable(events).pipe(Stream.onEnd(Deferred.succeed(observed, undefined))),
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
        yield* Deferred.await(observed);
        yield* reactor.drain;
        const commands = yield* Queue.clear(dispatched);
        assert.deepStrictEqual(
          commands
            .map((command) =>
              command.type === "thread.snooze"
                ? [command.type, command.threadId, command.snoozedUntil]
                : command.type === "thread.settle" ||
                    command.type === "thread.unsettle" ||
                    command.type === "thread.unsnooze"
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

it.effect(
  "snoozing a child tab parks the representative and other live tabs at the same time",
  () =>
    expectDispatches(
      [
        makeThread("primary", "active"),
        makeThread("open-tab", null, snoozed),
        makeThread("already-snoozed", null, snoozed),
        makeThread("resnoozed-tab", null, { snoozedUntil: DateTime.add(WAKE_AT, { hours: 1 }) }),
        makeThread("running-tab", null, { activityRunStatus: "running" }),
        makeThread("archived-tab", null, { archivedAt: NOW }),
        makeThread("deleted-tab", null, { deletedAt: NOW }),
        makeThread("standalone", null),
      ],
      [stored("thread.snoozed", "standalone"), stored("thread.snoozed", "open-tab")],
      [
        ["thread.snooze", "primary", DateTime.formatIso(WAKE_AT)],
        ["thread.snooze", "resnoozed-tab", DateTime.formatIso(WAKE_AT)],
        ["thread.snooze", "running-tab", DateTime.formatIso(WAKE_AT)],
      ],
    ),
);

it.effect("wake, Undo, sending a message, and pinning a child tab return its group's row", () =>
  Effect.gen(function* () {
    for (const type of ["thread.unsnoozed", "thread.pinned"] as const) {
      yield* expectDispatches(
        [
          makeThread("primary", null, snoozed),
          makeThread("open-tab", null),
          makeThread("already-awake", null),
          makeThread("archived-tab", null, { ...snoozed, archivedAt: NOW }),
          makeThread("standalone", null, snoozed),
        ],
        [stored(type, "standalone"), stored(type, "open-tab")],
        [["thread.unsnooze", "primary"]],
      );
    }
  }),
);

it.effect("a pending request or queued turn in a sibling prevents group snooze", () =>
  Effect.gen(function* () {
    for (const blocked of [
      makeThread("blocked-tab", null, {
        pendingRuntimeRequest: {
          id: RuntimeRequestId.make("request-1"),
          kind: "command",
          createdAt: NOW,
        },
      }),
      makeThread("blocked-tab", null, { latestUserMessageAt: DateTime.makeUnsafe(0) }),
    ]) {
      yield* expectDispatches(
        [makeThread("primary", null, snoozed), makeThread("open-tab", null, snoozed), blocked],
        [stored("thread.snoozed", "open-tab")],
        [
          ["thread.unsnooze", "open-tab"],
          ["thread.unsnooze", "primary"],
        ],
      );
    }
  }),
);

it.effect("a completed run, fresh failure, or pending request in a tab wakes the group early", () =>
  Effect.gen(function* () {
    for (const [thread, event] of [
      [
        makeThread("open-tab", null, {
          ...snoozed,
          status: "completed",
          latestRunCompletedAt: DateTime.add(NOW, { minutes: 1 }),
        }),
        stored("run.updated", "open-tab"),
      ],
      [
        makeThread("open-tab", null, {
          ...snoozed,
          status: "failed",
          latestRunCompletedAt: DateTime.add(NOW, { minutes: 1 }),
        }),
        stored("run.updated", "open-tab", null, { snoozedUntil: WAKE_AT, status: "failed" }),
      ],
      [
        makeThread("open-tab", null, {
          ...snoozed,
          pendingRuntimeRequest: {
            id: RuntimeRequestId.make("request-1"),
            kind: "command",
            createdAt: NOW,
          },
        }),
        stored("runtime-request.updated", "open-tab", null, {
          snoozedUntil: WAKE_AT,
          status: "pending",
        }),
      ],
    ] as const) {
      yield* expectDispatches(
        [makeThread("primary", null, snoozed), thread],
        [event],
        [["thread.unsnooze", "primary"]],
      );
    }
  }),
);

it.effect("old completions and failures do not wake a freshly snoozed group", () =>
  Effect.gen(function* () {
    for (const status of ["completed", "failed"] as const) {
      yield* expectDispatches(
        [
          makeThread("primary", null, snoozed),
          makeThread("open-tab", null, {
            ...snoozed,
            status,
            latestRunCompletedAt: DateTime.subtract(NOW, { minutes: 1 }),
          }),
        ],
        [stored("run.updated", "open-tab", null, { snoozedUntil: WAKE_AT, status })],
        [],
      );
    }
  }),
);

it.effect("mirrored snooze commands do not echo back to the other tabs", () =>
  expectDispatches(
    [makeThread("primary", null), makeThread("open-tab", null, snoozed)],
    [
      stored("thread.snoozed", "open-tab", "server:tab-snooze:open-tab:1"),
      stored("thread.unsnoozed", "primary", "server:tab-snooze:primary:2"),
    ],
    [],
  ),
);

it.effect("an Undo or resnooze that overtakes a snooze job wins", () =>
  Effect.gen(function* () {
    for (const source of [
      makeThread("open-tab", null),
      makeThread("open-tab", null, {
        ...snoozed,
        snoozedUntil: DateTime.add(WAKE_AT, { hours: 1 }),
      }),
      makeThread("open-tab", null, { ...snoozed, archivedAt: NOW }),
      makeThread("open-tab", null, { snoozedUntil: DateTime.makeUnsafe(0) }),
    ]) {
      yield* expectDispatches(
        [makeThread("primary", null), source],
        [stored("thread.snoozed", "open-tab")],
        [],
      );
    }
    yield* expectDispatches(
      [makeThread("primary", null, snoozed), makeThread("open-tab", null, snoozed)],
      [stored("thread.unsnoozed", "open-tab")],
      [],
    );
  }),
);
