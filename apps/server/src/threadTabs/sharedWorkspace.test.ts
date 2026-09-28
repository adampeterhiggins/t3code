import { describe, expect, it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import { areTabSiblings } from "./sharedWorkspace.ts";

describe("shared tab workspace", () => {
  it("allows sibling tabs to follow a checkout together", () => {
    expect(
      areTabSiblings(
        [ThreadId.make("first"), ThreadId.make("second")],
        new Set(["first", "second"]),
      ),
    ).toBe(true);
  });

  it("leaves unrelated threads sharing the worktree under the upstream rule", () => {
    expect(
      areTabSiblings(
        [ThreadId.make("first"), ThreadId.make("other")],
        new Set(["first", "second"]),
      ),
    ).toBe(false);
  });
});
