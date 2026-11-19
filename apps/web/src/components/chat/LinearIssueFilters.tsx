import type {
  EnvironmentId,
  LinearFilterOptions,
  LinearIssueFilters,
  LinearIssueSort,
} from "@t3tools/contracts";
import {
  ArrowDownUpIcon,
  BoxIcon,
  CircleDotIcon,
  FlagIcon,
  ListFilterIcon,
  SignalIcon,
  TagIcon,
  UserIcon,
  UsersIcon,
} from "lucide-react";
import { msg, T, useGT, useMessages, Var } from "gt-react";
import { type ReactNode, useState } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { FilterPill } from "../FilterPill";
import { MenuChoiceLabel } from "../MenuChoiceLabel";
import { Button } from "../ui/button";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuLoadingItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSearch,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "../ui/menu";
import { narrowLinearFilterOptions } from "./linearIssueFilters.logic";

export const DEFAULT_LINEAR_ISSUE_FILTERS: LinearIssueFilters = {
  assigneeIds: ["me"],
  teamIds: [],
  projectIds: [],
  milestoneIds: [],
  stateNames: [],
  priorities: [],
  labelNames: [],
  includeClosed: false,
};
export const DEFAULT_LINEAR_ISSUE_SORT: LinearIssueSort = { field: "updated", direction: "desc" };

interface PickerView {
  readonly filters: LinearIssueFilters;
  readonly sort: LinearIssueSort;
}

/** The picker's filters and sort, remembered per environment on this device. */
export const useLinearIssuePickerViewStore = create<{
  viewsByEnvironmentId: Readonly<Record<string, PickerView>>;
  setView: (environmentId: EnvironmentId, view: PickerView) => void;
}>()(
  persist(
    (set) => ({
      viewsByEnvironmentId: {},
      setView: (environmentId, view) =>
        set((state) => ({
          viewsByEnvironmentId: { ...state.viewsByEnvironmentId, [environmentId]: view },
        })),
    }),
    { name: "t3code:linear-issue-picker:v1", storage: createJSONStorage(() => localStorage) },
  ),
);

// One shared object: a selector that builds a fresh default each call never settles and loops.
const DEFAULT_PICKER_VIEW: PickerView = {
  filters: DEFAULT_LINEAR_ISSUE_FILTERS,
  sort: DEFAULT_LINEAR_ISSUE_SORT,
};

export function useLinearIssuePickerView(environmentId: EnvironmentId): PickerView {
  return useLinearIssuePickerViewStore(
    (state) => state.viewsByEnvironmentId[environmentId] ?? DEFAULT_PICKER_VIEW,
  );
}

const PRIORITIES: ReadonlyArray<{ value: number; label: string }> = [
  { value: 1, label: msg("Urgent", { $context: "Linear issue priority" }) },
  { value: 2, label: msg("High", { $context: "Linear issue priority" }) },
  { value: 3, label: msg("Medium", { $context: "Linear issue priority" }) },
  { value: 4, label: msg("Low", { $context: "Linear issue priority" }) },
  { value: 0, label: msg("No priority", { $context: "Linear issue priority" }) },
];

const STATE_TYPE_LABELS: Readonly<Record<string, string>> = {
  triage: msg("Triage", { $context: "Linear issue status group" }),
  backlog: msg("Backlog", { $context: "Linear issue status group" }),
  unstarted: msg("Todo", { $context: "Linear issue status group" }),
  started: msg("In progress", { $context: "Linear issue status group" }),
  completed: msg("Done", { $context: "Linear issue status group" }),
  canceled: msg("Canceled", { $context: "Linear issue status group" }),
};

const SORT_LABELS: Readonly<Record<LinearIssueSort["field"], string>> = {
  updated: msg("Updated", { $context: "sort by date updated" }),
  created: msg("Created", { $context: "sort by date created" }),
  priority: msg("Priority", { $context: "sort by priority" }),
  dueDate: msg("Due date", { $context: "sort by due date" }),
  status: msg("Status", { $context: "sort by status" }),
  title: msg("Title", { $context: "sort by title" }),
};

function toggle<T>(values: ReadonlyArray<T>, value: T, checked: boolean): T[] {
  return checked
    ? [...values.filter((item) => item !== value), value]
    : values.filter((item) => item !== value);
}

interface FilterDimension {
  readonly id: string;
  readonly label: string;
  readonly items: ReactNode;
}

/** One dimension's picks: what is selected, ticking a choice, and "Only". */
interface Selection<T> {
  readonly selected: ReadonlyArray<T>;
  readonly onToggle: (value: T, checked: boolean) => void;
  readonly onOnly: (value: T) => void;
}

interface AppliedFilter {
  readonly key: string;
  readonly icon: ReactNode;
  readonly label: string;
  readonly remove: () => void;
}

