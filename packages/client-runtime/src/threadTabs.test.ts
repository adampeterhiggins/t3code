import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { hiddenTabThreadKeys, threadTabGroupTarget } from "./threadTabs.ts";

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

  it("promotes the next open tab when the first tab is closed", () => {
    const local = EnvironmentId.make("local");
    const root = ThreadId.make("root");
    const second = ThreadId.make("second");
    const third = ThreadId.make("third");
    const memberships = new Map([
      [local, [root, second, third].map((threadId) => ({ threadId, groupId: root }))],
    ]);
    const shells = [
      { id: root, environmentId: local, archivedAt: "2026-01-01T00:00:00Z" },
      { id: second, environmentId: local, archivedAt: null },
      { id: third, environmentId: local, archivedAt: null },
    ];

    expect([...hiddenTabThreadKeys(shells, memberships)]).toEqual([
      ["local:third", "local:second"],
    ]);
  });

  it("opens a group's row on its most recently opened tab", () => {
    const hidden = new Map([
      ["local:second", "local:root"],
      ["local:third", "local:root"],
      ["local:other-child", "local:other"],
    ]);

    expect(threadTabGroupTarget("local:root", hidden, {})).toBe("local:root");
    expect(
      threadTabGroupTarget("local:root", hidden, {
        "local:root": 1,
        "local:second": 3,
        "local:third": 2,
        "local:other-child": 4,
      }),
    ).toBe("local:second");
    expect(threadTabGroupTarget("local:root", hidden, { "local:root": 5, "local:second": 3 })).toBe(
      "local:root",
    );
    expect(threadTabGroupTarget("local:second", hidden, { "local:third": 9 })).toBe("local:second");
  });
});
