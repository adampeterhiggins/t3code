import { Toolbar } from "../../components/ui/Toolbar";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { use, useEffect, useRef } from "react";
import { useNavigation, type ParamListBase } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Platform } from "react-native";
import type { SearchBarCommands } from "react-native-screens";
import { NativePrimaryColumnContext } from "../../native/v5-workspace-context";
import { useUniwindTheme } from "../../lib/useUniwindTheme";
import { useHardwareKeyboardCommand } from "../keyboard/hardwareKeyboardCommands";
import { withNativeGlassHeaderItem } from "../layout/native-glass-header-items";
import { createNativeMailSearchToolbarItem } from "../layout/native-mail-search-toolbar";
import { useNativeMailSearchToolbar } from "../../native/use-native-mail-search-toolbar";
import { isDefaultThreadListPages, threadListPageLabel } from "../threads/threadListV2";
import { buildHomeListFilterMenu, filterChoiceTitle } from "./home-list-filter-menu";
import { useDeviceType } from "../../native/native-layout-metrics";
import { createSidebarHeaderItems } from "../threads/sidebar-native-header-items";
import type { HomeHeaderProps } from "./HomeHeader.types";
import { useAdaptiveWorkspaceLayout } from "../layout/AdaptiveWorkspaceLayout";

export type { HomeHeaderEnvironment } from "./HomeHeader.types";