/**
 * Filters for the issue picker: a Filter menu with a submenu per dimension, Sort, and each
 * applied selection as a removable pill on its own row below. Team, project, and milestone
 * choices narrow to what the other picks allow (`narrowLinearFilterOptions`). Menus show no
 * counts: issues are filtered by Linear and capped, so the loaded ones cannot say how many each
 * choice would match. Statuses and labels match by name across teams; search text applies on top.
 */
export function LinearIssueFilterBar(props: {
  options: LinearFilterOptions | null;
  optionsError: string | null;
  optionsPending: boolean;
  onRetryOptions: () => void;
  view: PickerView;
  searching: boolean;
  onChange: (view: PickerView) => void;
}) {
  const { options, view } = props;
  const { filters, sort } = view;
  const gt = useGT();
  const resolve = useMessages();
  const [menuOpen, setMenuOpen] = useState(false);
  const setFilters = (patch: Partial<LinearIssueFilters>) =>
    props.onChange({ ...view, filters: { ...filters, ...patch } });
  const unavailableOptions = (emptyLabel: string) => {
    if (props.optionsPending && options !== null) return null;
    if (options === null && (props.optionsPending || props.optionsError === null)) {
      return (
        <MenuLoadingItem>
          <T>Loading filters…</T>
        </MenuLoadingItem>
      );
    }
    return (
      <MenuItem disabled>
        {props.optionsError !== null ? gt("Could not load filters") : emptyLabel}
      </MenuItem>
    );
  };
  const retryFailedOptions = (open: boolean) => {
    if (open && props.optionsError !== null && !props.optionsPending) props.onRetryOptions();
  };
  const checkbox = <T,>(
    entry: { value: T; label: string },
    query: string,
    selection: Selection<T>,
  ) => (
    <MenuCheckboxItem
      key={String(entry.value)}
      checked={selection.selected.includes(entry.value)}
      onCheckedChange={(checked) => selection.onToggle(entry.value, checked)}
    >
      <MenuChoiceLabel
        label={entry.label}
        query={query}
        onOnly={() => selection.onOnly(entry.value)}
      />
    </MenuCheckboxItem>
  );
  const checkboxes = <T,>(
    placeholder: string,
    entries: ReadonlyArray<{ value: T; label: string }>,
    selection: Selection<T>,
    emptyLabel = gt("No options"),
  ) =>
    entries.length === 0 ? (
      unavailableOptions(emptyLabel)
    ) : (
      <MenuSearch items={entries} getText={(entry) => entry.label} placeholder={placeholder}>
        {(matches, query) => matches.map((entry) => checkbox(entry, query, selection))}
      </MenuSearch>
    );
  // One search across every group, so the matches keep their group headings.
  const groupedCheckboxes = <T,>(
    placeholder: string,
    entries: ReadonlyArray<{ value: T; label: string; groupKey: string; groupLabel: string }>,
    selection: Selection<T>,
    emptyLabel = gt("No options"),
  ) =>
    entries.length === 0 ? (
      unavailableOptions(emptyLabel)
    ) : (
      <MenuSearch items={entries} getText={(entry) => entry.label} placeholder={placeholder}>
        {(matches, query) =>
          [...new Set(matches.map((entry) => entry.groupKey))].map((groupKey) => {
            const inGroup = matches.filter((entry) => entry.groupKey === groupKey);
            return (
              <MenuGroup key={groupKey}>
                <MenuGroupLabel>{inGroup[0]!.groupLabel}</MenuGroupLabel>
                {inGroup.map((entry) => checkbox(entry, query, selection))}
              </MenuGroup>
            );
          })
        }
      </MenuSearch>
    );

  const narrowed = options === null ? null : narrowLinearFilterOptions(options, filters);
  const users = [
    { value: "me", label: gt("Me", { $context: "assignee filter: the current user" }) },
    { value: "none", label: gt("Unassigned") },
    ...(options?.users ?? [])
      .filter((user) => !user.isMe)
      .map((user) => ({ value: user.id, label: user.name })),
  ];
  const allTeams = options?.teams ?? [];
  const teams = (narrowed?.teams ?? []).map((team) => ({
    value: team.id,
    label: `${team.name} (${team.key})`,
  }));
  const projectEntry = (project: { id: string; name: string }) => ({
    value: project.id,
    label: project.name,
  });
  const projects = [
    { value: "none", label: gt("No project") },
    ...(narrowed?.projects ?? []).map(projectEntry),
  ];
  const milestones = (options?.projects ?? []).flatMap((project) => project.milestones);
  const states = Object.entries(STATE_TYPE_LABELS).flatMap(([type, label]) =>
    (options?.states ?? [])
      .filter((state) => state.type === type)
      .map((state) => ({
        value: state.name,
        label: state.name,
        groupKey: type,
        groupLabel: resolve(label),
      })),
  );
  const labels = (options?.labels ?? []).map((label) => ({ value: label.name, label: label.name }));
  const priorities = PRIORITIES.map((priority) => ({
    ...priority,
    label: resolve(priority.label),
  }));
  // A dimension's toggle and "Only", from its picked values and how to replace them.
  const selection = <T,>(selected: ReadonlyArray<T>, set: (values: T[]) => void): Selection<T> => ({
    selected,
    onToggle: (value, checked) => set(toggle(selected, value, checked)),
    // "Only" settles the filter, so it also closes the menu.
    onOnly: (value) => {
      set([value]);
      setMenuOpen(false);
    },
  });
  const assignees = selection(filters.assigneeIds, (assigneeIds) => setFilters({ assigneeIds }));
  const pickedTeams = selection(filters.teamIds, (teamIds) => setFilters({ teamIds }));
  const pickedProjects = selection(filters.projectIds, (projectIds) => setFilters({ projectIds }));
  const pickedMilestones = selection(filters.milestoneIds, (milestoneIds) =>
    setFilters({ milestoneIds }),
  );
  const pickedStates = selection(filters.stateNames, (stateNames) => setFilters({ stateNames }));
  const pickedPriorities = selection(filters.priorities, (priorities) =>
    setFilters({ priorities }),
  );
  const pickedLabels = selection(filters.labelNames, (labelNames) => setFilters({ labelNames }));

  const dimensions: ReadonlyArray<FilterDimension> = [
    {
      id: "assignee",
      label: gt("Assignee"),
      items: (
        <>
          {options === null ? unavailableOptions(gt("No assignees")) : null}
          {checkboxes(gt("Search people"), users, assignees)}
        </>
      ),
    },
    {
      id: "team",
      label: gt("Team"),
      items: checkboxes(gt("Search teams"), teams, pickedTeams, gt("No teams")),
    },
    {
      id: "project",
      label: gt("Project", { $context: "field label" }),
      items: (
        <>
          {options === null ? unavailableOptions(gt("No projects")) : null}
          {checkboxes(gt("Search projects"), projects, pickedProjects)}
        </>
      ),
    },
    {
      id: "milestone",
      label: gt("Milestone"),
      items:
        (narrowed?.milestoneGroups.length ?? 0) === 0
          ? unavailableOptions(gt("No milestones"))
          : groupedCheckboxes(
              gt("Search milestones"),
              narrowed!.milestoneGroups.flatMap(({ project, milestones }) =>
                milestones.map((m) => ({
                  value: m.id,
                  label: m.name,
                  groupKey: project.id,
                  groupLabel: project.name,
                })),
              ),
              pickedMilestones,
            ),
    },
    {
      id: "status",
      label: gt("Status", { $context: "field label" }),
      items: (
        <>
          {groupedCheckboxes(gt("Search statuses"), states, pickedStates, gt("No statuses"))}
          <MenuSeparator />
          <MenuCheckboxItem
            checked={filters.includeClosed}
            disabled={filters.stateNames.length > 0}
            onCheckedChange={(checked) => setFilters({ includeClosed: checked })}
          >
            <T>Include done and canceled</T>
          </MenuCheckboxItem>
        </>
      ),
    },
    {
      id: "priority",
      label: gt("Priority", { $context: "field label" }),
      items: checkboxes(gt("Search priorities"), priorities, pickedPriorities),
    },
    {
      id: "label",
      label: gt("Label", { $context: "field label, a Linear issue label" }),
      items: checkboxes(gt("Search labels"), labels, pickedLabels, gt("No labels")),
    },
  ];
  const shownDimensions = dimensions.map((dimension) =>
    dimension.id !== "priority" && props.optionsPending && options !== null
      ? {
          ...dimension,
          items: (
            <>
              <MenuLoadingItem>
                <T>Loading filters…</T>
              </MenuLoadingItem>
              {dimension.items}
            </>
          ),
        }
      : dimension,
  );

  const labelOf = <T,>(entries: ReadonlyArray<{ value: T; label: string }>, value: T) =>
    entries.find((entry) => entry.value === value)?.label ?? gt("Unknown");
  const dimensionLabel = (id: string) =>
    dimensions.find((dimension) => dimension.id === id)?.label ?? id;
  // One pill per picked value, in menu order, named "Dimension: value".
  const pills = <T,>(
    picked: Selection<T>,
    dimension: string,
    icon: ReactNode,
    nameOf: (value: T) => string,
  ): AppliedFilter[] =>
    picked.selected.map((value) => ({
      key: `${dimension}:${String(value)}`,
      icon,
      label: gt("{dimension}: {value}", {
        dimension: dimensionLabel(dimension),
        value: nameOf(value),
      }),
      remove: () => picked.onToggle(value, false),
    }));
  const applied: AppliedFilter[] = [
    ...pills(assignees, "assignee", <UserIcon />, (id) => labelOf(users, id)),
    ...pills(
      pickedTeams,
      "team",
      <UsersIcon />,
      (id) => allTeams.find((team) => team.id === id)?.key ?? gt("Unknown"),
    ),
    ...pills(pickedProjects, "project", <BoxIcon />, (id) =>
      labelOf([projects[0]!, ...(options?.projects ?? []).map(projectEntry)], id),
    ),
    ...pills(
      pickedMilestones,
      "milestone",
      <FlagIcon />,
      (id) => milestones.find((m) => m.id === id)?.name ?? gt("Unknown"),
    ),
    ...pills(pickedStates, "status", <CircleDotIcon />, (name) => name),
    ...(filters.includeClosed && filters.stateNames.length === 0
      ? [
          {
            key: "includeClosed",
            icon: <CircleDotIcon />,
            label: gt("Status: Any"),
            remove: () => setFilters({ includeClosed: false }),
          },
        ]
      : []),
    ...pills(pickedPriorities, "priority", <SignalIcon />, (value) => labelOf(priorities, value)),
    ...pills(pickedLabels, "label", <TagIcon />, (name) => name),
  ];
  const isDefault = JSON.stringify(view) === JSON.stringify(DEFAULT_PICKER_VIEW);

  return (
    <>
      <div className="flex flex-col gap-1.5 px-3 pb-2">
        <div className="flex items-center gap-1.5">
          <Menu
            open={menuOpen}
            onOpenChange={(open) => {
              setMenuOpen(open);
              retryFailedOptions(open);
            }}
          >
            <MenuTrigger render={<Button type="button" size="xs" variant="outline" />}>
              <ListFilterIcon />
              <T context="verb, opens filter options">Filter</T>
            </MenuTrigger>
            <MenuPopup align="start">
              {shownDimensions.map((dimension) => (
                <MenuSub key={dimension.id}>
                  <MenuSubTrigger>{dimension.label}</MenuSubTrigger>
                  <MenuSubPopup>{dimension.items}</MenuSubPopup>
                </MenuSub>
              ))}
            </MenuPopup>
          </Menu>
          <div className="flex-1" />
          {isDefault ? null : (
            <Button
              type="button"
              size="xs"
              variant="ghost-muted"
              onClick={() => props.onChange(DEFAULT_PICKER_VIEW)}
            >
              <T context="verb, resets filters">Reset</T>
            </Button>
          )}
          <Menu>
            <MenuTrigger render={<Button type="button" size="xs" variant="ghost" />}>
              <ArrowDownUpIcon />
              {props.searching && sort.field !== "updated" && sort.field !== "created"
                ? gt("Relevance", { $context: "sort order" })
                : `${resolve(SORT_LABELS[sort.field])} ${sort.direction === "desc" ? "↓" : "↑"}`}
            </MenuTrigger>
            <MenuPopup align="end">
              <MenuRadioGroup
                value={sort.field}
                onValueChange={(field: LinearIssueSort["field"]) =>
                  props.onChange({ ...view, sort: { ...sort, field } })
                }
              >
                {(Object.keys(SORT_LABELS) as Array<LinearIssueSort["field"]>).map((field) => (
                  <MenuRadioItem key={field} value={field}>
                    {resolve(SORT_LABELS[field])}
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
              <MenuSeparator />
              <MenuRadioGroup
                value={sort.direction}
                onValueChange={(direction: LinearIssueSort["direction"]) =>
                  props.onChange({ ...view, sort: { ...sort, direction } })
                }
              >
                <MenuRadioItem value="desc">
                  <T context="sort direction">Descending</T>
                </MenuRadioItem>
                <MenuRadioItem value="asc">
                  <T context="sort direction">Ascending</T>
                </MenuRadioItem>
              </MenuRadioGroup>
            </MenuPopup>
          </Menu>
        </div>
        {applied.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1">
            {applied.map((filter) => (
              <FilterPill
                key={filter.key}
                icon={filter.icon}
                label={filter.label}
                onRemove={filter.remove}
              />
            ))}
          </div>
        ) : null}
      </div>
      {props.optionsError !== null ? (
        <div
          role="status"
          className="flex items-center gap-2 px-3 pb-2 text-muted-foreground text-xs"
        >
          <span className="min-w-0 flex-1">
            <T>
              Could not load Linear filters: <Var>{props.optionsError}</Var>
            </T>
          </span>
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={props.optionsPending}
            onClick={props.onRetryOptions}
          >
            {props.optionsPending ? gt("Retrying…") : gt("Retry")}
          </Button>
        </div>
      ) : null}
    </>
  );
}
