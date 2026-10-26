import { expect, it } from "vite-plus/test";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
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
    serverConfigs: new Map(),
    scopedProjectKeys: new Set([`${environmentId}:${projectId}`]),
    optimisticDrop: null,
    workingShelfEnabled: false,
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