export function HomeHeader(props: HomeHeaderProps) {
  const navigation = useNavigation<NativeStackNavigationProp<ParamListBase>>();
  const { layout, panes, togglePrimarySidebar } = useAdaptiveWorkspaceLayout();
  const usesNativeMailSearchToolbar = useNativeMailSearchToolbar();
  const deviceType = useDeviceType();
  const primaryColumn = use(NativePrimaryColumnContext);
  const sidebarHeader =
    Platform.OS === "ios" &&
    primaryColumn !== null &&
    (deviceType === "pad" || !usesNativeMailSearchToolbar);
  const showsCompactCompose = deviceType === "pad" && !layout.usesSplitView;
  const searchBarRef = useRef<SearchBarCommands>(null);
  const focusAfterReveal = useRef(false);
  useEffect(
    () =>
      navigation.addListener("transitionEnd", (event) => {
        if (focusAfterReveal.current && !event.data.closing) {
          focusAfterReveal.current = false;
          searchBarRef.current?.focus();
        }
      }),
    [navigation],
  );
  const iconColor = useUniwindTheme()["--color-icon"];
  const hasCustomListOptions =
    props.selectedEnvironmentId !== null ||
    props.selectedProjectKey !== null ||
    props.organisationKeys.length > 0 ||
    !isDefaultThreadListPages(props.pages);
  const focusSearch = () => {
    if (primaryColumn && !panes.primarySidebarVisible) {
      focusAfterReveal.current = true;
      togglePrimarySidebar();
      return true;
    }
    searchBarRef.current?.focus();
    return searchBarRef.current !== null;
  };
  useHardwareKeyboardCommand("focusSearch", focusSearch);
  const filterMenu = buildHomeListFilterMenu(props);

  if (props.usesWorkspaceToolbar) {
    return null;
  }

  return (
    <>
      <NativeStackScreenOptions
        optionsVersion={[filterMenu.items, showsCompactCompose]}
        options={{
          headerTintColor: iconColor,
          unstable_headerRightItems: () =>
            sidebarHeader
              ? [
                  ...createSidebarHeaderItems({
                    filterIcon: hasCustomListOptions
                      ? "line.3.horizontal.decrease.circle.fill"
                      : "line.3.horizontal.decrease.circle",
                    filterMenu,
                    onOpenSettings: props.onOpenSettings,
                  }),
                  ...(showsCompactCompose
                    ? [
                        withNativeGlassHeaderItem({
                          accessibilityLabel: "New task",
                          axisBehavior: "horizontalOnly",
                          icon: { name: "square.and.pencil", type: "sfSymbol" } as const,
                          identifier: "home-new-task",
                          label: "",
                          onPress: props.onStartNewTask,
                          type: "button",
                        }),
                      ]
                    : []),
                ]
              : [
                  withNativeGlassHeaderItem({
                    accessibilityLabel: "Open settings",
                    icon: { name: "ellipsis", type: "sfSymbol" } as const,
                    identifier: "home-settings",
                    label: "",
                    onPress: props.onOpenSettings,
                    type: "button",
                  }),
                ],
          // The keys below are set per-branch (not `undefined`) so a later
          // reapply cannot clobber options owned by Toolbar.
          ...(sidebarHeader
            ? {
                headerSearchBarOptions: {
                  ref: searchBarRef,
                  autoCapitalize: "none" as const,
                  hideNavigationBar: false,
                  hideWhenScrolling: false,
                  obscureBackground: false,
                  placement: "stacked" as const,
                  allowToolbarIntegration: false,
                  placeholder: "Search",
                  onCancelButtonPress: () => props.onSearchQueryChange(""),
                  onChangeText: (event) => props.onSearchQueryChange(event.nativeEvent.text),
                },
                unstable_headerToolbarItems: () => [],
              }
            : usesNativeMailSearchToolbar
              ? {
                  headerSearchBarOptions: {
                    ref: searchBarRef,
                    autoCapitalize: "none" as const,
                    onCancelButtonPress: () => props.onSearchQueryChange(""),
                  },
                  unstable_headerToolbarItems: () => [
                    createNativeMailSearchToolbarItem({
                      composeButtonId: "home-new-task",
                      composeSystemImageName: "square.and.pencil",
                      filterMenu,
                      filterButtonId: "home-filter",
                      filterSystemImageName: hasCustomListOptions
                        ? "line.3.horizontal.decrease.circle.fill"
                        : "line.3.horizontal.decrease",
                      onComposePress: props.onStartNewTask,
                      onSearchTextChange: props.onSearchQueryChange,
                      placeholder: "Search",
                      searchTextChangeId: "home-search-text",
                      showsSearchDismissButton: true,
                    }),
                  ],
                }
              : {
                  headerSearchBarOptions: {
                    ref: searchBarRef,
                    autoCapitalize: "none" as const,
                    hideNavigationBar: false,
                    placeholder: "Search",
                    onCancelButtonPress: () => {
                      props.onSearchQueryChange("");
                    },
                    onChangeText: (event) => {
                      props.onSearchQueryChange(event.nativeEvent.text);
                    },
                  },
                }),
        }}
      />

      {sidebarHeader || usesNativeMailSearchToolbar ? null : (
        <Toolbar placement="bottom">
          <Toolbar.Menu
            accessibilityLabel="Filter threads"
            icon={
              hasCustomListOptions
                ? "line.3.horizontal.decrease.circle.fill"
                : "line.3.horizontal.decrease.circle"
            }
            title="Thread list options"
            separateBackground
          >
            <Toolbar.Menu title="Environment">
              <Toolbar.Label>Environment</Toolbar.Label>
              <Toolbar.MenuAction
                isOn={props.selectedEnvironmentId === null}
                onPress={() => props.onEnvironmentChange(null)}
                subtitle="Show threads from every environment"
              >
                <Toolbar.Label>All environments</Toolbar.Label>
              </Toolbar.MenuAction>
              {props.environments.map((environment) => (
                <Toolbar.MenuAction
                  key={environment.environmentId}
                  isOn={props.selectedEnvironmentId === environment.environmentId}
                  onPress={() => props.onEnvironmentChange(environment.environmentId)}
                >
                  <Toolbar.Label>
                    {filterChoiceTitle(environment.label, environment.count)}
                  </Toolbar.Label>
                </Toolbar.MenuAction>
              ))}
            </Toolbar.Menu>

            {props.organisations.length > 0 ? (
              <Toolbar.Menu title="Organisations">
                <Toolbar.Label>Organisations</Toolbar.Label>
                <Toolbar.MenuAction
                  isOn={props.organisationKeys.length === 0}
                  onPress={props.onClearOrganisations}
                  subtitle="Show threads from every organisation"
                >
                  <Toolbar.Label>All organisations</Toolbar.Label>
                </Toolbar.MenuAction>
                {props.organisations.map((organisation) => (
                  <Toolbar.MenuAction
                    key={organisation.key}
                    isOn={props.organisationKeys.includes(organisation.key)}
                    onPress={() => props.onToggleOrganisation(organisation.key)}
                  >
                    <Toolbar.Label>
                      {filterChoiceTitle(organisation.label, organisation.count)}
                    </Toolbar.Label>
                  </Toolbar.MenuAction>
                ))}
              </Toolbar.Menu>
            ) : null}

            {props.projects.length > 0 ? (
              <Toolbar.Menu title="Project">
                <Toolbar.Label>Project</Toolbar.Label>
                <Toolbar.MenuAction
                  isOn={props.selectedProjectKey === null}
                  onPress={() => props.onProjectChange(null)}
                  subtitle="Show threads from every project"
                >
                  <Toolbar.Label>All projects</Toolbar.Label>
                </Toolbar.MenuAction>
                {props.projects.map((project) => (
                  <Toolbar.MenuAction
                    key={project.key}
                    isOn={props.selectedProjectKey === project.key}
                    onPress={() => props.onProjectChange(project.key)}
                  >
                    <Toolbar.Label>{filterChoiceTitle(project.label, project.count)}</Toolbar.Label>
                  </Toolbar.MenuAction>
                ))}
              </Toolbar.Menu>
            ) : null}
            <Toolbar.Menu title="Show">
              <Toolbar.Label>Show</Toolbar.Label>
              {props.availablePages.map((page) => (
                <Toolbar.MenuAction
                  key={page}
                  isOn={props.pages.includes(page)}
                  onPress={() => props.onTogglePage(page)}
                >
                  <Toolbar.Label>
                    {filterChoiceTitle(
                      threadListPageLabel(page, props.groups),
                      props.pageCounts?.get(page),
                    )}
                  </Toolbar.Label>
                </Toolbar.MenuAction>
              ))}
              {props.onCreateGroup ? (
                <Toolbar.MenuAction onPress={props.onCreateGroup}>
                  <Toolbar.Label>New group…</Toolbar.Label>
                </Toolbar.MenuAction>
              ) : null}
            </Toolbar.Menu>
          </Toolbar.Menu>
          <Toolbar.Spacer flexible />
          <Toolbar.Button
            accessibilityLabel="New task"
            icon="square.and.pencil"
            onPress={props.onStartNewTask}
            separateBackground
          />
        </Toolbar>
      )}
    </>
  );
}
