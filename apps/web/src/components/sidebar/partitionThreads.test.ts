import { expect, it } from "vite-plus/test";
import { EnvironmentId, ProjectId, ThreadId, type ServerConfig } from "@t3tools/contracts";
import { createInboxReturnTracker } from "@t3tools/client-runtime/state/thread-inbox";

import { makeThreadFixture } from "../../test-fixtures";
import { partitionSidebarThreads } from "./partitionThreads";

it("classifies groups and Automations while keeping unscoped threads in filter counts", () => {
  const environmentId = EnvironmentId.make("local");
  const projectId = ProjectId.make("selected");
  const thread = (id: string) =>
    makeThreadFixture({ id: ThreadId.make(id), environmentId, projectId });
  const active = thread("active");
  const grouped = { ...thread("grouped"), groupName: "Other" };
  const automation = { ...thread("scheduled"), groupName: "Work", scheduledTaskId: "task" };
  const hidden = { ...thread("hidden"), hiddenAt: "2026-01-01T00:00:00.000Z" };
  const outside = { ...thread("outside"), projectId: ProjectId.make("outside") };
  const tab = thread("tab");
  const result = partitionSidebarThreads({
    threads: [active, grouped, automation, hidden, outside, tab],
    tabThreadGroups: new Map([[`${environmentId}:${tab.id}`, "group"]]),
    groupsShownInThreads: new Set(["Work"]),
    groupsHidingSettled: new Set(),
    automationsHidingSettledEnvironmentIds: new Set(),
    serverConfigs: new Map(),
    scopedProjectKeys: new Set([`${environmentId}:${projectId}`]),
    optimisticDrop: null,
    workingShelfEnabled: false,
    sortActiveBySend: false,
    clockKey: "fixture",
    inboxReturns: createInboxReturnTracker(),
  });
  expect(result.activeThreads).toEqual([active]);
  expect(result.groupedThreads).toEqual([grouped]);
  expect(result.automationThreads).toEqual([automation]);
  expect(result.hiddenThreads).toEqual([hidden]);
  expect(result.shownGroupThreads).toEqual([{ thread: automation, page: "automations" }]);
  expect(result.facetThreads).toHaveLength(5);
  expect(result.facetThreads).toContainEqual({
    environmentId,
    projectId: outside.projectId,
    pages: ["threads"],
  });
  expect(result.facetThreads).toContainEqual({
    environmentId,
    projectId,
    pages: ["automations", "group:Work"],
  });
});

it("keeps settled threads of a group, or of Automations, that hides them on Settled", () => {
  const environmentId = EnvironmentId.make("local");
  const projectId = ProjectId.make("selected");
  const thread = (id: string) =>
    makeThreadFixture({ id: ThreadId.make(id), environmentId, projectId });
  const quietLive = { ...thread("quiet-live"), groupName: "Quiet" };
  const quietSettled = {
    ...thread("quiet-settled"),
    groupName: "Quiet",
    settledOverride: "settled" as const,
    settledAt: "2026-01-02T00:00:00.000Z",
  };
  const quietSnoozed = {
    ...thread("quiet-snoozed"),
    groupName: "Quiet",
    snoozedUntil: "2099-01-01T00:00:00.000Z",
    snoozedAt: "2026-01-01T00:00:00.000Z",
  };
  const workLive = { ...thread("work-live"), groupName: "Work" };
  const workSettled = {
    ...thread("work-settled"),
    groupName: "Work",
    settledOverride: "settled" as const,
    settledAt: "2026-01-03T00:00:00.000Z",
  };
  const automationLive = { ...thread("automation-live"), scheduledTaskId: "task" };
  const automationSettled = {
    ...thread("automation-settled"),
    scheduledTaskId: "task",
    settledOverride: "settled" as const,
    settledAt: "2026-01-04T00:00:00.000Z",
  };
  const result = partitionSidebarThreads({
    threads: [
      quietLive,
      quietSettled,
      quietSnoozed,
      workLive,
      workSettled,
      automationLive,
      automationSettled,
    ],
    tabThreadGroups: new Map(),
    groupsShownInThreads: new Set(["Work"]),
    groupsHidingSettled: new Set(["Quiet", "Work"]),
    automationsHidingSettledEnvironmentIds: new Set([environmentId]),
    serverConfigs: new Map<EnvironmentId, Pick<ServerConfig, "environment">>([
      [
        environmentId,
        {
          environment: { capabilities: { threadSettlement: true, threadSnooze: true } },
        } as Pick<ServerConfig, "environment">,
      ],
    ]),
    scopedProjectKeys: new Set([`${environmentId}:${projectId}`]),
    optimisticDrop: null,
    workingShelfEnabled: false,
    sortActiveBySend: false,
    clockKey: "fixture",
    inboxReturns: createInboxReturnTracker(),
  });
  const ids = (threads: ReadonlyArray<{ id: string }>) => threads.map((entry) => entry.id).sort();
  expect(ids(result.settledThreads)).toEqual([
    "automation-settled",
    "quiet-settled",
    "work-settled",
  ]);
  expect(ids(result.automationThreads)).toEqual(["automation-live"]);
  expect(ids(result.groupedThreads)).toEqual(["quiet-live", "quiet-snoozed"]);
  expect(result.snoozedThreads).toEqual([]);
  expect(ids(result.activeThreads)).toEqual(["work-live"]);
  expect(result.shownGroupThreads).toEqual([{ thread: workLive, page: "threads" }]);
  expect(result.facetThreads.filter((facet) => facet.pages[0] === "settled")).toHaveLength(3);
  expect(
    result.facetThreads
      .filter((facet) => facet.pages.includes("group:Quiet"))
      .map(
        (facet) =>
          // Quiet's settled thread is not counted on the group page.
          facet.pages,
      ),
  ).toEqual([["group:Quiet"], ["group:Quiet"]]);
  expect(result.facetThreads).toContainEqual({
    environmentId,
    projectId,
    pages: ["threads", "group:Work"],
  });
});
