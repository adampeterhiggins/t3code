import type {
  EnvironmentId,
  LinearFilterOptions,
  LinearIssueFilters,
  LinearIssueSort,
} from "@t3tools/contracts";
import { ChevronDownIcon } from "lucide-react";
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

export function useLinearIssuePickerView(environmentId: EnvironmentId): PickerView {
  return useLinearIssuePickerViewStore(
    (state) =>
      state.viewsByEnvironmentId[environmentId] ?? {
        filters: DEFAULT_LINEAR_ISSUE_FILTERS,
        sort: DEFAULT_LINEAR_ISSUE_SORT,
      },
  );
}

const PRIORITIES = [
  { value: 1, label: "Urgent" },
  { value: 2, label: "High" },
  { value: 3, label: "Medium" },
  { value: 4, label: "Low" },
  { value: 0, label: "No priority" },
] as const;

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

function FilterMenu(props: { label: string; summary: string | null; children: ReactNode }) {
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button type="button" size="xs" variant={props.summary ? "secondary" : "outline"} />
        }
      >
        {props.summary ? `${props.label}: ${props.summary}` : props.label}
        <ChevronDownIcon />
      </MenuTrigger>
      <MenuPopup align="start">{props.children}</MenuPopup>
    </Menu>
  );
}

/**
 * Linear-style filters for the issue picker. Every menu narrows the list; statuses and labels
 * match by name across teams. Search text applies on top of them.
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

  const userName = (id: string) =>
    id === "me"
      ? "Me"
      : id === "none"
        ? "Unassigned"
        : (options?.users.find((user) => user.id === id)?.name ?? "Someone");
  const teamName = (id: string) => options?.teams.find((team) => team.id === id)?.key ?? "Team";
  const projectName = (id: string) =>
    id === "none"
      ? "No project"
      : (options?.projects.find((project) => project.id === id)?.name ?? "Project");
  // Milestones of the picked projects, or of every project when none is picked.
  const milestoneProjects = (options?.projects ?? []).filter(
    (project) =>
      project.milestones.length > 0 &&
      (filters.projectIds.length === 0 || filters.projectIds.includes(project.id)),
  );
  const milestoneName = (id: string) =>
    options?.projects.flatMap((project) => project.milestones).find((m) => m.id === id)?.name ??
    "Milestone";
  const stateGroups = Object.entries(STATE_TYPE_LABELS)
    .map(([type, label]) => ({
      type,
      label,
      states: (options?.states ?? []).filter((state) => state.type === type),
    }))
    .filter((group) => group.states.length > 0);
  const isDefault =
    JSON.stringify(view) ===
    JSON.stringify({ filters: DEFAULT_LINEAR_ISSUE_FILTERS, sort: DEFAULT_LINEAR_ISSUE_SORT });

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2">
      <FilterMenu label="Assignee" summary={summarize(filters.assigneeIds.map(userName))}>
        {[
          { id: "me", name: "Me" },
          { id: "none", name: "Unassigned" },
          ...(options?.users ?? []).filter((user) => !user.isMe),
        ].map((user) => (
          <MenuCheckboxItem
            key={user.id}
            checked={filters.assigneeIds.includes(user.id)}
            onCheckedChange={(checked) =>
              setFilters({ assigneeIds: toggle(filters.assigneeIds, user.id, checked) })
            }
          >
            {user.name}
          </MenuCheckboxItem>
        ))}
      </FilterMenu>
      <FilterMenu label="Team" summary={summarize(filters.teamIds.map(teamName))}>
        {(options?.teams ?? []).map((team) => (
          <MenuCheckboxItem
            key={team.id}
            checked={filters.teamIds.includes(team.id)}
            onCheckedChange={(checked) =>
              setFilters({ teamIds: toggle(filters.teamIds, team.id, checked) })
            }
          >
            {team.name} ({team.key})
          </MenuCheckboxItem>
        ))}
      </FilterMenu>
      <FilterMenu label="Project" summary={summarize(filters.projectIds.map(projectName))}>
        {[{ id: "none", name: "No project" }, ...(options?.projects ?? [])].map((project) => (
          <MenuCheckboxItem
            key={project.id}
            checked={filters.projectIds.includes(project.id)}
            onCheckedChange={(checked) =>
              setFilters({ projectIds: toggle(filters.projectIds, project.id, checked) })
            }
          >
            {project.name}
          </MenuCheckboxItem>
        ))}
      </FilterMenu>
      {milestoneProjects.length > 0 || filters.milestoneIds.length > 0 ? (
        <FilterMenu label="Milestone" summary={summarize(filters.milestoneIds.map(milestoneName))}>
          {milestoneProjects.map((project) => (
            <MenuGroup key={project.id}>
              <MenuGroupLabel>{project.name}</MenuGroupLabel>
              {project.milestones.map((milestone) => (
                <MenuCheckboxItem
                  key={milestone.id}
                  checked={filters.milestoneIds.includes(milestone.id)}
                  onCheckedChange={(checked) =>
                    setFilters({
                      milestoneIds: toggle(filters.milestoneIds, milestone.id, checked),
                    })
                  }
                >
                  {milestone.name}
                </MenuCheckboxItem>
              ))}
            </MenuGroup>
          ))}
        </FilterMenu>
      ) : null}
      <FilterMenu
        label="Status"
        summary={summarize(filters.stateNames) ?? (filters.includeClosed ? "Any" : null)}
      >
        {stateGroups.map((group) => (
          <MenuGroup key={group.type}>
            <MenuGroupLabel>{group.label}</MenuGroupLabel>
            {group.states.map((state) => (
              <MenuCheckboxItem
                key={state.name}
                checked={filters.stateNames.includes(state.name)}
                onCheckedChange={(checked) =>
                  setFilters({ stateNames: toggle(filters.stateNames, state.name, checked) })
                }
              >
                {state.name}
              </MenuCheckboxItem>
            ))}
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
      </FilterMenu>
      <FilterMenu
        label="Priority"
        summary={summarize(
          PRIORITIES.filter((p) => filters.priorities.includes(p.value)).map((p) => p.label),
        )}
      >
        {PRIORITIES.map((priority) => (
          <MenuCheckboxItem
            key={priority.value}
            checked={filters.priorities.includes(priority.value)}
            onCheckedChange={(checked) =>
              setFilters({ priorities: toggle(filters.priorities, priority.value, checked) })
            }
          >
            {priority.label}
          </MenuCheckboxItem>
        ))}
      </FilterMenu>
      <FilterMenu label="Label" summary={summarize(filters.labelNames)}>
        {(options?.labels ?? []).map((label) => (
          <MenuCheckboxItem
            key={label.name}
            checked={filters.labelNames.includes(label.name)}
            onCheckedChange={(checked) =>
              setFilters({ labelNames: toggle(filters.labelNames, label.name, checked) })
            }
          >
            {label.name}
          </MenuCheckboxItem>
        ))}
      </FilterMenu>
      <FilterMenu
        label="Sort"
        summary={
          props.searching && sort.field !== "updated" && sort.field !== "created"
            ? "Relevance"
            : `${SORT_LABELS[sort.field]} ${sort.direction === "desc" ? "↓" : "↑"}`
        }
      >
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
      </FilterMenu>
      {isDefault ? null : (
        <Button
          type="button"
          size="xs"
          variant="ghost-muted"
          onClick={() =>
            props.onChange({
              filters: DEFAULT_LINEAR_ISSUE_FILTERS,
              sort: DEFAULT_LINEAR_ISSUE_SORT,
            })
          }
        >
          Reset
        </Button>
      )}
    </div>
  );
}
