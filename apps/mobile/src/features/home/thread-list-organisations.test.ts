import { EnvironmentId, ProjectId, type RepositoryIdentity } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildOrganisationOptions,
  repositoryOrganisationOf,
  scopeProjectRefsByOrganisations,
  toggleOrganisationKey,
} from "./thread-list-organisations";

const environmentId = EnvironmentId.make("environment-1");

function identity(canonicalKey: string, originKey?: string) {
  return {
    canonicalKey,
    ...(originKey ? { origin: { canonicalKey: originKey } } : {}),
  } as RepositoryIdentity;
}

function project(id: string, repositoryIdentity: RepositoryIdentity | null) {
  return { environmentId, id: ProjectId.make(id), repositoryIdentity };
}

describe("repositoryOrganisationOf", () => {
  it("keys by host and owner, counts a fork under its own remote, and needs a remote", () => {
    expect(repositoryOrganisationOf(identity("github.com/acme/app"))).toEqual({
      key: "github.com/acme",
      label: "acme",
    });
    expect(repositoryOrganisationOf(identity("github.com/acme/app", "github.com/me/app"))).toEqual({
      key: "github.com/me",
      label: "me",
    });
    expect(repositoryOrganisationOf(null)).toBeNull();
    expect(repositoryOrganisationOf(identity("app"))).toBeNull();
  });
});

describe("buildOrganisationOptions", () => {
  it("dedupes, sorts by label, and shows the host when two hosts share an owner", () => {
    expect(
      buildOrganisationOptions([
        project("a", identity("github.com/zed/one")),
        project("b", identity("github.com/acme/two")),
        project("c", identity("gitlab.com/acme/three")),
        project("d", identity("github.com/zed/four")),
        project("e", null),
      ]),
    ).toEqual([
      { key: "github.com/acme", label: "github.com/acme" },
      { key: "gitlab.com/acme", label: "gitlab.com/acme" },
      { key: "github.com/zed", label: "zed" },
    ]);
  });

  it("uses an organisation's chosen name", () => {
    expect(
      buildOrganisationOptions([project("a", identity("github.com/zed/one"))], {
        "github.com/zed": { name: "Zed Industries" },
      }),
    ).toEqual([{ key: "github.com/zed", label: "Zed Industries" }]);
  });
});

describe("scopeProjectRefsByOrganisations", () => {
  const projects = [
    project("upstream", identity("github.com/acme/app")),
    project("fork", identity("github.com/acme/app", "github.com/me/app")),
    project("other", identity("github.com/zed/tool")),
    project("local", null),
  ];
  const ids = (refs: ReturnType<typeof scopeProjectRefsByOrganisations>) =>
    refs === null ? null : refs.map((ref) => ref.projectId);

  it("does not narrow without picked organisations", () => {
    expect(
      scopeProjectRefsByOrganisations({ projects, projectRefs: null, organisationKeys: [] }),
    ).toBeNull();
  });

  it("narrows every checkout to the picked organisations", () => {
    expect(
      ids(
        scopeProjectRefsByOrganisations({
          projects,
          projectRefs: null,
          organisationKeys: ["github.com/acme", "github.com/zed"],
        }),
      ),
    ).toEqual(["upstream", "other"]);
  });

  it("ANDs with the project filter, per checkout", () => {
    expect(
      ids(
        scopeProjectRefsByOrganisations({
          projects,
          projectRefs: [
            { environmentId, projectId: ProjectId.make("upstream") },
            { environmentId, projectId: ProjectId.make("fork") },
          ],
          organisationKeys: ["github.com/me"],
        }),
      ),
    ).toEqual(["fork"]);
  });

  it("ignores organisations that no longer have a checkout", () => {
    expect(
      scopeProjectRefsByOrganisations({
        projects,
        projectRefs: null,
        organisationKeys: ["github.com/gone"],
      }),
    ).toBeNull();
  });

  it("toggles organisations on and off", () => {
    expect(toggleOrganisationKey([], "github.com/acme")).toEqual(["github.com/acme"]);
    expect(toggleOrganisationKey(["github.com/acme"], "github.com/acme")).toEqual([]);
  });
});
