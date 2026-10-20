import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectSetupScriptRunner from "./ProjectSetupScriptRunner.ts";
import { SubagentWorktreeSetup, type SubagentWorktreeSetupInput } from "./SubagentWorktreeSetup.ts";

export const layerInstall = Layer.effectDiscard(
  Effect.gen(function* () {
    const setup = yield* SubagentWorktreeSetup;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const runner = yield* ProjectSetupScriptRunner.ProjectSetupScriptRunner;

    const prepare = Effect.fn("SubagentWorktreeSetup.prepare")(function* (
      input: SubagentWorktreeSetupInput,
    ) {
      const thread = yield* projections.getThreadShell(input.threadId);
      if (thread === null) return;
      const result = yield* runner.runForThread({
        threadId: input.threadId,
        projectId: thread.projectId,
        worktreePath: input.worktreePath,
        preferredTerminalId: `subagent-setup-${input.agentId}`,
        observeCompletion: {},
      });
      if (result.status !== "started" || !result.completion) return;
      // Same rule as a thread's own worktree: only a non-async script holds the agent.
      if (result.async) {
        yield* Effect.forkDetach(result.completion);
      } else {
        yield* result.completion;
      }
    });

    yield* setup.install((input) =>
      prepare(input).pipe(
        // Setup is best effort: a failed install must not stop the subagent.
        Effect.catchCause((cause) =>
          Effect.logWarning("subagent worktree setup failed", {
            threadId: input.threadId,
            worktreePath: input.worktreePath,
            cause,
          }),
        ),
      ),
    );
  }),
);
