import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId } from "@t3tools/contracts";
import type { SidebarProjectGroupingMode } from "@t3tools/contracts/settings";
import { filterFacets } from "@t3tools/shared/filterFacets";

import { scopedProjectKey } from "../../lib/scopedEntities";
import {
  threadListV2MatchesSearch,
  threadListV2Pages,
  type ThreadListPage,
} from "../threads/threadListV2";
import type { HomeListFilterMenuProject } from "./home-list-filter-menu";
import { buildHomeProjectScopes, findHomeProjectScope } from "./homeThreadList";
import { repositoryOrganisationOf, type ThreadListOrganisation } from "./thread-list-organisations";

export interface ThreadListFilterFacets {
  readonly environmentCounts: ReadonlyMap<string, number>;
  /** The Project menu's choices: the environment's projects, narrowed to picked organisations. */
  readonly projects: ReadonlyArray<HomeListFilterMenuProject>;
  /** The Organisations menu's choices: owners of the picked environment and project's checkouts. */
  readonly organisations: ReadonlyArray<ThreadListOrganisation>;
  readonly pageCounts: ReadonlyMap<ThreadListPage, number>;
}

/**
 * The thread list filter menus' choices and counts. Each of Environment, Project, Organisations
 * and Show counts the threads matching the search that the other three let through, so a menu
 * says what picking a choice would leave. A pick the others exclude stays offered with a count
 * of 0, so it can be unpicked.
 */
export function buildThreadListFilterFacets(input: {
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly projectGroupingMode: SidebarProjectGroupingMode;
  readonly organisations: ReadonlyArray<ThreadListOrganisation>;
  readonly environmentId: EnvironmentId | null;
  readonly projectKey: string | null;
  readonly organisationKeys: ReadonlyArray<string>;
  readonly pages: ReadonlyArray<ThreadListPage>;
  readonly searchQuery: string;
  readonly matchedThreadKeys?: ReadonlySet<string>;
  /** How threads sort into Show pages; see threadListV2Pages. */
  readonly classification: Parameters<typeof threadListV2Pages>[1];
}): ThreadListFilterFacets {
  // Every environment's scopes, so a thread counts under its project whichever environment
  // is picked; the Project menu still offers only the picked environment's.
  const allScopes = buildHomeProjectScopes({
    projects: input.projects,
    environmentId: null,
    projectGroupingMode: input.projectGroupingMode,
  });
  const scopeKeyByRef = new Map<string, string>();
  for (const scope of allScopes) {
    for (const ref of scope.projectRefs) {
      scopeKeyByRef.set(scopedProjectKey(ref.environmentId, ref.projectId), scope.key);
    }
  }
  const organisationByRef = new Map<string, string>();
  for (const project of input.projects) {
    const organisation = repositoryOrganisationOf(project.repositoryIdentity);
    if (organisation) {
      organisationByRef.set(scopedProjectKey(project.environmentId, project.id), organisation.key);
    }
  }
  const pickedScope = findHomeProjectScope(allScopes, input.projectKey);
  const pickedRefs = new Set(
    pickedScope?.projectRefs.map((ref) => scopedProjectKey(ref.environmentId, ref.projectId)),
  );
  const refOf = (thread: EnvironmentThreadShell) =>
    scopedProjectKey(thread.environmentId, thread.projectId);
  const only = (value: string | undefined) => (value === undefined ? [] : [value]);

  const query = input.searchQuery.trim().toLocaleLowerCase();
  const threads = input.threads.filter(
    (thread) =>
      thread.archivedAt === null &&
      thread.lineage.relationshipToParent !== "subagent" &&
      threadListV2MatchesSearch(thread, query, input.matchedThreadKeys),
  );
  const facets = filterFacets(threads, {
    environment: {
      values: (thread) => [thread.environmentId],
      selected: input.environmentId === null ? [] : [input.environmentId],
    },
    project: {
      values: (thread) => only(scopeKeyByRef.get(refOf(thread))),
      selected: pickedScope === null ? [] : [pickedScope.key],
      matches: (thread) => pickedScope === null || pickedRefs.has(refOf(thread)),
    },
    organisation: {
      values: (thread) => only(organisationByRef.get(refOf(thread))),
      selected: input.organisationKeys,
    },
    page: {
      values: (thread) => threadListV2Pages(thread, input.classification),
      selected: input.pages,
    },
  });
  const counts = (choices: ReadonlyArray<{ value: string; count: number }>) =>
    new Map(choices.map((choice) => [choice.value, choice.count]));
  const projectCounts = counts(facets.project);
  const organisationCounts = counts(facets.organisation);

  const pickedOrganisations = new Set(input.organisationKeys);
  const organisationsOf = (projects: ReadonlyArray<EnvironmentProject>) =>
    projects.flatMap((project) => only(repositoryOrganisationOf(project.repositoryIdentity)?.key));
  const projects = buildHomeProjectScopes({
    projects: input.projects,
    environmentId: input.environmentId,
    projectGroupingMode: input.projectGroupingMode,
  })
    .filter(
      (scope) =>
        pickedOrganisations.size === 0 ||
        scope.key === input.projectKey ||
        organisationsOf(scope.projects).some((key) => pickedOrganisations.has(key)),
    )
    .map((scope) => ({
      key: scope.key,
      label: scope.title,
      count: projectCounts.get(scope.key) ?? 0,
    }));
  const inEnvironment = (project: EnvironmentProject) =>
    input.environmentId === null || project.environmentId === input.environmentId;
  const offeredOrganisations = new Set(
    organisationsOf((pickedScope?.projects ?? input.projects).filter(inEnvironment)),
  );
  const organisations = input.organisations
    .filter((option) => pickedOrganisations.has(option.key) || offeredOrganisations.has(option.key))
    .map((option) => ({ ...option, count: organisationCounts.get(option.key) ?? 0 }));
  return {
    environmentCounts: counts(facets.environment),
    projects,
    organisations,
    pageCounts: counts(facets.page) as ReadonlyMap<ThreadListPage, number>,
  };
}
