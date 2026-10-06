import { ProjectId, ThreadId, type OrchestrationV2ThreadShell } from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";

import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectSetupScriptRunner from "./ProjectSetupScriptRunner.ts";
import * as SubagentWorktreeSetup from "./SubagentWorktreeSetup.ts";

const THREAD_ID = ThreadId.make("thread-1");
const PROJECT_ID = ProjectId.make("project-1");

function makeLayer(input: {
  readonly async: boolean;
  readonly completion: Deferred.Deferred<void>;
  readonly runs: Array<ProjectSetupScriptRunner.ProjectSetupScriptRunnerInput>;
}) {
  return SubagentWorktreeSetup.layerInstall.pipe(
    Layer.provideMerge(SubagentWorktreeSetup.layer),
    Layer.provide(
      Layer.mock(ProjectionStore.ProjectionStoreV2)({
        getThreadShell: () =>
          Effect.succeed({ projectId: PROJECT_ID } as OrchestrationV2ThreadShell),
      }),
    ),
    Layer.provide(
      Layer.mock(ProjectSetupScriptRunner.ProjectSetupScriptRunner)({
        runForThread: (run) =>
          Effect.sync(() => {
            input.runs.push(run);
            return {
              status: "started",
              scriptId: "setup",
              scriptName: "Setup",
              scriptCommand: "pnpm install",
              terminalId: run.preferredTerminalId ?? "setup",
              cwd: run.worktreePath,
              async: input.async,
              completion: Deferred.await(input.completion).pipe(
                Effect.as({ exitCode: 0, durationMs: 1 }),
              ),
            } as const;
          }),
      }),
    ),
  );
}

const prepareInput = { threadId: THREAD_ID, agentId: "a1", worktreePath: "/repo/wt" };

describe("SubagentWorktreeSetup", () => {
  it.effect("runs the thread's project setup in the subagent worktree", () => {
    const runs: Array<ProjectSetupScriptRunner.ProjectSetupScriptRunnerInput> = [];
    return Effect.gen(function* () {
      const completion = yield* Deferred.make<void>();
      yield* Deferred.succeed(completion, undefined);
      yield* Effect.gen(function* () {
        const setup = yield* SubagentWorktreeSetup.SubagentWorktreeSetup;
        yield* setup.prepare(prepareInput);
      }).pipe(Effect.provide(makeLayer({ async: false, completion, runs })));
      assert.equal(runs.length, 1);
      assert.equal(runs[0]?.projectId, PROJECT_ID);
      assert.equal(runs[0]?.worktreePath, "/repo/wt");
      assert.equal(runs[0]?.preferredTerminalId, "subagent-setup-a1");
    });
  });

  it.effect("holds the subagent until a blocking script exits", () => {
    const runs: Array<ProjectSetupScriptRunner.ProjectSetupScriptRunnerInput> = [];
    return Effect.gen(function* () {
      const completion = yield* Deferred.make<void>();
      yield* Effect.gen(function* () {
        const setup = yield* SubagentWorktreeSetup.SubagentWorktreeSetup;
        const fiber = yield* Effect.forkChild(setup.prepare(prepareInput));
        yield* Effect.yieldNow;
        assert.isUndefined(fiber.pollUnsafe());
        yield* Deferred.succeed(completion, undefined);
        yield* Fiber.join(fiber);
      }).pipe(Effect.provide(makeLayer({ async: false, completion, runs })));
    });
  });

  it.effect("lets the subagent start beside an async script", () => {
    const runs: Array<ProjectSetupScriptRunner.ProjectSetupScriptRunnerInput> = [];
    return Effect.gen(function* () {
      const completion = yield* Deferred.make<void>();
      yield* Effect.gen(function* () {
        const setup = yield* SubagentWorktreeSetup.SubagentWorktreeSetup;
        // Would hang if prepare waited on the never-completing script.
        yield* setup.prepare(prepareInput);
      }).pipe(Effect.provide(makeLayer({ async: true, completion, runs })));
      assert.equal(runs.length, 1);
    });
  });
});
