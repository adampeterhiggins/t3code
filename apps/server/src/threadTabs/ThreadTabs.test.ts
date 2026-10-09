import {
  MessageId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2ServerCommand,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import { GitHubIssueThreadLinks } from "../githubIssues/GitHubIssueThreadLinks.ts";
import { LinearThreadLinks } from "../linear/LinearThreadLinks.ts";
import { OrchestratorDispatchError } from "../orchestration-v2/Orchestrator.ts";
import {
  ThreadManagementService,
  type ThreadManagementSendInput,
  type ThreadManagementSendResult,
} from "../orchestration-v2/ThreadManagementService.ts";
import { ensureThreadTabsSchema } from "./schema.ts";
import * as ThreadTabs from "./ThreadTabs.ts";

const NOW = DateTime.makeUnsafe("2026-10-05T12:00:00.000Z");
const codex = ProviderInstanceId.make("codex");

function makeShell(id: string, overrides: Partial<OrchestrationV2ThreadShell> = {}) {
  return {
    id: ThreadId.make(id),
    projectId: ProjectId.make("project"),
    title: id,
    providerInstanceId: codex,
    modelSelection: { instanceId: codex, model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: "feature/search",
    worktreePath: "/repo/.worktrees/search",
    lineage: { rootThreadId: ThreadId.make(id), parentThreadId: null, relationshipToParent: null },
    forkedFrom: null,
    createdBy: "user",
    creationSource: "web",
    activeProviderThreadId: null,
    latestRunId: null,
    activeRunId: null,
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
    ...overrides,
  } satisfies OrchestrationV2ThreadShell;
}

/** The summary reads only the latest run and the visible timeline. */
const projection = (threadId: string) =>
  ({
    runs: [{ status: "completed" }],
    visibleTurnItems: [
      {
        item: {
          type: "user_message",
          id: TurnItemId.make(`item-${threadId}`),
          messageId: MessageId.make(`message-${threadId}`),
          text: "Build the search view",
          status: "completed",
        },
      },
    ],
  }) as unknown as OrchestrationV2ThreadProjection;

/**
 * A thread service whose dispatch records commands and, unless told to fail, makes the thread
 * a create or fork names.
 */
const makeHarness = (input: {
  readonly shells: ReadonlyArray<OrchestrationV2ThreadShell>;
  readonly rejectDispatch?: boolean;
  /** Overrides a thread's timeline, in both its recent window and its full snapshot. */
  readonly projections?: Readonly<Record<string, OrchestrationV2ThreadProjection>>;
}) => {
  const projectionOf = (threadId: string) => input.projections?.[threadId] ?? projection(threadId);
  const shells = new Map(input.shells.map((shell) => [shell.id, shell]));
  const dispatched: Array<OrchestrationV2ServerCommand> = [];
  const sent: Array<ThreadManagementSendInput> = [];
  const threads = Layer.mock(ThreadManagementService)({
    sendToThread: (send) => {
      sent.push(send);
      return Effect.succeed({
        run: { id: RunId.make(`run-${send.threadId}`) },
      } as unknown as ThreadManagementSendResult);
    },
    getThreadShell: (threadId) => Effect.succeed(shells.get(threadId) ?? null),
    dispatch: (command) =>
      Effect.gen(function* () {
        dispatched.push(command);
        if (input.rejectDispatch) {
          return yield* new OrchestratorDispatchError({
            commandId: command.commandId,
            commandType: command.type,
            cause: "rejected",
          });
        }
        if (command.type === "thread.create") {
          shells.set(command.threadId, makeShell(command.threadId, { title: command.title }));
        }
        if (command.type === "thread.fork") {
          shells.set(command.targetThreadId, makeShell(command.targetThreadId));
        }
        if (command.type === "thread.model-selection.set") {
          const shell = shells.get(command.threadId);
          if (shell)
            shells.set(command.threadId, { ...shell, modelSelection: command.modelSelection });
        }
        return { sequence: 1, storedEvents: [] };
      }),
    getThreadSnapshotWindow: (threadId) =>
      Effect.succeed({ schemaVersion: 1, snapshotSequence: 3, projection: projectionOf(threadId) }),
    getThreadSnapshot: (threadId) =>
      Effect.succeed({ schemaVersion: 1, snapshotSequence: 4, projection: projectionOf(threadId) }),
  });
  const layer = ThreadTabs.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        threads,
        Layer.mock(LinearThreadLinks)({ refresh: Effect.void }),
        Layer.mock(GitHubIssueThreadLinks)({ refresh: Effect.void }),
        NodeCrypto.layer,
      ),
    ),
  );
  return { dispatched, sent, layer };
};

