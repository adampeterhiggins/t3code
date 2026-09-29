import type {
  EnvironmentId,
  LinearFilterOptions,
  LinearIssueFilters,
  LinearIssueSort,
} from "@t3tools/contracts";
import { ArrowDownUpIcon, ListFilterIcon, XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { Button } from "../ui/button";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "../ui/menu";

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
  { value: 1, label: "Urgent" },
  { value: 2, label: "High" },
  { value: 3, label: "Medium" },
  { value: 4, label: "Low" },
  { value: 0, label: "No priority" },
];

const STATE_TYPE_LABELS: Readonly<Record<string, string>> = {
  triage: "Triage",
  backlog: "Backlog",
  unstarted: "Todo",
  started: "In progress",
  completed: "Done",
  canceled: "Canceled",
};

const SORT_LABELS: Readonly<Record<LinearIssueSort["field"], string>> = {
  updated: "Updated",
  created: "Created",
  priority: "Priority",
  dueDate: "Due date",
  status: "Status",
  title: "Title",
};

function toggle<T>(values: ReadonlyArray<T>, value: T, checked: boolean): T[] {
  return checked
    ? [...values.filter((item) => item !== value), value]
    : values.filter((item) => item !== value);
}

/** "Label" alone, the one selected name, or a count once several are picked. */
function summarize(names: ReadonlyArray<string>): string | null {
  if (names.length === 0) return null;
  return names.length === 1 ? names[0]! : `${names.length}`;
}

interface FilterDimension {
  readonly id: string;
  readonly label: string;
  /** What is picked, or null when this filter is off. */
  readonly summary: string | null;
  readonly items: ReactNode;
  readonly clear: () => void;
}

/** An active filter: its menu to change the pick, and a button to drop it. */
function ActiveFilterChip({ dimension }: { dimension: FilterDimension }) {
  return (
    <span className="flex shrink-0 items-center">
      <Menu>
        <MenuTrigger render={<Button type="button" size="xs" variant="secondary" />}>
          {dimension.label}: {dimension.summary}
        </MenuTrigger>
        <MenuPopup align="start">{dimension.items}</MenuPopup>
      </Menu>
      <Button
        type="button"
        size="icon-xs"
        variant="ghost-muted"
        aria-label={`Clear ${dimension.label} filter`}
        onClick={dimension.clear}
      >
        <XIcon />
      </Button>
    </span>
  );
}

/**
 * Linear-style filters for the issue picker, on one line: a Filter menu with a submenu per
 * dimension, chips for the active ones (scrolling sideways rather than wrapping), and Sort.
 * Statuses and labels match by name across teams; search text applies on top.
 */
