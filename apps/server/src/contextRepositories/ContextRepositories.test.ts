import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { ComposerContextId, type RepositoryContextRecord } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { ChildProcessSpawner } from "effect/process";

import * as ServerConfig from "../config.ts";
import * as GitHubCli from "../sourceControl/GitHubCli.ts";
import * as SourceControlProviderRegistry from "../sourceControl/SourceControlProviderRegistry.ts";
import * as SourceControlRepositoryService from "../sourceControl/SourceControlRepositoryService.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";

import * as ContextRepositories from "./ContextRepositories.ts";

const TestLayer = ContextRepositories.layer.pipe(
  Layer.provide(SourceControlRepositoryService.layer),
  Layer.provide(
    Layer.mock(SourceControlProviderRegistry.SourceControlProviderRegistry)({
      resolveLink: () => undefined,
      get: () => Effect.die("clones in these tests go by URL, not provider"),
    }),
  ),
  Layer.provide(Layer.mock(GitHubCli.GitHubCli)({})),
  Layer.provideMerge(GitVcsDriver.layer),
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-context-repos-test-" })),
  Layer.provideMerge(VcsProcess.layer),
  Layer.provideMerge(NodeServices.layer),
);

/** A bare "remote" with one commit, and a workspace repository to clone into. */
const makeFixture = Effect.fn("makeFixture")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const base = yield* fs.makeTempDirectoryScoped({ prefix: "t3-context-repos-" });
  const run = (cwd: string, args: ReadonlyArray<string>) =>
    git.execute({ operation: "test.git", cwd, args, timeoutMs: 10_000 });
  const commit = (cwd: string) =>
    run(cwd, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"]);

  const seed = path.join(base, "seed");
  yield* fs.makeDirectory(seed);
  yield* fs.writeFileString(path.join(seed, "README.md"), "api\n");
  yield* run(seed, ["init", "-q", "-b", "main"]);
  yield* run(seed, ["add", "-A"]);
  yield* commit(seed);
  const remote = path.join(base, "api.git");
  yield* run(base, ["clone", "-q", "--bare", seed, remote]);

  const workspace = path.join(base, "workspace");
  yield* fs.makeDirectory(workspace);
  yield* fs.writeFileString(path.join(workspace, "index.ts"), "export {};\n");
  yield* run(workspace, ["init", "-q", "-b", "main"]);
  yield* run(workspace, ["add", "-A"]);
  yield* commit(workspace);

  return { base, seed, remote, workspace, run, commit };
});

const record = (remoteUrl: string, directoryName = "api"): RepositoryContextRecord => ({
  version: 1,
  contextId: ComposerContextId.make(`ctx_${directoryName}`),
  kind: "repository",
  label: `acme/${directoryName}`,
  nameWithOwner: `acme/${directoryName}`,
  remoteUrl,
  directoryName,
});

it.layer(TestLayer)("ContextRepositories", (it) => {
  it.effect("clones a missing repository, then leaves it alone and reports its status", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const service = yield* ContextRepositories.ContextRepositories;
      const { remote, seed, workspace, run, commit } = yield* makeFixture();

      const [cloned] = yield* service.ensure({
        cwd: workspace,
        directory: "",
        repositories: [record(remote)],
      });
      expect(cloned?.outcome).toMatchObject({
        status: "cloned",
        path: ".context/api",
        git: { branch: "main", upstream: "origin/main", ahead: 0, behind: 0, changedFiles: 0 },
      });
      expect(yield* fs.readFileString(path.join(workspace, ".context/api/README.md"))).toBe(
        "api\n",
      );

      // The workspace's own git never sees the clone.
      const status = yield* run(workspace, ["status", "--porcelain"]);
      expect(status.stdout.trim()).toBe("");

      // The remote moves on and the clone gets a local edit: still skipped, but the status says so.
      yield* fs.writeFileString(path.join(seed, "CHANGELOG.md"), "1\n");
      yield* run(seed, ["add", "-A"]);
      yield* commit(seed);
      yield* run(seed, ["push", "-q", remote, "main"]);
      yield* fs.writeFileString(path.join(workspace, ".context/api/README.md"), "edited\n");

      const [present] = yield* service.ensure({
        cwd: workspace,
        directory: "",
        repositories: [record(remote)],
      });
      expect(present?.outcome).toMatchObject({
        status: "present",
        fetched: true,
        detail: null,
        git: { branch: "main", ahead: 0, behind: 1, changedFiles: 1 },
      });
      expect(yield* fs.readFileString(path.join(workspace, ".context/api/README.md"))).toBe(
        "edited\n",
      );

      const inspected = yield* service.inspect({ cwd: workspace, directory: "" });
      expect(inspected.directory).toBe(".context");
      expect(inspected.clones).toEqual([
        {
          directoryName: "api",
          remoteUrl: remote,
          git: expect.objectContaining({ branch: "main", behind: 1, changedFiles: 1 }),
        },
      ]);
    }),
  );

  it.effect("never overwrites a folder that is not a clone of the attached remote", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const service = yield* ContextRepositories.ContextRepositories;
      const { remote, workspace } = yield* makeFixture();
      yield* fs.makeDirectory(path.join(workspace, ".context/api"), { recursive: true });
      yield* fs.writeFileString(path.join(workspace, ".context/api/notes.txt"), "mine\n");

      const [conflict, failed] = yield* service.ensure({
        cwd: workspace,
        directory: "",
        repositories: [record(remote), record(path.join(workspace, "missing.git"), "web")],
      });
      expect(conflict?.outcome).toMatchObject({
        status: "conflict",
        detail: ".context/api already exists and is not a git repository.",
      });
      expect(yield* fs.readFileString(path.join(workspace, ".context/api/notes.txt"))).toBe(
        "mine\n",
      );
      expect(failed?.outcome?.status).toBe("failed");
      expect(failed?.outcome?.detail).toBeTruthy();
    }),
  );

  it.effect("refuses a context folder outside the workspace", () =>
    Effect.gen(function* () {
      const service = yield* ContextRepositories.ContextRepositories;
      const { remote, workspace } = yield* makeFixture();
      const [outcome] = yield* service.ensure({
        cwd: workspace,
        directory: "../elsewhere",
        repositories: [record(remote)],
      });
      expect(outcome?.outcome?.status).toBe("failed");
      expect(outcome?.outcome?.detail).toContain("must be inside the workspace");
    }),
  );
});

