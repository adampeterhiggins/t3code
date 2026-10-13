import type { LinearFilterOptions } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { DEFAULT_LINEAR_ISSUE_FILTERS } from "./LinearIssueFilters";
import { narrowLinearFilterOptions } from "./linearIssueFilters.logic";

const options: LinearFilterOptions = {
  teams: [
    { id: "eng", key: "ENG", name: "Engineering" },
    { id: "des", key: "DES", name: "Design" },
    { id: "ops", key: "OPS", name: "Operations" },
  ],
  states: [],
  projects: [
    {
      id: "api",
      name: "API",
      teamIds: ["eng"],
      milestones: [{ id: "api-beta", name: "Beta" }],
    },
    {
      id: "app",
      name: "App",
      teamIds: ["eng", "des"],
      milestones: [{ id: "app-ga", name: "GA" }],
    },
    { id: "infra", name: "Infra", teamIds: ["ops"], milestones: [] },
  ],
  users: [],
  labels: [],
};

const narrow = (patch: Partial<typeof DEFAULT_LINEAR_ISSUE_FILTERS>) => {
  const result = narrowLinearFilterOptions(options, { ...DEFAULT_LINEAR_ISSUE_FILTERS, ...patch });
  return {
    teams: result.teams.map((team) => team.id),
    projects: result.projects.map((project) => project.id),
    milestones: result.milestoneGroups.flatMap((group) => group.milestones.map((m) => m.id)),
  };
};

describe("narrowLinearFilterOptions", () => {
  it("offers everything when nothing is picked", () => {
    expect(narrow({})).toEqual({
      teams: ["eng", "des", "ops"],
      projects: ["api", "app", "infra"],
      milestones: ["api-beta", "app-ga"],
    });
  });

  it("narrows teams to the picked projects' teams, but not projects by themselves", () => {
    expect(narrow({ projectIds: ["app"] })).toMatchObject({
      teams: ["eng", "des"],
      projects: ["api", "app", "infra"],
      milestones: ["app-ga"],
    });
  });

  it("leaves teams whole when No project is picked", () => {
    expect(narrow({ projectIds: ["api", "none"] }).teams).toEqual(["eng", "des", "ops"]);
  });

  it("narrows projects and milestones to the picked teams", () => {
    expect(narrow({ teamIds: ["des"] })).toEqual({
      teams: ["eng", "des", "ops"],
      projects: ["app"],
      milestones: ["app-ga"],
    });
  });

  it("keeps picks the other filters rule out, so they can be unpicked", () => {
    expect(narrow({ teamIds: ["ops"], projectIds: ["api"], milestoneIds: ["app-ga"] })).toEqual({
      teams: ["eng", "ops"],
      projects: ["api", "infra"],
      milestones: ["api-beta", "app-ga"],
    });
  });
});
