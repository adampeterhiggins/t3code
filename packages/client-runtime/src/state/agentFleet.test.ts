import { describe, expect, it } from "vite-plus/test";
import {
  NodeId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2Subagent,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import {
  arrangeAgentFleet,
  deriveThreadAgentFleet,
  edgeAgentStatus,
  summarizeAgentFleet,
} from "./agentFleet.ts";
import { DEFAULT_AGENT_LIST_VIEW } from "./agentListView.ts";
import { v2ThreadShell } from "./orchestrationV2TestFixtures.ts";

const at = (iso: string) => DateTime.makeUnsafe(iso);
const parentId = ThreadId.make("parent");

function shell(
  id: string,
  parent: string | null,
  overrides: Partial<OrchestrationV2ThreadShell> = {},
): OrchestrationV2ThreadShell {
  return {
    ...v2ThreadShell,
    id: ThreadId.make(id),
    title: id,
    lineage: {
      rootThreadId: parentId,
      parentThreadId: parent === null ? null : ThreadId.make(parent),
      relationshipToParent: parent === null ? null : "subagent",
    },
    ...overrides,
  };
}

function subagent(
  id: string,
  childThreadId: string | null,
  overrides: Partial<OrchestrationV2Subagent> = {},
): OrchestrationV2Subagent {
  return {
    id: NodeId.make(id),
    threadId: parentId,
    runId: null,
    parentNodeId: NodeId.make("root"),
    origin: "provider_native",
    createdBy: "provider",
    driver: "claudeAgent",
    providerInstanceId: ProviderInstanceId.make("claude"),
    providerThreadId: null,
    childThreadId: childThreadId === null ? null : ThreadId.make(childThreadId),
    nativeTaskRef: null,
    prompt: `Do ${id}`,
    title: id,
    model: "claude-haiku",
    status: "completed",
    result: `${id} done`,
    startedAt: at("2026-10-05T10:00:00Z"),
    completedAt: at("2026-10-05T10:01:00Z"),
    updatedAt: at("2026-10-05T10:01:00Z"),
    ...overrides,
  } as OrchestrationV2Subagent;
}

const keys = (rows: ReadonlyArray<{ readonly entry: { readonly key: string } }>) =>
  rows.map((row) => row.entry.key);

describe("deriveThreadAgentFleet", () => {
  it("lists the thread's own agents, then the agents they spawned, found through shells", () => {
    const fleet = deriveThreadAgentFleet({
      threadId: parentId,
      subagents: [
        subagent("scout", "scout-thread", { startedAt: at("2026-10-05T10:00:02Z") }),
        subagent("pending", null, { status: "pending", startedAt: null }),
      ],
      shells: [
        shell("parent", null),
        shell("scout-thread", "parent"),
        shell("nested", "scout-thread", { status: "failed" }),
        shell("deeper", "nested", { activityRunStatus: "running" }),
        // A fork of the scout is not an agent.
        {
          ...shell("fork", "scout-thread"),
          lineage: {
            rootThreadId: parentId,
            parentThreadId: ThreadId.make("scout-thread"),
            relationshipToParent: "fork",
          },
        },
      ],
    });
    expect(
      fleet.map(({ key, ownerThreadId, agent }) => [key, ownerThreadId, agent.status]),
    ).toEqual([
      ["scout-thread", "parent", "completed"],
      ["subagent:pending", "parent", "pending"],
      ["nested", "scout-thread", "failed"],
      ["deeper", "nested", "running"],
    ]);
    expect(fleet[0]!.subagent?.prompt).toBe("Do scout");
    expect(fleet[2]!.subagent).toBeNull();
  });

  it("follows a live follow-up run on a settled agent's child thread", () => {
    const [entry] = deriveThreadAgentFleet({
      threadId: parentId,
      subagents: [subagent("scout", "scout-thread")],
      shells: [
        shell("scout-thread", "parent", {
          activityRunStatus: "waiting",
          activityRunStartedAt: at("2026-10-05T11:00:00Z"),
        }),
      ],
    });
    expect(entry!.agent).toMatchObject({
      status: "waiting",
      startedAt: "2026-10-05T11:00:00.000Z",
      completedAt: null,
      result: null,
    });
  });

  it("does not loop on a lineage cycle", () => {
    const fleet = deriveThreadAgentFleet({
      threadId: parentId,
      subagents: [],
      shells: [shell("a", "parent"), shell("b", "a"), shell("parent", "b")],
    });
    expect(fleet.map((entry) => entry.key)).toEqual(["a", "b"]);
  });
});

describe("arrangeAgentFleet", () => {
  const fleet = deriveThreadAgentFleet({
    threadId: parentId,
    subagents: [
      subagent("late", "late-thread", { startedAt: at("2026-10-05T10:00:05Z") }),
      subagent("early", "early-thread", {
        startedAt: at("2026-10-05T10:00:01Z"),
        status: "running",
        completedAt: null,
      }),
    ],
    shells: [
      shell("late-thread", "parent"),
      shell("early-thread", "parent"),
      shell("helper", "late-thread", {
        status: "failed",
        createdAt: at("2026-10-05T10:00:06Z"),
      }),
    ],
  });

  it("puts each agent's own agents under it, siblings in spawn order", () => {
    const rows = arrangeAgentFleet(fleet, DEFAULT_AGENT_LIST_VIEW, parentId);
    expect(keys(rows)).toEqual(["early-thread", "late-thread", "helper"]);
    expect(rows.map((row) => row.depth)).toEqual([0, 0, 1]);
    expect(rows.every((row) => !row.context)).toBe(true);
  });

  it("keeps a filtered-out agent as context for a matching agent below it", () => {
    const rows = arrangeAgentFleet(
      fleet,
      { ...DEFAULT_AGENT_LIST_VIEW, statuses: ["failed"] },
      parentId,
    );
    expect(rows.map((row) => [row.entry.key, row.context])).toEqual([
      ["late-thread", true],
      ["helper", false],
    ]);
  });

  it("searches nested agents by title", () => {
    expect(
      keys(arrangeAgentFleet(fleet, { ...DEFAULT_AGENT_LIST_VIEW, query: "early" }, parentId)),
    ).toEqual(["early-thread"]);
  });
});

describe("summarizeAgentFleet", () => {
  it("counts statuses and adds up reported tokens", () => {
    const summary = summarizeAgentFleet(
      deriveThreadAgentFleet({
        threadId: parentId,
        subagents: [
          subagent("a", "a", { usage: { totalTokens: 1_200 } }),
          subagent("b", "b", { status: "running", completedAt: null, usage: { totalTokens: 300 } }),
          subagent("c", "c", { status: "cancelled" }),
        ],
        shells: [],
      }),
    );
    expect(summary).toEqual({
      counts: { working: 1, idle: 0, done: 1, failed: 0, stopped: 1 },
      totalTokens: 1_500,
      hasUsage: true,
    });
  });
});

describe("edgeAgentStatus", () => {
  it("reads run statuses an agent record never has", () => {
    expect(edgeAgentStatus("queued")).toBe("pending");
    expect(edgeAgentStatus("rolled_back")).toBe("cancelled");
    expect(edgeAgentStatus("error")).toBe("failed");
    expect(edgeAgentStatus(null)).toBe("idle");
  });
});
