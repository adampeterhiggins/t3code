import type { EnvironmentId } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  CONDUCTOR_LOCAL_SETTINGS_PATH,
  CONDUCTOR_SETTINGS_PATH,
  DEFAULT_CONDUCTOR_INCLUDE_PATTERNS,
  WORKTREE_INCLUDE_PATH,
  conductorEnvironmentEntries,
  parseConductorSettingsFile,
  resolveConductorSettings,
  updateConductorSettingsToml,
  type ConductorSettingsPatch,
} from "@t3tools/shared/conductorSettings";
import { setupProjectScript } from "@t3tools/shared/projectScripts";
import { useRef, useState, type ReactNode } from "react";

import { projectEnvironment } from "~/state/projects";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  clearProjectFileQueryData,
  confirmProjectFileQueryData,
  getOptimisticProjectFileQueryData,
  setProjectFileQueryData,
  useProjectFileQuery,
} from "../files/projectFilesQueryState";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { SettingResetButton, SettingsRow, SettingsSection } from "./settingsLayout";
import { useSettingsScope } from "./SettingsScopeContext";

type Target = "local" | "shared";

const TARGET_PATH: Record<Target, string> = {
  local: CONDUCTOR_LOCAL_SETTINGS_PATH,
  shared: CONDUCTOR_SETTINGS_PATH,
};
const TARGET_LABEL: Record<Target, string> = {
  local: "settings.local.toml",
  shared: "settings.toml",
};
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * The project's Conductor settings (`.conductor/settings.toml` and the
 * uncommitted `settings.local.toml`), edited in place in the representative
 * checkout. The server applies them when it creates a worktree; see
 * `apps/server/src/project/ConductorWorkspace.ts`.
 */
export function ConductorSettings() {
  const { scope, target } = useSettingsScope();
  const member =
    (scope.kind === "project" || scope.kind === "checkout") && target?.projectId
      ? scope.members.find((candidate) => candidate.id === target.projectId)
      : undefined;
  if (!member) return null;
  const setupAction = setupProjectScript(target?.settings.defaultProjectScripts ?? []);
  return (
    <ConductorSettingsSection
      environmentId={member.environmentId}
      cwd={member.workspaceRoot}
      setupActionName={setupAction?.name ?? null}
    />
  );
}

function fileContents(query: ReturnType<typeof useProjectFileQuery>): string | null {
  return query.data && !query.data.truncated ? query.data.contents : null;
}