export function LinearIssueFilterBar(props: {
  options: LinearFilterOptions | null;
  view: PickerView;
  searching: boolean;
  onChange: (view: PickerView) => void;
}) {
  const { options, view } = props;
  const { filters, sort } = view;
  const setFilters = (patch: Partial<LinearIssueFilters>) =>
    props.onChange({ ...view, filters: { ...filters, ...patch } });
  const checkboxes = <T,>(
    entries: ReadonlyArray<{ value: T; label: string }>,
    selected: ReadonlyArray<T>,
    onToggle: (value: T, checked: boolean) => void,
  ) =>
    entries.map((entry) => (
      <MenuCheckboxItem
        key={String(entry.value)}
        checked={selected.includes(entry.value)}
        onCheckedChange={(checked) => onToggle(entry.value, checked)}
      >
        {entry.label}
      </MenuCheckboxItem>
    ));

  const users = [
    { value: "me", label: "Me" },
    { value: "none", label: "Unassigned" },
    ...(options?.users ?? [])
      .filter((user) => !user.isMe)
      .map((user) => ({ value: user.id, label: user.name })),
  ];
  const teams = (options?.teams ?? []).map((team) => ({
    value: team.id,
    label: `${team.name} (${team.key})`,
    key: team.key,
  }));
  const projects = [
    { value: "none", label: "No project" },
    ...(options?.projects ?? []).map((project) => ({ value: project.id, label: project.name })),
  ];
  // Milestones of the picked projects, or of every project when none is picked.
  const milestoneProjects = (options?.projects ?? []).filter(
    (project) =>
      project.milestones.length > 0 &&
      (filters.projectIds.length === 0 || filters.projectIds.includes(project.id)),
  );
  const milestones = (options?.projects ?? []).flatMap((project) => project.milestones);
  const stateGroups = Object.entries(STATE_TYPE_LABELS)
    .map(([type, label]) => ({
      type,
      label,
      states: (options?.states ?? []).filter((state) => state.type === type),
    }))
    .filter((group) => group.states.length > 0);
  const labelOf = <T,>(entries: ReadonlyArray<{ value: T; label: string }>, value: T) =>
    entries.find((entry) => entry.value === value)?.label ?? "Unknown";

  const dimensions: ReadonlyArray<FilterDimension> = [
    {
      id: "assignee",
      label: "Assignee",
      summary: summarize(filters.assigneeIds.map((id) => labelOf(users, id))),
      items: checkboxes(users, filters.assigneeIds, (value, checked) =>
        setFilters({ assigneeIds: toggle(filters.assigneeIds, value, checked) }),
      ),
      clear: () => setFilters({ assigneeIds: [] }),
    },
    {
      id: "team",
      label: "Team",
      summary: summarize(
        filters.teamIds.map((id) => teams.find((team) => team.value === id)?.key ?? "Team"),
      ),
      items: checkboxes(teams, filters.teamIds, (value, checked) =>
        setFilters({ teamIds: toggle(filters.teamIds, value, checked) }),
      ),
      clear: () => setFilters({ teamIds: [] }),
    },
    {
      id: "project",
      label: "Project",
      summary: summarize(filters.projectIds.map((id) => labelOf(projects, id))),
      items: checkboxes(projects, filters.projectIds, (value, checked) =>
        setFilters({ projectIds: toggle(filters.projectIds, value, checked) }),
      ),
      clear: () => setFilters({ projectIds: [] }),
    },
    {
      id: "milestone",
      label: "Milestone",
      summary: summarize(
        filters.milestoneIds.map((id) => milestones.find((m) => m.id === id)?.name ?? "Unknown"),
      ),
      items:
        milestoneProjects.length === 0 ? (
          <MenuCheckboxItem disabled>No milestones</MenuCheckboxItem>
        ) : (
          milestoneProjects.map((project) => (
            <MenuGroup key={project.id}>
              <MenuGroupLabel>{project.name}</MenuGroupLabel>
              {checkboxes(
                project.milestones.map((m) => ({ value: m.id, label: m.name })),
                filters.milestoneIds,
                (value, checked) =>
                  setFilters({ milestoneIds: toggle(filters.milestoneIds, value, checked) }),
              )}
            </MenuGroup>
          ))
        ),
      clear: () => setFilters({ milestoneIds: [] }),
    },
    {
      id: "status",
      label: "Status",
      summary: summarize(filters.stateNames) ?? (filters.includeClosed ? "Any" : null),
      items: (
        <>
          {stateGroups.map((group) => (
            <MenuGroup key={group.type}>
              <MenuGroupLabel>{group.label}</MenuGroupLabel>
              {checkboxes(
                group.states.map((state) => ({ value: state.name, label: state.name })),
                filters.stateNames,
                (value, checked) =>
                  setFilters({ stateNames: toggle(filters.stateNames, value, checked) }),
              )}
            </MenuGroup>
          ))}
          <MenuSeparator />
          <MenuCheckboxItem
            checked={filters.includeClosed}
            disabled={filters.stateNames.length > 0}
            onCheckedChange={(checked) => setFilters({ includeClosed: checked })}
          >
            Include done and canceled
          </MenuCheckboxItem>
        </>
      ),
      clear: () => setFilters({ stateNames: [], includeClosed: false }),
    },
    {
      id: "priority",
      label: "Priority",
      summary: summarize(
        PRIORITIES.filter((p) => filters.priorities.includes(p.value)).map((p) => p.label),
      ),
      items: checkboxes(PRIORITIES, filters.priorities, (value, checked) =>
        setFilters({ priorities: toggle(filters.priorities, value, checked) }),
      ),
      clear: () => setFilters({ priorities: [] }),
    },
    {
      id: "label",
      label: "Label",
      summary: summarize(filters.labelNames),
      items: checkboxes(
        (options?.labels ?? []).map((label) => ({ value: label.name, label: label.name })),
        filters.labelNames,
        (value, checked) => setFilters({ labelNames: toggle(filters.labelNames, value, checked) }),
      ),
      clear: () => setFilters({ labelNames: [] }),
    },
  ];
  const active = dimensions.filter((dimension) => dimension.summary !== null);
  const isDefault = JSON.stringify(view) === JSON.stringify(DEFAULT_PICKER_VIEW);

  return (
    <div className="flex items-center gap-1.5 px-3 pb-2">
      <Menu>
        <MenuTrigger render={<Button type="button" size="xs" variant="outline" />}>
          <ListFilterIcon />
          Filter
        </MenuTrigger>
        <MenuPopup align="start">
          {dimensions.map((dimension) => (
            <MenuSub key={dimension.id}>
              <MenuSubTrigger>{dimension.label}</MenuSubTrigger>
              <MenuSubPopup>{dimension.items}</MenuSubPopup>
            </MenuSub>
          ))}
        </MenuPopup>
      </Menu>
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
        {active.map((dimension) => (
          <ActiveFilterChip key={dimension.id} dimension={dimension} />
        ))}
      </div>
      {isDefault ? null : (
        <Button
          type="button"
          size="xs"
          variant="ghost-muted"
          onClick={() => props.onChange(DEFAULT_PICKER_VIEW)}
        >
          Reset
        </Button>
      )}
      <Menu>
        <MenuTrigger render={<Button type="button" size="xs" variant="ghost" />}>
          <ArrowDownUpIcon />
          {props.searching && sort.field !== "updated" && sort.field !== "created"
            ? "Relevance"
            : `${SORT_LABELS[sort.field]} ${sort.direction === "desc" ? "↓" : "↑"}`}
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
                {SORT_LABELS[field]}
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
            <MenuRadioItem value="desc">Descending</MenuRadioItem>
            <MenuRadioItem value="asc">Ascending</MenuRadioItem>
          </MenuRadioGroup>
        </MenuPopup>
      </Menu>
    </div>
  );
}
