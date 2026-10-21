import { assert, it } from "@effect/vitest";
import { ProjectId, ThreadId } from "@t3tools/contracts";

import { describeWorktree, formatBytes } from "./worktree.ts";

it("formats sizes in binary units", () => {
  assert.strictEqual(formatBytes(null), "?");
  assert.strictEqual(formatBytes(512), "512 B");
  assert.strictEqual(formatBytes(1536), "1.5 KB");
  assert.strictEqual(formatBytes(300 * 1024 ** 2), "300 MB");
});

it("summarizes a worktree's branch, state, changes, threads, and pull request", () => {
  assert.deepStrictEqual(
    describeWorktree(
      {
        path: "/Users/adam/.t3/worktrees/t3code/t3-1",
        repositoryName: "t3code",
        projectId: ProjectId.make("project-1"),
        branch: "adam/fix",
        dirty: true,
        state: "active",
        threads: [
          { threadId: ThreadId.make("thread-1"), title: "Fix it", state: "active", running: true },
        ],
        pullRequest: { number: 42, url: "https://github.com/o/r/pull/42", state: "merged" },
      },
      2048,
    ),
    [
      "/Users/adam/.t3/worktrees/t3code/t3-1",
      "  adam/fix  active  local changes  1 thread(s), 1 running  PR #42 merged  2.0 KB",
      "  - thread-1  Fix it",
    ],
  );
});
