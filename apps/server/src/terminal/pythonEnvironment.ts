/**
 * Python environment activation for new terminals, the equivalent of VS
 * Code's `python.terminal.activateEnvironment` with
 * `python.defaultInterpreterPath`.
 *
 * The activation command is typed into the shell rather than injected as
 * environment variables, so it runs after the user's rc files and survives
 * ones that rebuild PATH.
 *
 * @module pythonEnvironment
 */
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { expandHomePathWith } from "@t3tools/provider-core/server/pathExpansion";

const VIRTUAL_ENVIRONMENT_DIRECTORIES = [".venv", "venv"] as const;

interface ShellSyntax {
  /** Virtual environment activation scripts, in preference order. */
  readonly scripts: ReadonlyArray<string>;
  /** Runs a script in the current shell. */
  readonly source: (scriptPath: string) => string;
  readonly quote: (value: string) => string;
}

const posixQuote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;
const powerShellQuote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const cmdQuote = (value: string) => `"${value}"`;

function shellSyntax(shell: string): ShellSyntax | null {
  const name = shell
    .split(/[\\/]/)
    .at(-1)!
    .toLowerCase()
    .replace(/\.exe$/, "");
  const posix = (scripts: ReadonlyArray<string>, command: string): ShellSyntax => ({
    scripts,
    source: (script) => `${command} ${posixQuote(script)}`,
    quote: posixQuote,
  });
  switch (name) {
    case "bash":
    case "zsh":
      return posix(["activate"], "source");
    case "sh":
    case "dash":
    case "ksh":
      return posix(["activate"], ".");
    case "fish":
      return posix(["activate.fish"], "source");
    case "csh":
    case "tcsh":
      return posix(["activate.csh"], "source");
    case "pwsh":
    case "powershell":
      return {
        // `python -m venv` writes Activate.ps1; uv writes activate.ps1.
        scripts: ["Activate.ps1", "activate.ps1"],
        source: (script) => `& ${powerShellQuote(script)}`,
        quote: powerShellQuote,
      };
    case "cmd":
      return { scripts: ["activate.bat"], source: cmdQuote, quote: cmdQuote };
    default:
      return null;
  }
}

/**
 * The line to type into a freshly started `shell` to activate a Python
 * environment, or null when there is none or the shell is unsupported.
 *
 * `interpreterPath` names an interpreter or an environment directory; empty
 * looks for a `.venv` or `venv` in `cwd`. Conda environments (those with a
 * `conda-meta` directory) use `conda activate`, which needs the shell hook
 * `conda init` installs. Anything else runs the environment's activate script.
 */
export const findPythonEnvironmentActivation = Effect.fn(
  "terminal.findPythonEnvironmentActivation",
)(function* (input: {
  readonly fileSystem: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly cwd: string;
  readonly shell: string;
  readonly platform: NodeJS.Platform;
  readonly interpreterPath: string;
}) {
  const syntax = shellSyntax(input.shell);
  if (syntax === null) return null;
  const { fileSystem, path } = input;
  const exists = (target: string) =>
    fileSystem.exists(target).pipe(Effect.orElseSucceed(() => false));
  const binDirectory = input.platform === "win32" ? "Scripts" : "bin";
  // The leading space keeps the line out of history in shells that ignore
  // space-prefixed commands.
  const line = (command: string) => ` ${command}\r`;

  const findActivateScript = Effect.fn(function* (environment: string) {
    for (const script of syntax.scripts) {
      const scriptPath = path.join(environment, binDirectory, script);
      if (yield* exists(scriptPath)) return scriptPath;
    }
    return null;
  });

  if (input.interpreterPath === "") {
    for (const directory of VIRTUAL_ENVIRONMENT_DIRECTORIES) {
      const script = yield* findActivateScript(path.join(input.cwd, directory));
      if (script !== null) return line(syntax.source(script));
    }
    return null;
  }

  const configured = path.resolve(input.cwd, expandHomePathWith(input.interpreterPath, path));
  const info = yield* fileSystem.stat(configured).pipe(Effect.option);
  if (info._tag === "None") return null;
  let environment = configured;
  if (info.value.type !== "Directory") {
    // `<env>/bin/python` or `<env>\Scripts\python.exe`; conda on Windows
    // keeps python.exe at the environment root.
    const parent = path.dirname(configured);
    environment = ["bin", "Scripts"].includes(path.basename(parent))
      ? path.dirname(parent)
      : parent;
  }

  if (yield* exists(path.join(environment, "conda-meta"))) {
    return line(`conda activate ${syntax.quote(environment)}`);
  }
  const script = yield* findActivateScript(environment);
  return script === null ? null : line(syntax.source(script));
});
