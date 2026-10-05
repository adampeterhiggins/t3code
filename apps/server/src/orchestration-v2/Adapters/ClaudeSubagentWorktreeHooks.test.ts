import * as NodeOS from "node:os";

import type { HookInput } from "@anthropic-ai/claude-agent-sdk";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ThreadId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import type * as SubagentWorktreeSetup from "../../project/SubagentWorktreeSetup.ts";
import { makeSubagentWorktreeSetupHooks } from "./ClaudeAdapterV2.ts";

const THREAD_ID = ThreadId.make("thread-subagent-hooks");

it.layer(NodeServices.layer)("Claude SubagentStart worktree setup", (it) => {
  it.effect("prepares each subagent worktree once, never the thread's own", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({
        directory: NodeOS.tmpdir(),
        prefix: "t3-subagent-hooks-",
      });
      const realRoot = yield* fileSystem.realPath(root);
      const threadWorktree = path.join(root, "thread");
      const agentWorktree = path.join(root, ".claude", "worktrees", "agent-a1");
      yield* fileSystem.makeDirectory(threadWorktree, { recursive: true });
      yield* fileSystem.makeDirectory(agentWorktree, { recursive: true });

      const prepared: Array<SubagentWorktreeSetup.SubagentWorktreeSetupInput> = [];
      const hooks = yield* makeSubagentWorktreeSetupHooks({
        threadId: THREAD_ID,
        sessionCwd: threadWorktree,
        prepared: new Set(),
        setup: {
          prepare: (input) => Effect.sync(() => void prepared.push(input)),
          install: () => Effect.void,
        },
        fileSystem,
      });
      const [matcher] = hooks.SubagentStart;
      const hook = matcher?.hooks[0];
      assert.isDefined(hook);
      const fire = (input: Record<string, unknown>) =>
        Effect.promise(() =>
          hook!(input as HookInput, undefined, { signal: new AbortController().signal }),
        );
      const start = (cwd: string, agentId: string) =>
        fire({
          hook_event_name: "SubagentStart",
          session_id: "session",
          transcript_path: "/tmp/transcript.jsonl",
          cwd,
          agent_id: agentId,
          agent_type: "general-purpose",
        });

      yield* start(agentWorktree, "a1");
      // The same worktree again, spelled through a trailing segment.
      yield* start(path.join(agentWorktree, "."), "a1-again");
      // A subagent without isolation runs in the thread's worktree.
      yield* start(threadWorktree, "a2");
      yield* fire({ hook_event_name: "SubagentStop", cwd: path.join(root, "elsewhere") });

      assert.deepStrictEqual(prepared, [
        {
          threadId: THREAD_ID,
          agentId: "a1",
          worktreePath: path.join(realRoot, ".claude", "worktrees", "agent-a1"),
        },
      ]);
      assert.equal(matcher?.timeout, 600);
    }),
  );
});
