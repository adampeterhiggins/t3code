import {
  CommandId,
  EventId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2ServerCommand,
  type OrchestrationV2StoredEvent,
  type OrchestrationV2ThreadShell,
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
import * as ThreadTabSidebarRowReactor from "./sidebarRow.ts";

const NOW = DateTime.makeUnsafe("2026-10-05T12:00:00.000Z");
const NOW_ISO = DateTime.formatIso(NOW);
const HIDDEN_AT = DateTime.makeUnsafe("2026-10-06T12:00:00.000Z");

function makeThread(
  id: string,
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
    settledOverride: null,
    settledAt: null,
    deletedAt: null,
    hiddenAt: null,
    ...overrides,
  };
}

/**
 * The reactor reads only an event's type, thread, and the field it mirrors, so the fixtures
 * leave the rest of each domain event out.
 */
function stored(
  threadId: string,
  change: { readonly hiddenAt: DateTime.Utc | null } | { readonly groupName: string | null },
  commandId = `client:${threadId}`,
): OrchestrationV2StoredEvent {
  const type = "hiddenAt" in change ? "thread.hidden-set" : "thread.group-set";
  return {
    sequence: 1,
    commandId: CommandId.make(commandId),
    event: {
      id: EventId.make(`event-${type}-${threadId}`),
      type,
      threadId: ThreadId.make(threadId),
      occurredAt: NOW,
      payload: change,
    } as unknown as OrchestrationV2StoredEvent["event"],
  };
}

/** A dispatched command as `[type, threadId, value]`, the value being what it sets. */
const summarize = (command: OrchestrationV2ServerCommand) =>
  command.type === "thread.hidden.set"
    ? ["hidden", command.threadId, command.hidden]
    : command.type === "thread.group.set"
      ? ["group", command.threadId, command.groupName]
      : [command.type];

/**
 * Streams events for a group of every thread except `standalone`, then asserts the reactor
 * dispatches exactly the expected commands, in any order.
 */
const expectDispatches = (
  threads: ReadonlyArray<OrchestrationV2ThreadShell>,
  events: ReadonlyArray<OrchestrationV2StoredEvent>,
  expected: ReadonlyArray<readonly [string, string, boolean | string | null]>,
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

        const reactor = yield* ThreadTabSidebarRowReactor.ThreadTabSidebarRowReactor;
        yield* reactor.start();
        yield* Queue.offerAll(storedEvents, events);
        const commands = yield* Effect.forEach(expected, () => Queue.take(dispatched));
        yield* reactor.drain;
        assert.deepStrictEqual(
          commands.map(summarize).sort(),
          [...expected].map((entry) => [...entry]).sort(),
        );
        assert.strictEqual(yield* Queue.size(dispatched), 0);
      }).pipe(
        Effect.provide(ThreadTabSidebarRowReactor.layer.pipe(Layer.provideMerge(dependencies))),
      );
    }),
  ).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" })));

it.effect("hiding any tab hides the other live tabs in its group", () =>
  expectDispatches(
    [
      makeThread("primary"),
      makeThread("open-tab"),
      makeThread("already-hidden", { hiddenAt: HIDDEN_AT }),
      makeThread("archived-tab", { archivedAt: NOW }),
      makeThread("standalone"),
    ],
    [
      stored("primary", { hiddenAt: HIDDEN_AT }, "server:tab-row:primary:1"),
      stored("standalone", { hiddenAt: HIDDEN_AT }),
      stored("open-tab", { hiddenAt: HIDDEN_AT }),
    ],
    [["hidden", "primary", true]],
  ),
);

it.effect("unhiding any tab unhides the other hidden tabs in its group", () =>
  expectDispatches(
    [
      makeThread("primary", { hiddenAt: HIDDEN_AT }),
      makeThread("open-tab", { hiddenAt: HIDDEN_AT }),
      makeThread("already-shown"),
      makeThread("archived-tab", { archivedAt: NOW, hiddenAt: HIDDEN_AT }),
      makeThread("standalone", { hiddenAt: HIDDEN_AT }),
    ],
    [stored("standalone", { hiddenAt: null }), stored("open-tab", { hiddenAt: null })],
    [["hidden", "primary", false]],
  ),
);

it.effect("moving any tab to a sidebar group moves the other live tabs with it", () =>
  expectDispatches(
    [
      makeThread("primary"),
      makeThread("open-tab"),
      makeThread("other-group", { groupName: "Later" }),
      makeThread("already-moved", { groupName: "Review" }),
      makeThread("archived-tab", { archivedAt: NOW }),
      makeThread("standalone"),
    ],
    [
      stored("primary", { groupName: "Review" }, "server:tab-row:primary:1"),
      stored("standalone", { groupName: "Review" }),
      stored("open-tab", { groupName: "Review" }),
    ],
    [
      ["group", "primary", "Review"],
      ["group", "other-group", "Review"],
    ],
  ),
);

it.effect("removing any tab from its sidebar group removes the other tabs too", () =>
  expectDispatches(
    [
      makeThread("primary", { groupName: "Review" }),
      makeThread("open-tab"),
      makeThread("already-removed"),
      makeThread("standalone", { groupName: "Review" }),
    ],
    [stored("standalone", { groupName: null }), stored("open-tab", { groupName: null })],
    [["group", "primary", null]],
  ),
);
