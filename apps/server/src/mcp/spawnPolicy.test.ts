import { describe, expect, it } from "@effect/vitest";
import { RunId, ThreadId, type OrchestrationV2ThreadShell } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";

import type * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import {
  assertMaySpawn,
  MAX_LIVE_CHILDREN,
  selfTargetRefusal,
  spawnParentOf,
  spawnRefusal,
} from "./spawnPolicy.ts";

type ShellFields = Pick<
  OrchestrationV2ThreadShell,
  | "id"
  | "startedBy"
  | "lineage"
  | "creationSource"
  | "archivedAt"
  | "settledOverride"
  | "deletedAt"
  | "activeRunId"
>;

const shell = (id: string, overrides: Partial<ShellFields> = {}) =>
  ({
    id: ThreadId.make(id),
    creationSource: "web",
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: ThreadId.make(id) },
    archivedAt: null,
    settledOverride: null,
    deletedAt: null,
    activeRunId: null,
    ...overrides,
  }) as OrchestrationV2ThreadShell;

const startedBy = (parent: string) => ({
  creationSource: "mcp" as const,
  startedBy: { kind: "thread" as const, threadId: ThreadId.make(parent) },
});

/** Just the two reads assertMaySpawn makes. */
const threadsOver = (shells: ReadonlyArray<OrchestrationV2ThreadShell>) =>
  ({
    getThreadShell: (threadId: ThreadId) =>
      Effect.succeed(shells.find((candidate) => candidate.id === threadId) ?? null),
    getShellSnapshot: () =>
      Effect.succeed({
        schemaVersion: 1,
        snapshotSequence: 0,
        threads: shells.filter((candidate) => candidate.archivedAt === null),
        archivedThreads: [],
      }),
  }) as unknown as ThreadManagement.ThreadManagementService["Service"];

describe("spawnParentOf", () => {
  it("reads the starting thread, or a delegate_task child's parent", () => {
    expect(spawnParentOf(shell("child", startedBy("parent")))).toBe("parent");
    expect(
      spawnParentOf(
        shell("task", {
          creationSource: "mcp",
          lineage: {
            parentThreadId: ThreadId.make("parent"),
            relationshipToParent: "subagent",
            rootThreadId: ThreadId.make("parent"),
          },
        }),
      ),
    ).toBe("parent");
  });

  it("ignores user threads, provider-native subagents, and agent access tokens", () => {
    expect(spawnParentOf(shell("user"))).toBeNull();
    expect(
      spawnParentOf(
        shell("native", {
          creationSource: "provider",
          lineage: {
            parentThreadId: ThreadId.make("parent"),
            relationshipToParent: "subagent",
            rootThreadId: ThreadId.make("parent"),
          },
        }),
      ),
    ).toBeNull();
    expect(
      spawnParentOf(shell("token", { startedBy: { kind: "agent-access", label: "EOD brief" } })),
    ).toBeNull();
  });
});

describe("spawnRefusal", () => {
  it("allows two levels and five live children", () => {
    expect(spawnRefusal({ parentDepth: 1, liveChildren: 4, count: 1 })).toBeNull();
    expect(spawnRefusal({ parentDepth: 2, liveChildren: 0, count: 1 })).toMatch(/2 levels deep/);
    expect(spawnRefusal({ parentDepth: 0, liveChildren: 5, count: 1 })).toMatch(/already has 5/);
    expect(spawnRefusal({ parentDepth: 0, liveChildren: 3, count: 3 })).toMatch(/2 or fewer/);
  });

  it("refuses a thread acting on itself", () => {
    const own = ThreadId.make("own");
    expect(selfTargetRefusal(own, own)).toMatch(/own thread/);
    expect(selfTargetRefusal(own, ThreadId.make("other"))).toBeNull();
    expect(selfTargetRefusal(undefined, own)).toBeNull();
  });
});

describe("assertMaySpawn", () => {
  it.effect("stops a chain two levels below the user's thread", () =>
    Effect.gen(function* () {
      const threads = threadsOver([
        shell("root"),
        shell("child", startedBy("root")),
        shell("grandchild", startedBy("child")),
      ]);
      expect(
        Exit.isSuccess(yield* Effect.exit(assertMaySpawn(threads, ThreadId.make("child"), 1))),
      ).toBe(true);
      const refused = yield* Effect.flip(assertMaySpawn(threads, ThreadId.make("grandchild"), 1));
      expect(refused.message).toMatch(/2 levels deep/);
    }),
  );

  it.effect("counts only live children, across projects", () =>
    Effect.gen(function* () {
      const live = Array.from({ length: MAX_LIVE_CHILDREN }, (_, index) =>
        shell(`live-${index}`, startedBy("root")),
      );
      const full = threadsOver([shell("root"), ...live]);
      const refused = yield* Effect.flip(assertMaySpawn(full, ThreadId.make("root"), 1));
      expect(refused.code).toBe("capability_denied");

      const [first, second, ...rest] = live;
      const freed = threadsOver([
        shell("root"),
        { ...first!, settledOverride: "settled" },
        { ...second!, archivedAt: DateTime.makeUnsafe("2026-10-05T00:00:00.000Z") },
        ...rest,
      ]);
      expect(
        Exit.isSuccess(yield* Effect.exit(assertMaySpawn(freed, ThreadId.make("root"), 2))),
      ).toBe(true);
    }),
  );

  it.effect("counts a delegated task's child only while it runs", () =>
    Effect.gen(function* () {
      const task = (id: string, running: boolean) =>
        shell(id, {
          creationSource: "mcp",
          activeRunId: running ? RunId.make(`run:${id}`) : null,
          lineage: {
            parentThreadId: ThreadId.make("root"),
            relationshipToParent: "subagent",
            rootThreadId: ThreadId.make("root"),
          },
        });
      const finished = Array.from({ length: MAX_LIVE_CHILDREN }, (_, index) =>
        task(`done-${index}`, false),
      );
      const threads = threadsOver([shell("root"), ...finished, task("running", true)]);
      expect(
        Exit.isSuccess(yield* Effect.exit(assertMaySpawn(threads, ThreadId.make("root"), 4))),
      ).toBe(true);
      const refused = yield* Effect.flip(assertMaySpawn(threads, ThreadId.make("root"), 5));
      expect(refused.message).toMatch(/1 threads it started/);
    }),
  );
});
