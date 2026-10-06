import type { MenuAction } from "@react-native-menu/menu";
import { useCallback, useMemo } from "react";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { MaterialThreadListToolbar } from "./MaterialThreadListToolbar";
import type { HomeHeaderProps } from "./HomeHeader.types";
import { isDefaultThreadListPages, threadListPageLabel } from "../threads/threadListV2";

export type { HomeHeaderEnvironment } from "./HomeHeader.types";

function checkedMenuState(checked: boolean) {
  return checked ? ("on" as const) : undefined;
}

export function HomeHeader(props: HomeHeaderProps) {
  // The list uses a fixed creation order and ignores sort/group options, so
  // the filter menu only carries the filters and the "customized" icon state
  // keys off those alone.
  const hasCustomListOptions =
    props.selectedEnvironmentId !== null ||
    props.selectedProjectKey !== null ||
    props.organisationKeys.length > 0 ||
    !isDefaultThreadListPages(props.pages);
  const menuActions = useMemo<MenuAction[]>(
    () => [
      {
        id: "environment",
        title: "Environment",
        subactions: [
          {
            id: "environment:all",
            title: "All environments",
            state: checkedMenuState(props.selectedEnvironmentId === null),
          },
          ...props.environments.map((environment) => ({
            id: `environment:${environment.environmentId}`,
            title: environment.label,
            state: checkedMenuState(props.selectedEnvironmentId === environment.environmentId),
          })),
        ],
      },
      ...(props.organisations.length === 0
        ? []
        : ([
            {
              id: "organisation",
              title: "Organisations",
              subactions: [
                {
                  id: "organisation:all",
                  title: "All organisations",
                  state: checkedMenuState(props.organisationKeys.length === 0),
                },
                ...props.organisations.map((organisation) => ({
                  id: `organisation:${organisation.key}`,
                  title: organisation.label,
                  state: checkedMenuState(props.organisationKeys.includes(organisation.key)),
                })),
              ],
            },
          ] satisfies MenuAction[])),
      ...(props.projects.length === 0
        ? []
        : ([
            {
              id: "project",
              title: "Project",
              subactions: [
                {
                  id: "project:all",
                  title: "All projects",
                  state: checkedMenuState(props.selectedProjectKey === null),
                },
                ...props.projects.map((project) => ({
                  id: `project:${project.key}`,
                  title: project.label,
                  state: checkedMenuState(props.selectedProjectKey === project.key),
                })),
              ],
            },
          ] satisfies MenuAction[])),
      {
        id: "page",
        title: "Show",
        subactions: [
          ...props.availablePages.map((page) => ({
            id: `page:${page}`,
            title: threadListPageLabel(page, props.groups),
            state: checkedMenuState(props.pages.includes(page)),
          })),
          ...(props.onCreateGroup ? [{ id: "new-group", title: "New group…" }] : []),
        ],
      },
    ],
    [
      props.environments,
      props.availablePages,
      props.groups,
      props.onCreateGroup,
      props.organisationKeys,
      props.organisations,
      props.pages,
      props.projects,
      props.selectedEnvironmentId,
      props.selectedProjectKey,
    ],
  );
  const handleMenuAction = useCallback(
    (event: { nativeEvent: { event: string } }) => {
      const id = event.nativeEvent.event;
      if (id === "environment:all") {
        props.onEnvironmentChange(null);
        return;
      }

      if (id.startsWith("environment:")) {
        const environmentId = id.slice("environment:".length);
        const environment = props.environments.find(
          (candidate) => candidate.environmentId === environmentId,
        );
        if (environment) {
          props.onEnvironmentChange(environment.environmentId);
        }
        return;
      }

      if (id === "organisation:all") {
        props.onClearOrganisations();
        return;
      }
      if (id.startsWith("organisation:")) {
        const key = id.slice("organisation:".length);
        if (props.organisations.some((organisation) => organisation.key === key)) {
          props.onToggleOrganisation(key);
        }
        return;
      }
      if (id === "new-group") {
        props.onCreateGroup?.();
        return;
      }
      const page = props.availablePages.find((candidate) => id === `page:${candidate}`);
      if (page !== undefined) {
        props.onTogglePage(page);
        return;
      }

      if (id === "project:all") {
        props.onProjectChange(null);
        return;
      }

      if (id.startsWith("project:")) {
        const projectKey = id.slice("project:".length);
        if (props.projects.some((project) => project.key === projectKey)) {
          props.onProjectChange(projectKey);
        }
        return;
      }
    },
    [props],
  );

  return (
    <>
      <NativeStackScreenOptions options={{ headerShown: false }} />
      <MaterialThreadListToolbar
        searchQuery={props.searchQuery}
        onSearchQueryChange={props.onSearchQueryChange}
        filterActions={menuActions}
        filterCustomized={hasCustomListOptions}
        onFilterAction={handleMenuAction}
        onOpenSettings={props.onOpenSettings}
        onOpenEnvironments={props.onOpenEnvironments}
      />
    </>
  );
}
