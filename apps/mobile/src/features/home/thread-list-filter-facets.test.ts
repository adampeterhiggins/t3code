import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  type RepositoryIdentity,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { makeThreadShellFixture } from "../../test-fixtures";
import type { ThreadListPage } from "../threads/threadListV2";
import { buildThreadListFilterFacets } from "./thread-list-filter-facets";
import { buildOrganisationOptions } from "./thread-list-organisations";

const local = EnvironmentId.make("local");
const remote = EnvironmentId.make("remote");
const now = "2026-06-02T00:00:00.000Z";

function project(environmentId: EnvironmentId, id: string, repository: string): EnvironmentProject {
  return {
    environmentId,
    id: ProjectId.make(id),
    title: id,
    workspaceRoot: `/workspaces/${environmentId}/${id}`,
    repositoryIdentity: { canonicalKey: repository } as RepositoryIdentity,
    defaultModelSelection: null,
    scripts: [],
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  };
}

function thread(
  owner: EnvironmentProject,
  id: string,
  input: Partial<EnvironmentThreadShell> = {},
): EnvironmentThreadShell {
  return makeThreadShellFixture({
    environmentId: owner.environmentId,
    projectId: owner.id,
    id: ThreadId.make(id),
    title: id,
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    archivedAt: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...input,
  });
}

const app = project(local, "app", "github.com/acme/app");
const site = project(local, "site", "github.com/me/site");
const api = project(remote, "api", "github.com/acme/api");
const projects = [app, site, api];
const threads = [
  thread(app, "Fix login"),
  thread(app, "Old work", { settledOverride: "settled" }),
  thread(site, "Landing page"),
  thread(site, "Later", { snoozedAt: now, snoozedUntil: "2026-06-03T00:00:00.000Z" }),
  thread(api, "Rate limits"),
];

function facets(input: {
  environmentId?: EnvironmentId | null;
  projectKey?: string | null;
  organisationKeys?: string[];
  pages?: ThreadListPage[];
  searchQuery?: string;
}) {
  return buildThreadListFilterFacets({
    threads,
    projects,
    projectGroupingMode: "separate",
    organisations: buildOrganisationOptions(projects),
    environmentId: input.environmentId ?? null,
    projectKey: input.projectKey ?? null,
    organisationKeys: input.organisationKeys ?? [],
    pages: input.pages ?? ["threads"],
    searchQuery: input.searchQuery ?? "",
    classification: { now },
  });
}

const keyOf = (label: string) => facets({}).projects.find((choice) => choice.label === label)!.key;

describe("buildThreadListFilterFacets", () => {
  it("counts each filter under the others but not itself", () => {
    const result = facets({ environmentId: local, organisationKeys: ["github.com/acme"] });
    // Another environment stays countable while one is picked.
    expect(Object.fromEntries(result.environmentCounts)).toEqual({ local: 1, remote: 1 });
    // Projects follow the environment and organisation, both in choices and counts.
    expect(result.projects).toEqual([{ key: keyOf("app"), label: "app", count: 1 }]);
    // Organisations are the environment's owners, counted without the organisation pick.
    expect(result.organisations.map(({ label, count }) => [label, count])).toEqual([
      ["acme", 1],
      ["me", 1],
    ]);
    expect(Object.fromEntries(result.pageCounts)).toEqual({ threads: 1, settled: 1 });
  });

  it("counts only threads matching the search", () => {
    const result = facets({ searchQuery: "login" });
    expect(Object.fromEntries(result.environmentCounts)).toEqual({ local: 1 });
    expect(Object.fromEntries(result.pageCounts)).toEqual({ threads: 1 });
  });

  it("keeps a pick the other filters exclude, with a count of 0", () => {
    const result = facets({ projectKey: keyOf("site"), organisationKeys: ["github.com/acme"] });
    expect(result.projects.find((choice) => choice.label === "site")?.count).toBe(0);
    expect(result.organisations.map(({ label, count }) => [label, count])).toEqual([
      ["acme", 0],
      ["me", 1],
    ]);
  });
});
