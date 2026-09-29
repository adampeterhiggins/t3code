import type { LinearIssueFilters, LinearIssueSort } from "@t3tools/contracts";

const CLOSED_STATE_TYPES = ["completed", "canceled"];

/** Linear's `IssueFilter` for the picker's filters: every non-empty list narrows the results. */
export function toLinearIssueFilter(filters: LinearIssueFilters): Record<string, unknown> {
  const clauses: Array<Record<string, unknown>> = [];

  if (filters.assigneeIds.length > 0) {
    const ids = filters.assigneeIds.filter((id) => id !== "me" && id !== "none");
    const anyOf = [
      ...(filters.assigneeIds.includes("me") ? [{ isMe: { eq: true } }] : []),
      ...(filters.assigneeIds.includes("none") ? [{ null: true }] : []),
      ...(ids.length > 0 ? [{ id: { in: ids } }] : []),
    ];
    clauses.push({ assignee: { or: anyOf } });
  }
  if (filters.teamIds.length > 0) {
    clauses.push({ team: { id: { in: filters.teamIds } } });
  }
  if (filters.projectIds.length > 0) {
    const ids = filters.projectIds.filter((id) => id !== "none");
    const anyOf = [
      ...(filters.projectIds.includes("none") ? [{ null: true }] : []),
      ...(ids.length > 0 ? [{ id: { in: ids } }] : []),
    ];
    clauses.push({ project: { or: anyOf } });
  }
  if (filters.milestoneIds.length > 0) {
    clauses.push({ projectMilestone: { id: { in: filters.milestoneIds } } });
  }
  if (filters.stateNames.length > 0) {
    clauses.push({ state: { name: { in: filters.stateNames } } });
  } else if (!filters.includeClosed) {
    clauses.push({ state: { type: { nin: CLOSED_STATE_TYPES } } });
  }
  if (filters.priorities.length > 0) {
    clauses.push({ priority: { in: filters.priorities } });
  }
  if (filters.labelNames.length > 0) {
    clauses.push({ labels: { some: { name: { in: filters.labelNames } } } });
  }
  return clauses.length === 0 ? {} : { and: clauses };
}

const SORT_KEYS = {
  updated: "updatedAt",
  created: "createdAt",
  priority: "priority",
  dueDate: "dueDate",
  status: "workflowState",
  title: "title",
} as const satisfies Record<LinearIssueSort["field"], string>;

/** Linear's `[IssueSortInput!]`. Descending priority puts urgent first. */
export function toLinearIssueSort(sort: LinearIssueSort): ReadonlyArray<Record<string, unknown>> {
  return [
    { [SORT_KEYS[sort.field]]: { order: sort.direction === "asc" ? "Ascending" : "Descending" } },
  ];
}