const withTabs = <A, E>(
  harness: ReturnType<typeof makeHarness>,
  body: (tabs: ThreadTabs.ThreadTabs["Service"]) => Effect.Effect<A, E, SqlClient.SqlClient>,
) =>
  Effect.gen(function* () {
    yield* ensureThreadTabsSchema();
    const tabs = yield* ThreadTabs.ThreadTabs;
    return yield* body(tabs);
  }).pipe(
    Effect.provide(
      harness.layer.pipe(Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" }))),
    ),
  );

it.effect("summarizes any other thread for a draft, but never the thread itself", () => {
  const harness = makeHarness({ shells: [makeShell("thread-elsewhere", { title: "Elsewhere" })] });
  return withTabs(harness, (tabs) =>
    Effect.gen(function* () {
      const handoff = yield* tabs.handoff(ThreadId.make("thread-draft"), {
        sourceThreadIds: [ThreadId.make("thread-elsewhere")],
      });
      assert.include(handoff.text, "Source thread: thread-elsewhere (snapshot 3)");
      assert.include(handoff.text, "Related chat: Elsewhere");
      assert.include(handoff.text, "User: Build the search view");

      const self = yield* Effect.flip(
        tabs.handoff(ThreadId.make("thread-elsewhere"), {
          sourceThreadIds: [ThreadId.make("thread-elsewhere")],
        }),
      );
      assert.strictEqual(self.reason, "invalid_request");
    }),
  );
});

it.effect("a fork point reads the full history and must be one of the chat's messages", () => {
  const harness = makeHarness({ shells: [makeShell("source")] });
  return withTabs(harness, (tabs) =>
    Effect.gen(function* () {
      const forked = yield* tabs.handoff(ThreadId.make("tab"), {
        sourceThreadIds: [ThreadId.make("source")],
        beforeMessageId: MessageId.make("message-source"),
      });
      assert.include(forked.text, "(snapshot 4)");
      assert.notInclude(forked.text, "Build the search view");

      const missing = yield* Effect.flip(
        tabs.handoff(ThreadId.make("tab"), {
          sourceThreadIds: [ThreadId.make("source")],
          afterMessageId: MessageId.make("missing"),
        }),
      );
      assert.strictEqual(missing.reason, "invalid_request");
    }),
  );
});

it.effect("a new tab joins the source's group on the same branch and worktree", () => {
  const harness = makeHarness({ shells: [makeShell("source")] });
  return withTabs(harness, (tabs) =>
    Effect.gen(function* () {
      const group = yield* tabs.create(ThreadId.make("source"), {
        threadId: ThreadId.make("tab"),
        modelSelection: { instanceId: codex, model: "gpt-5.5" },
        creationSource: "mobile",
      });
      assert.deepStrictEqual(
        group.tabs.map((tab) => tab.threadId),
        ["source", "tab"],
      );
      assert.strictEqual(group.groupId, "source");
      const command = harness.dispatched[0];
      assert.strictEqual(command?.type, "thread.create");
      if (command?.type === "thread.create") {
        assert.strictEqual(command.branch, "feature/search");
        assert.strictEqual(command.worktreePath, "/repo/.worktrees/search");
        assert.strictEqual(command.modelSelection.model, "gpt-5.5");
        assert.strictEqual(command.createdBy, "user");
        assert.strictEqual(command.creationSource, "mobile");
      }
      assert.deepStrictEqual(yield* tabs.memberships, [
        { threadId: ThreadId.make("source"), groupId: ThreadId.make("source"), groupName: null },
        { threadId: ThreadId.make("tab"), groupId: ThreadId.make("source"), groupName: null },
      ]);

      const existing = yield* Effect.flip(
        tabs.create(ThreadId.make("source"), {
          threadId: ThreadId.make("tab"),
          modelSelection: { instanceId: codex, model: "gpt-5.5" },
        }),
      );
      assert.strictEqual(existing.reason, "invalid_request");
    }),
  );
});

it.effect("forking a response natively adds the fork to the open tab's group", () => {
  const harness = makeHarness({ shells: [makeShell("source"), makeShell("tab")] });
  return withTabs(harness, (tabs) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
        INSERT INTO fork_thread_tabs (thread_id, group_id, position, created_at) VALUES
          ('source', 'source', 0, '2026-10-05T12:00:00.000Z'),
          ('tab', 'source', 1, '2026-10-05T12:00:01.000Z')
      `;
      const group = yield* tabs.fork(ThreadId.make("tab"), {
        threadId: ThreadId.make("fork"),
        sourceThreadId: ThreadId.make("source"),
        runId: RunId.make("run-1"),
      });
      assert.deepStrictEqual(
        group.tabs.map((tab) => tab.threadId),
        ["source", "tab", "fork"],
      );
      const command = harness.dispatched[0];
      assert.strictEqual(command?.type, "thread.fork");
      if (command?.type === "thread.fork") {
        assert.strictEqual(command.sourceThreadId, "source");
        assert.strictEqual(command.targetThreadId, "fork");
        assert.deepStrictEqual(command.sourcePoint, { type: "run", runId: RunId.make("run-1") });
      }
    }),
  );
});

it.effect("a fork without a run continues the source's latest finished response", () => {
  const response = (runId: string, status: string, sourceThreadId: string) => ({
    sourceThreadId: ThreadId.make(sourceThreadId),
    item: { type: "assistant_message", status, runId: RunId.make(runId) },
  });
  const harness = makeHarness({
    shells: [makeShell("source"), makeShell("tab"), makeShell("empty")],
    projections: {
      // The latest response is still running; the one before it was inherited from a fork.
      source: {
        runs: [],
        visibleTurnItems: [
          response("run-1", "completed", "ancestor"),
          response("run-2", "inProgress", "source"),
        ],
      } as unknown as OrchestrationV2ThreadProjection,
    },
  });
  return withTabs(harness, (tabs) =>
    Effect.gen(function* () {
      yield* tabs.fork(ThreadId.make("tab"), {
        threadId: ThreadId.make("fork"),
        sourceThreadId: ThreadId.make("source"),
      });
      const command = harness.dispatched[0];
      assert.strictEqual(command?.type, "thread.fork");
      if (command?.type === "thread.fork") {
        assert.strictEqual(command.sourceThreadId, "ancestor");
        assert.deepStrictEqual(command.sourcePoint, { type: "run", runId: RunId.make("run-1") });
      }

      const unfinished = yield* Effect.flip(
        tabs.fork(ThreadId.make("tab"), {
          threadId: ThreadId.make("fork-2"),
          sourceThreadId: ThreadId.make("empty"),
        }),
      );
      assert.strictEqual(unfinished.reason, "invalid_request");
      assert.strictEqual(harness.dispatched.length, 1);
    }),
  );
});

it.effect("a fork onto another model switches the new tab before its first message", () => {
  const harness = makeHarness({ shells: [makeShell("source")] });
  const claude = { instanceId: ProviderInstanceId.make("claude"), model: "claude-opus-5-5" };
  return withTabs(harness, (tabs) =>
    Effect.gen(function* () {
      const group = yield* tabs.fork(ThreadId.make("source"), {
        threadId: ThreadId.make("fork"),
        sourceThreadId: ThreadId.make("source"),
        runId: RunId.make("run-1"),
        modelSelection: claude,
      });
      assert.deepStrictEqual(
        harness.dispatched.map((command) => command.type),
        ["thread.fork", "thread.model-selection.set"],
      );
      assert.deepStrictEqual(
        group.tabs.find((tab) => tab.threadId === "fork")?.modelSelection,
        claude,
      );

      // The source's own model needs no switch.
      yield* tabs.fork(ThreadId.make("source"), {
        threadId: ThreadId.make("same-model"),
        sourceThreadId: ThreadId.make("source"),
        runId: RunId.make("run-1"),
        modelSelection: { instanceId: codex, model: "gpt-5.4" },
      });
      assert.strictEqual(harness.dispatched.length, 3);
    }),
  );
});

it.effect("an agent opens a tab as itself, then sends its first message", () => {
  const harness = makeHarness({ shells: [makeShell("source")] });
  const startedBy = { kind: "thread" as const, threadId: ThreadId.make("caller") };
  return withTabs(harness, (tabs) =>
    Effect.gen(function* () {
      const opened = yield* tabs.open(ThreadId.make("source"), {
        threadId: ThreadId.make("tab"),
        title: "Review",
        message: "Review the diff",
        startedBy,
      });
      assert.deepStrictEqual(
        opened.group.tabs.map((tab) => tab.threadId),
        ["source", "tab"],
      );
      assert.strictEqual(opened.runId, "run-tab");
      const command = harness.dispatched[0];
      assert.strictEqual(command?.type, "thread.create");
      if (command?.type === "thread.create") {
        assert.strictEqual(command.title, "Review");
        // Without a model of its own the tab runs the group's.
        assert.strictEqual(command.modelSelection.model, "gpt-5.4");
        assert.strictEqual(command.runtimeMode, "full-access");
        assert.strictEqual(command.createdBy, "agent");
        assert.strictEqual(command.creationSource, "mcp");
        assert.deepStrictEqual(command.startedBy, startedBy);
      }
      assert.strictEqual(harness.sent.length, 1);
      assert.strictEqual(harness.sent[0]?.threadId, "tab");
      assert.strictEqual(harness.sent[0]?.text, "Review the diff");
      assert.strictEqual(harness.sent[0]?.senderThreadId, "caller");
    }),
  );
});

it.effect("an agent forks a tab onto another model without sending anything", () => {
  const harness = makeHarness({ shells: [makeShell("source")] });
  const claude = { instanceId: ProviderInstanceId.make("claude"), model: "claude-opus-5-5" };
  const startedBy = { kind: "agent-access" as const, label: "CI" };
  return withTabs(harness, (tabs) =>
    Effect.gen(function* () {
      const opened = yield* tabs.open(ThreadId.make("source"), {
        threadId: ThreadId.make("fork"),
        fork: { sourceThreadId: ThreadId.make("source"), runId: RunId.make("run-1") },
        modelSelection: claude,
        startedBy,
      });
      assert.strictEqual(opened.runId, null);
      assert.strictEqual(harness.sent.length, 0);
      assert.deepStrictEqual(
        harness.dispatched.map((command) => command.type),
        ["thread.fork", "thread.model-selection.set"],
      );
      const command = harness.dispatched[0];
      if (command?.type === "thread.fork") {
        assert.strictEqual(command.createdBy, "agent");
        assert.deepStrictEqual(command.startedBy, startedBy);
      }
      assert.deepStrictEqual(
        opened.group.tabs.find((tab) => tab.threadId === "fork")?.modelSelection,
        claude,
      );
    }),
  );
});

it.effect("a rejected create leaves no membership behind", () => {
  const harness = makeHarness({ shells: [makeShell("source")], rejectDispatch: true });
  return withTabs(harness, (tabs) =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        tabs.create(ThreadId.make("source"), {
          threadId: ThreadId.make("tab"),
          modelSelection: { instanceId: codex, model: "gpt-5.4" },
        }),
      );
      assert.strictEqual(error.reason, "dispatch_failed");
      assert.deepStrictEqual(yield* tabs.memberships, [
        { threadId: ThreadId.make("source"), groupId: ThreadId.make("source"), groupName: null },
      ]);
    }),
  );
});

it.effect(
  "names the group independently of its tabs, including through a sibling, and clears it",
  () => {
    const harness = makeHarness({ shells: [makeShell("source")] });
    return withTabs(harness, (tabs) =>
      Effect.gen(function* () {
        const source = ThreadId.make("source");
        const sibling = ThreadId.make("sibling");
        const original = yield* tabs.create(source, {
          threadId: sibling,
          modelSelection: { instanceId: codex, model: "gpt-5.4" },
        });
        assert.strictEqual(original.name, null);
        const named = yield* tabs.setName(sibling, "  Search project  ");
        assert.strictEqual(named.name, "Search project");
        assert.deepStrictEqual(named.tabs, original.tabs);
        assert.strictEqual((yield* tabs.group(source)).name, "Search project");
        assert.deepStrictEqual(
          (yield* tabs.memberships).map((row) => row.groupName),
          ["Search project", "Search project"],
        );
        assert.strictEqual((yield* tabs.setName(source, null)).name, null);
        assert.deepStrictEqual(
          (yield* tabs.memberships).map((row) => row.groupName),
          [null, null],
        );
        assert.strictEqual(
          (yield* Effect.flip(tabs.setName(source, "   "))).reason,
          "invalid_request",
        );
      }),
    );
  },
);
