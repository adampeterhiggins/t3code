import {
  repositoryGroupingKeyOf,
  type EnvironmentId,
  type ProjectId,
  type RepositoryIdentity,
} from "@t3tools/contracts";
import type { Organisations } from "@t3tools/contracts/settings";

export interface ThreadListOrganisation {
  readonly key: string;
  readonly label: string;
}

interface OrganisationProject {
  readonly environmentId: EnvironmentId;
  readonly id: ProjectId;
  readonly repositoryIdentity?: RepositoryIdentity | null;
}

interface ProjectRef {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
}

/**
 * The organisation a checkout's repository belongs to, keyed by host and owner
 * so two hosts' same-named owners stay apart. A fork counts under its own
 * remote's owner. Null without a remote. Mirrors web's repositoryOrganisationOf.
 */
export function repositoryOrganisationOf(
  identity: RepositoryIdentity | null | undefined,
): ThreadListOrganisation | null {
  if (!identity) return null;
  const segments = repositoryGroupingKeyOf(identity).split("/");
  if (segments.length < 3) return null;
  const owner = segments.at(-2)!;
  return { key: segments.slice(0, -1).join("/"), label: owner };
}

/**
 * Organisations of every checkout, by label: the chosen name, else the owner, and the same
 * owner on two hosts shows its host.
 */
export function buildOrganisationOptions(
  projects: ReadonlyArray<Pick<OrganisationProject, "repositoryIdentity">>,
  organisations: Organisations = {},
): ReadonlyArray<ThreadListOrganisation> {
  const byKey = new Map<string, ThreadListOrganisation>();
  for (const project of projects) {
    const organisation = repositoryOrganisationOf(project.repositoryIdentity);
    if (organisation) byKey.set(organisation.key, organisation);
  }
  const options = [...byKey.values()];
  const labelCounts = new Map<string, number>();
  for (const option of options) {
    labelCounts.set(option.label, (labelCounts.get(option.label) ?? 0) + 1);
  }
  return options
    .map((option) => ({
      ...option,
      label:
        organisations[option.key]?.name ??
        ((labelCounts.get(option.label) ?? 0) > 1 ? option.key : option.label),
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

/** Multi-select toggle for the Organisations filter; none picked means all. */
export function toggleOrganisationKey(
  keys: ReadonlyArray<string>,
  key: string,
): ReadonlyArray<string> {
  return keys.includes(key) ? keys.filter((candidate) => candidate !== key) : [...keys, key];
}

/**
 * The project refs the thread list is scoped to: the project filter's refs (or
 * every checkout) narrowed to checkouts in a picked organisation. Organisations
 * are per checkout, since a project can hold a fork and its upstream. Picked
 * organisations that no longer have a checkout stop narrowing. Null when
 * nothing narrows the list.
 */
export function scopeProjectRefsByOrganisations(input: {
  readonly projects: ReadonlyArray<OrganisationProject>;
  readonly projectRefs: ReadonlyArray<ProjectRef> | null;
  readonly organisationKeys: ReadonlyArray<string>;
}): ReadonlyArray<ProjectRef> | null {
  const known = new Set(
    buildOrganisationOptions(input.projects).map((organisation) => organisation.key),
  );
  const organisations = new Set(input.organisationKeys.filter((key) => known.has(key)));
  if (organisations.size === 0) return input.projectRefs;
  const organisationByProject = new Map(
    input.projects.map((project) => [
      `${project.environmentId}:${project.id}`,
      repositoryOrganisationOf(project.repositoryIdentity)?.key,
    ]),
  );
  const refs =
    input.projectRefs ??
    input.projects.map((project) => ({
      environmentId: project.environmentId,
      projectId: project.id,
    }));
  return refs.filter((ref) =>
    organisations.has(organisationByProject.get(`${ref.environmentId}:${ref.projectId}`) ?? ""),
  );
}
