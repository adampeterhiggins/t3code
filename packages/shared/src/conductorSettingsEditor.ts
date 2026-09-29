import {
  CONDUCTOR_LOCAL_SETTINGS_PATH,
  CONDUCTOR_SETTINGS_PATH,
  DEFAULT_CONDUCTOR_INCLUDE_PATTERNS,
  conductorEnvironmentEntries,
  parseConductorSettingsFile,
  resolveConductorSettings,
  type ConductorSettingsFilePath,
} from "./conductorSettings.ts";

/**
 * What the Conductor settings editors (web settings page, mobile project
 * settings) show for one target file. Edits go to that file only; values
 * from the other files show as placeholders.
 */

/** `local` edits `.conductor/settings.local.toml` ("Only me"); `shared` edits `.conductor/settings.toml`. */
export type ConductorEditTarget = "local" | "shared";

const CONDUCTOR_EDIT_TARGET_PATH: Record<ConductorEditTarget, ConductorSettingsFilePath> = {
  local: CONDUCTOR_LOCAL_SETTINGS_PATH,
  shared: CONDUCTOR_SETTINGS_PATH,
};
const CONDUCTOR_EDIT_TARGET_LABEL: Record<ConductorEditTarget, string> = {
  local: "settings.local.toml",
  shared: "settings.toml",
};

export interface ConductorEditStatus {
  readonly text: string;
  readonly tone: "muted" | "warning";
}

export interface ConductorEditField {
  /** The target file's own value, empty when it leaves the field unset. */
  readonly value: string;
  /** What applies when the target file leaves the field unset. */
  readonly placeholder: string;
  /** The target file sets this field, so it can be reset. */
  readonly isSet: boolean;
  readonly statuses: ReadonlyArray<ConductorEditStatus>;
}

export interface ConductorEditModel {
  readonly targetPath: ConductorSettingsFilePath;
  readonly targetLabel: string;
  /** Raw contents of the target file, null when it does not exist yet. */
  readonly targetRaw: string | null;
  /** The target file exists but is not valid TOML; editing is disabled. */
  readonly targetInvalid: boolean;
  /** Other settings files that fail to parse and are ignored. */
  readonly otherInvalidFiles: ReadonlyArray<ConductorSettingsFilePath>;
  readonly setup: ConductorEditField;
  readonly archive: ConductorEditField;
  /** Disabled while `.worktreeinclude` exists, which takes precedence. */
  readonly filesToCopy: ConductorEditField & { readonly lockedByWorktreeInclude: boolean };
  /** `KEY=value` lines of the target file's own variables. */
  readonly environment: ConductorEditField;
}

function fieldStatuses(input: {
  readonly target: ConductorEditTarget;
  readonly ownValue: string | undefined;
  readonly inheritedValue: string | null;
  readonly overriddenLocally: boolean;
}): ConductorEditStatus[] {
  const label = CONDUCTOR_EDIT_TARGET_LABEL[input.target];
  if (input.overriddenLocally) {
    return [{ text: "Overridden on this machine by settings.local.toml.", tone: "warning" }];
  }
  if (input.ownValue !== undefined) {
    return [
      {
        text:
          input.inheritedValue === null
            ? `Set in ${label}.`
            : `Set in ${label}, overriding ${input.target === "local" ? "settings.toml" : "defaults"}.`,
        tone: "muted",
      },
    ];
  }
  if (input.inheritedValue !== null) {
    return [
      {
        text: `From ${input.target === "local" ? "settings.toml" : "another settings file"}.`,
        tone: "muted",
      },
    ];
  }
  return [];
}

