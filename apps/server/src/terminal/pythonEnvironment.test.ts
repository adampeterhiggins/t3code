import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { expect } from "vite-plus/test";

import { findPythonEnvironmentActivation } from "./pythonEnvironment.ts";

it.layer(NodeServices.layer)("findPythonEnvironmentActivation", (it) => {
  it.effect("picks the activation script and syntax for each shell", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3code-it's-a-venv-" });
      for (const script of ["bin/activate", "bin/activate.fish", "Scripts/Activate.ps1"]) {
        yield* fileSystem.makeDirectory(path.join(cwd, "venv", path.dirname(script)), {
          recursive: true,
        });
        yield* fileSystem.writeFileString(path.join(cwd, "venv", script), "");
      }
      const find = (shell: string, platform: NodeJS.Platform) =>
        findPythonEnvironmentActivation({
          fileSystem,
          path,
          cwd,
          shell,
          platform,
          interpreterPath: "",
        });
      const quoted = (script: string) => path.join(cwd, "venv", script).replaceAll("'", `'\\''`);

      expect(yield* find("/bin/bash", "linux")).toBe(` source '${quoted("bin/activate")}'\r`);
      expect(yield* find("/bin/sh", "linux")).toBe(` . '${quoted("bin/activate")}'\r`);
      expect(yield* find("/opt/homebrew/bin/fish", "darwin")).toBe(
        ` source '${quoted("bin/activate.fish")}'\r`,
      );
      expect(yield* find("pwsh.exe", "win32")).toBe(
        ` & '${path.join(cwd, "venv", "Scripts", "Activate.ps1").replaceAll("'", "''")}'\r`,
      );
      // No activate.csh, and nushell is unsupported.
      expect(yield* find("/bin/tcsh", "linux")).toBeNull();
      expect(yield* find("/usr/bin/nu", "linux")).toBeNull();
    }),
  );

  it.effect("prefers .venv over venv and returns null without either", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3code-venv-" });
      const find = findPythonEnvironmentActivation({
        fileSystem,
        path,
        cwd,
        shell: "zsh",
        platform: "darwin",
        interpreterPath: "",
      });

      expect(yield* find).toBeNull();
      for (const directory of ["venv", ".venv"]) {
        yield* fileSystem.makeDirectory(path.join(cwd, directory, "bin"), { recursive: true });
        yield* fileSystem.writeFileString(path.join(cwd, directory, "bin", "activate"), "");
      }
      expect(yield* find).toBe(` source '${path.join(cwd, ".venv", "bin", "activate")}'\r`);
    }),
  );

  it.effect("activates the configured interpreter's environment, using conda for conda envs", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3code-python-" });
      const cwd = path.join(root, "project");
      const touch = Effect.fn(function* (file: string) {
        yield* fileSystem.makeDirectory(path.dirname(file), { recursive: true });
        yield* fileSystem.writeFileString(file, "");
      });
      // A venv outside the default names, and a conda env.
      yield* touch(path.join(cwd, "env", "bin", "python"));
      yield* touch(path.join(cwd, "env", "bin", "activate"));
      yield* touch(path.join(cwd, ".venv", "bin", "activate"));
      const conda = path.join(root, "miniconda3", "envs", "app");
      yield* touch(path.join(conda, "bin", "python"));
      yield* fileSystem.makeDirectory(path.join(conda, "conda-meta"));
      const find = (interpreterPath: string, shell = "zsh") =>
        findPythonEnvironmentActivation({
          fileSystem,
          path,
          cwd,
          shell,
          platform: "darwin",
          interpreterPath,
        });

      const venvActivate = ` source '${path.join(cwd, "env", "bin", "activate")}'\r`;
      expect(yield* find("env/bin/python")).toBe(venvActivate);
      expect(yield* find("./env")).toBe(venvActivate);
      expect(yield* find(path.join(conda, "bin", "python"))).toBe(` conda activate '${conda}'\r`);
      expect(yield* find(conda, "pwsh")).toBe(` conda activate '${conda}'\r`);
      // A configured path that does not exist activates nothing, even with a .venv present.
      expect(yield* find("missing/bin/python")).toBeNull();
    }),
  );
});
