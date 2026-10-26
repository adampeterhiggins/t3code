import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";

import { makeThreadFixture } from "../../test-fixtures";
import { groupSidebarThreadsByName, projectSidebarPages } from "./pageProjection";
import { sidebarThreadView } from "./organization.logic";

const thread = (id: string, environment = "local") =>
  makeThreadFixture({
    id: ThreadId.make(id),
    environmentId: EnvironmentId.make(environment),
    groupName: "Work",
  });

describe("sidebar page projection", () => {
  it("keeps only the open environment's thread in a collapsed group", () => {
    const open = thread("same-id");
    const elsewhere = thread("same-id", "remote");
    const projection = projectSidebarPages({
      sidebarPages: ["threads", "group:Work", "group:Empty", "automations"],
      collapsedPages: new Set(["group:Work", "automations"]),
      sidebarRouteThreadKey: scopedThreadKey(scopeThreadRef(open.environmentId, open.id)),
      groupedThreadsByName: new Map([["Work", [elsewhere, open, thread("other")]]]),
      automationThreads: [thread("scheduled")],
      visibleSettledThreads: [thread("settled")],
      snoozedThreads: [],
      hiddenThreads: [],
    });
    expect(projection.visibleGroups).toEqual([
      { name: "Work", threads: [open] },
      { name: "Empty", threads: [] },
    ]);
    expect(projection.visibleAutomationThreads).toEqual([]);
    expect(projection.renderedSettledThreads).toEqual([]);
    expect(projection.showsThreads).toBe(true);
    expect(projection.threadsOnly).toBe(false);
  });

  it("lists Automations alongside Threads without disabling dragging", () => {
    const automation = thread("scheduled");
    const projection = projectSidebarPages({
      sidebarPages: ["threads", "automations"],
      collapsedPages: new Set(),
      sidebarRouteThreadKey: null,
      groupedThreadsByName: new Map(),
      automationThreads: [automation],
      visibleSettledThreads: [],
      snoozedThreads: [],
      hiddenThreads: [],
    });
    expect(projection.visibleAutomationThreads).toEqual([automation]);
    expect(projection.threadsOnly).toBe(true);
  });

  it("does not duplicate shown-in-Threads group members when their shelf is selected", () => {
    const grouped = thread("grouped");
    const automation = thread("scheduled");
    const shown = [{ thread: automation, page: "automations" as const }];
    expect(groupSidebarThreadsByName([grouped], shown, ["automations"]).get("Work")).toEqual([
      grouped,
    ]);
    expect(groupSidebarThreadsByName([grouped], shown, []).get("Work")).toEqual(
      expect.arrayContaining([grouped, automation]),
    );
  });

  it("uses group overrides only for groups and the grouped default for Automations", () => {
    const views = {
      ...DEFAULT_CLIENT_SETTINGS.sidebarThreadViews,
      grouped: "slim" as const,
      active: "card" as const,
    };
    const groups = { Work: { view: "card" as const } };
    expect(sidebarThreadView("grouped", "Work", groups, views)).toBe("card");
    expect(sidebarThreadView("grouped", "Missing", groups, views)).toBe("slim");
    expect(sidebarThreadView("automations", "Work", groups, views)).toBe("slim");
    expect(sidebarThreadView("active", "Work", groups, views)).toBe("card");
  });
});
