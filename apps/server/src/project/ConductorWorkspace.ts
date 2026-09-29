/**
 * ConductorWorkspace - runs a repository's Conductor (conductor.build)
 * workspace lifecycle for T3 worktrees, so repositories set up for Conductor
 * work without a t3.json.
 *
 * Reads `.conductor/settings.toml` (plus `settings.local.toml`, the `.json`
 * equivalents, and legacy `conductor.json`) from the project root. On worktree
 * creation it copies gitignored files matching `.worktreeinclude` /
 * `file_include_globs` from the project root and offers `scripts.setup` as
 * the setup script; before a worktree is removed it runs `scripts.archive`.
 * Scripts get Conductor's `CONDUCTOR_*` variables. Run scripts are not
 * supported yet.
 *
 * Everything here is best effort: unreadable or invalid files are logged and
 * treated as absent, and a failed copy never blocks the worktree.
 *
 * @module ConductorWorkspace
 */
import { HostProcessEnvironment, HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as NodeCrypto from "node:crypto";
import { parse as parseToml } from "smol-toml";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ProcessRunner from "../processRunner.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";

const ConductorSettingsFile = Schema.Struct({
  scripts: Schema.optionalKey(
    Schema.Struct({
      setup: Schema.optionalKey(Schema.String),
      archive: Schema.optionalKey(Schema.String),
    }),
  ),
  file_include_globs: Schema.optionalKey(Schema.String),
  environment_variables: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
});
type ConductorSettingsFile = typeof ConductorSettingsFile.Type;
const decodeConductorSettingsFile = Schema.decodeUnknownExit(ConductorSettingsFile);

interface ConductorConfig {
  readonly setupScript: string | null;
  readonly archiveScript: string | null;
  /** Gitignore-syntax patterns for files copied from the project root, or null for none. */
  readonly includePatterns: string | null;
  /** `environment_variables` plus its `local` section. */
  readonly environment: Readonly<Record<string, string>>;
  /** True when any Conductor settings file exists. */
  readonly configured: boolean;
}

/** Conductor's own default when a repository configures no Files to copy. */
const DEFAULT_INCLUDE_PATTERNS = ".env*";
const WORKTREE_INCLUDE_FILE = ".worktreeinclude";
const COPY_LIST_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const COPY_CONCURRENCY = 8;
const ARCHIVE_TIMEOUT = "60 seconds";

/**
 * Settings files in the order they apply; later files win. Legacy
 * `conductor.json` only counts until the repository has migrated to
 * `.conductor/settings.toml`, matching Conductor.
 */
const SETTINGS_FILES = [
  { path: "conductor.json", format: "json", legacy: true },
  { path: ".conductor/settings.json", format: "json", legacy: false },
  { path: ".conductor/settings.toml", format: "toml", legacy: false },
  { path: ".conductor/settings.local.json", format: "json", legacy: false },
  { path: ".conductor/settings.local.toml", format: "toml", legacy: false },
] as const;

/** Unparseable contents become `undefined`, which the schema then rejects. */
function parseSettingsFile(format: "json" | "toml", raw: string): unknown {
  try {
    return format === "toml" ? parseToml(raw) : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function stringEntries(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

/** Folds decoded settings files (lowest precedence first) into one config. */
function mergeConductorSettings(
  files: ReadonlyArray<ConductorSettingsFile>,
  worktreeInclude: string | null,
): ConductorConfig {
  let setupScript: string | null = null;
  let archiveScript: string | null = null;
  let includeGlobs: string | null = null;
  const environment: Record<string, string> = {};
  for (const file of files) {
    if (file.scripts?.setup !== undefined) setupScript = file.scripts.setup.trim() || null;
    if (file.scripts?.archive !== undefined) archiveScript = file.scripts.archive.trim() || null;
    if (file.file_include_globs !== undefined) includeGlobs = file.file_include_globs;
    const variables = file.environment_variables;
    if (variables !== undefined) {
      Object.assign(environment, stringEntries(variables), stringEntries(variables.local));
    }
  }
  const configured = files.length > 0;
  return {
    setupScript,
    archiveScript,
    // `.worktreeinclude` wins over settings, which win over the default. The
    // file is honored on its own too, as Claude Code worktrees do.
    includePatterns:
      worktreeInclude ?? includeGlobs ?? (configured ? DEFAULT_INCLUDE_PATTERNS : null),
    environment,
    configured,
  };
}

/** Pattern lines git can take as `--exclude` values: no blanks, no comments. */
function includePatternLines(patterns: string): string[] {
  return patterns
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

/**
 * First of the ten ports Conductor hands each workspace (`CONDUCTOR_PORT`
 * through `CONDUCTOR_PORT + 9`). Derived from the worktree path so it is
 * stable across restarts and the same for setup and archive without being
 * stored anywhere.
 */
export function conductorPort(worktreePath: string): number {
  const hash = NodeCrypto.createHash("sha256").update(worktreePath).digest();
  return 30_000 + (hash.readUInt32BE(0) % 2_000) * 10;
}

function conductorScriptEnv(input: {
  readonly projectRoot: string;
  readonly worktreePath: string;
  readonly workspaceName: string;
  readonly defaultBranch: string | null;
  readonly environment: Readonly<Record<string, string>>;
}): Record<string, string> {
  return {
    ...input.environment,
    CONDUCTOR_WORKSPACE_NAME: input.workspaceName,
    CONDUCTOR_WORKSPACE_PATH: input.worktreePath,
    CONDUCTOR_ROOT_PATH: input.projectRoot,
    CONDUCTOR_PORT: String(conductorPort(input.worktreePath)),
    CONDUCTOR_IS_LOCAL: "1",
    ...(input.defaultBranch ? { CONDUCTOR_DEFAULT_BRANCH: input.defaultBranch } : {}),
  };
}

export interface ConductorWorktreeInput {
  readonly projectRoot: string;
  readonly worktreePath: string;
}

export interface ConductorPreparedWorktree {
  /** `scripts.setup`, when the repository declares one. */
  readonly setupScript: string | null;
  /** Conductor variables for scripts in this worktree; empty when unconfigured. */
  readonly env: Readonly<Record<string, string>>;
}

export class ConductorWorkspace extends Context.Service<
  ConductorWorkspace,
  {
    /** Copies Files to copy into a fresh worktree and resolves its setup script and env. */
    readonly prepareWorktree: (
      input: ConductorWorktreeInput,
    ) => Effect.Effect<ConductorPreparedWorktree>;
    /** Runs `scripts.archive` in a worktree that is about to be removed. */
    readonly archiveWorktree: (input: ConductorWorktreeInput) => Effect.Effect<void>;
  }
>()("t3/project/ConductorWorkspace") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const processRunner = yield* ProcessRunner.ProcessRunner;
  const platform = yield* HostProcessPlatform;
  const hostEnv = yield* HostProcessEnvironment;

  const readOptional = (filePath: string) =>
    fileSystem
      .readFileString(filePath)
      .pipe(
        Effect.catch((error) =>
          error.reason._tag === "NotFound"
            ? Effect.succeed(null)
            : Effect.logWarning("failed to read Conductor settings", { filePath, error }).pipe(
                Effect.as(null),
              ),
        ),
      );

  const load = Effect.fn("ConductorWorkspace.load")(function* (projectRoot: string) {
    const contents = yield* Effect.forEach(SETTINGS_FILES, (file) =>
      readOptional(path.join(projectRoot, file.path)).pipe(Effect.map((raw) => ({ ...file, raw }))),
    );
    const migrated = contents.some(
      (file) => file.path === ".conductor/settings.toml" && file.raw !== null,
    );
    const files: ConductorSettingsFile[] = [];
    for (const file of contents) {
      if (file.raw === null || (file.legacy && migrated)) continue;
      const decoded = decodeConductorSettingsFile(parseSettingsFile(file.format, file.raw));
      if (Exit.isSuccess(decoded)) {
        files.push(decoded.value);
      } else {
        yield* Effect.logWarning("ignoring invalid Conductor settings file", {
          filePath: path.join(projectRoot, file.path),
          cause: decoded.cause,
        });
      }
    }
    const worktreeInclude = yield* readOptional(path.join(projectRoot, WORKTREE_INCLUDE_FILE));
    return mergeConductorSettings(files, worktreeInclude);
  });

  const resolveEnv = Effect.fn("ConductorWorkspace.resolveEnv")(function* (
    input: ConductorWorktreeInput,
    config: ConductorConfig,
  ) {
    const defaultBranch = yield* git.resolvePrimaryRemoteName(input.projectRoot).pipe(
      Effect.flatMap((remote) => git.resolveDefaultBranchName(input.projectRoot, remote)),
      Effect.orElseSucceed(() => null),
    );
    return conductorScriptEnv({
      projectRoot: input.projectRoot,
      worktreePath: input.worktreePath,
      workspaceName: path.basename(input.worktreePath),
      defaultBranch,
      environment: config.environment,
    });
  });

  /**
   * Copies gitignored files matching `patterns` from the project root. Git
   * does the matching, so the patterns get exact gitignore semantics, and
   * `check-ignore` drops untracked files that are not ignored, as Conductor
   * does. Files already in the worktree are left alone.
   */
  const copyIncludedFiles = Effect.fn("ConductorWorkspace.copyIncludedFiles")(function* (
    input: ConductorWorktreeInput,
    patterns: string,
  ) {
    const lines = includePatternLines(patterns);
    if (lines.length === 0) return;
    const listed = yield* git.execute({
      operation: "ConductorWorkspace.listIncludedFiles",
      cwd: input.projectRoot,
      args: [
        "ls-files",
        "-z",
        "--others",
        "--ignored",
        ...lines.map((line) => `--exclude=${line}`),
      ],
      maxOutputBytes: COPY_LIST_MAX_OUTPUT_BYTES,
      timeoutMs: 30_000,
    });
    if (listed.stdoutTruncated) {
      return yield* Effect.logWarning(
        "Conductor files to copy match too many files; nothing was copied",
        { projectRoot: input.projectRoot },
      );
    }
    if (listed.stdout.length === 0) return;
    const ignored = yield* git.execute({
      operation: "ConductorWorkspace.filterIgnoredFiles",
      cwd: input.projectRoot,
      args: ["check-ignore", "-z", "--stdin"],
      stdin: listed.stdout,
      // Exit 1 means none of them are ignored.
      allowNonZeroExit: true,
      maxOutputBytes: COPY_LIST_MAX_OUTPUT_BYTES,
      timeoutMs: 30_000,
    });
    const relativePaths = ignored.stdout.split("\0").filter((entry) => entry.length > 0);
    yield* Effect.forEach(
      relativePaths,
      (relativePath) => {
        const target = path.join(input.worktreePath, relativePath);
        return fileSystem.exists(target).pipe(
          Effect.flatMap((exists) =>
            exists
              ? Effect.void
              : fileSystem
                  .makeDirectory(path.dirname(target), { recursive: true })
                  .pipe(
                    Effect.andThen(
                      fileSystem.copyFile(path.join(input.projectRoot, relativePath), target),
                    ),
                  ),
          ),
          Effect.catch((error) =>
            Effect.logWarning("failed to copy Conductor file into worktree", {
              relativePath,
              error,
            }),
          ),
        );
      },
      { concurrency: COPY_CONCURRENCY, discard: true },
    );
    if (relativePaths.length > 0) {
      yield* Effect.logInfo("copied Conductor files into worktree", {
        worktreePath: input.worktreePath,
        count: relativePaths.length,
      });
    }
  });

  const prepareWorktree: ConductorWorkspace["Service"]["prepareWorktree"] = Effect.fn(
    "ConductorWorkspace.prepareWorktree",
  )(function* (input) {
    const config = yield* load(input.projectRoot);
    if (config.includePatterns !== null) {
      yield* copyIncludedFiles(input, config.includePatterns).pipe(
        Effect.catch((error) =>
          Effect.logWarning("failed to copy Conductor files into worktree", { error }),
        ),
      );
    }
    if (!config.configured) return { setupScript: null, env: {} };
    return { setupScript: config.setupScript, env: yield* resolveEnv(input, config) };
  });

  const archiveWorktree: ConductorWorkspace["Service"]["archiveWorktree"] = Effect.fn(
    "ConductorWorkspace.archiveWorktree",
  )(
    function* (input) {
      const config = yield* load(input.projectRoot);
      if (config.archiveScript === null) return;
      if (!(yield* fileSystem.exists(input.worktreePath).pipe(Effect.orElseSucceed(() => false)))) {
        return;
      }
      const env = yield* resolveEnv(input, config);
      const [command, args] =
        platform === "win32"
          ? [hostEnv.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", config.archiveScript]]
          : [hostEnv.SHELL || "/bin/sh", ["-c", config.archiveScript]];
      const result = yield* processRunner.run({
        command,
        args,
        cwd: input.worktreePath,
        env,
        timeout: ARCHIVE_TIMEOUT,
        timeoutBehavior: "timedOutResult",
        maxOutputBytes: 64 * 1024,
        outputMode: "truncate",
      });
      if (result.timedOut || result.code !== 0) {
        yield* Effect.logWarning("Conductor archive script failed", {
          worktreePath: input.worktreePath,
          exitCode: result.code,
          timedOut: result.timedOut,
          stderr: result.stderr.slice(-2_000),
        });
      }
    },
    Effect.catch((error) => Effect.logWarning("Conductor archive script failed to run", { error })),
  );

  return ConductorWorkspace.of({ prepareWorktree, archiveWorktree });
});

export const layer = Layer.effect(ConductorWorkspace, make);

/** A workspace with no Conductor settings, for tests that do not exercise Conductor. */
export const layerNoop = Layer.succeed(ConductorWorkspace, {
  prepareWorktree: () => Effect.succeed({ setupScript: null, env: {} }),
  archiveWorktree: () => Effect.void,
});
