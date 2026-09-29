import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as ConductorWorkspace from "./ConductorWorkspace.ts";

const TestLayer = ConductorWorkspace.layer.pipe(
  Layer.provideMerge(GitVcsDriver.layer),
  Layer.provideMerge(ProcessRunner.layer),
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-conductor-test-" })),
  Layer.provideMerge(VcsProcess.layer),
  Layer.provideMerge(NodeServices.layer),
);

/** A repository shaped like a real Conductor project, with an empty sibling worktree. */
const makeRepo = Effect.fn("makeRepo")(function* (files: Record<string, string>) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const base = yield* fs.makeTempDirectoryScoped({ prefix: "t3-conductor-" });
  const root = path.join(base, "repo");
  const worktree = path.join(base, "worktrees", "lisbon");
  yield* fs.makeDirectory(worktree, { recursive: true });
  for (const [relativePath, contents] of Object.entries(files)) {
    yield* fs.makeDirectory(path.dirname(path.join(root, relativePath)), { recursive: true });
    yield* fs.writeFileString(path.join(root, relativePath), contents);
  }
  const run = (args: ReadonlyArray<string>) =>
    git.execute({ operation: "test.git", cwd: root, args, timeoutMs: 10_000 });
  // Everything not gitignored is committed; ignored files stay local-only.
  yield* run(["init", "-q", "-b", "main"]);
  yield* run(["add", "-A"]);
  yield* run(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"]);
  return { root, worktree };
});

const read = (filePath: string) =>
  FileSystem.FileSystem.pipe(
    Effect.flatMap((fs) => fs.readFileString(filePath)),
    Effect.orElseSucceed(() => null),
  );

it.layer(TestLayer)("ConductorWorkspace", (it) => {
  it.effect("prepares a worktree for orchestra's Conductor settings", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const { root, worktree } = yield* makeRepo({
        ".conductor/settings.toml": [
          '"$schema" = "https://conductor.build/schemas/settings.repo.schema.json"',
          "[git]",
          "worktree_push_auto_setup_remote = true",
          "[scripts]",
          'setup = "./scripts/setup.sh --setup-workspace --package-managers --conductor-deps"',
          'archive = "./scripts/conductor.sh kill"',
          'run_mode = "concurrent"',
          "[scripts.run.dev]",
          'command = "./scripts/conductor.sh start --open"',
          "default = true",
          'icon = "play"',
        ].join("\n"),
        ".gitignore":
          ".env.*\n!.env.evals\nscripts/.env\n.conductor/*\n!.conductor/settings.toml\n",
        ".env": "TRACKED=1\n",
        ".env.evals": "TRACKED=1\n",
        ".env.local": "ORCHESTRA_LOCAL_UI_PORT=5001\n",
        "scripts/.env": "SECRET=1\n",
      });
      const fs = yield* FileSystem.FileSystem;
      yield* fs.writeFileString(path.join(root, ".envrc"), "untracked, not ignored\n");

      const conductor = yield* ConductorWorkspace.ConductorWorkspace;
      const prepared = yield* conductor.prepareWorktree({
        projectRoot: root,
        worktreePath: worktree,
      });

      expect(prepared.setupScript).toBe(
        "./scripts/setup.sh --setup-workspace --package-managers --conductor-deps",
      );
      expect(prepared.env).toMatchObject({
        CONDUCTOR_ROOT_PATH: root,
        CONDUCTOR_WORKSPACE_PATH: worktree,
        CONDUCTOR_WORKSPACE_NAME: "lisbon",
        CONDUCTOR_IS_LOCAL: "1",
        CONDUCTOR_PORT: String(ConductorWorkspace.conductorPort(worktree)),
      });
      // The default `.env*` pattern matches at any depth but copies ignored
      // files only: tracked and merely untracked ones stay behind.
      expect(yield* read(path.join(worktree, ".env.local"))).toBe("ORCHESTRA_LOCAL_UI_PORT=5001\n");
      expect(yield* read(path.join(worktree, "scripts/.env"))).toBe("SECRET=1\n");
      expect(yield* read(path.join(worktree, ".env"))).toBeNull();
      expect(yield* read(path.join(worktree, ".envrc"))).toBeNull();
    }),
  );

  it.effect("layers local settings over shared ones and .worktreeinclude over both", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const { root, worktree } = yield* makeRepo({
        "conductor.json": '{ "scripts": { "setup": "legacy" } }',
        ".conductor/settings.toml": [
          'file_include_globs = "config/local.json"',
          "[scripts]",
          'setup = "shared"',
          "[environment_variables]",
          'API_URL = "http://localhost:3000"',
          "[environment_variables.local]",
          'TARGET = "local"',
        ].join("\n"),
        ".conductor/settings.local.toml": '[scripts]\nsetup = "mine"\n',
        ".worktreeinclude": "# shared local files\ncerts/**\n",
        ".gitignore": "config/local.json\ncerts/\n.conductor/settings.local.toml\n",
        "config/local.json": "{}",
        "certs/dev/key.pem": "key",
      });

      const conductor = yield* ConductorWorkspace.ConductorWorkspace;
      const prepared = yield* conductor.prepareWorktree({
        projectRoot: root,
        worktreePath: worktree,
      });

      expect(prepared.setupScript).toBe("mine");
      expect(prepared.env).toMatchObject({ API_URL: "http://localhost:3000", TARGET: "local" });
      expect(yield* read(path.join(worktree, "certs/dev/key.pem"))).toBe("key");
      expect(yield* read(path.join(worktree, "config/local.json"))).toBeNull();
    }),
  );

  it.effect("leaves repositories without Conductor settings alone", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const { root, worktree } = yield* makeRepo({
        ".gitignore": ".env.local\n",
        ".env.local": "A=1\n",
      });

      const conductor = yield* ConductorWorkspace.ConductorWorkspace;
      const prepared = yield* conductor.prepareWorktree({
        projectRoot: root,
        worktreePath: worktree,
      });

      expect(prepared).toEqual({ setupScript: null, env: {} });
      expect(yield* read(path.join(worktree, ".env.local"))).toBeNull();
    }),
  );

  it.effect("runs the archive script in the worktree with Conductor variables", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const { root, worktree } = yield* makeRepo({
        ".conductor/settings.toml":
          '[scripts]\narchive = "echo $CONDUCTOR_WORKSPACE_NAME:$CONDUCTOR_PORT > $CONDUCTOR_ROOT_PATH/archived"\n',
      });

      const conductor = yield* ConductorWorkspace.ConductorWorkspace;
      yield* conductor.archiveWorktree({ projectRoot: root, worktreePath: worktree });

      expect(yield* read(path.join(root, "archived"))).toBe(
        `lisbon:${ConductorWorkspace.conductorPort(worktree)}\n`,
      );
    }),
  );
});
