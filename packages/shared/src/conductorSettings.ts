import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";

/**
 * Conductor (conductor.build) repository settings, read the way Conductor
 * reads them so a repository set up for Conductor behaves the same in T3
 * Code. The server applies them to new worktrees; the settings page edits
 * them in place.
 */

export const CONDUCTOR_SETTINGS_PATH = ".conductor/settings.toml";
export const CONDUCTOR_LOCAL_SETTINGS_PATH = ".conductor/settings.local.toml";
export const WORKTREE_INCLUDE_PATH = ".worktreeinclude";
/** Conductor's own default when a repository configures no Files to copy. */
export const DEFAULT_CONDUCTOR_INCLUDE_PATTERNS = ".env*";
export const CONDUCTOR_SETTINGS_SCHEMA_URL =
  "https://conductor.build/schemas/settings.repo.schema.json";

/**
 * Settings files in the order they apply; later files win. Legacy
 * `conductor.json` only counts until the repository has migrated to
 * `.conductor/settings.toml`, matching Conductor.
 */
export const CONDUCTOR_SETTINGS_FILES = [
  { path: "conductor.json", format: "json", legacy: true },
  { path: ".conductor/settings.json", format: "json", legacy: false },
  { path: CONDUCTOR_SETTINGS_PATH, format: "toml", legacy: false },
  { path: ".conductor/settings.local.json", format: "json", legacy: false },
  { path: CONDUCTOR_LOCAL_SETTINGS_PATH, format: "toml", legacy: false },
] as const;
export type ConductorSettingsFilePath = (typeof CONDUCTOR_SETTINGS_FILES)[number]["path"];

const ConductorSettingsFile = Schema.Struct({
  scripts: Schema.optionalKey(
    Schema.Struct({
      setup: Schema.optionalKey(Schema.String),
      archive: Schema.optionalKey(Schema.String),
      // Entries are read leniently by `conductorRunScripts`, so one odd run
      // script cannot make the whole file count as invalid.
      run: Schema.optionalKey(
        Schema.Union([Schema.String, Schema.Record(Schema.String, Schema.Unknown)]),
      ),
      run_mode: Schema.optionalKey(Schema.String),
    }),
  ),
  file_include_globs: Schema.optionalKey(Schema.String),
  environment_variables: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
});
export type ConductorSettingsFile = typeof ConductorSettingsFile.Type;
const decodeConductorSettingsFile = Schema.decodeUnknownExit(ConductorSettingsFile);
const decodeConductorSettingsJson = Schema.decodeUnknownExit(
  Schema.fromJsonString(ConductorSettingsFile),
);

function parseTomlOrUndefined(raw: string): unknown {
  try {
    return parseToml(raw);
  } catch {
    return undefined;
  }
}

/** Decodes one settings file, or null when it is malformed. */
export function parseConductorSettingsFile(
  format: "json" | "toml",
  raw: string,
): ConductorSettingsFile | null {
  const decoded =
    format === "toml"
      ? decodeConductorSettingsFile(parseTomlOrUndefined(raw))
      : decodeConductorSettingsJson(raw);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

const ENVIRONMENT_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Top-level string entries of an `environment_variables` table, without its
 * sections. Keys that are not valid variable names are dropped, as
 * Conductor's schema rejects them.
 */
export function conductorEnvironmentEntries(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === "string" && ENVIRONMENT_KEY_PATTERN.test(entry[0]),
    ),
  );
}

/** A run script from `[scripts.run.<id>]`, or the legacy single `scripts.run` string. */
export interface ConductorRunScript {
  readonly id: string;
  /** The id as Conductor shows it: repeated spaces collapsed, hyphens as spaces. */
  readonly name: string;
  /** `command` followed by its shell-quoted `args`. */
  readonly command: string;
  /** Lucide icon name; Conductor falls back to `play`. */
  readonly icon: string;
  readonly default: boolean;
  /** `options.cwd`, relative to the workspace. */
  readonly cwd: string | null;
}

/** The id Conductor gives a legacy `scripts.run = "..."` string. */
const LEGACY_RUN_SCRIPT_ID = "run";

function quoteShellArg(value: string): string {
  return /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}

