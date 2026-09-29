import { assert, describe, it } from "@effect/vitest";

import {
  toLinearIdentifierPrefixFilter,
  toLinearIssueFilter,
  toLinearIssueSort,
} from "./linearIssueFilters.ts";

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

describe("toLinearIdentifierPrefixFilter", () => {
  it("scopes a bare team key or key with a dash to that team", () => {
    const team = { team: { key: { eqIgnoreCase: "sym" } } };
    assert.deepEqual(toLinearIdentifierPrefixFilter("sym"), team);
    assert.deepEqual(toLinearIdentifierPrefixFilter("sym-"), team);
  });

  it("matches issue numbers that start with the typed digits", () => {
    assert.deepEqual(toLinearIdentifierPrefixFilter("SYM-19"), {
      and: [
        { team: { key: { eqIgnoreCase: "SYM" } } },
        {
          or: [
            { number: { eq: 19 } },
            { number: { gte: 190, lte: 199 } },
            { number: { gte: 1900, lte: 1999 } },
            { number: { gte: 19000, lte: 19999 } },
          ],
        },
      ],
    });
  });

  it("leaves text that cannot start an identifier to search", () => {
    for (const text of ["login bug", "19", "SYM-19x", "-SYM"]) {
      assert.isNull(toLinearIdentifierPrefixFilter(text), text);
    }
  });
});
