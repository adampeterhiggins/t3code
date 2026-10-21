import { assert, describe, it } from "@effect/vitest";
import * as Context from "effect/Context";
import { Tool } from "effect/ai";

import { WorktreeToolkit } from "./tools.ts";

describe("worktree MCP tools", () => {
  it("publishes handoff, status, and list as object-root tools", () => {
    const {
      t3_worktree_handoff: handoff,
      t3_worktree_status: status,
      t3_worktree_list: list,
    } = WorktreeToolkit.tools;

    assert.strictEqual(Context.get(handoff.annotations, Tool.Readonly), false);
    assert.strictEqual(Context.get(handoff.annotations, Tool.Destructive), true);
    assert.strictEqual(Context.get(handoff.annotations, Tool.OpenWorld), true);
    assert.include(handoff.description ?? "", "continuationPrompt");
    assert.include(handoff.description ?? "", "existing worktree");

    assert.strictEqual(Context.get(status.annotations, Tool.Readonly), true);
    assert.strictEqual(Context.get(status.annotations, Tool.Destructive), false);

    assert.strictEqual(Context.get(list.annotations, Tool.Readonly), true);
    assert.strictEqual(Context.get(list.annotations, Tool.Destructive), false);

    for (const [name, tool] of [
      ["t3_worktree_handoff", handoff],
      ["t3_worktree_status", status],
      ["t3_worktree_list", list],
    ] as const) {
      const schema = Tool.getJsonSchema(tool) as { readonly type?: unknown };
      assert.strictEqual(schema.type, "object", name);
    }
  });
});