function readRunScript(id: string, entry: unknown): ConductorRunScript | null {
  if (!isTable(entry) || typeof entry.command !== "string" || entry.command.trim() === "") {
    return null;
  }
  const availableIn = entry.available_in;
  const local =
    availableIn === undefined ||
    availableIn === "local" ||
    (Array.isArray(availableIn) && availableIn.includes("local"));
  if (!local || entry.hide === true) return null;
  const args = Array.isArray(entry.args)
    ? entry.args.filter((arg): arg is string => typeof arg === "string")
    : [];
  const options = isTable(entry.options) ? entry.options : {};
  return {
    id,
    name: id.replaceAll("-", " ").replace(/\s+/g, " ").trim(),
    command: [entry.command.trim(), ...args.map(quoteShellArg)].join(" "),
    icon: typeof entry.icon === "string" && entry.icon.trim() !== "" ? entry.icon.trim() : "play",
    default: entry.default === true,
    cwd: typeof options.cwd === "string" && options.cwd.trim() !== "" ? options.cwd.trim() : null,
  };
}

/**
 * Merges run scripts across settings files by id, as Conductor matches them:
 * a later file replaces the fields it sets, and `hide = true` removes a
 * shared script on this machine.
 */
function mergeRunScripts(
  merged: Map<string, Record<string, unknown>>,
  run: string | Record<string, unknown>,
) {
  if (typeof run === "string") {
    merged.set(LEGACY_RUN_SCRIPT_ID, { command: run, default: true });
    return;
  }
  for (const [id, entry] of Object.entries(run)) {
    if (isTable(entry)) merged.set(id, { ...merged.get(id), ...entry });
  }
}

export interface ResolvedConductorSettings {
  readonly setupScript: string | null;
  readonly archiveScript: string | null;
  /** Local run scripts in file order, the default one first. */
  readonly runScripts: ReadonlyArray<ConductorRunScript>;
  /** `nonconcurrent` stops other run scripts before starting one. */
  readonly runMode: "concurrent" | "nonconcurrent";
  /** Gitignore-syntax patterns for files copied from the project root, or null for none. */
  readonly includePatterns: string | null;
  /** `environment_variables` plus its `local` section. */
  readonly environment: Readonly<Record<string, string>>;
  /** True when any Conductor settings file exists. */
  readonly configured: boolean;
  /** Settings files that exist but fail to decode; they are ignored. */
  readonly invalidFiles: ReadonlyArray<ConductorSettingsFilePath>;
}

/**
 * Resolves raw file contents (null when a file is missing) into the settings
 * that apply. `.worktreeinclude` wins over `file_include_globs`, which wins
 * over the default; the file is honored on its own too, as Claude Code
 * worktrees do.
 */
export function resolveConductorSettings(input: {
  readonly files: Partial<Record<ConductorSettingsFilePath, string | null>>;
  readonly worktreeInclude: string | null;
}): ResolvedConductorSettings {
  const migrated = typeof input.files[CONDUCTOR_SETTINGS_PATH] === "string";
  let setupScript: string | null = null;
  let archiveScript: string | null = null;
  let includeGlobs: string | null = null;
  const environment: Record<string, string> = {};
  const runEntries = new Map<string, Record<string, unknown>>();
  let runMode: ResolvedConductorSettings["runMode"] = "concurrent";
  const invalidFiles: ConductorSettingsFilePath[] = [];
  let configured = false;
  for (const file of CONDUCTOR_SETTINGS_FILES) {
    const raw = input.files[file.path];
    if (typeof raw !== "string" || (file.legacy && migrated)) continue;
    const settings = parseConductorSettingsFile(file.format, raw);
    if (settings === null) {
      invalidFiles.push(file.path);
      continue;
    }
    configured = true;
    if (settings.scripts?.setup !== undefined) setupScript = settings.scripts.setup.trim() || null;
    if (settings.scripts?.archive !== undefined) {
      archiveScript = settings.scripts.archive.trim() || null;
    }
    if (settings.scripts?.run !== undefined) mergeRunScripts(runEntries, settings.scripts.run);
    if (settings.scripts?.run_mode !== undefined) {
      runMode = settings.scripts.run_mode === "nonconcurrent" ? "nonconcurrent" : "concurrent";
    }
    if (settings.file_include_globs !== undefined) includeGlobs = settings.file_include_globs;
    const variables = settings.environment_variables;
    if (variables !== undefined) {
      Object.assign(
        environment,
        conductorEnvironmentEntries(variables),
        conductorEnvironmentEntries(variables.local),
      );
    }
  }
  const runScripts = [...runEntries]
    .map(([id, entry]) => readRunScript(id, entry))
    .filter((script) => script !== null);
  return {
    setupScript,
    archiveScript,
    // Stable sort: the default script leads, the rest keep file order.
    runScripts: runScripts.sort((a, b) => Number(b.default) - Number(a.default)),
    runMode,
    includePatterns:
      input.worktreeInclude ??
      includeGlobs ??
      (configured ? DEFAULT_CONDUCTOR_INCLUDE_PATTERNS : null),
    environment,
    configured,
    invalidFiles,
  };
}

