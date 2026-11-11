import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { EnvironmentId, ProjectId, ThreadId, type ThreadTabMembership } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  appendCitationToPrompt,
  groupCitationDestinations,
  searchCitationDestinationTabs,
  type CitationDestinationGroup,
} from "./citationDestination";

const environmentId = EnvironmentId.make("env-1");
const projectId = ProjectId.make("project-1");

function shell(
  id: string,
  overrides: Partial<Record<keyof EnvironmentThreadShell, unknown>> = {},
): EnvironmentThreadShell {
  return {
    environmentId,
    id: ThreadId.make(id),
    projectId,
    title: id,
    runtime: null,
    archivedAt: null,
    hiddenAt: null,
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  } as unknown as EnvironmentThreadShell;
}

const membership = (
  threadId: string,
  groupId: string,
  groupName?: string,
): ThreadTabMembership => ({
  threadId: ThreadId.make(threadId),
  groupId: ThreadId.make(groupId),
  ...(groupName ? { groupName } : {}),
});

const group = (
  threads: EnvironmentThreadShell[],
  memberships: ThreadTabMembership[] | null = null,
) =>
  groupCitationDestinations({
    threads,
    memberships,
    environmentId,
    currentThreadId: ThreadId.make("source"),
  });

const summarize = (groups: CitationDestinationGroup[]) =>
  groups.map((entry) => [entry.title, entry.tabs.map((tab) => tab.id)]);

describe("groupCitationDestinations", () => {
  it("puts the cited thread first, then running, then recent, skipping dead threads", () => {
    const threads = [
      shell("older", { updatedAt: "2026-09-01T00:00:00.000Z" }),
      shell("source", { updatedAt: "2026-01-01T00:00:00.000Z" }),
      shell("newer", { updatedAt: "2026-10-02T00:00:00.000Z" }),
      shell("running", {
        updatedAt: "2026-08-01T00:00:00.000Z",
        runtime: { status: "running", activeRunId: "run-1" },
      }),
      shell("archived", { archivedAt: "2026-10-03T00:00:00.000Z" }),
      shell("hidden", { hiddenAt: "2026-10-03T00:00:00.000Z" }),
      shell("elsewhere", { environmentId: EnvironmentId.make("env-2") }),
    ];

    expect(group(threads).map((entry) => entry.key)).toEqual([
      "source",
      "running",
      "newer",
      "older",
    ]);
  });

  it("gathers tabs into their group in membership order, titled by the group's name", () => {
    const threads = [
      shell("source"),
      shell("sibling"),
      shell("review"),
      shell("draft", { updatedAt: "2026-10-05T00:00:00.000Z" }),
      shell("closed", { archivedAt: "2026-10-03T00:00:00.000Z" }),
      shell("alone"),
    ];
    const groups = group(threads, [
      membership("source", "source"),
      membership("sibling", "source"),
      membership("draft", "draft", "PR routing"),
      membership("closed", "draft", "PR routing"),
      membership("review", "draft", "PR routing"),
    ]);

    expect(summarize(groups)).toEqual([
      ["source", ["source", "sibling"]],
      ["PR routing", ["draft", "review"]],
      ["alone", ["alone"]],
    ]);
    expect(groups.map((entry) => entry.current)).toEqual([true, false, false]);
  });
});

describe("searchCitationDestinationTabs", () => {
  it("matches tabs by their own, group, or project title", () => {
    const groups = group(
      [shell("source"), shell("Fix WS reconnect backoff"), shell("Composer drafts sync")],
      [
        membership("Fix WS reconnect backoff", "Fix WS reconnect backoff", "Networking"),
        membership("Composer drafts sync", "Fix WS reconnect backoff", "Networking"),
      ],
    );
    const search = (query: string) =>
      searchCitationDestinationTabs(groups, new Map([[projectId, "t3code"]]), query).map(
        (entry) => entry.tab.id,
      );

    expect(search("reconn")).toEqual(["Fix WS reconnect backoff"]);
    expect(search("networking")).toEqual(["Fix WS reconnect backoff", "Composer drafts sync"]);
    expect(search("T3CODE")).toHaveLength(3);
  });
});

describe("appendCitationToPrompt", () => {
  it("starts an empty prompt with the citation", () => {
    expect(appendCitationToPrompt("  ", "[quote](cite)")).toBe("[quote](cite) ");
  });

  it("keeps one space between the existing prompt and the citation", () => {
    expect(appendCitationToPrompt("Look at", "[quote](cite)")).toBe("Look at [quote](cite) ");
    expect(appendCitationToPrompt("Look at\n", "[quote](cite)")).toBe("Look at\n[quote](cite) ");
  });
});
