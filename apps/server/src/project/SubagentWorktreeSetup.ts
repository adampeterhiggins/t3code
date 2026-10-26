import type { ThreadId } from "@t3tools/contracts";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

export interface SubagentWorktreeSetupInput {
  /** The T3 thread whose agent started the subagent. */
  readonly threadId: ThreadId;
  /** Provider id of the subagent, used to name its setup terminal. */
  readonly agentId: string;
  readonly worktreePath: string;
}

type Prepare = (input: SubagentWorktreeSetupInput) => Effect.Effect<void>;

/** Providers precede project layers, so preparation is installed later and defaults to a no-op. */
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
      prepare: Effect.fn("SubagentWorktreeSetup.prepare")((input) =>
        Ref.get(current).pipe(Effect.flatMap((prepare) => prepare(input))),
      ),
      install: Effect.fn("SubagentWorktreeSetup.install")((prepare) => Ref.set(current, prepare)),
    });
  }),
);
