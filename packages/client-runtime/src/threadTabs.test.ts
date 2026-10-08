import {
  EnvironmentId,
  MessageId,
  ThreadId,
  type OrchestrationV2ProjectedTurnItem,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  hiddenSidebarTabThreadKeys,
  hiddenTabThreadKeys,
  latestThreadForkPoint,
  threadForkPointBeforeMessage,
  threadTabGroupHeaderTarget,
  threadTabGroupTarget,
} from "./threadTabs.ts";

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

  it("keeps the open tab when its group's row is clicked", () => {
    const groups = new Map([
      ["local:second", "local:root"],
      ["local:third", "local:root"],
      ["local:other-child", "local:other"],
    ]);
    const openedAt = { "local:root": 1, "local:second": 5, "local:third": 3 };

    expect(threadTabGroupHeaderTarget("local:root", "local:third", groups, groups, openedAt)).toBe(
      "local:third",
    );
    expect(threadTabGroupHeaderTarget("local:root", "local:root", groups, groups, openedAt)).toBe(
      "local:root",
    );
    expect(
      threadTabGroupHeaderTarget("local:root", "local:other-child", groups, groups, openedAt),
    ).toBe("local:second");
    expect(threadTabGroupHeaderTarget("local:root", null, groups, new Map(), openedAt)).toBe(
      "local:root",
    );
  });
});

describe("sidebar membership lookup", () => {
  const local = EnvironmentId.make("local");
  const remote = EnvironmentId.make("remote");
  const root = ThreadId.make("root");
  const child = ThreadId.make("child");
  const ordinary = ThreadId.make("ordinary");
  const shell = (id: typeof root, environmentId = local) => ({
    id,
    environmentId,
    archivedAt: null,
  });

  it("reproduces a tab shell arriving before membership, then keeps it hidden throughout the lookup", () => {
    const threads = [shell(root), shell(child)];
    const staleMemberships = new Map([[local, [{ threadId: root, groupId: root }]]]);
    // The original selector briefly exposed both rows until the HTTP response arrived.
    expect(hiddenTabThreadKeys(threads, staleMemberships).has("local:child")).toBe(false);
    const pending = hiddenSidebarTabThreadKeys(
      threads,
      staleMemberships,
      new Set(["local:root"]),
      new Set([local]),
    );
    expect([...pending]).toEqual([["local:child", "local:child"]]);
    const refreshed = new Map([
      [local, [root, child].map((threadId) => ({ threadId, groupId: root }))],
    ]);
    expect([
      ...hiddenSidebarTabThreadKeys(
        threads,
        refreshed,
        new Set(["local:root", "local:child"]),
        new Set([local]),
      ),
    ]).toEqual([["local:child", "local:root"]]);
  });

  it("releases ordinary threads after lookup, including when the endpoint is unsupported", () => {
    const threads = [shell(root), shell(ordinary)];
    expect([
      ...hiddenSidebarTabThreadKeys(threads, new Map(), new Set(["local:root"]), new Set([local])),
    ]).toEqual([["local:ordinary", "local:ordinary"]]);
    expect(
      hiddenSidebarTabThreadKeys(
        threads,
        new Map(),
        new Set(["local:root", "local:ordinary"]),
        new Set([local]),
      ).size,
    ).toBe(0);
  });

  it("waits only for the captured shells in connected environments", () => {
    const threads = [shell(root), shell(child), shell(child, remote)];
    expect([
      ...hiddenSidebarTabThreadKeys(threads, new Map(), new Set(["local:root"]), new Set([local])),
    ]).toEqual([["local:child", "local:child"]]);
  });

  it("preserves known groups during refresh and promotes a sibling when the root closes", () => {
    const memberships = new Map([
      [local, [root, child].map((threadId) => ({ threadId, groupId: root }))],
    ]);
    expect([
      ...hiddenSidebarTabThreadKeys(
        [shell(root), shell(child), shell(ordinary)],
        memberships,
        new Set(["local:root", "local:child"]),
        new Set([local]),
      ),
    ]).toEqual([
      ["local:child", "local:root"],
      ["local:ordinary", "local:ordinary"],
    ]);
    expect(
      hiddenSidebarTabThreadKeys(
        [shell(child)],
        memberships,
        new Set(["local:root", "local:child"]),
        new Set([local]),
      ).size,
    ).toBe(0);
  });
});

describe("native fork points", () => {
  const parent = ThreadId.make("parent");
  const fork = ThreadId.make("fork");
  const entry = (sourceThreadId: ThreadId, item: Record<string, unknown>) =>
    ({ sourceThreadId, item }) as unknown as OrchestrationV2ProjectedTurnItem;
  const items = [
    entry(parent, { type: "user_message", messageId: "m1", runId: "r1" }),
    entry(parent, { type: "assistant_message", status: "completed", runId: "r1" }),
    entry(fork, { type: "user_message", messageId: "m2", runId: "r2" }),
    entry(fork, { type: "assistant_message", status: "completed", runId: "r2" }),
    entry(fork, { type: "user_message", messageId: "m3", runId: "r3" }),
    entry(fork, { type: "assistant_message", status: "streaming", runId: "r3" }),
  ];

  it("forks a whole chat from its latest finished response", () => {
    expect(latestThreadForkPoint(items)).toEqual({ sourceThreadId: fork, runId: "r2" });
    expect(latestThreadForkPoint(items.slice(0, 1))).toBeNull();
  });

  it("forks before a message from the response it followed, in the thread that owns it", () => {
    expect(threadForkPointBeforeMessage(items, MessageId.make("m2"))).toEqual({
      sourceThreadId: parent,
      runId: "r1",
    });
    expect(threadForkPointBeforeMessage(items, MessageId.make("m1"))).toBeNull();
    expect(threadForkPointBeforeMessage(items, MessageId.make("unloaded"))).toBeNull();
  });
});
