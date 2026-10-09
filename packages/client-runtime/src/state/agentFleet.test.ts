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
  modelSelectionEffort,
  subagentFromRecord,
  subagentIdentityParts,
  subagentResultSummaryLine,
  subagentRunStats,
  subagentRunUsageRows,
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

  it("names the child thread's current provider, else the one the record was spawned on", () => {
    const fleet = deriveThreadAgentFleet({
      threadId: parentId,
      subagents: [subagent("switched", "switched-thread"), subagent("unstarted", null)],
      shells: [
        shell("switched-thread", "parent", { providerInstanceId: ProviderInstanceId.make("grok") }),
        shell("nested", "switched-thread", {
          providerInstanceId: ProviderInstanceId.make("codex"),
        }),
      ],
    });
    expect(fleet.map((entry) => [entry.key, entry.providerInstanceId])).toEqual([
      ["switched-thread", "grok"],
      ["subagent:unstarted", "claude"],
      ["nested", "codex"],
    ]);
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
      shell("late-thread", "parent", { createdAt: at("2026-10-05T10:00:05Z") }),
      shell("early-thread", "parent", { createdAt: at("2026-10-05T10:00:01Z") }),
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

describe("spawn order", () => {
  it("keeps an agent in place when a follow-up restarts its record", () => {
    const fleet = deriveThreadAgentFleet({
      threadId: parentId,
      subagents: [
        // Resumed later, so its record's start moved past its sibling's.
        subagent("first", "first-thread", { startedAt: at("2026-10-05T10:05:00Z") }),
        subagent("second", "second-thread", { startedAt: at("2026-10-05T10:00:02Z") }),
        subagent("unthreaded", null, { startedAt: at("2026-10-05T10:00:03Z") }),
      ],
      shells: [
        shell("first-thread", "parent", { createdAt: at("2026-10-05T10:00:01Z") }),
        shell("second-thread", "parent", { createdAt: at("2026-10-05T10:00:02Z") }),
      ],
    });
    expect(keys(arrangeAgentFleet(fleet, DEFAULT_AGENT_LIST_VIEW, parentId))).toEqual([
      "first-thread",
      "second-thread",
      "subagent:unthreaded",
    ]);
  });
});

describe("subagentFromRecord", () => {
  it("adds the child thread's model, effort, and the record's artifacts", () => {
    const agent = subagentFromRecord(
      subagent("scout", "scout-thread", {
        model: null,
        outputFile: "/tmp/scout.output",
        sessionUrl: "https://claude.ai/code/s",
      }),
      shell("scout-thread", "parent", {
        modelSelection: {
          instanceId: ProviderInstanceId.make("claude"),
          model: "claude-sonnet-4-5-20250929",
          options: [{ id: "effort", value: "high" }],
        },
      }),
    );
    expect(agent).toMatchObject({
      model: "claude-sonnet-4-5-20250929",
      effort: "high",
      outputFile: "/tmp/scout.output",
      runHandles: { sessionUrl: "https://claude.ai/code/s" },
    });
    expect(subagentIdentityParts(agent, 3)).toEqual(["sonnet-4-5 · high", "run 3"]);
    expect(subagentIdentityParts({ model: "gpt-5", effort: null }, 1)).toEqual(["gpt-5"]);
  });

  it("reads effort only from a string option", () => {
    const selection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" };
    expect(modelSelectionEffort(selection)).toBeNull();
    expect(
      modelSelectionEffort({
        ...selection,
        options: [
          { id: "fastMode", value: true },
          { id: "reasoningEffort", value: "low" },
        ],
      }),
    ).toBe("low");
  });
});

describe("subagentRunStats", () => {
  const child = ThreadId.make("child");
  const run = (id: string, ordinal: number, threadId = child) => ({
    id: id as never,
    threadId,
    ordinal,
  });
  it("counts runs by the newest ordinal and reads its latest attempt", () => {
    const stats = subagentRunStats(
      {
        runs: [run("r3", 3), run("r2", 2), run("other", 9, parentId)],
        attempts: [
          { runId: "r3" as never, attemptOrdinal: 1 },
          { runId: "r3" as never, attemptOrdinal: 2 },
          { runId: "r2" as never, attemptOrdinal: 4 },
        ],
      },
      child,
    );
    expect(stats).toEqual({ runs: 3, attempt: 2 });
    expect(subagentRunUsageRows(stats)).toEqual([
      ["Runs", "3"],
      ["Attempt", "2"],
    ]);
    expect(subagentRunUsageRows({ runs: 1, attempt: 1 })).toEqual([]);
    expect(subagentRunStats({ runs: [], attempts: [] }, child)).toEqual({
      runs: 0,
      attempt: null,
    });
  });
});

describe("summarizeAgentFleet", () => {
  it("counts statuses and adds up reported usage", () => {
    const summary = summarizeAgentFleet(
      deriveThreadAgentFleet({
        threadId: parentId,
        subagents: [
          subagent("a", "a", {
            usage: { totalTokens: 1_200, inputTokens: 1_000, cachedInputTokens: 400, toolUses: 3 },
          }),
          subagent("b", "b", {
            status: "running",
            completedAt: null,
            usage: { totalTokens: 300, inputTokens: 200, outputTokens: 100, durationMs: 5_000 },
          }),
          subagent("c", "c", { status: "cancelled" }),
        ],
        shells: [],
      }),
    );
    expect(summary).toEqual({
      counts: { working: 1, idle: 0, done: 1, failed: 0, stopped: 1 },
      usage: {
        totalTokens: 1_500,
        inputTokens: 1_200,
        cachedInputTokens: 400,
        outputTokens: 100,
        toolUses: 3,
      },
    });
    expect(summarizeAgentFleet([]).usage).toBeNull();
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

describe("subagentResultSummaryLine", () => {
  it("takes the first line with text, without Markdown markers", () => {
    expect(subagentResultSummaryLine("\n## Slack digest: Thu\n\nFacts")).toBe("Slack digest: Thu");
    expect(subagentResultSummaryLine("- **Done** and green")).toBe("Done and green");
    expect(subagentResultSummaryLine("Haiku, the teapot\nsecond line")).toBe("Haiku, the teapot");
  });

  it("cuts long lines and returns null without text", () => {
    expect(subagentResultSummaryLine("x".repeat(200))).toHaveLength(160);
    expect(subagentResultSummaryLine("  \n\n")).toBeNull();
    expect(subagentResultSummaryLine(null)).toBeNull();
  });
});
