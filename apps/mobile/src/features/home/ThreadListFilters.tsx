import { Pressable, ScrollView } from "react-native";
import { SymbolView } from "../../components/AppSymbol";
import { ListFilterMenu } from "../workspace/ListFilterMenu";
import { isDefaultThreadListPages, threadListPageLabel } from "../threads/threadListV2";
import type { HomeHeaderProps } from "./HomeHeader.types";

export function ThreadListFilters(
  props: Pick<
    HomeHeaderProps,
    | "environments"
    | "projects"
    | "selectedEnvironmentId"
    | "selectedProjectKey"
    | "onEnvironmentChange"
    | "onProjectChange"
    | "pages"
    | "availablePages"
    | "onTogglePage"
    | "groups"
    | "onCreateGroup"
    | "organisations"
    | "organisationKeys"
    | "onToggleOrganisation"
    | "onClearOrganisations"
  >,
) {
  const selectedEnvironment = props.environments.find(
    (environment) => environment.environmentId === props.selectedEnvironmentId,
  );
  const selectedProject = props.projects.find(
    (project) => project.key === props.selectedProjectKey,
  );
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 2, paddingBottom: 10, gap: 8 }}
    >
      <ListFilterMenu
        label={selectedEnvironment?.label ?? "All environments"}
        accessibilityLabel="Filter threads by environment"
        active={selectedEnvironment !== undefined}
        actions={[
          {
            id: "all",
            title: "All environments",
            state: props.selectedEnvironmentId === null ? "on" : "off",
          },
          ...props.environments.map((environment) => ({
            id: JSON.stringify(environment.environmentId),
            title: environment.label,
            state:
              environment.environmentId === props.selectedEnvironmentId
                ? ("on" as const)
                : ("off" as const),
          })),
        ]}
        onSelect={(id) => {
          if (id === "all") props.onEnvironmentChange(null);
          else {
            const environment = props.environments.find(
              (candidate) => JSON.stringify(candidate.environmentId) === id,
            );
            if (environment) props.onEnvironmentChange(environment.environmentId);
          }
        }}
      />
      <ListFilterMenu
        label={selectedProject?.label ?? "All projects"}
        accessibilityLabel="Filter threads by project"
        active={selectedProject !== undefined}
        actions={[
          {
            id: "all",
            title: "All projects",
            state: props.selectedProjectKey === null ? "on" : "off",
          },
          ...props.projects.map((project) => ({
            id: JSON.stringify(project.key),
            title: project.label,
            state: project.key === props.selectedProjectKey ? ("on" as const) : ("off" as const),
          })),
        ]}
        onSelect={(id) => {
          if (id === "all") props.onProjectChange(null);
          else {
            const project = props.projects.find(
              (candidate) => JSON.stringify(candidate.key) === id,
            );
            if (project) props.onProjectChange(project.key);
          }
        }}
      />
      {props.organisations.length > 0 ? (
        <ListFilterMenu
          label={
            props.organisationKeys.length === 0
              ? "All organisations"
              : props.organisationKeys.length === 1
                ? (props.organisations.find(
                    (organisation) => organisation.key === props.organisationKeys[0],
                  )?.label ?? "1 organisation")
                : `${props.organisationKeys.length} organisations`
          }
          accessibilityLabel="Filter threads by organisation"
          active={props.organisationKeys.length > 0}
          actions={[
            {
              id: "all",
              title: "All organisations",
              state: props.organisationKeys.length === 0 ? "on" : "off",
            },
            ...props.organisations.map((organisation) => ({
              id: JSON.stringify(organisation.key),
              title: organisation.label,
              state: props.organisationKeys.includes(organisation.key)
                ? ("on" as const)
                : ("off" as const),
            })),
          ]}
          onSelect={(id) => {
            if (id === "all") props.onClearOrganisations();
            else {
              const organisation = props.organisations.find(
                (candidate) => JSON.stringify(candidate.key) === id,
              );
              if (organisation) props.onToggleOrganisation(organisation.key);
            }
          }}
        />
      ) : null}
      <ListFilterMenu
        label="Show"
        accessibilityLabel="Choose which thread pages to show"
        active={!isDefaultThreadListPages(props.pages)}
        actions={[
          ...props.availablePages.map((page) => ({
            id: JSON.stringify(page),
            title: threadListPageLabel(page, props.groups),
            state: props.pages.includes(page) ? ("on" as const) : ("off" as const),
          })),
          ...(props.onCreateGroup ? [{ id: "new-group", title: "New group…" }] : []),
        ]}
        onSelect={(id) => {
          if (id === "new-group") props.onCreateGroup?.();
          else {
            const page = props.availablePages.find((candidate) => JSON.stringify(candidate) === id);
            if (page) props.onTogglePage(page);
          }
        }}
      />
      {props.selectedEnvironmentId !== null || props.selectedProjectKey !== null ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Reset thread filters"
          className="h-8 w-8 items-center justify-center"
          onPress={() => {
            props.onEnvironmentChange(null);
            props.onProjectChange(null);
          }}
        >
          <SymbolView name="xmark.circle.fill" size={18} tintColorClassName="accent-icon-muted" />
        </Pressable>
      ) : null}
    </ScrollView>
  );
}
