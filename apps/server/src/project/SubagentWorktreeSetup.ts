import type { ThreadId } from "@t3tools/contracts";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ProjectSetupScriptRunner from "./ProjectSetupScriptRunner.ts";

export interface SubagentWorktreeSetupInput {
  /** The T3 thread whose agent started the subagent. */
  readonly threadId: ThreadId;
  /** Provider id of the subagent, used to name its setup terminal. */
  readonly agentId: string;
  readonly worktreePath: string;
}

type Prepare = (input: SubagentWorktreeSetupInput) => Effect.Effect<void>;

/**
 * Prepares a worktree a provider created for one of its subagents the way T3
 * prepares a thread's own worktree: files to copy, then the setup script with
 * the project's environment variables. `prepare` returns once a blocking
 * (non-async) script exits, so the subagent starts in a ready worktree.
 *
 * Providers are built below the project layers, so the server installs the
 * implementation with `installLive` once those exist. Until then, and in
 * tests that skip it, `prepare` does nothing.
 */
export class SubagentWorktreeSetup extends Context.Service<
  SubagentWorktreeSetup,
  {
    readonly prepare: Prepare;
    readonly install: (prepare: Prepare) => Effect.Effect<void>;
  }
>()("t3/project/SubagentWorktreeSetup") {}

export const layer = Layer.effect(
  SubagentWorktreeSetup,
  Effect.gen(function* () {
    const current = yield* Ref.make<Prepare>(() => Effect.void);
    return SubagentWorktreeSetup.of({
      prepare: (input) => Ref.get(current).pipe(Effect.flatMap((prepare) => prepare(input))),
      install: (prepare) => Ref.set(current, prepare),
    });
  }),
);

export const installLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const setup = yield* SubagentWorktreeSetup;
    const projections = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
    const runner = yield* ProjectSetupScriptRunner.ProjectSetupScriptRunner;

    const prepare = Effect.fn("SubagentWorktreeSetup.prepare")(function* (
      input: SubagentWorktreeSetupInput,
    ) {
      const thread = yield* projections.getThreadShellById(input.threadId);
      if (Option.isNone(thread)) return;
      const result = yield* runner.runForThread({
        threadId: input.threadId,
        projectId: thread.value.projectId,
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
