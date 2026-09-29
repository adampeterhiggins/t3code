import { assert, describe, it } from "@effect/vitest";

import { toLinearIssueFilter, toLinearIssueSort } from "./linearIssueFilters.ts";

const none = {
  assigneeIds: [],
  teamIds: [],
  projectIds: [],
  milestoneIds: [],
  stateNames: [],
  priorities: [],
  labelNames: [],
  includeClosed: true,
};

describe("toLinearIssueFilter", () => {
  it("adds no clauses when nothing is filtered", () => {
    assert.deepEqual(toLinearIssueFilter(none), {});
  });

  it("hides closed issues unless statuses are picked or closed ones are included", () => {
    const openOnly = { state: { type: { nin: ["completed", "canceled"] } } };
    assert.deepEqual(toLinearIssueFilter({ ...none, includeClosed: false }), { and: [openOnly] });
    assert.deepEqual(toLinearIssueFilter({ ...none, includeClosed: false, stateNames: ["Done"] }), {
      and: [{ state: { name: { in: ["Done"] } } }],
    });
  });

  it("combines me, unassigned, and specific people as alternatives", () => {
    assert.deepEqual(toLinearIssueFilter({ ...none, assigneeIds: ["me", "none", "u1"] }), {
      and: [{ assignee: { or: [{ isMe: { eq: true } }, { null: true }, { id: { in: ["u1"] } }] } }],
    });
  });

  it("narrows by every other list, with no project as an option", () => {
    assert.deepEqual(
      toLinearIssueFilter({
        ...none,
        teamIds: ["t1"],
        projectIds: ["none", "p1"],
        milestoneIds: ["m1"],
        priorities: [1, 2],
        labelNames: ["Bug"],
      }),
      {
        and: [
          { team: { id: { in: ["t1"] } } },
          { project: { or: [{ null: true }, { id: { in: ["p1"] } }] } },
          { projectMilestone: { id: { in: ["m1"] } } },
          { priority: { in: [1, 2] } },
          { labels: { some: { name: { in: ["Bug"] } } } },
        ],
      },
    );
  });
});

describe("toLinearIssueSort", () => {
  it("maps picker fields and directions onto Linear's sort keys", () => {
    assert.deepEqual(toLinearIssueSort({ field: "priority", direction: "desc" }), [
      { priority: { order: "Descending" } },
    ]);
    assert.deepEqual(toLinearIssueSort({ field: "status", direction: "asc" }), [
      { workflowState: { order: "Ascending" } },
    ]);
  });
});
