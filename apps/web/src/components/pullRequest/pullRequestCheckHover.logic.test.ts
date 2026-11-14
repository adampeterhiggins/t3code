import { describe, expect, it } from "vite-plus/test";

import { pullRequestCheckHoverDetail } from "./pullRequestCheckHover.logic";

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
