import { describe, expect, it } from "vite-plus/test";

import { githubAvatarUrlOf } from "./OrganisationIcon";

describe("githubAvatarUrlOf", () => {
  it("points a github.com owner at its avatar", () => {
    expect(githubAvatarUrlOf("github.com/focaldata")).toBe(
      "https://github.com/focaldata.png?size=64",
    );
  });

  it("has no avatar for other hosts or nested groups", () => {
    expect(githubAvatarUrlOf("gitlab.com/focaldata")).toBeNull();
    expect(githubAvatarUrlOf("github.com/focaldata/team")).toBeNull();
  });
});