function ConductorSettingsSection({
  environmentId,
  cwd,
  setupActionName,
}: {
  environmentId: EnvironmentId;
  cwd: string;
  setupActionName: string | null;
}) {
  const [target, setTarget] = useState<Target>("local");
  const writeFile = useAtomCommand(projectEnvironment.writeFile, { reportFailure: false });

  // Every file Conductor reads, so the page resolves exactly what the server will.
  const files = {
    "conductor.json": fileContents(useProjectFileQuery(environmentId, cwd, "conductor.json")),
    ".conductor/settings.json": fileContents(
      useProjectFileQuery(environmentId, cwd, ".conductor/settings.json"),
    ),
    [CONDUCTOR_SETTINGS_PATH]: fileContents(
      useProjectFileQuery(environmentId, cwd, CONDUCTOR_SETTINGS_PATH),
    ),
    ".conductor/settings.local.json": fileContents(
      useProjectFileQuery(environmentId, cwd, ".conductor/settings.local.json"),
    ),
    [CONDUCTOR_LOCAL_SETTINGS_PATH]: fileContents(
      useProjectFileQuery(environmentId, cwd, CONDUCTOR_LOCAL_SETTINGS_PATH),
    ),
  };
  const worktreeInclude = fileContents(
    useProjectFileQuery(environmentId, cwd, WORKTREE_INCLUDE_PATH),
  );

  const targetPath = TARGET_PATH[target];
  const targetRaw = files[targetPath as keyof typeof files];
  const own = targetRaw === null ? {} : parseConductorSettingsFile("toml", targetRaw);
  // What applies if the target file leaves a field unset. Local overrides are
  // left out when editing the repository file; they get their own status.
  const inherited = resolveConductorSettings({
    files: {
      ...files,
      [targetPath]: null,
      ...(target === "shared"
        ? { [CONDUCTOR_LOCAL_SETTINGS_PATH]: null, ".conductor/settings.local.json": null }
        : {}),
    },
    worktreeInclude: null,
  });
  const resolved = resolveConductorSettings({ files, worktreeInclude });
  const local =
    target === "shared"
      ? parseConductorSettingsFile("toml", files[CONDUCTOR_LOCAL_SETTINGS_PATH] ?? "")
      : null;

  // Saves run one at a time, each on top of the previous one's contents, so
  // editing a second field while the first is still writing loses nothing.
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const save = (patch: ConductorSettingsPatch) => {
    const path = targetPath;
    const label = TARGET_LABEL[target];
    const fallbackRaw = targetRaw;
    saveQueue.current = saveQueue.current.then(async () => {
      const currentRaw =
        getOptimisticProjectFileQueryData(environmentId, cwd, path)?.contents ?? fallbackRaw;
      let contents: string;
      try {
        contents = updateConductorSettingsToml(currentRaw, patch);
      } catch {
        toastManager.add({
          type: "error",
          title: `Could not update ${label}`,
          description: "The file is not valid TOML. Fix it by hand first.",
        });
        return;
      }
      setProjectFileQueryData(environmentId, cwd, path, contents);
      const result = await writeFile({
        environmentId,
        input: { cwd, relativePath: path, contents },
      });
      if (result._tag === "Success") {
        confirmProjectFileQueryData(environmentId, cwd, path, contents);
        return;
      }
      clearProjectFileQueryData(environmentId, cwd, path);
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add({
          type: "error",
          title: `Could not save ${label}`,
          description: error instanceof Error ? error.message : undefined,
        });
      }
    });
    // A failed save must not stall the ones queued after it.
    saveQueue.current = saveQueue.current.catch((error: unknown) => {
      clearProjectFileQueryData(environmentId, cwd, path);
      toastManager.add({
        type: "error",
        title: `Could not save ${label}`,
        description: error instanceof Error ? error.message : undefined,
      });
    });
  };

  const disabled = own === null;
  const inheritedSource = target === "local" ? "settings.toml" : "defaults";

  /** Where a field's value comes from, as shown under its title. */
  const fieldStatus = (input: {
    ownValue: string | undefined;
    inheritedValue: string | null;
    overridden: boolean;
    note?: ReactNode;
  }): ReactNode => {
    const parts: ReactNode[] = [];
    if (input.overridden) {
      parts.push(
        <span key="overridden" className="text-warning">
          Overridden on this machine by settings.local.toml.
        </span>,
      );
    } else if (input.ownValue !== undefined) {
      parts.push(
        input.inheritedValue === null
          ? `Set in ${TARGET_LABEL[target]}.`
          : `Set in ${TARGET_LABEL[target]}, overriding ${inheritedSource}.`,
      );
    } else if (input.inheritedValue !== null) {
      parts.push(`From ${target === "local" ? "settings.toml" : "another settings file"}.`);
    }
    if (input.note) parts.push(input.note);
    return parts.length > 0 ? <span className="flex flex-col gap-0.5">{parts}</span> : null;
  };

  const resetButton = (label: string, ownValue: unknown, patch: ConductorSettingsPatch) =>
    ownValue === undefined ? null : (
      <SettingResetButton
        label={label}
        tooltip={`Remove from ${TARGET_LABEL[target]}`}
        disabled={disabled}
        onClick={() => save(patch)}
      />
    );

  const ownEnvironment = conductorEnvironmentEntries(own?.environment_variables);
  const inheritedEnvironmentKeys = Object.keys(resolved.environment).filter(
    (key) => !(key in ownEnvironment),
  );

  return (
    <SettingsSection id="project-conductor" title="Conductor">
      <SettingsRow
        title="Save changes to"
        description={
          <>
            New worktrees copy these files and run these scripts, as Conductor does.{" "}
            <b className="font-medium">Only me</b> writes the uncommitted{" "}
            <code>.conductor/settings.local.toml</code>; <b className="font-medium">Repository</b>{" "}
            writes <code>.conductor/settings.toml</code> for everyone who clones it.
          </>
        }
        control={
          <ToggleGroup
            aria-label="Conductor settings file"
            value={[target]}
            onValueChange={(next) => {
              const value = next[0];
              if (value === "local" || value === "shared") setTarget(value);
            }}
          >
            <Toggle value="local">Only me</Toggle>
            <Toggle value="shared">Repository</Toggle>
          </ToggleGroup>
        }
      />
      {own === null ? (
        <SettingsRow
          className="text-warning"
          title={`${TARGET_LABEL[target]} is invalid`}
          description="It is not valid TOML, so it is ignored and cannot be edited here. Fix it in an editor."
        />
      ) : null}
      {resolved.invalidFiles
        .filter((path) => path !== targetPath)
        .map((path) => (
          <SettingsRow
            key={path}
            className="text-warning"
            title={`${path} is invalid`}
            description="It fails to parse, so new worktrees ignore it."
          />
        ))}

      <SettingsRow
        title="Setup script"
        description="Runs in each new worktree after it is created."
        status={fieldStatus({
          ownValue: own?.scripts?.setup,
          inheritedValue: inherited.setupScript,
          overridden: local?.scripts?.setup !== undefined,
          ...(setupActionName && resolved.setupScript
            ? {
                note: (
                  <span className="text-warning">
                    Not used: the project's “{setupActionName}” action runs on worktree creation
                    instead.
                  </span>
                ),
              }
            : {}),
        })}
        resetAction={resetButton("setup script", own?.scripts?.setup, { setup: null })}
      >
        <ScriptField
          ariaLabel="Setup script"
          value={own?.scripts?.setup ?? ""}
          placeholder={inherited.setupScript ?? "pnpm install"}
          disabled={disabled}
          onCommit={(next) => save({ setup: next })}
        />
      </SettingsRow>

      <SettingsRow
        title="Archive script"
        description="Runs in a worktree just before T3 Code removes it."
        status={fieldStatus({
          ownValue: own?.scripts?.archive,
          inheritedValue: inherited.archiveScript,
          overridden: local?.scripts?.archive !== undefined,
        })}
        resetAction={resetButton("archive script", own?.scripts?.archive, { archive: null })}
      >
        <ScriptField
          ariaLabel="Archive script"
          value={own?.scripts?.archive ?? ""}
          placeholder={inherited.archiveScript ?? "docker compose down"}
          disabled={disabled}
          onCommit={(next) => save({ archive: next })}
        />
      </SettingsRow>

      <SettingsRow
        title="Files to copy"
        description="Gitignored files matching these patterns are copied from this checkout into each new worktree. Uses .gitignore syntax, one pattern per line."
        status={
          worktreeInclude !== null ? (
            <span className="text-warning">
              This repository's .worktreeinclude takes precedence, so these patterns are not used.
            </span>
          ) : (
            fieldStatus({
              ownValue: own?.file_include_globs,
              inheritedValue: inherited.configured ? inherited.includePatterns : null,
              overridden: local?.file_include_globs !== undefined,
            })
          )
        }
        resetAction={resetButton("files to copy", own?.file_include_globs, {
          fileIncludeGlobs: null,
        })}
      >
        <ScriptField
          ariaLabel="Files to copy"
          value={worktreeInclude ?? own?.file_include_globs ?? ""}
          placeholder={inherited.includePatterns ?? DEFAULT_CONDUCTOR_INCLUDE_PATTERNS}
          disabled={disabled || worktreeInclude !== null}
          onCommit={(next) => save({ fileIncludeGlobs: next })}
        />
      </SettingsRow>

      <SettingsRow
        title="Environment variables"
        description={
          <>
            Passed to the setup and archive scripts, one <code>KEY=value</code> per line, alongside
            CONDUCTOR_ROOT_PATH, CONDUCTOR_WORKSPACE_PATH, CONDUCTOR_PORT, and the other Conductor
            variables.
          </>
        }
        status={
          inheritedEnvironmentKeys.length > 0
            ? `Also set by other settings files: ${inheritedEnvironmentKeys.join(", ")}.`
            : null
        }
        resetAction={resetButton("environment variables", own?.environment_variables, {
          environment: null,
        })}
      >
        <ScriptField
          ariaLabel="Environment variables"
          value={Object.entries(ownEnvironment)
            .map(([key, value]) => `${key}=${value}`)
            .join("\n")}
          placeholder="API_URL=http://localhost:3000"
          disabled={disabled}
          onCommit={(next) => {
            const parsed = parseEnvironmentLines(next);
            if (typeof parsed === "string") {
              toastManager.add({
                type: "error",
                title: "Environment variables not saved",
                description: parsed,
              });
              return;
            }
            save({ environment: parsed });
          }}
        />
      </SettingsRow>
    </SettingsSection>
  );
}

/** `KEY=value` lines to a record, or a message naming the first bad line. */
function parseEnvironmentLines(text: string): Record<string, string> | string {
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

/**
 * A monospace textarea that saves when it loses focus (or on Cmd/Ctrl+Enter),
 * so typing never writes the file on every keystroke.
 */
function ScriptField({
  ariaLabel,
  value,
  placeholder,
  disabled,
  onCommit,
}: {
  ariaLabel: string;
  value: string;
  placeholder: string;
  disabled: boolean;
  onCommit: (next: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div className="pt-2 pb-3">
      <Textarea
        size="sm"
        variant="code"
        aria-label={ariaLabel}
        spellCheck={false}
        value={draft ?? value}
        placeholder={placeholder}
        disabled={disabled}
        onFocus={() => setDraft(value)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const next = draft ?? value;
          setDraft(null);
          if (next.trim() !== value.trim()) onCommit(next);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
      />
    </div>
  );
}
