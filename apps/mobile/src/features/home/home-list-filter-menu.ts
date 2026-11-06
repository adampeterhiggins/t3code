import type { AppBarMenuItem } from "../../components/ui/AppBar.types";
import type { EnvironmentId } from "@t3tools/contracts";

import type { ThreadGroups } from "@t3tools/contracts/settings";

import { threadListPageLabel, type ThreadListPage } from "../threads/threadListV2";
import type { ThreadListOrganisation } from "./thread-list-organisations";

export interface HomeListFilterMenuEnvironment {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  /** Threads picking it would show under the other filters; see buildThreadListFilterFacets. */
  readonly count?: number;
}

export interface HomeListFilterMenuProject {
  readonly key: string;
  readonly label: string;
  readonly count?: number;
}

/** A filter choice's menu title, with how many threads picking it would show. Native menus
    have no trailing column on every platform, so the count follows the label. */
export function filterChoiceTitle(label: string, count: number | undefined): string {
  return count === undefined ? label : `${label} (${count})`;
}

export function buildHomeListFilterMenuItems(props: {
  readonly environments: ReadonlyArray<HomeListFilterMenuEnvironment>;
  readonly projects: ReadonlyArray<HomeListFilterMenuProject>;
  readonly selectedEnvironmentId: EnvironmentId | null;
  readonly selectedProjectKey: string | null;
  readonly onEnvironmentChange: (environmentId: EnvironmentId | null) => void;
  readonly onProjectChange: (projectKey: string | null) => void;
  readonly pages: ReadonlyArray<ThreadListPage>;
  /** Pages offered in the Show submenu, from availableThreadListPages. */
  readonly availablePages: ReadonlyArray<ThreadListPage>;
  readonly onTogglePage: (page: ThreadListPage) => void;
  /** Threads each page would show under the other filters. */
  readonly pageCounts?: ReadonlyMap<ThreadListPage, number>;
  /** Registered groups, for the emoji prefix on group pages. */
  readonly groups?: ThreadGroups;
  /** Adds "New group…" to Show; omitted when no environment supports groups. */
  readonly onCreateGroup?: () => void;
  /** Repository owners of the checkouts; multi-select, none picked means all. */
  readonly organisations: ReadonlyArray<ThreadListOrganisation>;
  readonly organisationKeys: ReadonlyArray<string>;
  readonly onToggleOrganisation: (key: string) => void;
  readonly onClearOrganisations: () => void;
}): AppBarMenuItem[] {
  const items: AppBarMenuItem[] = [];

  items.push({
    id: "environment",
    title: "Environment",
    items: [
      {
        id: "environment:all",
        title: "All environments",
        subtitle: "Show threads from every environment",
        selected: props.selectedEnvironmentId === null,
        onPress: () => props.onEnvironmentChange(null),
      },
      ...props.environments.map((environment) => ({
        id: `environment:${environment.environmentId}`,
        title: filterChoiceTitle(environment.label, environment.count),
        selected: props.selectedEnvironmentId === environment.environmentId,
        onPress: () => props.onEnvironmentChange(environment.environmentId),
      })),
    ],
  });

  if (props.organisations.length > 0) {
    items.push({
      id: "organisations",
      title: "Organisations",
      items: [
        {
          id: "organisation:all",
          title: "All organisations",
          subtitle: "Show threads from every organisation",
          selected: props.organisationKeys.length === 0,
          onPress: props.onClearOrganisations,
        },
        ...props.organisations.map((organisation) => ({
          id: `organisation:${organisation.key}`,
          title: filterChoiceTitle(organisation.label, organisation.count),
          selected: props.organisationKeys.includes(organisation.key),
          onPress: () => props.onToggleOrganisation(organisation.key),
        })),
      ],
    });
  }

  if (props.projects.length > 0) {
    items.push({
      id: "project",
      title: "Project",
      items: [
        {
          id: "project:all",
          title: "All projects",
          subtitle: "Show threads from every project",
          selected: props.selectedProjectKey === null,
          onPress: () => props.onProjectChange(null),
        },
        ...props.projects.map((project) => ({
          id: `project:${project.key}`,
          title: filterChoiceTitle(project.label, project.count),
          selected: props.selectedProjectKey === project.key,
          onPress: () => props.onProjectChange(project.key),
        })),
      ],
    });
  }

  // Multi-select: each page toggles; the last selected page stays on.
  items.push({
    id: "show",
    title: "Show",
    items: [
      ...props.availablePages.map((page) => ({
        id: `page:${page}`,
        title: filterChoiceTitle(
          threadListPageLabel(page, props.groups),
          props.pageCounts?.get(page),
        ),
        selected: props.pages.includes(page),
        onPress: () => props.onTogglePage(page),
      })),
      ...(props.onCreateGroup
        ? [{ id: "new-group", title: "New group…", onPress: props.onCreateGroup }]
        : []),
    ],
  });

  return items;
}
