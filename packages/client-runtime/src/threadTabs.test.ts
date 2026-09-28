import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { hiddenTabThreadKeys } from "./threadTabs.ts";

describe("sidebar tab groups", () => {
  it("keeps the parent row and hides its children only in the matching environment", () => {
    const local = EnvironmentId.make("local");
    const remote = EnvironmentId.make("remote");
    const root = ThreadId.make("root");
    const child = ThreadId.make("child");
    const shells = [
      { id: root, environmentId: local, archivedAt: null },
      { id: child, environmentId: local, archivedAt: null },
      { id: child, environmentId: remote, archivedAt: null },
    ];
    const memberships = new Map([
      [
        local,
        [
          { threadId: root, groupId: root },
          { threadId: child, groupId: root },
        ],
      ],
    ]);

    expect([...hiddenTabThreadKeys(shells, memberships)]).toEqual([["local:child", "local:root"]]);
    expect(
      hiddenTabThreadKeys(
        [{ ...shells[0]!, archivedAt: "2026-01-01T00:00:00Z" }, ...shells.slice(1)],
        memberships,
      ).size,
    ).toBe(0);
  });
});