export function conductorEditModel(input: {
  readonly files: Partial<Record<ConductorSettingsFilePath, string | null>>;
  readonly worktreeInclude: string | null;
  readonly target: ConductorEditTarget;
  /** Name of the project's own setup action, which runs instead of Conductor's. */
  readonly setupActionName?: string | null;
}): ConductorEditModel {
  const targetPath = CONDUCTOR_EDIT_TARGET_PATH[input.target];
  const targetRaw = input.files[targetPath] ?? null;
  const own = targetRaw === null ? {} : parseConductorSettingsFile("toml", targetRaw);
  const resolved = resolveConductorSettings({
    files: input.files,
    worktreeInclude: input.worktreeInclude,
  });
  // What applies if the target file leaves a field unset. Local overrides are
  // left out when editing the repository file; they get their own status.
  const inherited = resolveConductorSettings({
    files: {
      ...input.files,
      [targetPath]: null,
      ...(input.target === "shared"
        ? { [CONDUCTOR_LOCAL_SETTINGS_PATH]: null, ".conductor/settings.local.json": null }
        : {}),
    },
    worktreeInclude: null,
  });
  const local =
    input.target === "shared"
      ? parseConductorSettingsFile("toml", input.files[CONDUCTOR_LOCAL_SETTINGS_PATH] ?? "")
      : null;
  const statuses = (
    ownValue: string | undefined,
    inheritedValue: string | null,
    overriddenLocally: boolean,
  ) => fieldStatuses({ target: input.target, ownValue, inheritedValue, overriddenLocally });

  const setupStatuses = statuses(
    own?.scripts?.setup,
    inherited.setupScript,
    local?.scripts?.setup !== undefined,
  );
  if (input.setupActionName && resolved.setupScript) {
    setupStatuses.push({
      text: `Not used: the project's “${input.setupActionName}” action runs on worktree creation instead.`,
      tone: "warning",
    });
  }
  const ownEnvironment = conductorEnvironmentEntries(own?.environment_variables);
  const inheritedEnvironmentKeys = Object.keys(resolved.environment).filter(
    (key) => !(key in ownEnvironment),
  );
  const lockedByWorktreeInclude = input.worktreeInclude !== null;

  return {
    targetPath,
    targetLabel: CONDUCTOR_EDIT_TARGET_LABEL[input.target],
    targetRaw,
    targetInvalid: own === null,
    otherInvalidFiles: resolved.invalidFiles.filter((path) => path !== targetPath),
    setup: {
      value: own?.scripts?.setup ?? "",
      placeholder: inherited.setupScript ?? "pnpm install",
      isSet: own?.scripts?.setup !== undefined,
      statuses: setupStatuses,
    },
    archive: {
      value: own?.scripts?.archive ?? "",
      placeholder: inherited.archiveScript ?? "docker compose down",
      isSet: own?.scripts?.archive !== undefined,
      statuses: statuses(
        own?.scripts?.archive,
        inherited.archiveScript,
        local?.scripts?.archive !== undefined,
      ),
    },
    filesToCopy: {
      value: input.worktreeInclude ?? own?.file_include_globs ?? "",
      placeholder: inherited.includePatterns ?? DEFAULT_CONDUCTOR_INCLUDE_PATTERNS,
      isSet: own?.file_include_globs !== undefined,
      lockedByWorktreeInclude,
      statuses: lockedByWorktreeInclude
        ? [
            {
              text: "This repository's .worktreeinclude takes precedence, so these patterns are not used.",
              tone: "warning",
            },
          ]
        : statuses(
            own?.file_include_globs,
            inherited.configured ? inherited.includePatterns : null,
            local?.file_include_globs !== undefined,
          ),
    },
    environment: {
      value: Object.entries(ownEnvironment)
        .map(([key, value]) => `${key}=${value}`)
        .join("\n"),
      placeholder: "API_URL=http://localhost:3000",
      isSet: own?.environment_variables !== undefined,
      statuses:
        inheritedEnvironmentKeys.length > 0
          ? [
              {
                text: `Also set by other settings files: ${inheritedEnvironmentKeys.join(", ")}.`,
                tone: "muted",
              },
            ]
          : [],
    },
  };
}

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** `KEY=value` lines to a record, or a message naming the first bad line. */
export function parseConductorEnvironmentLines(text: string): Record<string, string> | string {
  const entries: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    const key = separator === -1 ? trimmed : trimmed.slice(0, separator).trim();
    if (separator === -1 || !ENV_KEY_PATTERN.test(key)) {
      return `“${trimmed}” is not a KEY=value line.`;
    }
    entries[key] = trimmed.slice(separator + 1).trim();
  }
  return entries;
}
