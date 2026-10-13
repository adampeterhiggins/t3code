import { describe, expect, it } from "vite-plus/test";

import { applyFilterDimensions, filterFacets } from "./filterFacets.ts";

interface Issue {
  readonly id: string;
  readonly author: string;
  readonly labels: ReadonlyArray<string>;
}

const issues: ReadonlyArray<Issue> = [
  { id: "1", author: "ada", labels: ["bug", "web"] },
  { id: "2", author: "ada", labels: ["web"] },
  { id: "3", author: "grace", labels: ["bug"] },
  { id: "4", author: "linus", labels: [] },
];

const dimensions = (author: string[], labels: string[]) => ({
  author: { values: (issue: Issue) => [issue.author], selected: author },
  labels: { values: (issue: Issue) => issue.labels, selected: labels },
});

describe("filterFacets", () => {
  it("counts each dimension under the others, not itself", () => {
    const facets = filterFacets(issues, dimensions(["ada"], []));
    // Picking ada leaves the author menu whole, so more authors can be added.
    expect(facets.author).toEqual([
      { value: "ada", count: 2 },
      { value: "grace", count: 1 },
      { value: "linus", count: 1 },
    ]);
    // The labels menu only counts ada's issues.
    expect(facets.labels).toEqual([
      { value: "web", count: 2 },
      { value: "bug", count: 1 },
    ]);
  });

  it("keeps a picked value the other filters exclude, at zero", () => {
    const facets = filterFacets(issues, dimensions(["linus"], ["bug"]));
    expect(facets.author).toEqual([
      { value: "ada", count: 1 },
      { value: "grace", count: 1 },
      { value: "linus", count: 0 },
    ]);
    expect(facets.labels).toEqual([{ value: "bug", count: 0 }]);
  });

  it("uses a dimension's own matcher when it has one", () => {
    const allOf = {
      ...dimensions([], ["bug", "web"]),
      labels: {
        values: (issue: Issue) => issue.labels,
        selected: ["bug", "web"],
        matches: (issue: Issue) => ["bug", "web"].every((label) => issue.labels.includes(label)),
      },
    };
    expect(applyFilterDimensions(issues, allOf).map((issue) => issue.id)).toEqual(["1"]);
    expect(filterFacets(issues, allOf).author).toEqual([{ value: "ada", count: 1 }]);
  });
});