const listingLayer = (repositoriesByOwner: Record<string, ReadonlyArray<string>>) => {
  const calls: Array<string> = [];
  const layer = ContextRepositories.layer.pipe(
    Layer.provide(SourceControlRepositoryService.layer),
    Layer.provide(
      Layer.mock(SourceControlProviderRegistry.SourceControlProviderRegistry)({
        resolveLink: () => undefined,
        get: () => Effect.die("listing never clones"),
      }),
    ),
    Layer.provide(
      Layer.mock(GitHubCli.GitHubCli)({
        execute: ({ args, cwd }) => {
          const owner = args[2]!;
          calls.push(owner);
          const names = repositoriesByOwner[owner];
          if (names === undefined) {
            return Effect.fail(
              new GitHubCli.GitHubCliCommandError({
                command: "gh",
                cwd,
                cause: new Error(`Could not resolve to a user with the login of '${owner}'.`),
              }),
            );
          }
          const stdout = JSON.stringify(
            names.map((name, index) => ({
              name,
              nameWithOwner: `${owner}/${name}`,
              url: `https://github.com/${owner}/${name}`,
              pushedAt: `2026-10-0${9 - index}T00:00:00Z`,
            })),
          );
          return Effect.succeed({
            exitCode: ChildProcessSpawner.ExitCode(0),
            stdout,
            stderr: "",
            stdoutTruncated: false,
            stderrTruncated: false,
          });
        },
      }),
    ),
    Layer.provideMerge(GitVcsDriver.layer),
    Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-context-repos-list-" })),
    Layer.provideMerge(VcsProcess.layer),
    Layer.provideMerge(NodeServices.layer),
  );
  return { calls, layer };
};

it.effect("lists owners in priority order, keeps each list, and skips an owner that fails", () => {
  const { calls, layer } = listingLayer({
    me: ["fd-manager", "dotfiles"],
    focaldata: ["fd-manager", "fd-questionnaire"],
  });
  return Effect.gen(function* () {
    const service = yield* ContextRepositories.ContextRepositories;
    const input = { owner: "me", owners: ["me", "missing", "focaldata"] };
    const first = yield* service.list(input);
    expect(first.repositories.map((candidate) => candidate.nameWithOwner)).toEqual([
      "me/fd-manager",
      "me/dotfiles",
      "focaldata/fd-manager",
      "focaldata/fd-questionnaire",
    ]);
    // The next open is served from memory; only the failed owner is asked again.
    const second = yield* service.list(input);
    expect(second).toEqual(first);
    expect(calls.toSorted()).toEqual(["focaldata", "me", "missing", "missing"]);
    // When every owner fails, the error surfaces.
    const failed = yield* Effect.flip(service.list({ owner: "missing" }));
    expect(failed.message).toContain("missing");
  }).pipe(Effect.provide(layer));
});

it("parses porcelain v2 branch headers and counts changed paths", () => {
  expect(
    ContextRepositories.parsePorcelainV2Status(
      [
        "# branch.oid 0123456789abcdef",
        "# branch.head feature/x",
        "# branch.upstream origin/feature/x",
        "# branch.ab +2 -5",
        "1 .M N... 100644 100644 100644 a b src/a.ts",
        "? new.txt",
        "",
      ].join("\n"),
    ),
  ).toEqual({
    branch: "feature/x",
    headSha: "0123456789abcdef",
    upstream: "origin/feature/x",
    ahead: 2,
    behind: 5,
    changedFiles: 2,
  });
  expect(
    ContextRepositories.parsePorcelainV2Status(
      "# branch.oid (initial)\n# branch.head (detached)\n",
    ),
  ).toMatchObject({ branch: null, headSha: null, upstream: null });
});
