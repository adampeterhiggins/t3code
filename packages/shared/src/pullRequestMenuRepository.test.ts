import { describe, expect, it } from "vite-plus/test";

import { pullRequestMenuRepository } from "./pullRequestMenuRepository.ts";

const identity = {
  canonicalKey: "github.com/acme/web",
  displayName: "acme/web",
};

describe("pullRequestMenuRepository", () => {
  it("names the repository gh opens when a fork's web URL differs from upstream", () => {
    expect(
      pullRequestMenuRepository({
        ...identity,
        webUrl: "https://github.com/Me/Web",
      }),
    ).toEqual({ host: "github.com", repository: "Me/Web" });
  });

  it("ignores a web URL for the identity's own repository, including a mount prefix", () => {
    expect(
      pullRequestMenuRepository({ ...identity, webUrl: "https://github.com/acme/web/" }),
    ).toBeNull();
    expect(
      pullRequestMenuRepository({
        canonicalKey: "forge.test/team/repo",
        displayName: "team/repo",
        webUrl: "http://forge.test:3000/git/team/repo",
      }),
    ).toBeNull();
    expect(pullRequestMenuRepository(identity)).toBeNull();
    expect(pullRequestMenuRepository(null)).toBeNull();
  });
});
