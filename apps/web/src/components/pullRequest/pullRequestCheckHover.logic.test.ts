import { describe, expect, it } from "vite-plus/test";

import {
  plainCheckSummary,
  pullRequestCheckHoverDetail,
  pullRequestCheckSource,
  pullRequestCheckTiming,
} from "./pullRequestCheckHover.logic";

describe("pullRequestCheckHoverDetail", () => {
  it("keeps a description that says more than the name", () => {
    expect(
      pullRequestCheckHoverDetail({
        name: "Python Tests / Coverage (base)",
        description: "Coverage decreased",
      }),
    ).toBe("Coverage decreased");
  });

  it("omits a description that repeats the name or is blank", () => {
    expect(pullRequestCheckHoverDetail({ name: "Run pytest", description: "Run pytest" })).toBe(
      null,
    );
    expect(pullRequestCheckHoverDetail({ name: "Run pytest", description: "  " })).toBe(null);
    expect(pullRequestCheckHoverDetail({ name: "Run pytest", description: null })).toBe(null);
  });
});

describe("pullRequestCheckSource", () => {
  it("joins the app and workflow, leaving out a workflow the name already shows", () => {
    expect(pullRequestCheckSource({ name: "test", app: "GitHub Actions", workflow: "CI" })).toBe(
      "GitHub Actions · CI",
    );
    expect(
      pullRequestCheckSource({ name: "CI / test", app: "GitHub Actions", workflow: "CI" }),
    ).toBe("GitHub Actions");
    expect(pullRequestCheckSource({ name: "ci/legacy" })).toBe(null);
  });
});

describe("pullRequestCheckTiming", () => {
  const now = Date.parse("2026-08-11T17:00:00Z");

  it("describes a finished run's duration and age, and a running one's elapsed time", () => {
    expect(
      pullRequestCheckTiming(
        {
          status: "failure",
          startedAt: "2026-08-11T16:50:00Z",
          completedAt: "2026-08-11T16:52:05Z",
        },
        now,
      ),
    ).toBe("Took 2m 5s · finished 7m ago");
    expect(
      pullRequestCheckTiming({ status: "pending", startedAt: "2026-08-11T16:59:15Z" }, now),
    ).toBe("Running for 45s");
    expect(pullRequestCheckTiming({ status: "pending" }, now)).toBe(null);
    expect(pullRequestCheckTiming({ status: "success" }, now)).toBe(null);
  });
});

describe("plainCheckSummary", () => {
  it("reduces a Markdown report to its prose", () => {
    expect(
      plainCheckSummary(
        [
          "## [Codecov](https://codecov.io) Report",
          "<!-- hidden -->",
          "Attention: Patch coverage is **62%** with `3 lines` missing.",
          "",
          "| File | Coverage |",
          "| --- | --- |",
          "",
          "",
          "- src/app.ts",
        ].join("\n"),
      ),
    ).toBe(
      "Codecov Report\n\nAttention: Patch coverage is 62% with 3 lines missing.\n\n• src/app.ts",
    );
  });
});
