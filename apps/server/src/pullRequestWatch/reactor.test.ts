import {
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationThreadShell,
  type PullRequestWatch,
  type ThreadPullRequestSnapshot,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as PullRequestWatchReactor from "./reactor.ts";
import {
  ensurePullRequestWatchSchema,
  listPullRequestWatches,
  upsertPullRequestWatch,
} from "./store.ts";

const NOW = "2026-09-30T12:00:00.000Z";
const THREAD_ID = ThreadId.make("thread");
const KEY = { host: "github.com", repository: "owner/repo", number: 7 } as const;

const failingChecks: ThreadPullRequestSnapshot = {
  state: "open",
  title: "Fix things",
  headBranch: "feature",
  baseBranch: "main",
  isDraft: false,
  updatedAt: NOW,
  syncedAt: NOW,
  checksState: "failing",
};

function makeThread(
  snapshot: ThreadPullRequestSnapshot,
  overrides: Partial<OrchestrationThreadShell> = {},
): OrchestrationThreadShell {
  return {
    id: THREAD_ID,
    projectId: ProjectId.make("project"),
    title: "thread",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
    runtimeMode: "full-access",
    interactionMode: "default",
    pullRequests: [
      {
        ...KEY,
        url: "https://github.com/owner/repo/pull/7",
        source: "created",
        linkedAt: NOW,
        snapshot,
        stack: null,
      },
    ],
    branch: "feature",
    worktreePath: null,
    latestTurn: null,
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    session: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...overrides,
  };
}

const activeWatch: PullRequestWatch = {
  threadId: THREAD_ID,
  ...KEY,
  status: "active",
  attemptsUsed: 0,
  handled: [],
  updatedAt: NOW,
};

/** Evaluates `thread` once per entry, returning the dispatched commands and the watches left. */
const evaluate = (
  watch: PullRequestWatch,
  threads: ReadonlyArray<OrchestrationThreadShell>,
  options: { readonly failDispatch?: boolean } = {},
) =>
  Effect.gen(function* () {
    const dispatched: Array<OrchestrationCommand> = [];
    let current = threads[0]!;
    const dependencies = Layer.mergeAll(
      Layer.mock(ProjectionSnapshotQuery)({
        getThreadShellById: () => Effect.succeed(Option.some(current)),
      }),
      Layer.mock(OrchestrationEngineService)({
        dispatch: (command) =>
          options.failDispatch
            ? Effect.die("dispatch rejected")
            : Effect.sync(() => dispatched.push(command)).pipe(Effect.as({ sequence: 1 })),
        subscribeDomainEvents: Effect.succeed(Stream.empty),
      }),
      NodeCrypto.layer,
    );
    return yield* Effect.gen(function* () {
      yield* ensurePullRequestWatchSchema();
      yield* upsertPullRequestWatch(watch);
      const reactor = yield* PullRequestWatchReactor.PullRequestWatchReactor;
      for (const thread of threads) {
        current = thread;
        yield* reactor.evaluate(THREAD_ID);
        yield* reactor.drain;
      }
      return { dispatched, watches: yield* listPullRequestWatches(THREAD_ID) };
    }).pipe(Effect.provide(PullRequestWatchReactor.layer.pipe(Layer.provideMerge(dependencies))));
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" })));

it.effect("starts one follow-up for new work and not again for the same state", () =>
  Effect.gen(function* () {
    const thread = makeThread(failingChecks);
    const { dispatched, watches } = yield* evaluate(activeWatch, [thread, thread]);
    assert.strictEqual(dispatched.length, 1);
    const command = dispatched[0]!;
    assert.strictEqual(command.type, "thread.turn.start");
    if (command.type === "thread.turn.start") {
      assert.include(command.message.text, "CI checks are failing");
      assert.include(command.message.text, "gh pr checks 7");
    }
    assert.strictEqual(watches[0]?.attemptsUsed, 1);
    assert.deepStrictEqual(watches[0]?.handled, [`checks@${NOW}`]);
  }),
);

it.effect("follows up again after a push fails its checks", () =>
  Effect.gen(function* () {
    const pushedAt = "2026-09-30T12:10:00.000Z";
    const { dispatched, watches } = yield* evaluate(activeWatch, [
      makeThread(failingChecks),
      makeThread({ ...failingChecks, updatedAt: pushedAt }),
    ]);
    assert.strictEqual(dispatched.length, 2);
    assert.strictEqual(watches[0]?.attemptsUsed, 2);
  }),
);

it.effect("waits while the agent is working", () =>
  Effect.gen(function* () {
    const busy = makeThread(failingChecks, {
      session: {
        threadId: THREAD_ID,
        status: "running",
        providerName: "codex",
        runtimeMode: "full-access",
        activeTurnId: null,
        lastError: null,
        updatedAt: NOW,
      },
    });
    const { dispatched, watches } = yield* evaluate(activeWatch, [busy]);
    assert.strictEqual(dispatched.length, 0);
    assert.strictEqual(watches[0]?.attemptsUsed, 0);
  }),
);

it.effect("stops at the follow-up budget", () =>
  Effect.gen(function* () {
    const { dispatched } = yield* evaluate({ ...activeWatch, attemptsUsed: 3 }, [
      makeThread(failingChecks),
    ]);
    assert.strictEqual(dispatched.length, 0);
  }),
);

it.effect("does not follow up while paused", () =>
  Effect.gen(function* () {
    const { dispatched } = yield* evaluate({ ...activeWatch, status: "paused" }, [
      makeThread(failingChecks),
    ]);
    assert.strictEqual(dispatched.length, 0);
  }),
);

it.effect("ends the watch when the pull request merges", () =>
  Effect.gen(function* () {
    const { dispatched, watches } = yield* evaluate(activeWatch, [
      makeThread({ ...failingChecks, state: "merged", checksState: "passing" }),
    ]);
    assert.strictEqual(dispatched.length, 0);
    assert.deepStrictEqual(watches, []);
  }),
);

it.effect("gives the attempt back when the turn cannot start", () =>
  Effect.gen(function* () {
    const { watches } = yield* evaluate(activeWatch, [makeThread(failingChecks)], {
      failDispatch: true,
    });
    assert.strictEqual(watches[0]?.attemptsUsed, 0);
    assert.deepStrictEqual(watches[0]?.handled, []);
  }),
);
