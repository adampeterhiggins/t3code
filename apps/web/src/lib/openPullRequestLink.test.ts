import { describe, expect, it } from "vite-plus/test";

import { type EnvironmentId, ProjectId } from "@t3tools/contracts";

import {
  findProjectOnChangeRequestHost,
  resolvePullRequestPreviewTarget,
} from "./openPullRequestLink";

describe("findProjectOnChangeRequestHost", () => {
  const project = (id: string, identity: Record<string, unknown>) =>
    ({ id, repositoryIdentity: identity }) as never;
  const frontend = project("frontend", {
    canonicalKey: "github.com/acme/frontend",
    provider: "github",
    owner: "acme",
    name: "frontend",
  });
  const backend = project("backend", {
    canonicalKey: "github.com/acme/backend",
    provider: "github",
    owner: "acme",
    name: "backend",
  });

  it("prefers the project checked out from the link's own repository", () => {
    expect(
      findProjectOnChangeRequestHost([frontend, backend], {
        host: "github.com",
        repository: "acme/backend",
        number: 7,
      }),
    ).toBe(backend);
  });

  it("lends any project on the host to a repository nobody has checked out", () => {
    expect(
      findProjectOnChangeRequestHost([frontend], {
        host: "github.com",
        repository: "acme/backend",
        number: 7,
      }),
    ).toBe(frontend);
  });
});

describe("resolvePullRequestPreviewTarget", () => {
  const environmentId = "env-1" as EnvironmentId;
  const frontend = {
    id: ProjectId.make("frontend"),
    environmentId,
    repositoryIdentity: {
      canonicalKey: "github.com/acme/frontend",
      provider: "github",
      owner: "acme",
      name: "frontend",
    },
  } as never;
  const url = "https://github.com/acme/backend/pull/105";

  it("reads a pull request from another repository through a project on its host", () => {
    expect(
      resolvePullRequestPreviewTarget({
        environmentId,
        projects: [frontend],
        capabilities: { pullRequests: true, threadPullRequests: true } as never,
        url,
      }),
    ).toEqual({
      environmentId,
      input: { projectId: "frontend", host: "github.com", repository: "acme/backend", number: 105 },
    });
  });

  it("keeps the link on a server that cannot route by host", () => {
    expect(
      resolvePullRequestPreviewTarget({
        environmentId,
        projects: [frontend],
        capabilities: { pullRequests: true } as never,
        url,
      }),
    ).toBeNull();
  });
});