/** Pattern lines git can take as `--exclude` values: no blanks, no comments. */
export function conductorIncludePatternLines(patterns: string): string[] {
  return patterns
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

/**
 * First of the ten ports Conductor hands each workspace (`CONDUCTOR_PORT`
 * through `CONDUCTOR_PORT + 9`). Derived from the worktree path (FNV-1a) so
 * the server's setup and archive scripts and the client's run scripts agree
 * without storing it anywhere.
 */
export function conductorPort(worktreePath: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < worktreePath.length; index++) {
    hash ^= worktreePath.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return 30_000 + (hash % 2_000) * 10;
}

/** Last path segment, for either separator. */
function baseName(path: string): string {
  return (
    path
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .at(-1) ?? path
  );
}

/**
 * Conductor's variables for a script in a workspace, over the repository's
 * `environment_variables`. `worktreePath` is the project root itself when the
 * thread runs in the main checkout.
 */
export function conductorScriptEnv(input: {
  readonly projectRoot: string;
  readonly worktreePath: string;
  readonly defaultBranch: string | null;
  readonly environment: Readonly<Record<string, string>>;
}): Record<string, string> {
  return {
    ...input.environment,
    CONDUCTOR_WORKSPACE_NAME: baseName(input.worktreePath),
    CONDUCTOR_WORKSPACE_PATH: input.worktreePath,
    CONDUCTOR_ROOT_PATH: input.projectRoot,
    CONDUCTOR_PORT: String(conductorPort(input.worktreePath)),
    CONDUCTOR_IS_LOCAL: "1",
    ...(input.defaultBranch ? { CONDUCTOR_DEFAULT_BRANCH: input.defaultBranch } : {}),
  };
}

/**
 * A change to one settings file. `null` removes the key so the value is
 * inherited from the other files again; `undefined` leaves it alone.
 */
export interface ConductorSettingsPatch {
  readonly setup?: string | null;
  readonly archive?: string | null;
  readonly fileIncludeGlobs?: string | null;
  /** Replaces the file's top-level variables; `local`/`cloud` sections are kept. */
  readonly environment?: Readonly<Record<string, string>> | null;
}

type TomlTable = Record<string, unknown>;

function isTable(value: unknown): value is TomlTable {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function setOrDelete(table: TomlTable, key: string, value: unknown) {
  if (value === null || value === "") delete table[key];
  else table[key] = value;
}

/**
 * Applies a patch to a TOML settings file and returns the new contents.
 * Keys the patch does not touch are kept, including ones T3 Code does not
 * use; comments are not. Throws when `raw` is not valid TOML so a broken file
 * is never overwritten.
 */
export function updateConductorSettingsToml(
  raw: string | null,
  patch: ConductorSettingsPatch,
): string {
  const document: TomlTable =
    raw === null || raw.trim() === ""
      ? { $schema: CONDUCTOR_SETTINGS_SCHEMA_URL }
      : (parseToml(raw) as TomlTable);
  const scripts: TomlTable = isTable(document.scripts) ? { ...document.scripts } : {};
  if (patch.setup !== undefined) setOrDelete(scripts, "setup", patch.setup?.trim() ?? null);
  if (patch.archive !== undefined) setOrDelete(scripts, "archive", patch.archive?.trim() ?? null);
  setOrDelete(document, "scripts", Object.keys(scripts).length > 0 ? scripts : null);
  if (patch.fileIncludeGlobs !== undefined) {
    setOrDelete(document, "file_include_globs", patch.fileIncludeGlobs?.trim() ?? null);
  }
  if (patch.environment !== undefined) {
    const current = isTable(document.environment_variables) ? document.environment_variables : {};
    const sections = Object.fromEntries(
      Object.entries(current).filter(([, value]) => isTable(value)),
    );
    const next = { ...patch.environment, ...sections };
    setOrDelete(document, "environment_variables", Object.keys(next).length > 0 ? next : null);
  }
  return `${stringifyToml(document).trim()}\n`;
}
