import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import {
  MAX_LIVE_CHILDREN,
  resolveRuntimeMode,
  selfTargetRefusal,
  spawnDepth,
  spawnRefusal,
} from "./policy.ts";

const shell = (
  id: string,
  parent?: string,
  state: { archived?: boolean; settled?: boolean } = {},
) => ({
  id: ThreadId.make(id),
  createdBy: parent ? { kind: "thread" as const, threadId: ThreadId.make(parent) } : null,
  archivedAt: state.archived ? "2026-01-01T00:00:00.000Z" : null,
  settledAt: state.settled ? "2026-01-01T00:00:00.000Z" : null,
});

describe("operate policy", () => {
  it("never starts a child with more freedom than its parent", () => {
    expect(resolveRuntimeMode(undefined, "auto-accept-edits")).toEqual({
      mode: "auto-accept-edits",
    });
    expect(resolveRuntimeMode("approval-required", "auto")).toEqual({ mode: "approval-required" });
    expect(resolveRuntimeMode("full-access", "full-access")).toEqual({ mode: "full-access" });
    expect(resolveRuntimeMode("full-access", "approval-required")).toHaveProperty("refused");
  });

  it("counts agent-started levels up to the user's thread", () => {
    const threads = [shell("user"), shell("child", "user"), shell("grandchild", "child")];
    expect(spawnDepth(threads[0]!, threads)).toBe(0);
    expect(spawnDepth(threads[1]!, threads)).toBe(1);
    expect(spawnDepth(threads[2]!, threads)).toBe(2);
  });

  it("lets a thread start children until the chain is two levels deep", () => {
    const threads = [shell("user"), shell("child", "user"), shell("grandchild", "child")];
    expect(spawnRefusal(threads[0]!, threads)).toBeNull();
    expect(spawnRefusal(threads[1]!, threads)).toBeNull();
    expect(spawnRefusal(threads[2]!, threads)).toMatch(/levels deep/);
  });

  it("caps live children, but not settled or archived ones", () => {
    const parent = shell("user");
    const live = Array.from({ length: MAX_LIVE_CHILDREN }, (_, index) =>
      shell(`child-${index}`, "user"),
    );
    expect(spawnRefusal(parent, [parent, ...live])).toMatch(/still active/);

    const finished = [
      ...live.slice(1),
      shell("settled", "user", { settled: true }),
      shell("archived", "user", { archived: true }),
    ];
    expect(spawnRefusal(parent, [parent, ...finished])).toBeNull();
  });

  it("refuses to act on the caller's own thread", () => {
    expect(selfTargetRefusal(ThreadId.make("a"), ThreadId.make("a"))).not.toBeNull();
    expect(selfTargetRefusal(ThreadId.make("a"), ThreadId.make("b"))).toBeNull();
    expect(selfTargetRefusal(null, ThreadId.make("b"))).toBeNull();
  });
});
