import { describe, expect, it } from "vite-plus/test";

import { threadMoveTargets } from "./projects.ts";

describe("threadMoveTargets", () => {
  const thread = {
    environmentId: "env-a",
    projectId: "current",
    lineage: { relationshipToParent: null },
  };
  const projects = [
    { environmentId: "env-a", id: "current", title: "Current" },
    { environmentId: "env-a", id: "web", title: "Web" },
    { environmentId: "env-a", id: "api", title: "API" },
    { environmentId: "env-b", id: "remote", title: "Remote" },
  ];

  it("lists the other projects in the thread's environment, by title", () => {
    expect(threadMoveTargets(thread, projects, true)).toEqual([
      { id: "api", label: "API" },
      { id: "web", label: "Web" },
    ]);
  });

  it("offers no move where the server can't, or for a subagent", () => {
    expect(threadMoveTargets(thread, projects, false)).toBeNull();
    expect(
      threadMoveTargets(
        { ...thread, lineage: { relationshipToParent: "subagent" } },
        projects,
        true,
      ),
    ).toBeNull();
  });
});
