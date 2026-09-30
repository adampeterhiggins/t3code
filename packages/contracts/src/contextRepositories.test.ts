import { describe, expect, it } from "vite-plus/test";

import { contextRepositoryRemoteKey } from "./contextRepositories.ts";

describe("contextRepositoryRemoteKey", () => {
  it("matches the same repository across protocols, case, and suffixes", () => {
    const key = contextRepositoryRemoteKey("https://github.com/acme/api");
    expect(contextRepositoryRemoteKey("git@github.com:Acme/API.git")).toBe(key);
    expect(contextRepositoryRemoteKey("https://user:token@github.com/acme/api.git/")).toBe(key);
    expect(contextRepositoryRemoteKey("ssh://git@github.com/acme/api.git")).toBe(key);
  });

  it("tells different repositories apart", () => {
    expect(contextRepositoryRemoteKey("https://github.com/acme/api")).not.toBe(
      contextRepositoryRemoteKey("https://github.com/acme/web"),
    );
  });
});
